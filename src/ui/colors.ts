import { category } from '../domain/categories';
import type { DayItem } from '../domain/day';
import { particlesFor, type LayerSpec } from '../vessel/VesselEngine';

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

/** Рутина — приглушённый фундамент; невыполненное — полупрозрачное; выполненное — плотное. */
export function itemLayer(i: DayItem): LayerSpec {
  const base = category(i.categoryId).color;
  if (i.kind === 'routine') {
    return { key: i.key, count: particlesFor(i.minutes), color: mix(base, '#2B2D36', 0.38), alpha: 1 };
  }
  return { key: i.key, count: particlesFor(i.minutes), color: base, alpha: i.done ? 1 : 0.5 };
}
