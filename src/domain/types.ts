/** Дата дня в формате YYYY-MM-DD (локальная). */
export type DateKey = string;

export type Priority = 'high' | 'medium' | 'low';
export type Location = 'home' | 'out';

export type Timing =
  | { kind: 'duration'; minutes: number }
  /** start/end — минуты от полуночи. end <= start означает переход через полночь. */
  | { kind: 'interval'; start: number; end: number };

/** Скрытые затраты, привязанные к задаче. Лежат отдельными пластами сразу над ней. */
export type AttachmentKind = 'travel' | 'prep' | 'recovery';
export interface Attachment {
  kind: AttachmentKind;
  label: string;
  minutes: number;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export type RecurrenceRule =
  | { freq: 'daily' }
  | { freq: 'weekly'; weekdays: number[] } // 0 = Пн … 6 = Вс
  | { freq: 'everyN'; interval: number }
  | { freq: 'monthly' }; // по числу даты начала

/** Поля задачи, которые задаёт пользователь (общие для задачи и шаблона серии). */
export interface TaskFields {
  title: string;
  categoryId: string;
  timing: Timing;
  priority: Priority;
  location: Location;
  attachments: Attachment[];
  subtasks: Subtask[];
}

export interface Task extends TaskFields {
  id: string;
  date: DateKey;
  done: boolean;
  /** Порядок принятия в сосуд: определяет порядок пластов. */
  order: number;
  seriesId?: string;
}

export interface Series {
  id: string;
  template: TaskFields;
  rule: RecurrenceRule;
  start: DateKey;
  until?: DateKey;
  /** Даты, для которых экземпляр уже материализован в Task или удалён. */
  taken: DateKey[];
  order: number;
}

export interface RoutineItem {
  id: string;
  title: string;
  categoryId: string;
  minutes: number;
  weekdays: number[]; // 0 = Пн … 6 = Вс
}

export interface Category {
  id: string;
  name: string;
  color: string;
  defaultLocation: Location;
  /** Подготовка перед выходом (предлагается только для «вне дома»). */
  prepMinutes?: number;
  /** Восстановление после (душ после зала и т.п.). */
  recovery?: { label: string; minutes: number };
  /** Системная категория: не выбирается для задач вручную. */
  system?: boolean;
}

export interface Settings {
  /** Буфер-переключение между задачами, минут. 0 = выключено. */
  bufferMinutes: number;
}

export interface Profile {
  birthDate: DateKey;
  /** Ожидаемая продолжительность жизни, лет. */
  lifeYears: number;
}

export interface AppData {
  version: 1;
  tasks: Task[];
  series: Series[];
  routine: RoutineItem[];
  /** Переопределения рутины на конкретный день: itemId → минуты (0 = пропустить). */
  routineOverrides: Record<DateKey, Record<string, number>>;
  settings: Settings;
  /** Нет профиля — показываем онбординг. */
  profile?: Profile;
}
