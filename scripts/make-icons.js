// Generates icons/icon{16,48,128}.png with no dependencies: a plain grey box with a black
// pause mark. Run with `npm run icons`; the output is committed.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Colour at pixel (x, y) of a size×size icon: a flat light-grey box with a 1px black
 * border and two black pause bars. Plain on purpose, to match the textboard look.
 */
function sample(x, y, size) {
  const border = Math.max(1, Math.round(size / 32));
  if (x < border || y < border || x >= size - border || y >= size - border) return [0, 0, 0, 255];
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const inBar = (cx) => Math.abs(u - cx) <= 0.08 && Math.abs(v - 0.5) <= 0.25;
  if (inBar(0.36) || inBar(0.64)) return [0, 0, 0, 255];
  return [239, 239, 239, 255];
}

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = sample(x, y, size);
      out.set(c, (y * size + x) * 4);
    }
  }
  return png(size, out);
}

const dir = path.join(__dirname, "..", "icons");
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), render(size));
  console.log(`icons/icon${size}.png`);
}
