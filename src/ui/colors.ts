import { category } from '../domain/categories';
import type { DayItem } from '../domain/day';
import type { WeekGroup } from '../domain/week';
import { grainsFor, WEEK_SCALE, type LayerSpec } from '../vessel/VesselEngine';

export const ROUTINE_TINT = '#2B2D36';

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
}

/** Рутина — приглушённый фундамент; невыполненное — блёклое; выполненное — яркое. */
export function itemLayer(i: DayItem): LayerSpec {
  const base = category(i.categoryId).color;
  if (i.kind === 'routine') {
    return { key: i.key, count: grainsFor(i.minutes), color: mix(base, ROUTINE_TINT, 0.38), alpha: 1 };
  }
  return { key: i.key, count: grainsFor(i.minutes), color: base, alpha: i.done ? 1 : 0.5 };
}

/** Пласт недельного сосуда — те же правила цвета, шкала 168 часов. */
export function weekGroupLayer(g: WeekGroup): LayerSpec {
  const base = category(g.categoryId).color;
  const count = grainsFor(g.minutes, WEEK_SCALE.hours);
  if (g.kind === 'routine') return { key: g.key, count, color: mix(base, ROUTINE_TINT, 0.38), alpha: 1 };
  return { key: g.key, count, color: base, alpha: g.kind === 'done' ? 1 : 0.5 };
}
