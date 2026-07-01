// core_logic.js
// Pure conversion logic (no DOM access) — the JS twin of core_logic.py.

// Wire format is intentionally identical to core/save.py and web/save.py:
//   base64( gzip( json.dumps(data, separators=(",", ":")).encode() ) )
//   gzip.compress(..., compresslevel=9, mtime=0)

// Two deliberate deviations from a naive JS translation, both there to match
// Python's behavior byte-for-byte where it matters for save compatibility:
//   1. Minified JSON is ASCII-escaped (mirrors json.dumps' default
//      ensure_ascii=True) so non-ASCII save data (character names, etc.)
//      serializes to the same bytes Python would produce.
//   2. The gzip header/trailer are built by hand with mtime=0, matching
//      exactly what gzip.compress(mtime=0) writes. The compressed body itself
//      will generally NOT be byte-identical to zlib's output (different
//      DEFLATE implementations make different but equally valid encoding
//      choices at the same compression level) — this mirrors the assumption
//      already baked into main.py's roundtrip(), which falls back to
//      comparing decompressed JSON content when raw bytes differ.
//
// All gzip-touching functions are async because the Web Streams API
// (CompressionStream/DecompressionStream) has no synchronous equivalent.

export const INVALID_BASE64_MESSAGE = "Invalid Base64 input.";
export const INVALID_GZIP_MESSAGE = "Invalid gzip data.";
export const INVALID_JSON_MESSAGE = "Invalid JSON input.";

// ── CRC32 (needed for the gzip trailer we build by hand) ──────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Stream helpers ──────────────────────────────────────────────────────────

async function readAllBytes(readableStream) {
  const reader = readableStream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function deflateRawCompress(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return readAllBytes(cs.readable);
}

async function gzipDecompressRaw(gzBytes) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(gzBytes);
  writer.close();
  return readAllBytes(ds.readable);
}

// ── Gzip framing (mtime=0, matches gzip.compress(..., mtime=0)) ──────────────

async function gzipCompress(bytes, compresslevel = 9) {
  const deflated = await deflateRawCompress(bytes);

  const header = new Uint8Array(10);
  header[0] = 0x1f;
  header[1] = 0x8b;
  header[2] = 0x08; // CM = deflate
  header[3] = 0x00; // FLG = 0 (no FNAME) — matches pack()'s GzipFile(filename="")
  // bytes 4-7 = MTIME, left at 0 to match mtime=0
  header[8] = compresslevel === 9 ? 0x02 : compresslevel === 1 ? 0x04 : 0x00; // XFL
  // OS = 0x03 (Unix), matching gzip.compress(mtime=0)'s zlib fast path — the
  // code path actually used by save.py / global_save.py / core_logic.py.
  // NOT the same as gzip.GzipFile's OS=0xff — see the pack() divergence
  // documented in main.py before its fix.
  header[9] = 0x03;

  const trailer = new Uint8Array(8);
  new DataView(trailer.buffer).setUint32(0, crc32(bytes), true);
  new DataView(trailer.buffer).setUint32(4, bytes.length >>> 0, true); // ISIZE mod 2**32

  const out = new Uint8Array(header.length + deflated.length + trailer.length);
  out.set(header, 0);
  out.set(deflated, header.length);
  out.set(trailer, header.length + deflated.length);
  return out;
}

async function assertValidGzip(gzBytes) {
  try {
    await gzipDecompressRaw(gzBytes);
  } catch (exc) {
    throw new Error(INVALID_GZIP_MESSAGE);
  }
}

// ── Base64 ───────────────────────────────────────────────────────────────────

function normalizeBase64Text(b64) {
  return b64.replace(/\s+/g, "");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000; // avoid call-stack blowup on large arrays
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  let binary;
  try {
    binary = atob(b64);
  } catch (exc) {
    throw new Error(INVALID_BASE64_MESSAGE);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── ASCII-escaped JSON (mirrors json.dumps' default ensure_ascii=True) ───────

function toAsciiJson(jsonStr) {
  let out = "";
  for (const ch of jsonStr) {
    const code = ch.codePointAt(0);
    if (code <= 0x7f) {
      out += ch;
      continue;
    }
    if (code > 0xffff) {
      // Encode as a UTF-16 surrogate pair, same as Python does for astral chars.
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
    } else {
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out;
}

function jsonPayloadBytes(jsonStr) {
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (exc) {
    throw new Error(INVALID_JSON_MESSAGE);
  }
  // JSON.stringify already omits whitespace by default, so separators match
  // Python's separators=(",", ":") without extra work.
  const minified = toAsciiJson(JSON.stringify(data));
  return new TextEncoder().encode(minified);
}

// ── Public API (mirrors core_logic.py function-for-function) ─────────────────

export async function extractLogic(gzBytes) {
  let raw;
  try {
    raw = await gzipDecompressRaw(gzBytes);
  } catch (exc) {
    throw new Error(INVALID_GZIP_MESSAGE);
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch (exc) {
    throw new Error(INVALID_JSON_MESSAGE);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (exc) {
    throw new Error(INVALID_JSON_MESSAGE);
  }

  // Preserve keys/values exactly; only whitespace/formatting changes.
  return JSON.stringify(data, null, 2);
}

export async function packLogic(jsonStr) {
  const payload = jsonPayloadBytes(jsonStr);
  return gzipCompress(payload, 9);
}

export function gzBytesToBase64(gzBytes) {
  return bytesToBase64(gzBytes);
}

export async function base64ToGzBytes(b64) {
  const normalized = normalizeBase64Text(b64);
  const gzBytes = base64ToBytes(normalized);
  await assertValidGzip(gzBytes);
  return gzBytes;
}

export async function base64ToJsonText(b64) {
  const gzBytes = await base64ToGzBytes(b64);
  return extractLogic(gzBytes);
}

export async function jsonTextToBase64(jsonStr) {
  const gzBytes = await packLogic(jsonStr);
  return gzBytesToBase64(gzBytes);
}