import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { addDays, diffDays, formatMinutes, fromKey, toKey } from '../domain/dates';
import { DAY_CAPACITY, dayLoad, type DayLoad } from '../domain/day';
import { ageYears, lifeEnd } from '../domain/life';
import type { AppData, DateKey, Profile } from '../domain/types';
import { mix } from './colors';

const MONTHS_SHORT = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const C = {
  past: '#575A66',
  pastPlanned: '#A3A7B4',
  pastOver: '#8E3E42',
  today: '#55C46A',
  future: '#22242C',
  futureLow: '#2C3158',
  futureHigh: '#8A97FF',
  over: '#FF5A5F',
};

/**
 * Загрузка дней, где есть что-то кроме рутины. Считаем только диапазон, где вообще бывают данные:
 * от самой ранней записи до конца жизни (бессрочные повторы тянутся до конца).
 */
export function lifeLoads(data: AppData, profile: Profile, today: DateKey): Map<DateKey, DayLoad> {
  const end = lifeEnd(profile);
  const dates = [
    today,
    ...data.tasks.map((t) => t.date),
    ...data.series.map((s) => s.start),
    ...Object.keys(data.routineOverrides),
  ];
  const start = dates.reduce((a, b) => (b < a ? b : a));
  let last = dates.reduce((a, b) => (b > a ? b : a));
  for (const s of data.series) {
    const until = s.until ?? end;
    if (until > last) last = until;
  }
  if (last > end) last = end;

  const out = new Map<DateKey, DayLoad>();
  const hasData = data.tasks.length || data.series.length || Object.keys(data.routineOverrides).length;
  if (!hasData) return out;
  for (let d = start < profile.birthDate ? profile.birthDate : start; d <= last; d = addDays(d, 1)) {
    const l = dayLoad(data, d);
    if (l.hasPlan || l.overflow > 0) out.set(d, l);
  }
  return out;
}

export function dayColor(date: DateKey, today: DateKey, load: DayLoad | undefined): string {
  if (date === today) return C.today;
  const free = load ? Math.max(1, DAY_CAPACITY - load.routine) : 1;
  const t = load ? Math.min(1, load.planned / free) : 0;
  if (date < today) {
    if (load?.overflow) return C.pastOver;
    return load?.hasPlan ? mix(C.past, C.pastPlanned, 0.35 + 0.65 * t) : C.past;
  }
  if (load?.overflow) return C.over;
  return load?.hasPlan ? mix(C.futureLow, C.futureHigh, 0.2 + 0.8 * t) : C.future;
}

interface Layout {
  dpr: number;
  w: number;
  h: number;
  /** Месяцев в строке: 12 на широком экране, 6 на телефоне (год — две строки). */
  perRow: number;
  unit: number; // размер клетки в device px
  gap: number; // между месяцами
  rowGap: number;
  yearGap: number;
  decadeGap: number;
  labelW: number; // css px
  headerH: number; // css px
  years: number[];
}

function makeLayout(width: number, profile: Profile): Layout {
  const perRow = width < 700 ? 6 : 12;
  const rowsPerYear = 12 / perRow;
  const labelW = width < 500 ? 30 : 46;
  const headerH = perRow === 12 ? 16 : 4;
  const units = perRow * 31 + (perRow - 1) * 1.6;
  const unitCss = Math.max(0.5, (width - labelW - 4) / units);
  // Внутреннее разрешение с запасом: клетка ≥ 3 пикселей canvas — чёткие края, сетка во всю ширину.
  const dpr = Math.max(window.devicePixelRatio || 1, Math.ceil(3 / unitCss));
  const avail = Math.max(100, (width - labelW - 4) * dpr);
  const unit = Math.max(1, Math.floor(avail / units));
  const gap = Math.max(1, Math.round(unit * 1.6));
  const rowGap = Math.max(1, Math.round(unit * 0.5));
  const yearGap = rowsPerYear > 1 ? rowGap * 2 : 0;
  const decadeGap = Math.max(2, unit * 2);
  const startYear = fromKey(profile.birthDate).getFullYear();
  const endYear = fromKey(lifeEnd(profile)).getFullYear();
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  const rowsPx = years.length * (rowsPerYear * (unit + rowGap) + yearGap) + Math.floor(years.length / 10) * decadeGap;
  return { dpr, w: width, h: headerH + rowsPx / dpr + 4, perRow, unit, gap, rowGap, yearGap, decadeGap, labelW, headerH, years };
}

/** Позиция клетки в device px. */
function cellXY(L: Layout, yearIdx: number, month: number, day: number) {
  const part = Math.floor(month / L.perRow);
  const row = yearIdx * (12 / L.perRow) + part;
  const x = L.labelW * L.dpr + (month % L.perRow) * (31 * L.unit + L.gap) + (day - 1) * L.unit;
  const y = L.headerH * L.dpr + row * (L.unit + L.rowGap) + yearIdx * L.yearGap + Math.floor(yearIdx / 10) * L.decadeGap;
  return { x, y };
}

interface Props {
  data: AppData;
  profile: Profile;
  today: DateKey;
  selected?: DateKey;
  /** Анимация «прожитого» для онбординга, мс. */
  revealMs?: number;
  onPick?: (date: DateKey) => void;
}

