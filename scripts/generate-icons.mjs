#!/usr/bin/env node
// Generates every StarLine image asset with no image dependencies: the PWA icons, the Android
// launcher icons and the splash for the Capacitor wrap. Deterministic — same seed, same bytes.
// Art (docs/DESIGN.md): the gold ✦ sparkle (astroid-family shape) over the deep-space gradient
// with seeded star specks. Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pwaDir = join(root, "apps", "web", "public", "icons");
const androidDir = join(root, "apps", "web", "assets");
mkdirSync(pwaDir, { recursive: true });
mkdirSync(androidDir, { recursive: true });

// --- minimal PNG encoder ----------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- the art ------------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLD = [246, 199, 96];
const STAR = [205, 213, 255];
const TOP = [10, 12, 30];
const BOTTOM = [23, 16, 51];

function render(size, { armScale = 0.42, transparent = false, sparkle = true } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const rand = mulberry32(0x53544152);

  if (!transparent) {
    // Background: vertical deep-space gradient.
    for (let y = 0; y < size; y++) {
      const t = y / (size - 1);
      const r = Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * t);
      const g = Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * t);
      const b = Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * t);
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }

    // Star specks (splat-painted).
    const speckCount = Math.floor((size * size) / 700);
    for (let s = 0; s < speckCount; s++) {
      const x0 = rand() * size;
      const y0 = rand() * size;
      const radius = 0.3 + rand() * 1.2;
      const alpha = 0.2 + rand() * 0.65;
      const gold = rand() < 0.18;
      const colour = gold ? GOLD : STAR;
      const box = Math.ceil(radius) + 1;
      for (let y = Math.floor(y0 - box); y <= Math.floor(y0 + box); y++) {
        if (y < 0 || y >= size) continue;
        for (let x = Math.floor(x0 - box); x <= Math.floor(x0 + box); x++) {
          if (x < 0 || x >= size) continue;
          const d = Math.hypot(x - x0, y - y0);
          if (d > radius) continue;
          const i = (y * size + x) * 4;
          const a = alpha * (1 - d / radius);
          rgba[i] = Math.round(rgba[i] * (1 - a) + colour[0] * a);
          rgba[i + 1] = Math.round(rgba[i + 1] * (1 - a) + colour[1] * a);
          rgba[i + 2] = Math.round(rgba[i + 2] * (1 - a) + colour[2] * a);
        }
      }
    }
  }

  if (!sparkle) return encodePng(size, rgba);

  // The ✦ sparkle with a soft glow. Boxed pass: outside the glow radius nothing changes.
  const opaque = !transparent;
  const centre = size / 2;
  const arm = size * armScale;
  const glowRadius = arm * 1.6;
  const box = Math.ceil(glowRadius) + 2;
  const from = Math.max(0, Math.floor(centre - box));
  const to = Math.min(size - 1, Math.floor(centre + box));
  for (let y = from; y <= to; y++) {
    for (let x = from; x <= to; x++) {
      const dx = (x - centre + 0.5) / arm;
      const dy = (y - centre + 0.5) / arm;
      const shape = Math.abs(dx) ** 0.45 + Math.abs(dy) ** 0.45;
      const dist = Math.hypot(x - centre, y - centre);
      const glow = Math.max(0, 1 - dist / glowRadius);
      const glowAlpha = glow ** 2.4 * 0.5;
      const i = (y * size + x) * 4;
      if (shape <= 1) {
        const edge = Math.max(0, Math.min(1, (1.08 - shape) / 0.2));
        if (opaque) {
          rgba[i] = Math.round(rgba[i] * (1 - edge) + GOLD[0] * edge);
          rgba[i + 1] = Math.round(rgba[i + 1] * (1 - edge) + GOLD[1] * edge);
          rgba[i + 2] = Math.round(rgba[i + 2] * (1 - edge) + GOLD[2] * edge);
        } else {
          rgba[i] = GOLD[0];
          rgba[i + 1] = GOLD[1];
          rgba[i + 2] = GOLD[2];
          rgba[i + 3] = Math.round(edge * 255);
        }
      } else if (glowAlpha > 0.01) {
        if (opaque) {
          rgba[i] = Math.round(rgba[i] * (1 - glowAlpha) + GOLD[0] * glowAlpha);
          rgba[i + 1] = Math.round(rgba[i + 1] * (1 - glowAlpha) + GOLD[1] * glowAlpha);
          rgba[i + 2] = Math.round(rgba[i + 2] * (1 - glowAlpha) + GOLD[2] * glowAlpha);
        } else {
          rgba[i] = GOLD[0];
          rgba[i + 1] = GOLD[1];
          rgba[i + 2] = GOLD[2];
          rgba[i + 3] = Math.round(glowAlpha * 255);
        }
      }
    }
  }

  return encodePng(size, rgba);
}

// --- outputs ------------------------------------------------------------------------------
const pwaOutputs = [
  ["icon-512.png", 512, { armScale: 0.42 }],
  ["icon-192.png", 192, { armScale: 0.42 }],
  ["maskable-512.png", 512, { armScale: 0.34 }],
  ["apple-touch-icon.png", 180, { armScale: 0.42 }],
];
for (const [name, size, options] of pwaOutputs) {
  const png = render(size, options);
  writeFileSync(join(pwaDir, name), png);
  console.log(`public/icons/${name}: ${size}x${size}, ${png.length} bytes`);
}

const androidOutputs = [
  ["icon.png", 1024, { armScale: 0.4 }],
  ["icon-foreground.png", 1024, { transparent: true, armScale: 0.36 }],
  ["icon-background.png", 1024, { sparkle: false }],
];
for (const [name, size, options] of androidOutputs) {
  const png = render(size, options);
  writeFileSync(join(androidDir, name), png);
  console.log(`web/assets/${name}: ${size}x${size}, ${png.length} bytes`);
}

// One splash render, written twice: the Capacitor assets tool wants both slots explicit.
const splash = render(2732, { armScale: 0.15 });
for (const name of ["splash.png", "splash-dark.png"]) {
  writeFileSync(join(androidDir, name), splash);
  console.log(`web/assets/${name}: 2732x2732, ${splash.length} bytes`);
}

console.log("icons written to public/icons and web/assets");
