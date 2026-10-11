import type { DateKey } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): DateKey {
  return toKey(new Date());
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** 0 = Пн … 6 = Вс */
export function weekday(key: DateKey): number {
  return (fromKey(key).getDay() + 6) % 7;
}

export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);
}

export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function formatDay(key: DateKey): string {
  const d = fromKey(key);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${WEEKDAYS_SHORT[weekday(key)]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${year}`;
}

export function formatDayShort(key: DateKey): string {
  const d = fromKey(key);
  return `${WEEKDAYS_SHORT[weekday(key)]} ${d.getDate()}.${pad(d.getMonth() + 1)}`;
}

export function formatMinutes(min: number): string {
  const sign = min < 0 ? '−' : '';
  const m = Math.abs(Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${sign}${h}ч ${r}м`;
  if (h) return `${sign}${h}ч`;
  return `${sign}${r}м`;
}

export function formatClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function parseClock(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
