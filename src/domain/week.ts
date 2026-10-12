import { CATEGORIES } from './categories';
import { addDays, weekday } from './dates';
import { computeDay, DAY_CAPACITY, type DayPlan } from './day';
import type { AppData, DateKey } from './types';

export const WEEK_CAPACITY = 7 * DAY_CAPACITY;

/** Понедельник недели, в которую входит дата. */
export function weekStart(date: DateKey): DateKey {
  return addDays(date, -weekday(date));
}

export function weekDays(start: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type WeekGroupKind = 'routine' | 'done' | 'planned';

/** Пласт недельного сосуда: всё время недели одной категории и одного вида. */
export interface WeekGroup {
  key: string;
  kind: WeekGroupKind;
  categoryId: string;
  minutes: number;
}

export interface WeekPlan {
  start: DateKey;
  days: DayPlan[];
  groups: WeekGroup[];
  total: number;
  free: number;
  overflow: number;
}

const KIND_ORDER: WeekGroupKind[] = ['routine', 'done', 'planned'];
const PREFIX: Record<WeekGroupKind, string> = { routine: 'wr', done: 'wd', planned: 'wp' };

/**
 * Неделя одним сосудом. Пласты сгруппированы по категориям:
 * внизу рутина, выше сделанное, сверху запланированное и ещё не сделанное.
 */
export function aggregateWeek(data: AppData, start: DateKey): WeekPlan {
  const days = weekDays(start).map((d) => computeDay(data, d));
  const sums = new Map<string, WeekGroup>();
  for (const day of days) {
    for (const item of day.items) {
      // Основание недели: рутина, незанятый блок работы и дорога на работу.
      const base = item.kind === 'routine' || item.kind === 'job' || (item.kind === 'travel' && !!item.jobId && !item.taskId);
      const kind: WeekGroupKind = base ? 'routine' : item.done ? 'done' : 'planned';
      const key = `${PREFIX[kind]}:${item.categoryId}`;
      const g = sums.get(key);
      if (g) g.minutes += item.minutes;
      else sums.set(key, { key, kind, categoryId: item.categoryId, minutes: item.minutes });
    }
  }
  const catOrder = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  const groups = [...sums.values()].sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || (catOrder.get(a.categoryId) ?? 99) - (catOrder.get(b.categoryId) ?? 99));
  const total = groups.reduce((s, g) => s + g.minutes, 0);
  return {
    start,
    days,
    groups,
    total,
    free: Math.max(0, WEEK_CAPACITY - total),
    overflow: Math.max(0, total - WEEK_CAPACITY),
  };
}
