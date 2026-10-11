import { CATEGORIES } from './categories';
import { addDays, fromKey, toKey } from './dates';
import { computeDay, timingMinutes, type DayPlan } from './day';
import { weekStart } from './week';
import type { AppData, DateKey } from './types';

export type Period = 'week' | 'month';
export type LoadClass = 'free' | 'normal' | 'tight' | 'over';

export const LOAD_LABEL: Record<LoadClass, string> = {
  free: 'Свободный',
  normal: 'Нормальный',
  tight: 'Под завязку',
  over: 'Переполнен',
};

/** Пороги по свободному времени дня: > 4ч — свободный, 1–4ч — нормальный, < 1ч — под завязку. */
export const FREE_DAY_MIN = 4 * 60;
export const TIGHT_DAY_MIN = 60;

export function classifyDay(plan: DayPlan): LoadClass {
  if (plan.overflow > 0) return 'over';
  if (plan.free > FREE_DAY_MIN) return 'free';
  if (plan.free >= TIGHT_DAY_MIN) return 'normal';
  return 'tight';
}

export function periodRange(date: DateKey, period: Period): [DateKey, DateKey] {
  if (period === 'week') {
    const s = weekStart(date);
    return [s, addDays(s, 6)];
  }
  const d = fromKey(date);
  return [toKey(new Date(d.getFullYear(), d.getMonth(), 1)), toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}

export interface CategoryTotal {
  categoryId: string;
  routine: number;
  done: number;
  /** Запланировано и не сделано. */
  planned: number;
}

export interface PeriodStats {
  from: DateKey;
  to: DateKey;
  days: { date: DateKey; plan: DayPlan; cls: LoadClass }[];
  byCategory: CategoryTotal[];
  tasks: { count: number; doneCount: number; minutes: number; doneMinutes: number };
  classes: Record<LoadClass, number>;
  freeTotal: number;
  ratingAvg: number | null;
  checkinCount: number;
}

export function periodStats(data: AppData, from: DateKey, to: DateKey): PeriodStats {
  const days: PeriodStats['days'] = [];
  const cats = new Map<string, CategoryTotal>();
  const tasks = { count: 0, doneCount: 0, minutes: 0, doneMinutes: 0 };
  const classes: Record<LoadClass, number> = { free: 0, normal: 0, tight: 0, over: 0 };
  let freeTotal = 0;
  let ratingSum = 0;
  let checkinCount = 0;

  for (let d = from; d <= to; d = addDays(d, 1)) {
    const plan = computeDay(data, d);
    const cls = classifyDay(plan);
    days.push({ date: d, plan, cls });
    classes[cls]++;
    freeTotal += plan.free;

    for (const item of plan.items) {
      const c = cats.get(item.categoryId) ?? { categoryId: item.categoryId, routine: 0, done: 0, planned: 0 };
      if (item.kind === 'routine') c.routine += item.minutes;
      else if (item.done) c.done += item.minutes;
      else c.planned += item.minutes;
      cats.set(item.categoryId, c);
    }
    for (const t of plan.tasks) {
      const m = timingMinutes(t.timing);
      tasks.count++;
      tasks.minutes += m;
      if (t.done) {
        tasks.doneCount++;
        tasks.doneMinutes += m;
      }
    }
    const ci = data.checkins?.[d];
    if (ci) {
      ratingSum += ci.rating;
      checkinCount++;
    }
  }

  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  const byCategory = [...cats.values()].sort((a, b) =>
    (b.done + b.planned) - (a.done + a.planned) || (order.get(a.categoryId) ?? 99) - (order.get(b.categoryId) ?? 99));

  return {
    from, to, days, byCategory, tasks, classes, freeTotal,
    ratingAvg: checkinCount ? ratingSum / checkinCount : null,
    checkinCount,
  };
}
