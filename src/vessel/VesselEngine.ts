/**
 * Сосуд как «падающий песок» (клеточная симуляция в духе thisissand / sandspiel).
 * Каждая песчинка занимает ровно одну клетку, поэтому объём честный: песчинок = минут × 40.
 */

/** Сосуд — квадрат GRID×GRID песчинок. 10 рядов = 1 час. */
export const GRID = 240;
export const CAPACITY = GRID * GRID;
export const GRAINS_PER_MINUTE = CAPACITY / (24 * 60);

export function grainsFor(minutes: number, scaleHours = 24): number {
  if (minutes <= 0) return 0;
  return Math.max(1, Math.round((minutes * CAPACITY) / (scaleHours * 60)));
}

/** Шкала на стенке: сколько часов вмещает сосуд и как часто подписывать. */
export interface VesselScale {
  hours: number;
  major: number;
  minor: number;
}

export const DAY_SCALE: VesselScale = { hours: 24, major: 6, minor: 1 };
export const WEEK_SCALE: VesselScale = { hours: 168, major: 24, minor: 6 };

export interface LayerSpec {
  key: string;
  count: number;
  color: string;
  /** < 1 — невыполненное: цвет приглушается к фону. */
  alpha: number;
}

/** open — насыпать заново (смена дня); diff — досыпать/убрать разницу; instant — без анимации. */
export type LayerMode = 'open' | 'diff' | 'instant';

export interface VesselLabels {
  free: string;
  overflow: string | null;
}

export interface VesselCallbacks {
  onHover?: (key: string | null, clientX: number, clientY: number) => void;
  onLayerClick?: (key: string) => void;
  onSpillClick?: () => void;
}

const EMPTY = 0;
const WALL = 1;
const FIRST_SLOT = 2;
const HEADROOM = 50; // рядов над краем: отсюда сыплется струя
const GRAVITY = 0.45;
const VMAX = 8;
const NOISE_LEVELS = 16;
const BG: [number, number, number] = [17, 18, 22];
const OVERFLOW_RED = '#FF5A5F';

type Phase = 'idle' | 'active' | 'shake' | 'drain';

interface Slot {
  key: string;
  pal: Uint32Array;
  count: number;
}

interface Pour {
  slot: number;
  remaining: number;
  rate: number;
  /** Частота «волн» плотности струи по ширине сосуда. */
  waves: number;
  stall: number;
}

const newPour = (slot: number, remaining: number, rate: number): Pour => ({
  slot, remaining, rate, waves: 0.8 + Math.random() * 1.6, stall: 0,
});

interface View {
  w: number; h: number; px: number; ox: number; oy: number;
}

function hexRgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 16 вариантов яркости — «зернистость» песка. */
function palette(rgb: [number, number, number]): Uint32Array {
  const out = new Uint32Array(NOISE_LEVELS);
  for (let n = 0; n < NOISE_LEVELS; n++) {
    const f = 0.78 + (n / (NOISE_LEVELS - 1)) * 0.36;
    const r = Math.min(255, Math.round(rgb[0] * f));
    const g = Math.min(255, Math.round(rgb[1] * f));
    const b = Math.min(255, Math.round(rgb[2] * f));
    out[n] = (255 << 24) | (b << 16) | (g << 8) | r; // ABGR (little-endian)
  }
  return out;
}

