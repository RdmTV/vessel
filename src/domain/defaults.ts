import type { AppData, RoutineItem } from './types';

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WORKDAYS = [0, 1, 2, 3, 4];

/** Средние значения: люди обычно занижают время на рутину. */
export const DEFAULT_ROUTINE: RoutineItem[] = [
  { id: 'sleep', title: 'Сон', categoryId: 'sleep', minutes: 8 * 60, weekdays: ALL },
  { id: 'food', title: 'Еда', categoryId: 'chores', minutes: 90, weekdays: ALL },
  { id: 'hygiene', title: 'Гигиена, сборы', categoryId: 'chores', minutes: 60, weekdays: ALL },
  { id: 'work', title: 'Работа', categoryId: 'work', minutes: 8 * 60, weekdays: WORKDAYS },
  { id: 'commute', title: 'Дорога на работу', categoryId: 'commute', minutes: 60, weekdays: WORKDAYS },
];

export function emptyData(): AppData {
  return {
    version: 1,
    tasks: [],
    series: [],
    routine: structuredClone(DEFAULT_ROUTINE),
    routineOverrides: {},
    settings: { bufferMinutes: 0 },
  };
}
