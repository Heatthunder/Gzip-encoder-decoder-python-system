// web_main.js
// DOM bridge: connects UI events to core_logic.js. Structurally mirrors
// web_main.py 1:1 (same event names, same status messages) so the behavior
// doesn't change — only the runtime does.

import {
  extractLogic,
  packLogic,
  gzBytesToBase64,
  base64ToGzBytes,
  base64ToJsonText,
  jsonTextToBase64,
} from "./core_logic.js";

const statusEl = document.querySelector("#status");
const editorEl = document.querySelector("#editor");
const base64El = document.querySelector("#base64-text");
const fileInputEl = document.querySelector("#file-upload");
const dropzoneEl = document.querySelector("#dropzone");

function setStatus(message, isError = false) {
  statusEl.innerText = message;
  statusEl.style.color = isError ? "#fca5a5" : "#e5e7eb";
}

function errorMessage(exc) {
  return exc && exc.message ? exc.message : String(exc);
}

function triggerDownload(filename, payload, mimeType) {
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function loadGzipBytes(gzBytes, sourceLabel) {
  editorEl.value = await extractLogic(gzBytes);
  base64El.value = gzBytesToBase64(gzBytes);
  setStatus(`Detected gzip input (${sourceLabel}) -> decoded successfully`);
}

function loadJsonText(jsonText, sourceLabel) {
  const parsed = JSON.parse(jsonText); // throws on invalid JSON; caller handles it
  editorEl.value = JSON.stringify(parsed, null, 2);
  setStatus(`Detected JSON input (${sourceLabel}) -> loaded to editor`);
}

async function handleDroppedFile(file) {
  const name = (file.name || "").toLowerCase();

  if (name.endsWith(".json.gz") || name.endsWith(".gz") || name.endsWith(".gzip")) {
    setStatus(`Detected file type: ${file.name} (decode path)`);
    const gzBytes = new Uint8Array(await file.arrayBuffer());
    await loadGzipBytes(gzBytes, file.name);
    return;
  }

  if (name.endsWith(".json")) {
    setStatus(`Detected file type: ${file.name} (encode path)`);
    loadJsonText(await file.text(), file.name);
    return;
  }

  setStatus(`Unsupported dropped file type: ${file.name}. Use .json.gz/.gz or .json files.`, true);
}

async function handleDroppedText(rawText, sourceLabel = "text drop") {
  const text = (rawText || "").trim();
  if (!text) {
    setStatus("Dropped text is empty.", true);
    return;
  }

  let gzBytes;
  try {
    gzBytes = await base64ToGzBytes(text.replace(/\s+/g, ""));
  } catch (exc) {
    setStatus("Dropped text is not valid Base64 gzip content.", true);
    return;
  }

  setStatus("Detected text payload: Base64 (decode path)");
  await loadGzipBytes(gzBytes, sourceLabel);
}

fileInputEl.addEventListener("change", async (event) => {
  try {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setStatus("No file selected.", true);
      return;
    }
    const file = files.item(0);
    const gzBytes = new Uint8Array(await file.arrayBuffer());
    await loadGzipBytes(gzBytes, file.name);
  } catch (exc) {
    setStatus(`Failed to load file: ${errorMessage(exc)}`, true);
  }
});

document.querySelector("#b64-to-json-btn").addEventListener("click", async () => {
  try {
    editorEl.value = await base64ToJsonText(base64El.value || "");
    setStatus("Decoded Base64 into JSON editor.");
  } catch (exc) {
    setStatus(`Failed to decode Base64: ${errorMessage(exc)}`, true);
  }
});

document.querySelector("#b64-to-gz-btn").addEventListener("click", async () => {
  try {
    const gzBytes = await base64ToGzBytes(base64El.value || "");
    triggerDownload("save.json.gz", gzBytes, "application/gzip");
    setStatus("Decoded Base64 and downloaded save.json.gz");
  } catch (exc) {
    setStatus(`Failed to build gzip from Base64: ${errorMessage(exc)}`, true);
  }
});

document.querySelector("#json-to-b64-btn").addEventListener("click", async () => {
  try {
    const jsonText = editorEl.value || "";
    base64El.value = await jsonTextToBase64(jsonText);
    setStatus("Converted JSON editor content to Base64.");
  } catch (exc) {
    setStatus(`Failed to convert JSON: ${errorMessage(exc)}`, true);
  }
});

document.querySelector("#download-btn").addEventListener("click", async () => {
  try {
    const jsonText = editorEl.value || "";
    const gzBytes = await packLogic(jsonText);
    triggerDownload("save.json.gz", gzBytes, "application/gzip");
    setStatus("Packed JSON editor and downloaded save.json.gz");
  } catch (exc) {
    setStatus(`Failed to pack file: ${errorMessage(exc)}`, true);
  }
});

function registerDragAndDrop() {
  if (!dropzoneEl) return;

  let dragCounter = 0;

  const preventDefault = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onDragEnter = (event) => {
    preventDefault(event);
    dragCounter += 1;
    dropzoneEl.classList.add("is-active");
    setStatus("Drag detected: drop file or Base64 text into the dropzone");
  };

  const onDragOver = (event) => {
    preventDefault(event);
  };

  const onDragLeave = (event) => {
    preventDefault(event);
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dropzoneEl.classList.remove("is-active");
  };

  const onDrop = async (event) => {
    try {
      preventDefault(event);
      dragCounter = 0;
      dropzoneEl.classList.remove("is-active");

      const dt = event.dataTransfer;
      const files = dt ? dt.files : null;
      if (files && files.length > 0) {
        await handleDroppedFile(files.item(0));
        return;
      }

      const droppedText = dt ? dt.getData("text/plain") : "";
      await handleDroppedText(droppedText);
    } catch (exc) {
      setStatus(`Failed to process drop input: ${errorMessage(exc)}`, true);
    }
  };

  const onPaste = async (event) => {
    // Limit decode side-effects to intentional paste inside the dropzone.
    const target = event.target;
    if (target !== dropzoneEl && !dropzoneEl.contains(target)) return;

    const clipboard = event.clipboardData;
    if (!clipboard) return;

    const pastedText = clipboard.getData("text/plain");
    if (pastedText && pastedText.trim()) {
      try {
        await handleDroppedText(pastedText, "pasted text");
      } catch (exc) {
        setStatus(`Failed to decode pasted text: ${errorMessage(exc)}`, true);
      }
    }
  };

  // NOTE: bound to both document and the dropzone element, same as the
  // original web_main.py — kept as-is for behavioral parity. This does mean
  // dropzone-internal events technically reach two listeners (bubbling +
  // the direct binding); it was already the case before this port, so I
  // left it alone rather than changing behavior as a side effect of the
  // rewrite. Flag if you'd like it deduplicated.
  for (const [name, handler] of Object.entries({
    dragenter: onDragEnter,
    dragover: onDragOver,
    dragleave: onDragLeave,
    drop: onDrop,
  })) {
    document.addEventListener(name, handler, false);
    dropzoneEl.addEventListener(name, handler, false);
  }
  document.addEventListener("paste", onPaste, false);
}

registerDragAndDrop();