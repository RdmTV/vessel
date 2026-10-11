import { diffDays, fromKey, weekday } from './dates';
import type { DateKey, RecurrenceRule, Series } from './types';

/** Подходит ли дата под правило серии (без учёта taken). */
export function matchesRule(s: Pick<Series, 'rule' | 'start' | 'until'>, date: DateKey): boolean {
  if (date < s.start) return false;
  if (s.until && date > s.until) return false;
  const r = s.rule;
  switch (r.freq) {
    case 'daily':
      return true;
    case 'weekly':
      return r.weekdays.includes(weekday(date));
    case 'everyN':
      return diffDays(s.start, date) % Math.max(1, r.interval) === 0;
    case 'monthly': {
      const startDay = fromKey(s.start).getDate();
      const d = fromKey(date);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(startDay, daysInMonth);
    }
  }
}

/** Нужно ли сгенерировать виртуальный экземпляр серии на эту дату. */
export function occursVirtually(s: Series, date: DateKey): boolean {
  return matchesRule(s, date) && !s.taken.includes(date);
}

export function describeRule(rule: RecurrenceRule): string {
  switch (rule.freq) {
    case 'daily':
      return 'каждый день';
    case 'weekly': {
      const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
      const wd = [...rule.weekdays].sort();
      if (wd.join() === '0,1,2,3,4') return 'по будням';
      if (wd.join() === '5,6') return 'по выходным';
      return wd.map((i) => names[i]).join(', ');
    }
    case 'everyN':
      return `каждые ${rule.interval} дн.`;
    case 'monthly':
      return 'раз в месяц';
  }
}