export function LifeGrid({ data, profile, today, selected, revealMs, onPick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const loads = useMemo(() => lifeLoads(data, profile, today), [data, profile, today]);
  const layout = useMemo(() => (width ? makeLayout(width, profile) : null), [width, profile]);
  const end = lifeEnd(profile);

  // Все дни жизни с координатами — считаем один раз на раскладку.
  const cells = useMemo(() => {
    if (!layout) return [];
    const out: { key: DateKey; x: number; y: number; n: number }[] = [];
    layout.years.forEach((year, yi) => {
      for (let m = 0; m < 12; m++) {
        const days = new Date(year, m + 1, 0).getDate();
        for (let d = 1; d <= days; d++) {
          const key = toKey(new Date(year, m, d));
          if (key < profile.birthDate || key > end) continue;
          const { x, y } = cellXY(layout, yi, m, d);
          out.push({ key, x, y, n: out.length });
        }
      }
    });
    return out;
  }, [layout, profile.birthDate, end]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const L = layout;
    const canvas = canvasRef.current;
    if (!L || !canvas) return;
    canvas.width = Math.round(L.w * L.dpr);
    canvas.height = Math.round(L.h * L.dpr);
    canvas.style.width = `${L.w}px`;
    canvas.style.height = `${L.h}px`;
    const ctx = canvas.getContext('2d')!;
    const size = L.unit >= 4 ? L.unit - 1 : L.unit;
    const lived = diffDays(profile.birthDate, today);

    const drawAll = (revealDays: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // подписи месяцев (когда год в одну строку)
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${10 * L.dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (L.perRow === 12) {
        for (let m = 0; m < 12; m++) {
          const { x } = cellXY(L, 0, m, 16);
          ctx.fillText(MONTHS_SHORT[m], x, (L.headerH / 2) * L.dpr);
        }
      }

      // подпись слева: год и возраст каждые 5 лет
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.textAlign = 'right';
      ctx.font = `${9 * L.dpr}px system-ui, sans-serif`;
      L.years.forEach((year, yi) => {
        if (yi % 5 !== 0 && yi !== L.years.length - 1) return;
        const { y } = cellXY(L, yi, 0, 1);
        ctx.fillText(L.labelW > 40 ? `${year} · ${yi}` : String(yi), (L.labelW - 6) * L.dpr, y + L.unit / 2);
      });

      for (const c of cells) {
        // при «проявлении» прожитое закрашивается по порядку от рождения
        const hidden = c.key <= today && c.n >= revealDays;
        ctx.fillStyle = hidden ? C.future : dayColor(c.key, today, loads.get(c.key));
        ctx.fillRect(c.x, c.y, size, size);
      }

      // рамки: сегодня (зелёная, видна даже на крошечной сетке) и выбранный день (белая)
      const ring = (key: DateKey, color: string, padUnits: number) => {
        const s = fromKey(key);
        const yi = s.getFullYear() - L.years[0];
        if (yi < 0 || yi >= L.years.length) return;
        const { x, y } = cellXY(L, yi, s.getMonth(), s.getDate());
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, L.dpr * 1.6);
        const pad = Math.max(3, L.unit * padUnits);
        ctx.strokeRect(x - pad, y - pad, size + pad * 2, size + pad * 2);
      };
      if (revealDays > lived) ring(today, C.today, 3);
      if (selected && selected !== today) ring(selected, '#ffffff', 1.2);
    };

    if (!revealMs) {
      drawAll(Infinity);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / revealMs);
      const eased = 1 - (1 - k) ** 2;
      drawAll(k >= 1 ? Infinity : Math.floor(lived * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, cells, loads, profile, today, selected, revealMs]);

  /** Клетка под курсором → дата. */
  const dateAt = (clientX: number, clientY: number): DateKey | null => {
    const L = layout;
    const canvas = canvasRef.current;
    if (!L || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const px = (clientX - r.left) * L.dpr - L.labelW * L.dpr;
    const py = (clientY - r.top) * L.dpr - L.headerH * L.dpr;
    if (px < 0 || py < 0) return null;
    const monthW = 31 * L.unit + L.gap;
    const col = Math.floor(px / monthW);
    const d = Math.floor((px - col * monthW) / L.unit) + 1;
    // строка с учётом промежутков между годами и десятилетиями
    let yi = -1;
    let part = 0;
    const absY = py + L.headerH * L.dpr;
    for (let i = 0; i < L.years.length && yi < 0; i++) {
      for (let p = 0; p < 12 / L.perRow; p++) {
        const { y } = cellXY(L, i, p * L.perRow, 1);
        if (absY >= y - L.rowGap && absY < y + L.unit + L.rowGap) {
          yi = i;
          part = p;
          break;
        }
      }
    }
    const m = part * L.perRow + col;
    if (col < 0 || col >= L.perRow || yi < 0 || d < 1 || d > 31) return null;
    const year = L.years[yi];
    if (d > new Date(year, m + 1, 0).getDate()) return null;
    const key = toKey(new Date(year, m, d));
    if (key < profile.birthDate || key > end) return null;
    return key;
  };

  const onMove = (e: PointerEvent) => {
    const key = dateAt(e.clientX, e.clientY);
    if (!key) {
      setTip(null);
      return;
    }
    const d = fromKey(key);
    const load = loads.get(key);
    const age = ageYears(profile.birthDate, key);
    let text = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()} · ${age} лет`;
    if (key === today) text += ' · сегодня';
    if (load?.overflow) text += ` · переполнен на ${formatMinutes(load.overflow)}`;
    else if (load?.hasPlan) text += ` · запланировано ${formatMinutes(load.planned)}`;
    setTip({ text, x: e.clientX, y: e.clientY });
  };

  return (
    <div ref={wrapRef} className="life-grid">
      <canvas
        ref={canvasRef}
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
        onClick={(e) => {
          const key = dateAt(e.clientX, e.clientY);
          if (key && onPick) onPick(key);
        }}
        style={{ cursor: onPick ? 'pointer' : 'default' }}
      />
      {tip && <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>}
    </div>
  );
}
