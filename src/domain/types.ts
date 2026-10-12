/** Дата дня в формате YYYY-MM-DD (локальная). */
export type DateKey = string;

export type Priority = 'high' | 'medium' | 'low';
export type Location = 'home' | 'out';

export type Timing =
  | { kind: 'duration'; minutes: number }
  /** start/end — минуты от полуночи. end <= start означает переход через полночь. */
  | { kind: 'interval'; start: number; end: number };

/**
 * «Оборот» — дело, которое делается одновременно с основным (бег + подкаст, дорога + аудиокнига).
 * Места в сосуде не занимает: живёт внутри пласта основного дела.
 */
export interface Parallel {
  title: string;
  categoryId: string;
  /** Не больше длительности основного дела. */
  minutes: number;
  done?: boolean;
  goalId?: string;
}

/** Скрытые затраты, привязанные к задаче. Лежат отдельными пластами сразу над ней. */
export type AttachmentKind = 'travel' | 'prep' | 'recovery';
export interface Attachment {
  kind: AttachmentKind;
  label: string;
  minutes: number;
  parallel?: Parallel;
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
  /** Привязка к долгосрочной цели (или проекту фриланса — это цель с jobId). */
  goalId?: string;
  parallel?: Parallel;
  /** Рабочая задача: у основной работы заполняет блок изнутри, у фриланса — ярус поверх. */
  jobId?: string;
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
  /** Оборот по шаблону (каждый раз, когда этот пункт рутины есть в дне). */
  parallel?: Parallel;
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
  /** Ежедневный чек-ин при первом открытии. По умолчанию включён. */
  checkinEnabled?: boolean;
}

/** Долгосрочная цель на отрезке жизни. */
export interface Goal {
  id: string;
  title: string;
  /** Категория пласта резерва в сосуде. */
  categoryId: string;
  /** Цвет полосы на сетках. */
  color: string;
  start: DateKey;
  end: DateKey;
  /** Серия-резерв «N минут в день» (если включён). */
  seriesId?: string;
  reserve?: { minutes: number; weekdays: number[] };
  /** Проект (заказ) фриланса: цель, привязанная к источнику работы, с оценкой часов. */
  jobId?: string;
  estimate?: number;
}

/**
 * Источник работы. Основная работа — блок по графику (контейнер: рабочие задачи заполняют его изнутри,
 * превышение — переработка). Фриланс — без графика, его задачи и проекты — ярус поверх, в «своё» время.
 */
export interface Job {
  id: string;
  title: string;
  kind: 'fixed' | 'freelance';
  color: string;
  /** Длина блока в рабочий день (fixed). */
  minutes: number;
  weekdays: number[];
  /** Дорога на работу — невидимое время работы, только в дни блока. */
  commuteMinutes: number;
  /** Обороты по шаблону: во время работы и в дороге. */
  parallel?: Parallel;
  commuteParallel?: Parallel;
}

/** Отпуск, больничный, праздники: блок работы и дорога в эти дни не появляются. */
export interface Vacation {
  id: string;
  /** null — все работы. */
  jobId: string | null;
  start: DateKey;
  end: DateKey;
  title: string;
}

export type GoalProgress = 'yes' | 'little' | 'no';

/** Чек-ин про конкретный день. */
export interface CheckIn {
  date: DateKey;
  rating: number; // 1..5
  note?: string;
  goals: Record<string, GoalProgress>;
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
  /** Оборот пункта рутины на конкретный день: itemId → оборот (null — на этот день без оборота). */
  routineParallel?: Record<DateKey, Record<string, Parallel | null>>;
  settings: Settings;
  /** Нет профиля — показываем онбординг. */
  profile?: Profile;
  goals?: Goal[];
  checkins?: Record<DateKey, CheckIn>;
  /** День, когда последний раз предлагали чек-ин (чтобы «Пропустить» не спрашивал снова). */
  lastCheckinPrompt?: DateKey;
  jobs?: Job[];
  /** Блок работы на конкретный день: jobId → минуты (0 — выходной). */
  jobOverrides?: Record<DateKey, Record<string, number>>;
  /** Обороты работы на день: `${jobId}` — во время работы, `${jobId}:travel` — в дороге. null — без оборота. */
  jobParallel?: Record<DateKey, Record<string, Parallel | null>>;
  vacations?: Vacation[];
}
