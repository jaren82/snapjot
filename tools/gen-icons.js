// Generates SnapJot toolbar icons (red rounded square + white annotation box).
// Pure Node, no dependencies. Run: node tools/gen-icons.js
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const crc32 = (() => {
  const tbl = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c;
  }
  return (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) c = tbl[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (~c) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(N, pixelFn) {
  const raw = Buffer.alloc(N * (N * 4 + 1));
  let o = 0;
  for (let y = 0; y < N; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < N; x++) {
      const [r, g, b, a] = pixelFn(x, y, N);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pixel(x, y, N) {
  const r = 0.2 * N; // corner radius
  const cx = Math.min(x, N - 1 - x);
  const cy = Math.min(y, N - 1 - y);
  if (cx < r && cy < r) {
    const dx = r - cx,
      dy = r - cy;
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0]; // rounded corner
  }
  const a = 0.27 * N,
    b = 0.73 * N,
    t = Math.max(1, Math.round(0.1 * N));
  const inBox = x >= a && x <= b && y >= a && y <= b;
  const inInner = x >= a + t && x <= b - t && y >= a + t && y <= b - t;
  if (inBox && !inInner) return [255, 255, 255, 255]; // white box outline
  return [255, 59, 48, 255]; // red
}

// --- independent structural validator (re-reads bytes) ---
function validate(buf, N) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++)
    if (buf[i] !== sig[i]) throw new Error("bad signature");
  let p = 8;
  let sawIDAT = false;
  const idatParts = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    const crc = buf.readUInt32BE(p + 8 + len);
    if (crc32(Buffer.concat([Buffer.from(type), data])) !== crc)
      throw new Error("CRC mismatch in " + type);
    if (type === "IDAT") {
      sawIDAT = true;
      idatParts.push(data);
    }
    p += 12 + len;
  }
  if (!sawIDAT) throw new Error("no IDAT");
  const inflated = zlib.inflateSync(Buffer.concat(idatParts));
  const expect = N * (N * 4 + 1);
  if (inflated.length !== expect)
    throw new Error(`inflated ${inflated.length} != ${expect}`);
  return true;
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const N of [16, 32, 48, 128]) {
  const buf = encodePng(N, pixel);
  validate(buf, N); // throws if malformed
  fs.writeFileSync(path.join(outDir, `icon${N}.png`), buf);
  console.log(`icon${N}.png  ${buf.length} bytes  validated OK`);
}
console.log("all icons generated + validated");
