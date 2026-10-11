import { addDays } from './dates';
import { tasksForDate, type DayTask } from './day';
import { goalsOn } from './goals';
import type { AppData, CheckIn, DateKey, Goal } from './types';

/** Сколько дней назад искать невыполненное. */
const LOOKBACK_DAYS = 14;

export interface PendingCheckIn {
  /** О каком дне спрашиваем (вчера). */
  date: DateKey;
  goals: Goal[];
  /** Невыполненное за пропущенные дни (до вчера включительно). */
  undone: DayTask[];
  hadTasks: boolean;
}

/**
 * Нужно ли сегодня спросить про вчера. Спрашиваем только про последний день,
 * а невыполненное собираем за все пропущенные дни — одним списком.
 */
export function pendingCheckIn(data: AppData, today: DateKey): PendingCheckIn | null {
  if (data.settings.checkinEnabled === false) return null;
  if (data.lastCheckinPrompt === today) return null;
  const date = addDays(today, -1);
  if (data.checkins?.[date]) return null;
  if (data.profile && date < data.profile.birthDate) return null;

  // Пропущенный отрезок начинается в день прошлого показа (тогда спрашивали про дни до него),
  // но не дальше LOOKBACK_DAYS назад.
  let from = addDays(today, -LOOKBACK_DAYS);
  if (data.lastCheckinPrompt && data.lastCheckinPrompt > from) from = data.lastCheckinPrompt;

  const undone: DayTask[] = [];
  for (let d = from; d <= date; d = addDays(d, 1)) {
    for (const t of tasksForDate(data, d)) if (!t.done) undone.push(t);
  }
  const goals = goalsOn(data, date);
  const hadTasks = tasksForDate(data, date).length > 0;
  if (!goals.length && !hadTasks && !undone.length) return null;
  return { date, goals, undone, hadTasks };
}

export function saveCheckIn(data: AppData, checkin: CheckIn, today: DateKey): AppData {
  return {
    ...data,
    checkins: { ...(data.checkins ?? {}), [checkin.date]: checkin },
    lastCheckinPrompt: today,
  };
}

export function skipCheckIn(data: AppData, today: DateKey): AppData {
  return { ...data, lastCheckinPrompt: today };
}

/** Цвет оценки дня: 1 — красноватый, 5 — зелёный. */
export const RATING_COLORS = ['#D9605F', '#E0904D', '#D8C152', '#9CCB5E', '#55C46A'];
