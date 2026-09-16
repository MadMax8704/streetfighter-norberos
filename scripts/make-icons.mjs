#!/usr/bin/env node
/* ============================================================================
   Ragdoll Masters – PWA ikon generátor (nulla külső függőség)
   ----------------------------------------------------------------------------
   Rajzol egy ütésben lévő stick-figurát sötét háttéren, és PNG-ként írja ki:
     public/icon-192.png            (manifest "any")
     public/icon-512.png            (manifest "any")
     public/icon-maskable-512.png   (manifest "maskable", 40%-os safe zone)
     public/apple-touch-icon.png    (iOS, 180px)
   Futtatás: node scripts/make-icons.mjs
   ========================================================================== */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/* ---------------- PNG encoder (8-bit RGBA) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    rgba.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- rajzolás (anti-aliased) ---------------- */
const BG = [7, 10, 20];        // #070a14 – a játék háttérszíne
const WHITE = [255, 255, 255];
const GOLD = [255, 209, 102];   // #ffd166 – a gamepad gombjának színe

function makeCanvas(size) {
  const px = new Float64Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255; }
  return { size, px };
}
function over(canvas, x, y, color, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  for (let c = 0; c < 3; c++) canvas.px[i + c] = color[c] * a + canvas.px[i + c] * (1 - a);
}
function paintCircle(cv, cx, cy, r, color) {
  const s = cv.size;
  for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(s - 1, Math.ceil(cy + r + 1)); y++)
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(s - 1, Math.ceil(cx + r + 1)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      over(cv, x, y, color, Math.max(0, Math.min(1, r - d + 0.5)));
    }
}
function paintSeg(cv, x1, y1, x2, y2, halfW, color) {
  const s = cv.size;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - halfW - 1));
  const maxX = Math.min(s - 1, Math.ceil(Math.max(x1, x2) + halfW + 1));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - halfW - 1));
  const maxY = Math.min(s - 1, Math.ceil(Math.max(y1, y2) + halfW + 1));
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      let t = ((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x + 0.5 - (x1 + t * dx), y + 0.5 - (y1 + t * dy));
      over(cv, x, y, color, Math.max(0, Math.min(1, halfW - d + 0.5)));
    }
}

/* Ütésben lévő stick-figura egységkoordinátákban (0..1). */
function drawFigure(cv, scale) {
  const S = cv.size;
  const T = (u, v) => [(0.5 + (u - 0.5) * scale) * S, (0.5 + (v - 0.5) * scale) * S];
  const W = (w) => (w * scale * S) / 2; // fél-szélesség px-ben
  const [hx, hy] = T(0.52, 0.30);
  const [tx1, ty1] = T(0.52, 0.40), [tx2, ty2] = T(0.47, 0.63);
  const [a1x, a1y] = T(0.51, 0.46), [punchX, punchY] = T(0.74, 0.44), [backAx, backAy] = T(0.34, 0.55);
  const [l1x, l1y] = T(0.47, 0.63), [frontFx, frontFy] = T(0.63, 0.82), [backFx, backFy] = T(0.33, 0.84);
  const [fx, fy] = T(0.76, 0.44);
  paintSeg(cv, a1x, a1y, backAx, backAy, W(0.05), WHITE);   // hátsó kar
  paintSeg(cv, l1x, l1y, backFx, backFy, W(0.055), WHITE);  // hátsó láb
  paintSeg(cv, tx1, ty1, tx2, ty2, W(0.055), WHITE);        // törzs
  paintSeg(cv, l1x, l1y, frontFx, frontFy, W(0.055), WHITE);// előláb
  paintSeg(cv, a1x, a1y, punchX, punchY, W(0.05), WHITE);   // ökölkar
  paintCircle(cv, hx, hy, 0.095 * scale * S, WHITE);        // fej
  paintCircle(cv, fx, fy, 0.048 * scale * S, GOLD);         // ököl (akcent)
}

function render(size, scale) {
  const cv = makeCanvas(size);
  drawFigure(cv, scale);
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size * 4; i++) out[i] = Math.max(0, Math.min(255, Math.round(cv.px[i])));
  return encodePNG(size, out);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, 1.0],
  ['icon-512.png', 512, 1.0],
  ['icon-maskable-512.png', 512, 0.78], // maskable: a figura a 40%-os safe zone-on belül marad
  ['apple-touch-icon.png', 180, 0.92],
];
for (const [name, size, scale] of targets) {
  const file = join(OUT, name);
  writeFileSync(file, render(size, scale));
  console.log(`✓ ${file} (${size}x${size}, scale=${scale})`);
}
