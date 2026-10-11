import type { Category } from './types';

export const CATEGORIES: Category[] = [
  { id: 'sleep', name: 'Сон', color: '#6271F5', defaultLocation: 'home' },
  { id: 'work', name: 'Работа', color: '#E2A33C', defaultLocation: 'home' },
  { id: 'commute', name: 'Дорога', color: '#8C95A8', defaultLocation: 'home', system: true },
  {
    id: 'sport', name: 'Спорт', color: '#55C46A', defaultLocation: 'out',
    prepMinutes: 15, recovery: { label: 'Душ', minutes: 20 },
  },
  { id: 'chores', name: 'Быт', color: '#CD8466', defaultLocation: 'home' },
  { id: 'rest', name: 'Отдых', color: '#E06BAA', defaultLocation: 'home', prepMinutes: 15 },
  { id: 'study', name: 'Учёба', color: '#4DB2EA', defaultLocation: 'home' },
  { id: 'health', name: 'Здоровье', color: '#35C3BE', defaultLocation: 'out', prepMinutes: 10 },
  { id: 'hidden', name: 'Невидимое', color: '#77708F', defaultLocation: 'home', system: true },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function category(id: string): Category {
  return byId.get(id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** Категории, доступные для выбора у задачи. Дорогу можно выбрать явно (поездка как задача). */
export const PICKABLE_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'hidden');

/** Подготовка «вне дома» по умолчанию, если у категории не задано своё значение. */
export const DEFAULT_PREP_MINUTES = 10;

export const ATTACHMENT_CATEGORY = {
  travel: 'commute',
  prep: 'hidden',
  recovery: 'hidden',
} as const;
