import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite } = Matter;

/** Сосуд — квадрат GRID×GRID частиц. Ряд = 1 час, частица = 2.5 минуты. */
export const GRID = 24;
export const CAPACITY = GRID * GRID;
export const MINUTES_PER_PARTICLE = (24 * 60) / CAPACITY;

export interface LayerSpec {
  key: string;
  count: number;
  color: string;
  alpha: number;
}

/** open — налить заново (смена дня); diff — анимировать изменения; instant — без анимации. */
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

// Категории столкновений.
const CAT_WALL = 0x01;
const CAT_EXT = 0x02; // невидимое продолжение стенок вверх — держит насыпаемую горку
const CAT_POUR = 0x04;
const CAT_SPILL = 0x08;
const CAT_SURFACE = 0x10; // утрамбованные пласты
const CAT_FLOOR = 0x20;

const OVERFLOW_RED = '#FF5A5F';

type Ease = (t: number) => number;
const easeOutCubic: Ease = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack: Ease = (t) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

interface Tween {
  fx: number; fy: number; fa: number; fs: number; fo: number;
  tx: number; ty: number; ts: number; to: number;
  t0: number; dur: number; ease: Ease;
  onDone?: () => void;
}

type PState = 'cell' | 'falling' | 'spilled' | 'fading';

interface Particle {
  id: string;
  key: string;
  idx: number;
  state: PState;
  /** Целевая клетка; >= CAPACITY — место над краем (переполнение). */
  cell: number;
  body: Matter.Body | null;
  x: number; y: number; a: number;
  scale: number; opacity: number;
  tween: Tween | null;
  color: string;
}

interface Batch {
  parts: Particle[];
  pending: Particle[];
  nextSpawn: number;
  lastSpawn: number;
  settledSince: number | null;
}

interface Layout {
  w: number; h: number;
  S: number; cell: number; t: number;
  x0: number; y0: number; yB: number; yF: number;
}