export class VesselEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: VesselCallbacks;
  private dpr = 1;
  private view: View | null = null;

  // мир
  private M = 0; // поля по бокам для выпавшего
  private WW = 0;
  private WH = 0;
  private rimY = HEADROOM;
  private vx0 = 0; // левая клетка внутренности сосуда
  private grid = new Uint16Array(0);
  private vel = new Float32Array(0);
  private noise = new Uint8Array(0);
  private stamp = new Uint32Array(0);
  private frameNo = 0;

  // слои
  private layers: LayerSpec[] = [];
  private slots: (Slot | undefined)[] = [];
  private keyToSlot = new Map<string, number>();
  private pours: Pour[] = [];
  /** Фаза волн струи — медленно дрейфует, поэтому границы пластов волнистые. */
  private wavePhase = 0;
  private extOn = false;
  private phase: Phase = 'idle';
  private quietTicks = 0;
  private phaseTicks = 0;
  /** Сколько песчинок упало (вниз или по диагонали) за последний шаг. Перекатывание по поверхности не считается. */
  private falls = 0;
  private acc = 0;
  private last = 0;

  // отрисовка
  private off = document.createElement('canvas');
  private offCtx = this.off.getContext('2d')!;
  private img: ImageData | null = null;
  private pix = new Uint32Array(0);
  private dirty = true;
  private draft: LayerSpec[] | null = null;
  private labels: VesselLabels = { free: '', overflow: null };
  private highlight: string | null = null;
  private scale: VesselScale = DAY_SCALE;

  private raf = 0;
  private destroyed = false;
  private pendingMode: LayerMode | null = null;

  constructor(canvas: HTMLCanvasElement, cb: VesselCallbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.cb = cb;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __vessel: VesselEngine }).__vessel = this;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
  }

  // ───────────────────────────── публичное API

  resize(w: number, h: number) {
    if (w < 50 || h < 50) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // На узком экране поля под выпавшее меньше — сосуд крупнее.
    const M = w < 600 ? 34 : 70;
    const rebuild = M !== this.M || !this.grid.length;
    if (rebuild) this.buildWorld(M);

    const labelSpace = 34;
    const px = Math.min((w - 12) / this.WW, (h - labelSpace - 8) / this.WH);
    const ox = (w - this.WW * px) / 2;
    const oy = Math.max(4, (h - labelSpace - this.WH * px) / 2);
    this.view = { w, h, px, ox, oy };
    this.dirty = true;

    if (rebuild) {
      this.refill(this.pendingMode === 'open' ? 'open' : 'instant');
      this.pendingMode = null;
    }
  }

  setLayers(layers: LayerSpec[], mode: LayerMode) {
    this.layers = layers;
    if (!this.grid.length) {
      this.pendingMode = mode;
      return;
    }
    if (mode === 'diff') this.diff();
    else this.refill(mode);
  }

  setDraft(draft: LayerSpec[] | null) {
    this.draft = draft && draft.some((d) => d.count > 0) ? draft : null;
  }

  setLabels(labels: VesselLabels) {
    this.labels = labels;
  }

  setScale(scale: VesselScale) {
    this.scale = scale;
  }

  setHighlight(key: string | null) {
    if (this.highlight === key) return;
    this.highlight = key;
    this.restyle();
  }

  // ───────────────────────────── мир

  private buildWorld(M: number) {
    this.M = M;
    this.WW = M + 2 + GRID + 2 + M;
    this.WH = HEADROOM + GRID + 2;
    this.rimY = HEADROOM;
    this.vx0 = M + 2;
    const n = this.WW * this.WH;
    this.grid = new Uint16Array(n);
    this.vel = new Float32Array(n);
    this.noise = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.off.width = this.WW;
    this.off.height = this.WH;
    this.img = this.offCtx.createImageData(this.WW, this.WH);
    this.pix = new Uint32Array(this.img.data.buffer);
    this.extOn = false;

    const { WW, WH, vx0 } = this;
    const set = (x: number, y: number) => { this.grid[y * WW + x] = WALL; };
    for (let y = this.rimY; y < WH; y++) {
      set(vx0 - 2, y); set(vx0 - 1, y);
      set(vx0 + GRID, y); set(vx0 + GRID + 1, y);
    }
    for (let x = vx0 - 2; x < vx0 + GRID + 2; x++) {
      set(x, WH - 2); set(x, WH - 1);
    }
  }

  /** Невидимое продолжение стенок вверх: держит насыпаемую горку, пока песок не утрамбован. */
  private setExt(on: boolean) {
    if (this.extOn === on) return;
    this.extOn = on;
    const { WW, vx0, grid } = this;
    for (let y = 0; y < this.rimY; y++) {
      for (const x of [vx0 - 2, vx0 - 1, vx0 + GRID, vx0 + GRID + 1]) {
        const i = y * WW + x;
        if (on && grid[i] === EMPTY) grid[i] = WALL;
        else if (!on && grid[i] === WALL) grid[i] = EMPTY;
      }
    }
  }

  private wake() {
    this.setPhase('active');
    this.dirty = true;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.quietTicks = 0;
    this.phaseTicks = 0;
  }

  private isOutside(x: number, y: number) {
    return x < this.vx0 || x >= this.vx0 + GRID || y < this.rimY;
  }

  // ───────────────────────────── слоты (пласт = слот)

  private slotFor(l: LayerSpec): number {
    let id = this.keyToSlot.get(l.key);
    if (id === undefined) {
      id = this.slots.length < FIRST_SLOT ? FIRST_SLOT : this.slots.length;
      this.keyToSlot.set(l.key, id);
      this.slots[id] = { key: l.key, pal: palette([128, 128, 128]), count: 0 };
    }
    return id;
  }

  /** Пересчитать цвета слотов (выполнено/нет, подсветка). */
  private restyle() {
    const hl = this.highlight;
    const byKey = new Map(this.layers.map((l) => [l.key, l]));
    for (const s of this.slots) {
      if (!s) continue;
      const l = byKey.get(s.key);
      let rgb: [number, number, number] = l ? hexRgb(l.color) : [128, 128, 128];
      if (l && l.alpha < 1) rgb = mixRgb(rgb, BG, (1 - l.alpha) * 0.9);
      const lit = hl === null || s.key === hl || s.key.startsWith(`${hl}:`);
      s.pal = palette(lit ? rgb : mixRgb(rgb, BG, 0.62));
    }
    this.dirty = true;
  }

  private resetSlots() {
    this.slots = [];
    this.keyToSlot.clear();
    this.pours = [];
  }

  private pending(slot: number): number {
    let n = 0;
    for (const p of this.pours) if (p.slot === slot) n += p.remaining;
    return n;
  }

  // ───────────────────────────── заполнение и diff

  private clearGrains() {
    const { grid } = this;
    for (let i = 0; i < grid.length; i++) if (grid[i] >= FIRST_SLOT) grid[i] = EMPTY;
  }

  private refill(mode: LayerMode) {
    this.clearGrains();
    this.resetSlots();
    for (const l of this.layers) this.slotFor(l);
    this.restyle();
    this.setExt(true);

    if (mode === 'open') {
      const total = this.layers.reduce((s, l) => s + l.count, 0);
      const rate = Math.min(1200, Math.max(250, Math.ceil(total / 55)));
      for (const l of this.layers) {
        if (l.count > 0) this.pours.push(newPour(this.slotFor(l), l.count, rate));
      }
      this.wake();
      return;
    }

    // instant: ровные пласты снизу вверх, излишек досыпается струёй и выпадает.
    const { grid, noise, WW, vx0, rimY } = this;
    let c = 0;
    for (const l of this.layers) {
      const slot = this.slotFor(l);
      let rest = l.count;
      while (rest > 0 && c < CAPACITY) {
        const row = Math.floor(c / GRID);
        const i = (rimY + GRID - 1 - row) * WW + vx0 + (c % GRID);
        grid[i] = slot;
        noise[i] = (Math.random() * NOISE_LEVELS) | 0;
        this.slots[slot]!.count++;
        c++;
        rest--;
      }
      if (rest > 0) this.pours.push(newPour(slot, rest, 300));
    }
    this.wake();
  }

  private diff() {
    const want = new Map<number, number>();
    for (const l of this.layers) want.set(this.slotFor(l), (want.get(this.slotFor(l)) ?? 0) + l.count);

    // Есть ли изменения в количестве песка?
    let changed = false;
    for (const [id, s] of this.slots.entries()) {
      if (!s) continue;
      if ((want.get(id) ?? 0) !== s.count + this.pending(id)) changed = true;
    }
    this.restyle();
    if (!changed) return;

    const { grid, WW, WH } = this;

    // Выпавшее (на полу и над краем) убираем — оно будет пересыпано заново.
    for (let y = 0; y < WH; y++) {
      for (let x = 0; x < WW; x++) {
        const i = y * WW + x;
        const c = grid[i];
        if (c >= FIRST_SLOT && this.isOutside(x, y)) {
          grid[i] = EMPTY;
          this.slots[c]!.count--;
        }
      }
    }

    for (const [id, s] of this.slots.entries()) {
      if (!s) continue;
      let delta = (want.get(id) ?? 0) - s.count - this.pending(id);
      if (delta >= 0) continue;
      // Сначала уменьшаем ещё не насыпанное…
      for (const p of this.pours) {
        if (p.slot !== id || delta >= 0) continue;
        const cut = Math.min(p.remaining, -delta);
        p.remaining -= cut;
        delta += cut;
      }
      // …потом убираем верхние песчинки слоя — всё сверху осядет само.
      for (let y = 0; y < WH && delta < 0; y++) {
        for (let x = 0; x < WW && delta < 0; x++) {
          const i = y * WW + x;
          if (grid[i] === id) {
            grid[i] = EMPTY;
            s.count--;
            delta++;
          }
        }
      }
    }
    this.pours = this.pours.filter((p) => p.remaining > 0);

    // Недостающее досыпаем сверху в порядке слоёв.
    for (const l of this.layers) {
      const id = this.slotFor(l);
      const delta = l.count - this.slots[id]!.count - this.pending(id);
      if (delta <= 0) continue;
      this.pours.push(newPour(id, delta, Math.min(420, Math.max(30, Math.ceil(delta / 40)))));
    }
    this.setExt(true);
    this.wake();
  }

  // ───────────────────────────── симуляция

  /**
   * Песок сыплется по всей ширине, но с «гуляющей» плотностью (синусоида с дрейфующей фазой):
   * поверхность в среднем ровная — уровень честный, — а границы пластов волнистые, как в песочном арте.
   */
  private emit(): number {
    const p = this.pours[0];
    if (!p) return 0;
    const { grid, noise, vel, WW, vx0 } = this;
    this.wavePhase += 0.045;

    const n = Math.min(p.remaining, p.rate);
    const rows = Math.min(this.rimY - 4, Math.ceil(n / (GRID * 0.5)) + 2);
    const k = (Math.PI * 2 * p.waves) / GRID;
    let placed = 0;
    for (let a = 0; a < n * 4 && placed < n; a++) {
      const cx = Math.random() * GRID;
      // отбор по плотности 1 ± 0.6·sin
      if (Math.random() * 1.6 > 1 + 0.6 * Math.sin(cx * k + this.wavePhase)) continue;
      const x = vx0 + (cx | 0);
      const y = 1 + ((Math.random() * rows) | 0);
      const i = y * WW + x;
      if (grid[i] !== EMPTY) continue;
      grid[i] = p.slot;
      noise[i] = (Math.random() * NOISE_LEVELS) | 0;
      vel[i] = 1 + Math.random();
      placed++;
    }
    p.remaining -= placed;
    this.slots[p.slot]!.count += placed;
    p.stall = placed ? 0 : p.stall + 1;
    // Горка упёрлась в носик (сильное переполнение) — открываем края, пусть ссыпается.
    if (p.stall > 20) this.setExt(false);
    if (p.remaining <= 0) this.pours.shift();
    return placed;
  }

  private step(spread: number): number {
    const f = ++this.frameNo;
    const { grid, vel, noise, stamp, WW, WH } = this;
    let moved = 0;
    let falls = 0;

    const move = (from: number, to: number, v: number) => {
      grid[to] = grid[from];
      noise[to] = noise[from];
      vel[to] = v;
      stamp[to] = f;
      grid[from] = EMPTY;
      moved++;
    };

    for (let y = WH - 2; y >= 0; y--) {
      const ltr = ((y + f) & 1) === 0;
      const row = y * WW;
      for (let j = 0; j < WW; j++) {
        const x = ltr ? j : WW - 1 - j;
        const i = row + x;
        if (grid[i] < FIRST_SLOT || stamp[i] === f) continue;

        // падение (с ускорением)
        const below = i + WW;
        if (grid[below] === EMPTY) {
          const v = Math.min(VMAX, vel[i] + GRAVITY);
          let to = below;
          let yy = y + 1;
          for (let s = (v | 0) - 1; s > 0 && yy + 1 < WH && grid[to + WW] === EMPTY; s--) {
            to += WW;
            yy++;
          }
          move(i, to, v);
          falls++;
          continue;
        }
        vel[i] = 0;

        // по диагонали
        const l = x > 0 && grid[below - 1] === EMPTY;
        const r = x < WW - 1 && grid[below + 1] === EMPTY;
        if (l || r) {
          const d = l && r ? (Math.random() < 0.5 ? -1 : 1) : l ? -1 : 1;
          move(i, below + d, 0.5);
          falls++;
          continue;
        }

        // сползание по пологому склону — только для верхних песчинок
        if (y === 0 || grid[i - WW] !== EMPTY || y + 1 >= WH) continue;
        const first = Math.random() < 0.5 ? -1 : 1;
        for (let t = 0; t < 2; t++) {
          const d = t === 0 ? first : -first;
          let ok = false;
          for (let k = 1; k <= spread; k++) {
            const xx = x + d * k;
            if (xx < 0 || xx >= WW || grid[i + d * k] !== EMPTY) break;
            if (grid[below + d * k] === EMPTY) { ok = true; break; }
          }
          if (ok) {
            move(i, i + d, 0);
            break;
          }
        }
      }
    }
    this.falls = falls;
    return moved;
  }

  /** Верхняя занятая клетка каждого столбика внутри сосуда (y; меньше — выше). */
  private tops(): Int32Array {
    const { grid, WW, vx0 } = this;
    const top = new Int32Array(GRID);
    for (let c = 0; c < GRID; c++) {
      let i = vx0 + c;
      let y = 0;
      while (grid[i] === EMPTY) { i += WW; y++; }
      top[c] = y;
    }
    return top;
  }

  /**
   * Оседание: верхняя песчинка столбика перетекает на соседний, более низкий.
   * Используется только когда горка торчит над краем — чтобы влезающий песок не висел над сосудом,
   * а лишний дошёл до стенок и ссыпался.
   */
  /** Переложить верхнюю песчинку столбика `from` на верх столбика `to`. */
  private shiftTop(top: Int32Array, from: number, to: number): number {
    const { grid, noise, vel, WW, vx0 } = this;
    const fi = top[from] * WW + vx0 + from;
    // столбик-приёмник заполнен до верха мира — класть некуда
    if (grid[fi] < FIRST_SLOT || top[to] <= 0) return 0;
    const ti = (top[to] - 1) * WW + vx0 + to;
    grid[ti] = grid[fi];
    noise[ti] = noise[fi];
    vel[ti] = 0;
    grid[fi] = EMPTY;
    top[from]++;
    top[to]--;
    return 1;
  }

  private level(passes: number, top: Int32Array): number {
    let moved = 0;
    const shift = (from: number, to: number) => { moved += this.shiftTop(top, from, to); };
    // Проходы попеременно слева направо и обратно: песчинка «перекатывается» вниз по склону
    // через несколько столбиков за проход. Перепад в 1 ряд тоже выравниваем — иначе пологие волны стоят.
    for (let p = 0; p < passes; p++) {
      const ltr = ((p + this.frameNo) & 1) === 0;
      for (let j = 0; j < GRID - 1; j++) {
        const c = ltr ? j : GRID - 2 - j;
        if (ltr ? top[c + 1] > top[c] : top[c + 1] < top[c]) {
          if (ltr) shift(c, c + 1);
          else shift(c + 1, c);
        }
      }
    }
    return moved;
  }

  /** Всё, что выше края, течёт к ближайшей стенке (левая половина — влево, правая — вправо). */
  private drainFlow(top: Int32Array, passes: number): number {
    const half = GRID / 2;
    const rim = this.rimY;
    let moved = 0;
    for (let p = 0; p < passes; p++) {
      for (let c = 1; c < half; c++) {
        if (top[c] < rim && top[c - 1] >= top[c]) moved += this.shiftTop(top, c, c - 1);
      }
      for (let c = GRID - 2; c >= half; c--) {
        if (top[c] < rim && top[c + 1] >= top[c]) moved += this.shiftTop(top, c, c + 1);
      }
    }
    return moved;
  }

  /** Слив лишнего: песок выше края у стенок пересыпается наружу и падает на пол. */
  private spillEdges(top: Int32Array): number {
    const { grid, noise, vel, WW, vx0, rimY } = this;
    let moved = 0;
    for (const [c, outX, dir] of [[0, vx0 - 3, -1], [GRID - 1, vx0 + GRID + 2, 1]] as const) {
      for (let k = 0; k < 72 && top[c] < rimY; k++) {
        const fi = top[c] * WW + vx0 + c;
        // «водопад» шириной 6 и высотой 12 клеток сразу за стенкой
        const ti = (rimY - 2 - Math.floor(k / 6)) * WW + outX + dir * (k % 6);
        if (grid[fi] < FIRST_SLOT) break;
        if (grid[ti] !== EMPTY) continue;
        grid[ti] = grid[fi];
        noise[ti] = noise[fi];
        vel[ti] = 2.5;
        grid[fi] = EMPTY;
        top[c]++;
        moved++;
      }
    }
    return moved;
  }

  private sandAboveRim(): boolean {
    const { grid, WW, vx0 } = this;
    for (let y = 0; y < this.rimY; y++) {
      for (let x = vx0; x < vx0 + GRID; x++) if (grid[y * WW + x] >= FIRST_SLOT) return true;
    }
    return false;
  }

  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.view) return;

    // Фиксированный шаг 60 раз в секунду — скорость песка не зависит от частоты экрана (60/120/180 Гц).
    this.acc += Math.min(100, now - (this.last || now));
    this.last = now;
    let steps = 0;
    while (this.acc >= 1000 / 60 && steps < 3) {
      this.tick();
      this.acc -= 1000 / 60;
      steps++;
    }
    if (steps === 3) this.acc = 0;

    this.draw();
  };

  private tick() {
    if (this.phase === 'idle') return;
    this.phaseTicks++;

    if (this.phase === 'active') {
      // насыпка: струя + песок
      const emitted = this.emit();
      // чистый песок (угол 45°), без оползания — иначе поверхность «ползёт» секундами
      if (this.step(1) || emitted) this.dirty = true;
      if (!this.pours.length) {
        this.quietTicks = this.falls === 0 ? this.quietTicks + 1 : 0;
        if (this.quietTicks < 3) return;
        // Горки остаются как есть. Если пик торчит над краем:
        // всё влезает — песок чуть оседает; не влезает — лишнее ссыпается через края.
        if (!this.sandAboveRim()) this.setPhase('idle');
        else if (this.wantTotal() <= CAPACITY) this.setPhase('shake');
        else {
          this.setExt(false);
          this.setPhase('drain');
        }
      }
      return;
    }

    if (this.phase === 'shake') {
      this.step(1);
      this.level(8, this.tops());
      this.dirty = true;
      if ((this.falls === 0 && !this.sandAboveRim()) || this.phaseTicks > 300) this.setPhase('idle');
      return;
    }

    // drain: лишнее ссыпается через края и ложится на полу горками
    this.step(1);
    const top = this.tops();
    // Сначала засыпаем ямки внутри — наружу уходит только то, что действительно не влезло.
    let valley = false;
    for (let c = 0; c < GRID && !valley; c++) valley = top[c] > this.rimY;
    let spilled = 0;
    if (valley) this.level(32, top);
    else {
      this.drainFlow(top, 24);
      spilled = this.spillEdges(top);
    }
    this.dirty = true;
    const done = this.falls === 0 && spilled === 0 && !this.sandAboveRim();
    if (done || this.phaseTicks > 1800) this.setPhase('idle');
  }

  // ───────────────────────────── отрисовка

  private draw() {
    const v = this.view!;
    const ctx = this.ctx;
    if (this.dirty && this.img) {
      const { grid, noise, pix, slots } = this;
      for (let i = 0; i < grid.length; i++) {
        const c = grid[i];
        pix[i] = c >= FIRST_SLOT ? slots[c]!.pal[noise[i]] : 0;
      }
      this.offCtx.putImageData(this.img, 0, 0);
      this.dirty = false;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    this.drawScale();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, v.ox, v.oy, this.WW * v.px, this.WH * v.px);

    // пол
    const floorY = v.oy + this.WH * v.px;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, floorY + 0.5);
    ctx.lineTo(v.w, floorY + 0.5);
    ctx.stroke();

    this.drawDraft();
    this.drawWalls();
    this.drawLabels();
  }

  /** Экранные координаты сосуда. */
  private geo() {
    const v = this.view!;
    const left = v.ox + this.vx0 * v.px;
    const right = left + GRID * v.px;
    const rim = v.oy + this.rimY * v.px;
    const bottom = rim + GRID * v.px;
    return { left, right, rim, bottom, px: v.px, rowPx: v.px };
  }

  private drawScale() {
    const ctx = this.ctx;
    const g = this.geo();
    const x = g.left - 2 * g.px - 6;
    ctx.font = '500 11px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const { hours, major: majorStep, minor } = this.scale;
    const hourPx = (GRID / hours) * g.px;
    for (let h = 0; h <= hours; h += minor) {
      const y = Math.round(g.bottom - h * hourPx) + 0.5;
      const major = h % majorStep === 0;
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - (major ? 8 : 4), y);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(`${h}ч`, x - 12, y);
      }
    }
  }

  private drawWalls() {
    const ctx = this.ctx;
    const g = this.geo();
    const lw = Math.max(2, g.px * 1.6);
    const left = g.left - g.px;
    const right = g.right + g.px;
    const bottom = g.bottom + g.px;
    const rad = g.px * 8;
    ctx.strokeStyle = 'rgba(232,234,242,0.9)';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(left, g.rim);
    ctx.lineTo(left, bottom - rad);
    ctx.quadraticCurveTo(left, bottom, left + rad, bottom);
    ctx.lineTo(right - rad, bottom);
    ctx.quadraticCurveTo(right, bottom, right, bottom - rad);
    ctx.lineTo(right, g.rim);
    ctx.stroke();
  }

  private wantTotal(): number {
    return this.layers.reduce((s, l) => s + l.count, 0);
  }

  /** Черновик: пунктирные полосы от честного уровня вверх. Не влезает — красные и выше края. */
  private drawDraft() {
    if (!this.draft) return;
    const ctx = this.ctx;
    const g = this.geo();
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 260);
    const rowPx = g.px;
    let level = this.wantTotal() / GRID; // в рядах
    const total = this.wantTotal() + this.draft.reduce((s, d) => s + d.count, 0);
    const fits = total <= CAPACITY;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    for (const d of this.draft) {
      const rows = d.count / GRID;
      const y1 = g.bottom - level * rowPx;
      const y0 = g.bottom - (level + rows) * rowPx;
      const color = fits ? d.color : OVERFLOW_RED;
      ctx.globalAlpha = 0.18 * pulse;
      ctx.fillStyle = color;
      ctx.fillRect(g.left, y0, g.right - g.left, y1 - y0);
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
      ctx.strokeStyle = color;
      ctx.strokeRect(g.left + 0.5, y0 + 0.5, g.right - g.left - 1, Math.max(1, y1 - y0 - 1));
      level += rows;
    }
    ctx.restore();
  }

  private drawLabels() {
    const ctx = this.ctx;
    const g = this.geo();
    const level = Math.min(this.wantTotal(), CAPACITY) / GRID;
    const fillTop = g.bottom - level * g.px;
    const cx = (g.left + g.right) / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.labels.free && !this.labels.overflow) {
      ctx.font = '600 15px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      const y = fillTop - g.rim > 40 ? (g.rim + fillTop) / 2 : g.rim - 16;
      ctx.fillText(this.labels.free, cx, y);
    }
    if (this.labels.overflow) {
      ctx.font = '600 14px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = OVERFLOW_RED;
      ctx.fillText(this.labels.overflow, cx, Math.min(this.view!.h - 12, g.bottom + 2 * g.px + 20));
    }
  }

  // ───────────────────────────── ввод

  private cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const v = this.view;
    if (!v) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - v.ox) / v.px);
    const y = Math.floor((clientY - rect.top - v.oy) / v.px);
    if (x < 0 || y < 0 || x >= this.WW || y >= this.WH) return null;
    return { x, y };
  }

  private hit(clientX: number, clientY: number): { key: string | null; spill: boolean } {
    const c = this.cellAt(clientX, clientY);
    if (!c) return { key: null, spill: false };
    // ищем песчинку в небольшом радиусе — по одной клетке попасть трудно
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (x < 0 || y < 0 || x >= this.WW || y >= this.WH) continue;
          const id = this.grid[y * this.WW + x];
          if (id < FIRST_SLOT) continue;
          if (this.isOutside(x, y)) return { key: null, spill: true };
          return { key: this.slots[id]?.key ?? null, spill: false };
        }
      }
    }
    return { key: null, spill: false };
  }

  private onPointerMove = (e: PointerEvent) => {
    const h = this.hit(e.clientX, e.clientY);
    this.canvas.style.cursor = h.key || h.spill ? 'pointer' : 'default';
    this.cb.onHover?.(h.key, e.clientX, e.clientY);
  };

  /** На телефоне наведения нет — тап показывает подсказку и подсветку пласта. */
  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') this.onPointerMove(e);
  };

  private onPointerLeave = () => {
    this.canvas.style.cursor = 'default';
    this.cb.onHover?.(null, 0, 0);
  };

  private onClick = (e: MouseEvent) => {
    const h = this.hit(e.clientX, e.clientY);
    if (h.key) this.cb.onLayerClick?.(h.key);
    else if (h.spill) this.cb.onSpillClick?.();
  };
}
