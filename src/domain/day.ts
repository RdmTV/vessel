import { ATTACHMENT_CATEGORY } from './categories';
import { addDays, weekday } from './dates';
import { occursVirtually } from './recurrence';
import type {
  AppData, AttachmentKind, DateKey, Job, Parallel, Priority, RoutineItem, Task, TaskFields, Timing,
} from './types';
import { blockMinutes, jobParallelOn, jobsOf } from './work';

export const DAY_CAPACITY = 24 * 60;

/** Задача дня: реальная или виртуальный экземпляр серии (ещё не материализован). */
export interface DayTask extends Task {
  virtual?: boolean;
}

/** job — незанятая часть блока работы (рабочие задачи заполняют блок изнутри). */
export type ItemKind = 'routine' | 'job' | 'task' | 'carry' | 'buffer' | AttachmentKind;

/** Один пласт в сосуде. */
export interface DayItem {
  key: string;
  kind: ItemKind;
  title: string;
  categoryId: string;
  minutes: number;
  done: boolean;
  taskId?: string;
  /** Для пункта рутины. */
  routineId?: string;
  goalId?: string;
  /** Пласт относится к работе (блок, дорога на работу, рабочая задача, фриланс). */
  jobId?: string;
  /** Цвет источника работы вместо цвета категории. */
  color?: string;
  /** Оборот: дело внутри этого же пласта, места не занимает. minutes ≤ minutes пласта. */
  parallel?: Parallel;
}

/** Работа в этот день: блок по графику, сколько занято задачами, переработка. */
export interface JobDay {
  job: Job;
  block: number;
  used: number;
  overtime: number;
}

export interface DayPlan {
  date: DateKey;
  items: DayItem[];
  tasks: DayTask[];
  total: number;
  free: number;
  overflow: number;
  jobs: JobDay[];
  overtime: number;
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

/** Оборот не может быть длиннее своего пласта. */
function capParallel(p: Parallel | undefined, minutes: number): Parallel | undefined {
  if (!p || p.minutes <= 0 || minutes <= 0) return undefined;
  return p.minutes > minutes ? { ...p, minutes } : p;
}

/** Пласты задачи на её день: сама задача + привязанные скрытые затраты + буфер. */
export function taskItems(
  t: Pick<Task, 'id' | 'title' | 'categoryId' | 'timing' | 'attachments' | 'done' | 'goalId' | 'parallel'>,
  bufferMinutes: number,
  keyPrefix = 't',
): DayItem[] {
  const minutes = minutesOnStartDay(t.timing);
  const items: DayItem[] = [{
    key: `${keyPrefix}:${t.id}`,
    kind: 'task',
    title: t.title,
    categoryId: t.categoryId,
    minutes,
    done: t.done,
    taskId: t.id,
    goalId: t.goalId,
    parallel: capParallel(t.parallel, minutes),
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
      parallel: capParallel(a.parallel, a.minutes),
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

/** Оборот пункта рутины на день: переопределение дня важнее шаблона. */
export function routineParallelOn(data: AppData, date: DateKey, item: RoutineItem): Parallel | undefined {
  const day = data.routineParallel?.[date];
  if (day && item.id in day) return day[item.id] ?? undefined;
  return item.parallel;
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
      routineId: r.id,
      parallel: capParallel(routineParallelOn(data, date, r), minutes),
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
  const buffer = data.settings.bufferMinutes;
  const jobDays = workItems(data, date, tasks, items);

  // Своё: личные задачи и фриланс (ярус поверх работы). Задачи основной работы уже внутри блока.
  const fixedIds = new Set(jobDays.map((j) => j.job.id));
  const jobColor = new Map(jobsOf(data).map((j) => [j.id, j.color]));
  const projectJob = new Map((data.goals ?? []).filter((g) => g.jobId).map((g) => [g.id, g.jobId!]));
  for (const t of tasks) {
    if (t.jobId && fixedIds.has(t.jobId)) continue;
    const jobId = t.jobId ?? (t.goalId ? projectJob.get(t.goalId) : undefined);
    const its = taskItems(t, buffer);
    if (jobId) {
      for (const it of its) {
        it.jobId = jobId;
        if (it.kind === 'task') it.color = jobColor.get(jobId);
      }
    }
    items.push(...its);
  }

  const total = items.reduce((s, i) => s + i.minutes, 0);
  return {
    date,
    items,
    tasks,
    total,
    free: Math.max(0, DAY_CAPACITY - total),
    overflow: Math.max(0, total - DAY_CAPACITY),
    jobs: jobDays,
    overtime: jobDays.reduce((s, j) => s + j.overtime, 0),
  };
}

/**
 * Основная работа — контейнер: дорога на работу, рабочие задачи и незанятая часть блока.
 * Задачи заполняют блок изнутри; если их больше блока — переработка, блок растёт.
 */
function workItems(data: AppData, date: DateKey, tasks: DayTask[], items: DayItem[]): JobDay[] {
  const out: JobDay[] = [];
  for (const job of jobsOf(data)) {
    if (job.kind !== 'fixed') continue;
    const block = blockMinutes(data, job, date);
    const own = tasks.filter((t) => t.jobId === job.id);
    if (block === 0 && own.length === 0) continue;

    if (block > 0 && job.commuteMinutes > 0) {
      items.push({
        key: `j:${job.id}:travel`,
        kind: 'travel',
        title: 'Дорога на работу',
        categoryId: 'commute',
        minutes: job.commuteMinutes,
        done: false,
        jobId: job.id,
        parallel: capParallel(jobParallelOn(data, date, job, 'travel'), job.commuteMinutes),
      });
    }

    let used = 0;
    for (const t of own) {
      for (const it of taskItems(t, data.settings.bufferMinutes)) {
        it.jobId = job.id;
        if (it.kind === 'task') it.color = job.color;
        used += it.minutes;
        items.push(it);
      }
    }

    const rest = Math.max(0, block - used);
    if (rest > 0) {
      items.push({
        key: `j:${job.id}`,
        kind: 'job',
        title: job.title,
        categoryId: 'work',
        minutes: rest,
        done: false,
        jobId: job.id,
        color: job.color,
        parallel: capParallel(jobParallelOn(data, date, job, 'block'), rest),
      });
    }
    out.push({ job, block, used, overtime: Math.max(0, used - block) });
  }
  return out;
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

/** Основание дня: рутина + блок работы целиком + дорога на работу. Сверху — личное и переработка. */
export function baseMinutes(plan: DayPlan): number {
  let base = 0;
  for (const i of plan.items) {
    if (i.kind === 'routine') base += i.minutes;
    else if (i.kind === 'travel' && i.jobId && !i.taskId) base += i.minutes;
  }
  for (const j of plan.jobs) base += j.block;
  return base;
}

export function dayLoad(data: AppData, date: DateKey): DayLoad {
  const plan = computeDay(data, date);
  const routine = baseMinutes(plan);
  const planned = Math.max(0, plan.total - routine);
  return { routine, planned, total: plan.total, overflow: plan.overflow, hasPlan: planned > 0 };
}

/**
 * Сколько черновик реально добавит в сосуд. Рабочая задача внутри блока добавляет 0
 * (она заполняет блок), сверх блока — только переработку.
 */
export function draftEffect(data: AppData, date: DateKey, fields: TaskFields, before: DayPlan): { added: number; total: number } {
  const probe: Task = { ...fields, id: '__draft__', date, done: false, order: Number.MAX_SAFE_INTEGER };
  const after = computeDay({ ...data, tasks: [...data.tasks, probe] }, date);
  return { added: after.total - before.total, total: after.total };
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
