/**
 * Generates build/icon.ico and build/icon.png from the app's brand mark.
 *
 * Deliberately dependency-free: it rasterises rounded rectangles directly and
 * encodes PNG with node's zlib, so regenerating the icons never needs
 * ImageMagick, a headless browser, or a native module on any platform.
 *
 *   node scripts/make-icons.mjs
 *
 * The output is committed, so this only needs re-running when the mark changes.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');

// The mark: four rounded tiles on a dark rounded panel, matching the favicon.
const BACKDROP = [15, 23, 42, 255];
const TILES = [
  { x: 0.1875, y: 0.1875, color: [56, 189, 248, 255] },
  { x: 0.5313, y: 0.1875, color: [244, 114, 182, 255] },
  { x: 0.1875, y: 0.5313, color: [251, 191, 36, 255] },
  { x: 0.5313, y: 0.5313, color: [52, 211, 153, 255] },
];
const TILE = 0.2813;
const TILE_RADIUS = 0.0625;
const PANEL_RADIUS = 0.2188;

/** Signed distance to a rounded rectangle; negative inside. */
function roundedRectDistance(px, py, x, y, w, h, r) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const dx = Math.max(cx, 0);
  const dy = Math.max(cy, 0);
  return Math.min(Math.max(cx, cy), 0) + Math.sqrt(dx * dx + dy * dy) - r;
}

function blend(dst, offset, [r, g, b, a], coverage) {
  const alpha = (a / 255) * coverage;
  if (alpha <= 0) return;
  const inv = 1 - alpha;
  dst[offset] = Math.round(r * alpha + dst[offset] * inv);
  dst[offset + 1] = Math.round(g * alpha + dst[offset + 1] * inv);
  dst[offset + 2] = Math.round(b * alpha + dst[offset + 2] * inv);
  dst[offset + 3] = Math.round(255 * alpha + dst[offset + 3] * inv);
}

/** 4x4 supersampled coverage keeps the small sizes from looking ragged. */
function coverageAt(px, py, size, shape) {
  const steps = 4;
  let hits = 0;
  for (let sy = 0; sy < steps; sy++) {
    for (let sx = 0; sx < steps; sx++) {
      const x = (px + (sx + 0.5) / steps) / size;
      const y = (py + (sy + 0.5) / steps) / size;
      if (roundedRectDistance(x, y, shape.x, shape.y, shape.w, shape.h, shape.r) <= 0) hits++;
    }
  }
  return hits / (steps * steps);
}

function renderRGBA(size) {
  const pixels = new Uint8Array(size * size * 4);
  const shapes = [
    { x: 0, y: 0, w: 1, h: 1, r: PANEL_RADIUS, color: BACKDROP },
    ...TILES.map((t) => ({ x: t.x, y: t.y, w: TILE, h: TILE, r: TILE_RADIUS, color: t.color })),
  ];
  for (const shape of shapes) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const coverage = coverageAt(x, y, size, shape);
        if (coverage > 0) blend(pixels, (y * size + x) * 4, shape.color, coverage);
      }
    }
  }
  return pixels;
}

// --- PNG ------------------------------------------------------------------

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO ------------------------------------------------------------------

/** Vista and later accept PNG-compressed entries, which keeps 256px sane. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach((image, i) => {
    const entry = i * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette size
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

mkdirSync(OUT, { recursive: true });

const images = ICO_SIZES.map((size) => ({ size, data: encodePng(size, renderRGBA(size)) }));
writeFileSync(join(OUT, 'icon.ico'), encodeIco(images));
console.log(`build/icon.ico  ${ICO_SIZES.join(', ')}px`);

for (const size of [256, 512]) {
  const name = size === 512 ? 'icon.png' : 'icon-256.png';
  writeFileSync(join(OUT, name), encodePng(size, renderRGBA(size)));
  console.log(`build/${name}  ${size}px`);
}
