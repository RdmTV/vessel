import { ATTACHMENT_CATEGORY } from './categories';
import { addDays, weekday } from './dates';
import { occursVirtually } from './recurrence';
import type {
  AppData, AttachmentKind, DateKey, Priority, Task, TaskFields, Timing,
} from './types';

export const DAY_CAPACITY = 24 * 60;

/** Задача дня: реальная или виртуальный экземпляр серии (ещё не материализован). */
export interface DayTask extends Task {
  virtual?: boolean;
}

export type ItemKind = 'routine' | 'task' | 'carry' | 'buffer' | AttachmentKind;

/** Один пласт в сосуде. */
export interface DayItem {
  key: string;
  kind: ItemKind;
  title: string;
  categoryId: string;
  minutes: number;
  done: boolean;
  taskId?: string;
}

export interface DayPlan {
  date: DateKey;
  items: DayItem[];
  tasks: DayTask[];
  total: number;
  free: number;
  overflow: number;
}

/**
 * id экземпляра серии. Материализованная задача получает тот же id,
 * поэтому пласт в сосуде не меняет идентичность при отметке «сделано».
 * uid() никогда не содержит «~».
 */
export const virtualId = (seriesId: string, date: DateKey) => `${seriesId}~${date}`;

export function parseVirtualId(id: string): { seriesId: string; date: DateKey } | null {
  const i = id.indexOf('~');
  if (i < 0) return null;
  return { seriesId: id.slice(0, i), date: id.slice(i + 1) };
}

export function intervalLength(start: number, end: number): number {
  return (end - start + DAY_CAPACITY) % DAY_CAPACITY;
}

/** Полная длительность задачи (без скрытых затрат). */
export function timingMinutes(t: Timing): number {
  return t.kind === 'duration' ? t.minutes : intervalLength(t.start, t.end);
}

export const crossesMidnight = (t: Timing) => t.kind === 'interval' && t.end < t.start && t.end > 0;

/** Сколько минут задачи приходится на её собственный день. */
export function minutesOnStartDay(t: Timing): number {
  if (t.kind === 'duration') return t.minutes;
  return crossesMidnight(t) ? DAY_CAPACITY - t.start : intervalLength(t.start, t.end);
}

// Индекс задач по датам. Данные неизменяемые, поэтому кэш по ссылке на AppData корректен.
const byDateCache = new WeakMap<AppData, Map<DateKey, Task[]>>();

function tasksByDate(data: AppData): Map<DateKey, Task[]> {
  let m = byDateCache.get(data);
  if (!m) {
    m = new Map();
    for (const t of data.tasks) {
      const arr = m.get(t.date);
      if (arr) arr.push(t);
      else m.set(t.date, [t]);
    }
    byDateCache.set(data, m);
  }
  return m;
}

export function tasksForDate(data: AppData, date: DateKey): DayTask[] {
  const result: DayTask[] = [...(tasksByDate(data).get(date) ?? [])];
  for (const s of data.series) {
    if (!occursVirtually(s, date)) continue;
    // Без глубокого копирования: данные неизменяемые, а сетки жизни считают тысячи дней.
    result.push({
      ...s.template,
      id: virtualId(s.id, date),
      date,
      done: false,
      order: s.order,
      seriesId: s.id,
      virtual: true,
    });
  }
  return result.sort((a, b) => a.order - b.order);
}

/** Пласты задачи на её день: сама задача + привязанные скрытые затраты + буфер. */
export function taskItems(
  t: Pick<Task, 'id' | 'title' | 'categoryId' | 'timing' | 'attachments' | 'done'>,
  bufferMinutes: number,
  keyPrefix = 't',
): DayItem[] {
  const items: DayItem[] = [{
    key: `${keyPrefix}:${t.id}`,
    kind: 'task',
    title: t.title,
    categoryId: t.categoryId,
    minutes: minutesOnStartDay(t.timing),
    done: t.done,
    taskId: t.id,
  }];
  for (const a of t.attachments) {
    if (a.minutes <= 0) continue;
    items.push({
      key: `${keyPrefix}:${t.id}:${a.kind}`,
      kind: a.kind,
      title: a.label,
      categoryId: ATTACHMENT_CATEGORY[a.kind],
      minutes: a.minutes,
      done: t.done,
      taskId: t.id,
    });
  }
  if (bufferMinutes > 0) {
    items.push({
      key: `${keyPrefix}:${t.id}:buffer`,
      kind: 'buffer',
      title: 'Переключение',
      categoryId: 'hidden',
      minutes: bufferMinutes,
      done: t.done,
      taskId: t.id,
    });
  }
  return items;
}