export class VesselEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: VesselCallbacks;
  private engine = Engine.create({ enableSleeping: true });
  private L: Layout | null = null;
  private dpr = 1;

  private layers: LayerSpec[] = [];
  private styles = new Map<string, { color: string; alpha: number }>();
  private parts = new Map<string, Particle>();
  private batches: Batch[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private surface: Matter.Body[] = [];
  private statics: Matter.Body[] = [];
  private cellOwner: (Particle | null)[] = [];

  private draft: LayerSpec[] | null = null;
  private labels: VesselLabels = { free: '', overflow: null };
  private highlight: string | null = null;
  private hoverSpill = false;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private destroyed = false;
  private pendingMode: LayerMode | null = null;

  constructor(canvas: HTMLCanvasElement, cb: VesselCallbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.cb = cb;
    this.engine.gravity.y = 2.2;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('click', this.onClick);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('click', this.onClick);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }

  // ───────────────────────────── публичное API

  resize(w: number, h: number) {
    if (w < 50 || h < 50) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // На узких экранах сосуд крупнее, места под выпавшее по бокам меньше.
    const widthShare = w < 600 ? 0.84 : 0.66;
    const S = Math.floor(Math.min((w - 56) * widthShare, (h - 90) * 0.9) / GRID) * GRID;
    const cell = S / GRID;
    const t = Math.max(4, Math.round(cell * 0.32));
    const x0 = Math.round((w - S) / 2 + 12);
    const y0 = Math.round(Math.max(36, (h - S - t - 40) / 2 + 8));
    const yB = y0 + S;
    this.L = { w, h, S, cell, t, x0, y0, yB, yF: yB + t };
    this.buildStatics();
    this.rebuild(this.pendingMode === 'open' ? 'open' : 'instant');
    this.pendingMode = null;
  }

  setLayers(layers: LayerSpec[], mode: LayerMode) {
    this.layers = layers;
    this.styles = new Map(layers.map((l) => [l.key, { color: l.color, alpha: l.alpha }]));
    for (const p of this.parts.values()) {
      const st = this.styles.get(p.key);
      if (st) p.color = st.color;
    }
    if (!this.L) {
      this.pendingMode = mode;
      return;
    }
    if (mode === 'diff') this.diff();
    else this.rebuild(mode);
  }

  setDraft(draft: LayerSpec[] | null) {
    this.draft = draft && draft.some((d) => d.count > 0) ? draft : null;
  }

  setLabels(labels: VesselLabels) {
    this.labels = labels;
  }

  setHighlight(key: string | null) {
    this.highlight = key;
  }

  // ───────────────────────────── геометрия

  private cellPos(i: number): { x: number; y: number } {
    const L = this.L!;
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    return { x: L.x0 + (col + 0.5) * L.cell, y: L.yB - (row + 0.5) * L.cell };
  }

  private buildStatics() {
    const L = this.L!;
    Composite.remove(this.engine.world, this.statics);
    const { S, t, x0, y0, yB, w, h } = L;
    const wallOpts = (cat: number, mask: number) => ({
      isStatic: true, friction: 0.2, collisionFilter: { category: cat, mask },
    });
    const extH = S * 1.4;
    this.statics = [
      // стенки сосуда
      Bodies.rectangle(x0 - t / 2, y0 + S / 2 + t / 2, t, S + t, wallOpts(CAT_WALL, CAT_POUR | CAT_SPILL)),
      Bodies.rectangle(x0 + S + t / 2, y0 + S / 2 + t / 2, t, S + t, wallOpts(CAT_WALL, CAT_POUR | CAT_SPILL)),
      Bodies.rectangle(x0 + S / 2, yB + t / 2, S + 2 * t, t, wallOpts(CAT_WALL, CAT_POUR | CAT_SPILL)),
      // продолжение стенок для насыпки
      Bodies.rectangle(x0 - t / 2, y0 - extH / 2, t, extH, wallOpts(CAT_EXT, CAT_POUR)),
      Bodies.rectangle(x0 + S + t / 2, y0 - extH / 2, t, extH, wallOpts(CAT_EXT, CAT_POUR)),
      // пол и края экрана — для выпавшего
      Bodies.rectangle(w / 2, L.yF + 200, w * 3, 400, wallOpts(CAT_FLOOR, CAT_SPILL)),
      Bodies.rectangle(-100, h / 2, 200, h * 4, wallOpts(CAT_FLOOR, CAT_SPILL)),
      Bodies.rectangle(w + 100, h / 2, 200, h * 4, wallOpts(CAT_FLOOR, CAT_SPILL)),
    ];
    Composite.add(this.engine.world, this.statics);
  }

  /** Статическая поверхность утрамбованных частиц: целые ряды одним телом + клетки неполного ряда. */
  private rebuildSurface() {
    const L = this.L!;
    Composite.remove(this.engine.world, this.surface);
    this.surface = [];
    this.cellOwner = new Array(CAPACITY).fill(null);
    let k = 0;
    for (const p of this.parts.values()) {
      if (p.state === 'cell' && p.cell < CAPACITY) {
        this.cellOwner[p.cell] = p;
        k++;
      }
    }
    const opts = {
      isStatic: true, friction: 0.4, collisionFilter: { category: CAT_SURFACE, mask: CAT_POUR | CAT_SPILL },
    };
    const full = Math.floor(k / GRID);
    if (full > 0) {
      this.surface.push(Bodies.rectangle(L.x0 + L.S / 2, L.yB - (full * L.cell) / 2, L.S, full * L.cell, opts));
    }
    for (let i = full * GRID; i < k; i++) {
      const { x, y } = this.cellPos(i);
      this.surface.push(Bodies.rectangle(x, y, L.cell, L.cell, opts));
    }
    Composite.add(this.engine.world, this.surface);
  }

  private computeLayout(): Map<string, { key: string; idx: number; cell: number }> {
    const m = new Map<string, { key: string; idx: number; cell: number }>();
    let c = 0;
    for (const l of this.layers) {
      for (let i = 0; i < l.count; i++) m.set(`${l.key}#${i}`, { key: l.key, idx: i, cell: c++ });
    }
    return m;
  }

  private totalCount(): number {
    return this.layers.reduce((s, l) => s + l.count, 0);
  }

  // ───────────────────────────── частицы

  private makeParticle(id: string, key: string, idx: number, cell: number): Particle {
    const { x, y } = this.cellPos(cell);
    return {
      id, key, idx, cell, state: 'cell', body: null, x, y, a: 0, scale: 1, opacity: 1, tween: null,
      color: this.styles.get(key)?.color ?? '#888',
    };
  }

  private makeBody(x: number, y: number, cat: number): Matter.Body {
    const L = this.L!;
    const size = L.cell * 0.9;
    const spill = cat === CAT_SPILL;
    return Bodies.rectangle(x, y, size, size, {
      friction: spill ? 0.05 : 0.25,
      frictionStatic: spill ? 0.1 : 0.5,
      restitution: 0.08,
      density: 0.002,
      slop: 0.02,
      collisionFilter: {
        category: cat,
        mask: spill
          ? CAT_WALL | CAT_SURFACE | CAT_FLOOR | CAT_SPILL
          : CAT_WALL | CAT_EXT | CAT_POUR | CAT_SURFACE,
      },
    });
  }

  private removeBody(p: Particle) {
    if (!p.body) return;
    Composite.remove(this.engine.world, p.body);
    p.body = null;
  }

  private tweenTo(
    p: Particle, tx: number, ty: number, dur: number, ease: Ease = easeInOutCubic,
    opts: { delay?: number; ts?: number; to?: number; onDone?: () => void } = {},
  ) {
    p.tween = {
      fx: p.x, fy: p.y, fa: p.a, fs: p.scale, fo: p.opacity,
      tx, ty, ts: opts.ts ?? 1, to: opts.to ?? 1,
      t0: performance.now() + (opts.delay ?? 0), dur, ease, onDone: opts.onDone,
    };
  }

  /** Превращает частицу в выпавшую: физическое тело, которое скатывается через край на пол. */
  private spill(p: Particle) {
    const L = this.L!;
    this.removeBody(p);
    p.state = 'spilled';
    p.tween = null;
    p.scale = 1;
    p.opacity = 1;
    const body = this.makeBody(p.x, p.y, CAT_SPILL);
    const dir = p.x < L.x0 + L.S / 2 ? -1 : 1;
    Body.setVelocity(body, { x: dir * (2.5 + Math.random() * 3.5), y: -1 - Math.random() * 1.5 });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);
    p.body = body;
    Composite.add(this.engine.world, body);
  }

  private fadeOut(p: Particle) {
    this.removeBody(p);
    p.state = 'fading';
    this.tweenTo(p, p.x, p.y + 4, 260, easeOutCubic, {
      ts: 0.2, to: 0, onDone: () => this.parts.delete(p.id),
    });
  }

  // ───────────────────────────── перестройка и diff

  private rebuild(mode: LayerMode) {
    if (!this.L) return;
    for (const p of this.parts.values()) this.removeBody(p);
    this.parts.clear();
    this.batches = [];
    this.timers = [];

    const L = this.L;
    const layout = this.computeLayout();
    const spills: Particle[] = [];
    for (const [id, { key, idx, cell }] of layout) {
      const p = this.makeParticle(id, key, idx, cell);
      this.parts.set(id, p);
      if (cell >= CAPACITY) {
        spills.push(p);
        continue;
      }
      if (mode === 'open') {
        const row = Math.floor(cell / GRID);
        const target = { x: p.x, y: p.y };
        p.y = L.y0 - L.cell * (2 + Math.random() * 3);
        p.x = target.x + (Math.random() - 0.5) * L.cell * 0.6;
        p.a = (Math.random() - 0.5) * 0.8;
        p.opacity = 0;
        this.tweenTo(p, target.x, target.y, 380, easeOutBack, { delay: row * 38 + Math.random() * 90 });
      }
    }
    this.rebuildSurface();

    if (!spills.length) return;
    if (mode === 'open') {
      const rows = Math.ceil(Math.min(this.totalCount(), CAPACITY) / GRID);
      for (const p of spills) p.opacity = 0;
      this.timers.push({
        at: performance.now() + rows * 38 + 450,
        fn: () => spills.forEach((p) => this.parts.has(p.id) && this.spill(p)),
      });
    } else {
      spills.forEach((p) => this.spill(p));
      // Досимулировать, чтобы выпавшее сразу лежало на полу.
      for (let i = 0; i < 240; i++) Engine.update(this.engine, 1000 / 60);
      this.syncBodies();
    }
  }

  /** Мгновенно завершает незаконченные насыпки (если данные поменялись во время анимации). */
  private fastForward() {
    for (const b of this.batches) {
      for (const p of b.pending) {
        p.state = 'cell';
        const { x, y } = this.cellPos(p.cell);
        p.x = x;
        p.y = this.L!.y0 - this.L!.cell * 2;
        this.tweenTo(p, x, y, 200);
      }
      b.pending = [];
      this.compact(b, true);
    }
    this.batches = [];
  }

  private diff() {
    const L = this.L!;
    this.fastForward();
    const layout = this.computeLayout();

    // Самая верхняя клетка среди сохранившихся частиц: всё, что выше и новое, — насыпаем.
    let topPersist = -1;
    for (const [id, n] of layout) if (this.parts.has(id)) topPersist = Math.max(topPersist, n.cell);

    for (const p of [...this.parts.values()]) {
      if (p.state === 'fading') continue;
      const n = layout.get(p.id);
      if (!n) {
        this.fadeOut(p);
        continue;
      }
      const moved = n.cell !== p.cell;
      p.cell = n.cell;
      if (n.cell < CAPACITY) {
        const { x, y } = this.cellPos(n.cell);
        if (p.state === 'spilled') {
          // переполнение ушло — частица возвращается в сосуд
          this.syncBody(p);
          this.removeBody(p);
          p.state = 'cell';
          this.tweenTo(p, x, y, 650, easeInOutCubic);
        } else if (moved || p.tween) {
          p.state = 'cell';
          this.tweenTo(p, x, y, 420, easeInOutCubic, { to: 1, ts: 1 });
        }
      } else if (p.state === 'cell') {
        // пласт вытолкнуло выше края — поднимается и вываливается
        const { x, y } = this.cellPos(n.cell);
        p.state = 'falling';
        this.tweenTo(p, x, y, 420, easeInOutCubic, { onDone: () => this.spill(p) });
      }
    }

    const pour: Particle[] = [];
    for (const [id, n] of layout) {
      if (this.parts.has(id)) continue;
      const p = this.makeParticle(id, n.key, n.idx, n.cell);
      this.parts.set(id, p);
      if (n.cell >= CAPACITY) {
        // новое сверх края: падает сверху и скатывается наружу
        p.y = L.y0 - L.cell * (1 + Math.random() * 2);
        p.x = L.x0 + L.cell + Math.random() * (L.S - 2 * L.cell);
        this.spill(p);
      } else if (n.cell > topPersist) {
        p.state = 'falling';
        pour.push(p);
      } else {
        // вставка в середину — проявляется на месте
        p.scale = 0.1;
        p.opacity = 0;
        this.tweenTo(p, p.x, p.y, 320, easeOutBack, { delay: 120 });
      }
    }

    this.rebuildSurface();
    if (pour.length) {
      this.batches.push({ parts: pour, pending: [...pour], nextSpawn: performance.now() + 60, lastSpawn: 0, settledSince: null });
    }
  }

  // ───────────────────────────── насыпка

  private spawnWave(b: Batch, now: number) {
    const L = this.L!;
    const perRow = GRID - 5;
    const maxRows = 10;
    const wave = b.pending.splice(0, perRow * maxRows);
    const span = L.S - 1.8 * L.cell;
    wave.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const k = i % perRow;
      const x = L.x0 + 0.9 * L.cell + (k / (perRow - 1)) * span + (Math.random() - 0.5) * L.cell * 0.4;
      const y = L.y0 - L.cell * 1.6 - row * L.cell * 1.15 - Math.random() * L.cell * 0.3;
      const body = this.makeBody(x, y, CAT_POUR);
      Body.setAngle(body, (Math.random() - 0.5) * 0.9);
      Body.setVelocity(body, { x: (Math.random() - 0.5) * 1.2, y: 1 + Math.random() });
      p.body = body;
      p.x = x;
      p.y = y;
      p.a = body.angle;
      Composite.add(this.engine.world, body);
    });
    b.lastSpawn = now;
    b.nextSpawn = now + 420;
  }

  /** Утрамбовка: частицы слоя скользят в свои клетки, ближайшие — в нижние. */
  private compact(b: Batch, fast = false) {
    const byKey = new Map<string, Particle[]>();
    for (const p of b.parts) {
      if (!this.parts.has(p.id)) continue;
      const arr = byKey.get(p.key) ?? [];
      arr.push(p);
      byKey.set(p.key, arr);
    }
    const L = this.L!;
    for (const group of byKey.values()) {
      const cells = group.map((p) => p.cell).sort((a, c) => a - c);
      this.syncBodies(group);
      const sorted = [...group].sort((a, c) => c.y - a.y);
      const ordered: Particle[] = [];
      for (let i = 0; i < sorted.length; i += GRID) {
        ordered.push(...sorted.slice(i, i + GRID).sort((a, c) => a.x - c.x));
      }
      ordered.forEach((p, i) => {
        p.cell = cells[i];
        this.removeBody(p);
        p.state = 'cell';
        const { x, y } = this.cellPos(p.cell);
        const dist = Math.hypot(x - p.x, y - p.y) / L.cell;
        this.tweenTo(p, x, y, fast ? 160 : 200 + Math.min(220, dist * 25), easeInOutCubic);
      });
    }
    this.rebuildSurface();
  }

  private updateBatches(now: number) {
    for (const b of [...this.batches]) {
      if (b.pending.length) {
        if (now >= b.nextSpawn) this.spawnWave(b, now);
        continue;
      }
      const moving = b.parts.some((p) => p.body && !p.body.isSleeping && p.body.speed > 0.35);
      if (!moving) b.settledSince ??= now;
      else b.settledSince = null;
      const settled = b.settledSince !== null && now - b.settledSince > 120 && now - b.lastSpawn > 350;
      if (settled || now - b.lastSpawn > 2200) {
        this.compact(b);
        this.batches = this.batches.filter((x) => x !== b);
      }
    }
  }

  // ───────────────────────────── цикл

  /** Выпавшее не должно залипать на краю: пока частица над сосудом — подталкиваем к ближайшей стенке. */
  private nudgeSpills() {
    const L = this.L!;
    const mid = L.x0 + L.S / 2;
    for (const p of this.parts.values()) {
      const b = p.body;
      if (p.state !== 'spilled' || !b) continue;
      const { x, y } = b.position;
      if (y > L.y0 + L.cell * 0.5 || x < L.x0 - L.t || x > L.x0 + L.S + L.t) continue;
      const dir = x < mid ? -1 : 1;
      if (b.isSleeping) Matter.Sleeping.set(b, false);
      if (b.velocity.x * dir < 2.5) Body.setVelocity(b, { x: dir * 2.5, y: b.velocity.y });
    }
  }

  private syncBody(p: Particle) {
    if (!p.body) return;
    p.x = p.body.position.x;
    p.y = p.body.position.y;
    p.a = p.body.angle;
  }

  private syncBodies(list: Iterable<Particle> = this.parts.values()) {
    for (const p of list) this.syncBody(p);
  }

  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.L) return;
    const dt = Math.min(50, now - (this.last || now));
    this.last = now;

    for (const t of [...this.timers]) {
      if (now >= t.at) {
        this.timers = this.timers.filter((x) => x !== t);
        t.fn();
      }
    }

    this.updateBatches(now);
    this.nudgeSpills();

    this.acc += dt;
    let steps = 0;
    while (this.acc >= 1000 / 60 && steps < 3) {
      Engine.update(this.engine, 1000 / 60);
      this.acc -= 1000 / 60;
      steps++;
    }
    if (steps === 3) this.acc = 0;
    this.syncBodies();

    for (const p of this.parts.values()) {
      const tw = p.tween;
      if (!tw) continue;
      const k = Math.max(0, Math.min(1, (now - tw.t0) / tw.dur));
      if (now < tw.t0) continue;
      const e = tw.ease(k);
      p.x = tw.fx + (tw.tx - tw.fx) * e;
      p.y = tw.fy + (tw.ty - tw.fy) * e;
      p.a = tw.fa * (1 - e);
      p.scale = tw.fs + (tw.ts - tw.fs) * e;
      p.opacity = tw.fo + (tw.to - tw.fo) * Math.min(1, k * 2.5);
      if (k >= 1) {
        p.tween = null;
        tw.onDone?.();
      }
    }

    this.draw(now);
  };

  // ───────────────────────────── отрисовка

  private draw(now: number) {
    const L = this.L!;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);

    this.drawScale();

    // пол
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, L.yF + 0.5);
    ctx.lineTo(L.w, L.yF + 0.5);
    ctx.stroke();

    // частицы
    const size = L.cell * 0.86;
    const r = L.cell * 0.2;
    const hl = this.highlight;
    for (const p of this.parts.values()) {
      if (p.opacity <= 0.01 || p.scale <= 0.01) continue;
      const st = this.styles.get(p.key);
      let alpha = (st?.alpha ?? 1) * p.opacity;
      // Ключ «t:<id>» подсвечивает и привязанные пласты «t:<id>:travel» и т.п.
      const lit = hl !== null && (p.key === hl || p.key.startsWith(`${hl}:`));
      if (hl && !lit) alpha *= 0.35;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      const s = size * p.scale;
      roundRect(ctx, -s / 2, -s / 2, s, s, r * p.scale);
      ctx.fill();
      if (lit) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }

    this.drawDraft(now, size, r);
    this.drawWalls();
    this.drawLabels();
  }

  private drawScale() {
    const L = this.L!;
    const ctx = this.ctx;
    const x = L.x0 - L.t - 6;
    ctx.font = '500 11px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let h = 0; h <= 24; h++) {
      const y = Math.round(L.yB - h * L.cell) + 0.5;
      const major = h % 6 === 0;
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
    const L = this.L!;
    const ctx = this.ctx;
    const { x0, y0, yB, S, t } = L;
    const lw = Math.max(2, t * 0.6);
    const left = x0 - lw / 2 - 1;
    const right = x0 + S + lw / 2 + 1;
    const bottom = yB + lw / 2 + 1;
    const rad = L.cell * 0.6;
    ctx.strokeStyle = 'rgba(232,234,242,0.9)';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(left, y0);
    ctx.lineTo(left, bottom - rad);
    ctx.quadraticCurveTo(left, bottom, left + rad, bottom);
    ctx.lineTo(right - rad, bottom);
    ctx.quadraticCurveTo(right, bottom, right, bottom - rad);
    ctx.lineTo(right, y0);
    ctx.stroke();
  }

  private drawDraft(now: number, size: number, r: number) {
    if (!this.draft) return;
    const ctx = this.ctx;
    const pulse = 0.55 + 0.45 * Math.sin(now / 260);
    let c = Math.max(this.totalCount(), 0);
    const total = c + this.draft.reduce((s, d) => s + d.count, 0);
    const fits = total <= CAPACITY;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.2;
    for (const d of this.draft) {
      for (let i = 0; i < d.count; i++, c++) {
        const { x, y } = this.cellPos(c);
        const over = c >= CAPACITY;
        const color = over || !fits ? OVERFLOW_RED : d.color;
        ctx.globalAlpha = (over ? 0.9 : 0.75) * (0.6 + 0.4 * pulse);
        ctx.strokeStyle = color;
        roundRect(ctx, x - size / 2, y - size / 2, size, size, r);
        ctx.stroke();
        ctx.globalAlpha = (over ? 0.28 : 0.16) * pulse;
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawLabels() {
    const L = this.L!;
    const ctx = this.ctx;
    const filledRows = Math.min(this.totalCount(), CAPACITY) / GRID;
    const fillTop = L.yB - filledRows * L.cell;
    const freeRows = GRID - filledRows;
    const cx = L.x0 + L.S / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.labels.free && !this.labels.overflow) {
      ctx.font = '600 15px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const y = freeRows >= 1.6 ? (L.y0 + fillTop) / 2 : L.y0 - 16;
      ctx.fillText(this.labels.free, cx, y);
    }
    if (this.labels.overflow) {
      ctx.font = '600 14px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = OVERFLOW_RED;
      ctx.fillText(this.labels.overflow, cx, Math.min(L.h - 12, L.yF + 22));
    }
  }

  // ───────────────────────────── ввод

  private hit(clientX: number, clientY: number): { key: string | null; spill: boolean } {
    const L = this.L;
    if (!L) return { key: null, spill: false };
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const col = Math.floor((x - L.x0) / L.cell);
    const row = Math.floor((L.yB - y) / L.cell);
    if (col >= 0 && col < GRID && row >= 0 && row < GRID) {
      return { key: this.cellOwner[row * GRID + col]?.key ?? null, spill: false };
    }
    const hasSpill = [...this.parts.values()].some((p) => p.state === 'spilled');
    const outside = x < L.x0 - L.t || x > L.x0 + L.S + L.t;
    return { key: null, spill: hasSpill && (y > L.y0 && y < L.yF + 36) && (outside || y > L.yB) };
  }

  private onPointerMove = (e: PointerEvent) => {
    const h = this.hit(e.clientX, e.clientY);
    this.hoverSpill = h.spill;
    this.canvas.style.cursor = h.key || h.spill ? 'pointer' : 'default';
    this.cb.onHover?.(h.key, e.clientX, e.clientY);
  };

  private onPointerLeave = () => {
    this.canvas.style.cursor = 'default';
    this.hoverSpill = false;
    this.cb.onHover?.(null, 0, 0);
  };

  private onClick = (e: MouseEvent) => {
    const h = this.hit(e.clientX, e.clientY);
    if (h.key) this.cb.onLayerClick?.(h.key);
    else if (h.spill || (this.hoverSpill && this.labels.overflow)) this.cb.onSpillClick?.();
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function particlesFor(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.max(1, Math.round(minutes / MINUTES_PER_PARTICLE));
}
