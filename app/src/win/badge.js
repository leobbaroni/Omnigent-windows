// [win] Taskbar badge for Windows.
//
// `app.setBadgeCount` is a no-op on Windows, so the unread count the SPA
// reports through the native bridge would be invisible. Windows offers a
// taskbar *overlay icon* per window instead (`BrowserWindow.setOverlayIcon`).
// This module renders a small red disc with the count (1–9, "9+") as a PNG,
// dependency-free (hand-rolled PNG encoder over zlib and a 3×5 bitmap font),
// and applies it to every shell window. Clearing passes null.

"use strict";

const zlib = require("zlib");

const SIZE = 32;

// 3×5 bitmap digits, rows top→bottom, 1 = lit.
const FONT = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "001", "001"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

/** Text shown for a count: "1".."9", then "9+". */
function labelFor(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return "";
  return n > 9 ? "9+" : String(n);
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = new Int32Array(256).map((_, n) => {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  }));
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode an RGBA buffer as a PNG.
 *
 * @param {Buffer} rgba width*height*4 bytes
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Render the badge as RGBA: red disc, white text, transparent corners.
 *
 * @param {string} label "1".."9" or "9+"
 * @param {number} [size]
 * @returns {Buffer}
 */
function renderRgba(label, size = SIZE) {
  const px = Buffer.alloc(size * size * 4, 0);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size / 2 - 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      // 1px anti-aliased edge.
      const a = d <= r - 1 ? 255 : d >= r ? 0 : Math.round((r - d) * 255);
      if (a === 0) continue;
      const i = (y * size + x) * 4;
      px[i] = 0xd9;
      px[i + 1] = 0x2b;
      px[i + 2] = 0x2b;
      px[i + 3] = a;
    }
  }
  // Text: each glyph 3×5 scaled by `s`, 1 scaled column gap.
  const glyphs = [...label].map((ch) => FONT[ch]).filter(Boolean);
  if (glyphs.length === 0) return px;
  const s = glyphs.length === 1 ? Math.floor(size / 7) : Math.floor(size / 10);
  const gap = s;
  const textW = glyphs.length * 3 * s + (glyphs.length - 1) * gap;
  const textH = 5 * s;
  let ox = Math.round((size - textW) / 2);
  const oy = Math.round((size - textH) / 2);
  for (const g of glyphs) {
    for (let gy = 0; gy < 5; gy += 1) {
      for (let gx = 0; gx < 3; gx += 1) {
        if (g[gy][gx] !== "1") continue;
        for (let dy = 0; dy < s; dy += 1) {
          for (let dx = 0; dx < s; dx += 1) {
            const x = ox + gx * s + dx;
            const y = oy + gy * s + dy;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const i = (y * size + x) * 4;
            px[i] = 255;
            px[i + 1] = 255;
            px[i + 2] = 255;
            px[i + 3] = 255;
          }
        }
      }
    }
    ox += 3 * s + gap;
  }
  return px;
}

const pngCache = new Map();

/**
 * PNG bytes for a count (cached per label). Empty label → null.
 *
 * @param {number} count
 * @returns {Buffer | null}
 */
function badgePng(count) {
  const label = labelFor(count);
  if (!label) return null;
  if (!pngCache.has(label)) pngCache.set(label, encodePng(renderRgba(label), SIZE, SIZE));
  return pngCache.get(label);
}

/**
 * Apply the badge to every window. `nativeImage` and the window list are
 * injected so this is testable; a failure on one window never affects others.
 *
 * @param {number} count
 * @param {object} deps
 * @param {{ createFromBuffer: (b: Buffer) => unknown }} deps.nativeImage
 * @param {Array<{ isDestroyed?: () => boolean, setOverlayIcon: (img: unknown, desc: string) => void }>} deps.windows
 * @returns {number} windows updated
 */
function applyBadge(count, { nativeImage, windows }) {
  const label = labelFor(count);
  const png = badgePng(count);
  const image = png ? nativeImage.createFromBuffer(png) : null;
  const description = label ? `${count} unread Omnigent session${Number(count) === 1 ? "" : "s"}` : "";
  let n = 0;
  for (const win of windows) {
    try {
      if (win.isDestroyed && win.isDestroyed()) continue;
      win.setOverlayIcon(image, description);
      n += 1;
    } catch {
      /* one bad window must not stop the rest */
    }
  }
  return n;
}

module.exports = { SIZE, labelFor, encodePng, renderRgba, badgePng, applyBadge };