export function routineItems(data: AppData, date: DateKey): DayItem[] {
  const wd = weekday(date);
  const overrides = data.routineOverrides[date] ?? {};
  const items: DayItem[] = [];
  for (const r of data.routine) {
    if (!r.weekdays.includes(wd)) continue;
    const minutes = overrides[r.id] ?? r.minutes;
    if (minutes <= 0) continue;
    items.push({
      key: `r:${r.id}`,
      kind: 'routine',
      title: r.title,
      categoryId: r.categoryId,
      minutes,
      done: false,
    });
  }
  return items;
}

export function computeDay(data: AppData, date: DateKey): DayPlan {
  const items = routineItems(data, date);

  // Хвосты задач прошлого дня, перешедших через полночь, — утро этого дня.
  for (const t of tasksForDate(data, addDays(date, -1))) {
    if (t.timing.kind !== 'interval' || !crossesMidnight(t.timing)) continue;
    items.push({
      key: `c:${t.id}`,
      kind: 'carry',
      title: `${t.title} (после полуночи)`,
      categoryId: t.categoryId,
      minutes: t.timing.end,
      done: t.done,
      taskId: t.id,
    });
  }

  const tasks = tasksForDate(data, date);
  for (const t of tasks) items.push(...taskItems(t, data.settings.bufferMinutes));

  const total = items.reduce((s, i) => s + i.minutes, 0);
  return {
    date,
    items,
    tasks,
    total,
    free: Math.max(0, DAY_CAPACITY - total),
    overflow: Math.max(0, total - DAY_CAPACITY),
  };
}

/** Сводка дня для сеток: рутина отдельно от запланированного. */
export interface DayLoad {
  routine: number;
  planned: number;
  total: number;
  overflow: number;
  /** Есть ли в дне что-то кроме рутины. */
  hasPlan: boolean;
}

export function dayLoad(data: AppData, date: DateKey): DayLoad {
  const plan = computeDay(data, date);
  let routine = 0;
  for (const i of plan.items) if (i.kind === 'routine') routine += i.minutes;
  const planned = plan.total - routine;
  return { routine, planned, total: plan.total, overflow: plan.overflow, hasPlan: planned > 0 };
}

/** Сколько минут черновик займёт в своём дне. */
export function draftMinutes(fields: TaskFields, bufferMinutes: number): number {
  return taskItems({ ...fields, id: 'draft', done: false }, bufferMinutes)
    .reduce((s, i) => s + i.minutes, 0);
}

/** Ближайшие дни после `from`, куда черновик влезает целиком. */
export function nearestFitDays(
  data: AppData, fields: TaskFields, from: DateKey, count = 3, horizon = 60,
): { date: DateKey; free: number }[] {
  const need = draftMinutes(fields, data.settings.bufferMinutes);
  const found: { date: DateKey; free: number }[] = [];
  for (let i = 1; i <= horizon && found.length < count; i++) {
    const date = addDays(from, i);
    const plan = computeDay(data, date);
    const free = DAY_CAPACITY - plan.total;
    if (free >= need) found.push({ date, free });
  }
  return found;
}

export const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2 };
export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'Высокий', medium: 'Средний', low: 'Низкий',
};

/** Кандидаты на вытеснение: невыполненные задачи дня, сначала наименее важные. */
export function displaceCandidates(plan: DayPlan, maxPriority: Priority = 'high'): DayTask[] {
  return plan.tasks
    .filter((t) => !t.done && PRIORITY_RANK[t.priority] <= PRIORITY_RANK[maxPriority])
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}
