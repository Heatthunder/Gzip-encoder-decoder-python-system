# gzip-json-tools

**A lightweight utility — CLI and browser-based — for managing gzipped JSON save files.**

## Purpose
Many modern games and applications store data as **minified JSON** compressed with **Gzip** to save space. This makes manual editing nearly impossible without the right tools.

**Specifically built for:** [Text-Adventure-Game-REBUILT](https://github.com/Heatthunder/Text-Adventure-Game-REBUILT) and [REBUILT-Web-Build](https://github.com/Heatthunder/Text-Adventure-Game-REBUILT-Web-Build)

This utility provides a reliable "roundtrip" workflow for developers and modders to:
1. **Decompress** and "pretty-print" JSON for easy manual editing.
2. **Recompress** edited JSON back into the specific Gzip format the application expects.
3. **Verify** that the data remains valid and uncorrupted through automated integrity checks.

Two ways to use it:
- **CLI tool** (`main.py`) — for scripting, CI, and terminal-based workflows.
- **Web tool** (`index.html`) — a browser-based editor with drag-and-drop, no install required. Deployed via GitHub Pages.

Both tools — plus the game's own save system (`save.py` / `global_save.py`) — share the exact same codec: `base64(gzip(json.dumps(data, separators=(",", ":"))))` with `mtime=0`. Files packed by any one of them are byte-identical to files packed by the others for the same JSON content.

---

## Disclaimer
**Use this tool at your own risk.** Modifying game saves can lead to data loss or character corruption. Always keep an original, untouched backup of your save files in a separate folder before using this utility. The author is not responsible for any damage caused by the use of this software.

---

## Requirements

### CLI
* **Python 3.10+** (3.11+ recommended)
* **Standard Library Only**: No third-party packages (like `pip install`) are required.

### Web
* Any modern browser (Chrome, Edge, Firefox, or Safari released after ~mid-2023) — the tool relies on the built-in `CompressionStream`/`DecompressionStream` gzip support, which has been standard/widely available across major browsers since May 2023.
* No install, no build step, no PyScript/Pyodide dependency. `index.html` loads a plain JS module directly.
* **Local testing note:** opening `index.html` directly via a `file://` URL will fail in most browsers, since ES modules (`<script type="module">`) are blocked by CORS under `file://`. Serve the folder with a simple local server instead, e.g. `python3 -m http.server` from the project folder, then visit `http://localhost:8000`. This restriction doesn't apply once deployed to GitHub Pages (served over `https://`).

---

## CLI Tool

### Running it

Open a terminal (Command Prompt, PowerShell, macOS Terminal, Linux shell), then:

1. **Go to the project folder:**
```bash
cd /path/to/gzip-json-tools
```

2. Check Python is available:

```bash
python3 --version
```

If `python3` is not recognized on Windows, use:

```bash
python --version
```

3. Show command help:

```bash
python3 main.py -h
```

If you run from an IDE debugger, make sure you pass command arguments (for example: `pack your_save.json -o your_save.json.gz`).

### Quick start (first time with your game save)

If your game already creates a `.json.gz` save, inspect it directly:

```bash
python3 main.py info your_save.json.gz
```

If your game save is plain JSON (not gzipped) and you want to create gzip first:

```bash
python3 main.py pack your_save.json -o your_save.json.gz --mtime 0
```

Then verify the roundtrip behavior:

```bash
python3 main.py roundtrip your_save.json.gz
```

And create a backup before editing:

```bash
python3 main.py backup your_save.json.gz
```

### Usage

**Extract a `.json.gz` file to JSON**

```bash
python3 main.py extract file.json.gz -o file.json
```

**Pack a JSON file back to gzip**

```bash
python3 main.py pack file.json -o file.json.gz --level 9 --mtime 0
```

**Verify roundtrip integrity**

```bash
python3 main.py roundtrip file.json.gz
```

**Inspect file metadata and hash**

```bash
python3 main.py info file.json.gz
```

**Create a backup before editing**

```bash
python3 main.py backup file.json.gz
```

**Base64 conversions** (useful for pasting a save into/out of a text field, e.g. the game's in-browser import/export flow)

```bash
python3 main.py gz-to-b64 file.json.gz              # .gz file -> Base64 text (stdout)
python3 main.py b64-to-gz -i b64.txt -o file.json.gz # Base64 text -> .gz file
python3 main.py b64-to-json -i b64.txt -o file.json  # Base64 text -> pretty JSON
python3 main.py json-to-b64 file.json                # JSON file -> Base64 text (stdout)
```

### Command reference

```text
extract       Extract a gzipped JSON file (pretty output by default)
pack          Pack a JSON file into gzip (minified JSON)
backup        Create a timestamped backup copy of a file
roundtrip     Extract -> Pack -> Verify equivalence
info          Print metadata and integrity info
gz-to-b64     Read .json.gz bytes and print Base64
b64-to-gz     Decode Base64 input and write .json.gz output
b64-to-json   Decode Base64 input and output pretty JSON
json-to-b64   Read .json and print Base64 gz payload
```

---

## Web Tool

### Opening it

- **Deployed copy:** open the GitHub Pages URL for this repo (see the repo's "About" section or Settings → Pages once deployed).
- **Local copy:** serve the project folder with a local HTTP server (see the `file://` note under Requirements above), then open `index.html` from that server in your browser.

### How to use

1. Load a save via any of:
   - Dragging a `.json.gz`/`.gz` file, a `.json` file, or Base64 text directly onto the dropzone.
   - Clicking the file upload control to pick a `.json.gz` file.
   - Pasting Base64 text into the dropzone.
2. Edit the JSON in the editor panel as needed.
3. Convert or export using the buttons:
   - **Base64 → JSON** — decode the Base64 field into the editor.
   - **JSON → Base64** — minify and gzip the editor content into the Base64 field.
   - **Base64 → download `.gz`** — decode the Base64 field and download it as a `.json.gz` file.
   - **Download `.gz`** — pack the editor's current JSON and download it as `.json.gz` directly.
4. Status messages appear below the editor confirming what was detected/loaded, or describing any error (invalid Base64, invalid gzip, invalid JSON).

The web UI uses a **dark theme** by default for reduced eye strain during long editing sessions, and shows a **disclaimer note** at the top reminding you to keep backups.

---

## Deterministic gzip output (CLI + Web)

- **CLI**: `pack` supports `--mtime` and defaults to `0`, so repeated packing of the same JSON produces stable, reproducible gzip bytes. Passing `--mtime 0` explicitly is recommended for clarity in scripts/CI.
- **Web**: JSON repacking uses the same deterministic `mtime=0` packing for JSON→gzip and JSON→Base64 flows.
- **Cross-tool byte parity**: `pack`/`json-to-b64` (CLI), the web tool, and the game's own `save.py`/`global_save.py` all produce byte-identical gzip output for the same JSON input — same header bytes, same `mtime=0`, same OS byte. This makes hash-based integrity checks (see `info`'s `sha256_gz`) meaningful across all three.
- **Note on the web tool's compressed body**: while gzip *headers* are forced to match byte-for-byte, the DEFLATE-compressed body itself may differ slightly between the browser's `CompressionStream` and Python's `zlib`, since different DEFLATE implementations can make different, equally valid encoding choices at the same compression level. Content always decompresses identically — `roundtrip` falls back to comparing decompressed JSON when raw bytes don't match exactly, for this reason.

## Tips for game-save workflows

- Always run `backup` before manual save edits.
- Use deterministic packing (`--mtime 0` in CLI; fixed `mtime=0` in web) for reproducible gzip output.
- `extract` uses the embedded gzip original filename when available, but sanitizes it and falls back to the `.gz`-stripped name when unsafe.
- Embedded filenames are read from the **first gzip member** only (concatenated multi-member `.gz` files are not fully scanned for naming metadata).
- Filename rules can vary across filesystems; when embedded metadata is unsafe for the current platform, extraction falls back to the `.gz`-stripped filename.
- If byte-for-byte output differs after repacking, use `roundtrip` to confirm the JSON data still matches.
- Keep an untouched original save in a separate folder so you can recover quickly if an edit breaks loading.

## Troubleshooting

**CLI**
- **"python3: command not found"**: try `python` instead.
- **"Error: Input JSON invalid"**: fix JSON syntax first (missing commas, bad quotes, etc.).
- **"Error: File not found"**: double-check the path and run command from the correct folder.
- **Windows path issues**: wrap paths with spaces in double quotes (for example: `python main.py pack "my save.json" -o "my save.json.gz"`).
- **`SystemExit: 2` / `the following arguments are required: command`**: the script was started without a subcommand. Add one of: `extract`, `pack`, `backup`, `roundtrip`, `info`, `gz-to-b64`, `b64-to-gz`, `b64-to-json`, `json-to-b64`.
- **Temp file errors during `pack` on Windows**: run from a normal local folder (not cloud-synced), and retry. Some sync/AV tools can interfere with temporary files; the tool now warns when the destination folder appears protected/unwritable.

**Web**
- **Blank page / console errors about modules or CORS on load**: you're likely opening `index.html` via `file://`. Serve the folder with a local HTTP server instead (see Requirements above), or use the deployed GitHub Pages copy.
- **"Failed to decode Base64" / "Invalid gzip data"**: the pasted or dropped content isn't valid Base64-encoded gzip data — check for truncation or accidental whitespace/formatting from wherever it was copied.
- **Nothing happens on drag-and-drop**: confirm you're dropping onto the dropzone area specifically, not elsewhere on the page.

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**.

### Quick Summary
* **Share** — You can copy and redistribute the material in any medium or format.
* **Adapt** — You can remix, transform, and build upon the material.
* **Attribution** — You must give appropriate credit and link to the license.
* **NonCommercial** — You may not use this work for commercial purposes.
* **ShareAlike** — If you modify this work, you must distribute it under this same license.

---

### How to Attribute
If you use or adapt this work, please use the following format:
> "**[Project Title]**" by **[Your Name/Org]**, used under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

*For the full legal terms, please see the [LICENSE.md](./LICENSE.md) file.*