// Генерирует PNG-иконки приложения: сосуд с волнистыми пластами песка.
// Запуск: node scripts/make-icons.mjs  →  public/icons/*.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [17, 18, 22];
const WALL = [232, 234, 242];
// Пласты снизу вверх: сон, быт, работа, спорт — как в сосуде по умолчанию.
const LAYERS = [
  { color: [98, 113, 245], top: 0.42 },
  { color: [205, 132, 102], top: 0.55 },
  { color: [226, 163, 60], top: 0.8 },
  { color: [85, 196, 106], top: 0.9 },
];

// Детерминированный шум, чтобы иконка не менялась от запуска к запуску.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function draw(size, { padding }) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BG);

  // Сосуд: квадрат без крышки, по центру.
  const inner = Math.round(size * (1 - padding * 2) * 0.62);
  const wall = Math.max(2, Math.round(size * 0.035));
  const x0 = Math.round((size - inner) / 2);
  const yBottom = Math.round(size * (0.5 + (1 - padding * 2) * 0.33));
  const yTop = yBottom - inner;

  // Песок: зернистость + волнистые границы пластов.
  for (let y = yTop; y < yBottom; y++) {
    for (let x = x0; x < x0 + inner; x++) {
      const h = (yBottom - y) / inner; // 0 внизу … 1 вверху
      const fx = (x - x0) / inner;
      let layer = null;
      for (const l of LAYERS) {
        const wave = Math.sin(fx * Math.PI * 2.2 + l.top * 9) * 0.035;
        if (h <= l.top + wave) { layer = l; break; }
      }
      if (!layer) continue;
      const f = 0.82 + rnd() * 0.3;
      set(x, y, layer.color.map((c) => Math.min(255, Math.round(c * f))));
    }
  }

  // Стенки: левая, правая и дно — сосуд без крышки.
  for (let y = yTop; y < yBottom + wall; y++) {
    for (let x = x0 - wall; x < x0 + inner + wall; x++) {
      if (x < x0 || x >= x0 + inner || y >= yBottom) set(x, y, WALL);
    }
  }
  return png(size, size, px);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = {
  'apple-touch-icon.png': draw(180, { padding: 0.06 }),
  'icon-192.png': draw(192, { padding: 0.06 }),
  'icon-512.png': draw(512, { padding: 0.06 }),
  // maskable: безопасная зона — центральные 80%
  'icon-maskable-512.png': draw(512, { padding: 0.14 }),
};
for (const [name, data] of Object.entries(files)) writeFileSync(new URL(name, out), data);
console.log('icons:', Object.keys(files).join(', '));
