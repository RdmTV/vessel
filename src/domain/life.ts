import { addDays, diffDays, fromKey, toKey } from './dates';
import type { DateKey, Profile } from './types';

export const DEFAULT_LIFE_YEARS = 80;

export function addYears(key: DateKey, years: number): DateKey {
  const d = fromKey(key);
  const day = d.getDate();
  d.setFullYear(d.getFullYear() + years);
  // 29 февраля → 28 февраля в невисокосный год
  if (d.getDate() !== day) d.setDate(0);
  return toKey(d);
}

/** Последний день ожидаемой жизни. */
export function lifeEnd(p: Profile): DateKey {
  return addDays(addYears(p.birthDate, p.lifeYears), -1);
}

export function ageYears(birth: DateKey, on: DateKey): number {
  const b = fromKey(birth);
  const d = fromKey(on);
  let age = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--;
  return age;
}

export interface LifeStats {
  total: number;
  lived: number;
  left: number;
  age: number;
  /** Доля прожитого, 0..1. */
  share: number;
}

export function lifeStats(p: Profile, today: DateKey): LifeStats {
  const total = diffDays(p.birthDate, lifeEnd(p)) + 1;
  const lived = Math.min(total, Math.max(0, diffDays(p.birthDate, today)));
  return { total, lived, left: total - lived, age: ageYears(p.birthDate, today), share: lived / total };
}

/** «14 903 дня» — с пробелами-разделителями и правильным окончанием. */
export function pluralDays(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  const word = abs > 10 && abs < 20 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней';
  return `${n.toLocaleString('ru-RU')} ${word}`;
}

export function pluralYears(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  const word = abs > 10 && abs < 20 ? 'лет' : last === 1 ? 'год' : last >= 2 && last <= 4 ? 'года' : 'лет';
  return `${n} ${word}`;
}
