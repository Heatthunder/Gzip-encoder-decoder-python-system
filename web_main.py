"""PyScript web bridge: connects DOM events to pure core_logic functions."""

from __future__ import annotations

import io
import json
import base64
import asyncio

from js import Blob, Uint8Array, URL, document as js_document
from pyodide.ffi import create_proxy
from pyodide.ffi import to_js
from pyscript import document, when

from core_logic import extract_logic, pack_logic


status_el = document.querySelector("#status")
editor_el = document.querySelector("#editor")
file_input_el = document.querySelector("#file-upload")
dropzone_el = document.querySelector("#dropzone")


def set_status(message: str, is_error: bool = False) -> None:
    """Render status text in the UI."""
    status_el.innerText = message
    status_el.style.color = "#b00020" if is_error else "#1f2937"


def _infer_json_filename(upload_name: str) -> str:
    """Map uploaded filename to a stable JSON name for gzip header metadata."""
    if upload_name.lower().endswith(".gz"):
        return f"{upload_name[:-3]}.json"
    return "save.json"


def _is_base64_payload(text: str) -> bool:
    """Best-effort check for pasted/dropped Base64 content."""
    candidate = "".join(text.split())
    if not candidate:
        return False
    try:
        decoded = base64.b64decode(candidate, validate=True)
        # Require non-empty bytes to avoid false positives.
        return bool(decoded)
    except Exception:
        return False


def _load_json_text(json_text: str, source_label: str) -> None:
    """Validate incoming JSON text and load it into editor."""
    parsed = json.loads(json_text)
    editor_el.value = json.dumps(parsed, indent=2, ensure_ascii=False)
    set_status(f"Detected JSON input ({source_label}) → loaded to editor")


def _load_gzip_bytes(gz_bytes: bytes, source_label: str) -> None:
    """Decode gzip payload into pretty-printed JSON editor content."""
    with io.BytesIO(gz_bytes) as _stream:
        json_text = extract_logic(_stream.getvalue())

    editor_el.value = json_text
    set_status(f"Detected gzip input ({source_label}) → decoded successfully")


async def _handle_dropped_file(file_obj) -> None:
    """Route dropped file to decode or encode path based on extension."""
    name = (file_obj.name or "").lower()
    if name.endswith(".json.gz") or name.endswith(".gz") or name.endswith(".gzip"):
        set_status(f"Detected file type: {file_obj.name} (decode path)")
        gz_bytes = bytes(Uint8Array.new(await file_obj.arrayBuffer()).to_py())
        _load_gzip_bytes(gz_bytes, file_obj.name)
        return

    if name.endswith(".json"):
        set_status(f"Detected file type: {file_obj.name} (encode path)")
        json_text = await file_obj.text()
        _load_json_text(json_text, file_obj.name)
        return

    set_status(
        f"Unsupported dropped file type: {file_obj.name}. "
        "Use .json.gz/.gz or .json files.",
        is_error=True,
    )


def _handle_dropped_text(raw_text: str, source_label: str = "text drop") -> None:
    """Route dropped text to Base64 decode path when possible."""
    text = (raw_text or "").strip()
    if not text:
        set_status("Dropped text is empty.", is_error=True)
        return

    if not _is_base64_payload(text):
        set_status("Dropped text is not valid Base64.", is_error=True)
        return

    set_status("Detected text payload: Base64 (decode path)")
    gz_bytes = base64.b64decode("".join(text.split()))
    _load_gzip_bytes(gz_bytes, source_label)


@when("change", "#file-upload")
async def on_file_selected(event):
    """Load a selected gzip save file, decode it, and place JSON in editor."""
    try:
        files = event.target.files
        if not files or files.length == 0:
            set_status("No file selected.", is_error=True)
            return

        file_obj = files.item(0)
        buffer = await file_obj.arrayBuffer()
        gz_bytes = bytes(Uint8Array.new(buffer).to_py())
        _load_gzip_bytes(gz_bytes, file_obj.name)
    except Exception as exc:  # Surface parse/decompression errors to user.
        set_status(f"Failed to load file: {exc}", is_error=True)


@when("click", "#download-btn")
def on_download_clicked(event):
    """Read JSON from editor, repack as gzip bytes, and trigger download."""
    try:
        json_text = editor_el.value or ""
        if not json_text.strip():
            set_status("Editor is empty; nothing to pack.", is_error=True)
            return

        upload_name = file_input_el.files.item(0).name if file_input_el.files.length else ""
        packed_bytes = pack_logic(json_text, filename=_infer_json_filename(upload_name))

        uint8_data = Uint8Array.new(to_js(memoryview(packed_bytes)))
        blob = Blob.new([uint8_data], to_js({"type": "application/gzip"}))

        download_url = URL.createObjectURL(blob)
        anchor = js_document.createElement("a")
        anchor.href = download_url
        anchor.download = "save.gz"
        js_document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(download_url)

        set_status("Packed and downloaded save.gz")
    except Exception as exc:  # Surface JSON validation/compression errors.
        set_status(f"Failed to pack file: {exc}", is_error=True)


def _register_drag_and_drop() -> None:
    """Attach drag-and-drop listeners to the visible dropzone."""
    drag_counter = {"count": 0}

    def _prevent_default(event):
        event.preventDefault()
        event.stopPropagation()

    def _on_dragenter(event):
        _prevent_default(event)
        drag_counter["count"] += 1
        dropzone_el.classList.add("is-active")
        set_status("Drag detected: drop file or Base64 text into the dropzone")

    def _on_dragover(event):
        _prevent_default(event)

    def _on_dragleave(event):
        _prevent_default(event)
        drag_counter["count"] = max(0, drag_counter["count"] - 1)
        if drag_counter["count"] == 0:
            dropzone_el.classList.remove("is-active")

    async def _on_drop_async(event):
        _prevent_default(event)
        drag_counter["count"] = 0
        dropzone_el.classList.remove("is-active")

        dt = event.dataTransfer
        files = dt.files if dt else None
        if files and files.length > 0:
            await _handle_dropped_file(files.item(0))
            return

        dropped_text = dt.getData("text/plain") if dt else ""
        _handle_dropped_text(dropped_text)

    def _on_drop(event):
        asyncio.create_task(_on_drop_async(event))

    def _on_paste(event):
        pasted_text = event.clipboardData.getData("text/plain")
        if pasted_text and pasted_text.strip():
            try:
                _handle_dropped_text(pasted_text, source_label="pasted text")
            except Exception as exc:
                set_status(f"Failed to decode pasted text: {exc}", is_error=True)

    # Keep proxy references alive for listener lifetime.
    global _dnd_proxies
    _dnd_proxies = {
        "dragenter": create_proxy(_on_dragenter),
        "dragover": create_proxy(_on_dragover),
        "dragleave": create_proxy(_on_dragleave),
        "drop": create_proxy(_on_drop),
        "paste": create_proxy(_on_paste),
    }

    for event_name in ("dragenter", "dragover", "dragleave", "drop"):
        js_document.addEventListener(event_name, _dnd_proxies[event_name], False)
        dropzone_el.addEventListener(event_name, _dnd_proxies[event_name], False)
    js_document.addEventListener("paste", _dnd_proxies["paste"], False)


_register_drag_and_drop()
