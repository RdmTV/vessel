import { addDays } from './dates';
import { computeDay } from './day';
import { uid } from './id';
import { endSeriesFrom } from './mutations';
import type { AppData, DateKey, Goal, RecurrenceRule, Series, TaskFields } from './types';

/** Цвета полос целей на сетках. Красный не используем — он занят под «переполнено». */
export const GOAL_COLORS = ['#F5C04A', '#4FD1E8', '#B57BFF', '#6EE7A8', '#FF9F5A', '#FF7EB6', '#C6F16D', '#7AA2FF'];

export interface GoalInput {
  title: string;
  categoryId: string;
  color: string;
  start: DateKey;
  end: DateKey;
  /** Резерв времени «N минут в эти дни недели» — пласт цели в каждом дне. */
  reserve: { minutes: number; weekdays: number[] } | null;
  /** Проект фриланса: источник работы и оценка часов. */
  jobId?: string;
  estimate?: number;
}

/** Проекты (заказы) — цели, привязанные к источнику работы. */
export const isProject = (g: Goal) => !!g.jobId;

export const goalsOf = (data: AppData): Goal[] => data.goals ?? [];

export function goalsOn(data: AppData, date: DateKey): Goal[] {
  return goalsOf(data).filter((g) => g.start <= date && date <= g.end);
}

function reserveRule(weekdays: number[]): RecurrenceRule {
  return weekdays.length === 7 ? { freq: 'daily' } : { freq: 'weekly', weekdays: [...weekdays].sort() };
}

function reserveTemplate(goalId: string, input: GoalInput): TaskFields {
  return {
    title: input.title,
    categoryId: input.categoryId,
    timing: { kind: 'duration', minutes: input.reserve!.minutes },
    priority: 'medium',
    location: 'home',
    attachments: [],
    subtasks: [],
    goalId,
  };
}

/**
 * Резерв начинается не раньше сегодняшнего дня: иначе прошлые дни задним числом
 * заполнились бы «невыполненными» пластами цели.
 */
function reserveSeries(goalId: string, input: GoalInput, today: DateKey): Series | null {
  if (!input.reserve || input.reserve.minutes <= 0 || !input.reserve.weekdays.length) return null;
  const start = input.start > today ? input.start : today;
  if (start > input.end) return null;
  return {
    id: uid(),
    template: reserveTemplate(goalId, input),
    rule: reserveRule(input.reserve.weekdays),
    start,
    until: input.end,
    taken: [],
    order: Date.now(),
  };
}

function goalFrom(id: string, input: GoalInput, series: Series | null): Goal {
  return {
    id,
    title: input.title,
    categoryId: input.categoryId,
    color: input.color,
    start: input.start,
    end: input.end,
    ...(series ? { seriesId: series.id, reserve: input.reserve! } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.estimate ? { estimate: input.estimate } : {}),
  };
}

export function addGoal(data: AppData, input: GoalInput, today: DateKey): AppData {
  const id = uid();
  const series = reserveSeries(id, input, today);
  const goal = goalFrom(id, input, series);
  return {
    ...data,
    goals: [...goalsOf(data), goal],
    series: series ? [...data.series, series] : data.series,
  };
}

export function updateGoal(data: AppData, id: string, input: GoalInput, today: DateKey): AppData {
  const old = goalsOf(data).find((g) => g.id === id);
  if (!old) return data;
  let next = data;
  // Старый резерв заканчиваем с сегодняшнего дня (прошлое не трогаем) и заводим новый.
  if (old.seriesId) next = endSeriesFrom(next, old.seriesId, today);
  const series = reserveSeries(id, input, today);
  const goal = goalFrom(id, input, series);
  return {
    ...next,
    goals: goalsOf(next).map((g) => (g.id === id ? goal : g)),
    series: series ? [...next.series, series] : next.series,
  };
}

export function deleteGoal(data: AppData, id: string, today: DateKey): AppData {
  const goal = goalsOf(data).find((g) => g.id === id);
  if (!goal) return data;
  let next = goal.seriesId ? endSeriesFrom(data, goal.seriesId, today) : data;
  // Прошлые задачи остаются, просто без привязки к цели.
  next = {
    ...next,
    goals: goalsOf(next).filter((g) => g.id !== id),
    tasks: next.tasks.map((t) => (t.goalId === id ? { ...t, goalId: undefined } : t)),
    series: next.series.map((s) => (s.template.goalId === id
      ? { ...s, template: { ...s.template, goalId: undefined } }
      : s)),
  };
  return next;
}

export interface GoalStats {
  /** Всего запланировано на цель в диапазоне (включая будущий резерв), минут. */
  planned: number;
  done: number;
}

/**
 * Часы цели на отрезке (по умолчанию — весь срок цели).
 * Засчитываются и задачи цели, и обороты с этой целью (английский в наушниках по дороге).
 */
export function goalStats(data: AppData, goal: Goal, from = goal.start, to = goal.end): GoalStats {
  let planned = 0;
  let done = 0;
  const start = from > goal.start ? from : goal.start;
  const end = to < goal.end ? to : goal.end;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    for (const item of computeDay(data, d).items) {
      if (item.kind === 'task' && item.goalId === goal.id) {
        planned += item.minutes;
        if (item.done) done += item.minutes;
      }
      const p = item.parallel;
      if (p?.goalId === goal.id) {
        planned += p.minutes;
        if (p.done) done += p.minutes;
      }
    }
  }
  return { planned, done };
}

/**
 * Сколько в день нужно на проект, чтобы успеть к дедлайну: остаток оценки / оставшиеся дни (с сегодняшнего).
 */
export function projectPace(data: AppData, goal: Goal, today: DateKey): { done: number; left: number; daysLeft: number; perDay: number } {
  const done = goalStats(data, goal, goal.start, addDays(today, -1)).done
    + goalStats(data, goal, today, today).done;
  const left = Math.max(0, (goal.estimate ?? 0) - done);
  const from = today > goal.start ? today : goal.start;
  let daysLeft = 0;
  for (let d = from; d <= goal.end; d = addDays(d, 1)) daysLeft++;
  return { done, left, daysLeft, perDay: daysLeft ? Math.ceil(left / daysLeft / 5) * 5 : left };
}

/**
 * Резерв цели в этот день уже закрыт оборотом с той же целью (например, подкаст по дороге) —
 * отдельный пласт резерва можно убрать. Возвращает название пласта с оборотом.
 */
export function reserveCoveredBy(data: AppData, date: DateKey, goalId: string): string | null {
  for (const item of computeDay(data, date).items) {
    if (item.parallel?.goalId === goalId) return item.title;
  }
  return null;
}

/** Серия дней подряд (до `upTo` включительно) с отметкой «продвинулся» или «чуть-чуть». */
export function goalStreak(data: AppData, goalId: string, upTo: DateKey): number {
  let n = 0;
  for (let d = upTo; ; d = addDays(d, -1)) {
    const p = data.checkins?.[d]?.goals[goalId];
    if (p === 'yes' || p === 'little') n++;
    else break;
  }
  return n;
}
