import { addDays } from './dates';
import { parseVirtualId } from './day';
import { uid } from './id';
import type { AppData, DateKey, RecurrenceRule, Series, Task, TaskFields } from './types';

/**
 * Чистые операции над AppData. Каждая возвращает новый объект.
 * id задачи может быть виртуальным (`v:<seriesId>:<date>`) — тогда экземпляр сперва материализуется.
 */

export type EditScope = 'this' | 'following';

const cloneFields = (f: TaskFields): TaskFields => structuredClone(f);

function pickFields(t: TaskFields): TaskFields {
  const { title, categoryId, timing, priority, location, attachments, subtasks, goalId } = t;
  const fields: TaskFields = cloneFields({ title, categoryId, timing, priority, location, attachments, subtasks });
  if (goalId) fields.goalId = goalId;
  return fields;
}

export function addTask(
  data: AppData, fields: TaskFields, date: DateKey, rule: RecurrenceRule | null, order = Date.now(),
): AppData {
  if (rule) {
    const series: Series = {
      id: uid(), template: pickFields(fields), rule, start: date, taken: [], order,
    };
    return { ...data, series: [...data.series, series] };
  }
  const task: Task = { ...pickFields(fields), id: uid(), date, done: false, order };
  return { ...data, tasks: [...data.tasks, task] };
}

/** Превращает виртуальный экземпляр серии в реальную задачу. Возвращает данные и id задачи. */
export function materialize(data: AppData, id: string): { data: AppData; id: string } {
  if (data.tasks.some((t) => t.id === id)) return { data, id };
  const v = parseVirtualId(id);
  if (!v) return { data, id };
  const s = data.series.find((x) => x.id === v.seriesId);
  if (!s) return { data, id };
  const fields = cloneFields(s.template);
  fields.subtasks = fields.subtasks.map((st) => ({ ...st, done: false }));
  const task: Task = { ...fields, id, date: v.date, done: false, order: s.order, seriesId: s.id };
  return {
    id: task.id,
    data: {
      ...data,
      tasks: [...data.tasks, task],
      series: data.series.map((x) => (x.id === s.id ? { ...x, taken: [...x.taken, v.date] } : x)),
    },
  };
}

function mapTask(data: AppData, id: string, fn: (t: Task) => Task): AppData {
  const m = materialize(data, id);
  return { ...m.data, tasks: m.data.tasks.map((t) => (t.id === m.id ? fn(t) : t)) };
}

export const toggleDone = (data: AppData, id: string) =>
  mapTask(data, id, (t) => ({ ...t, done: !t.done }));

export const toggleSubtask = (data: AppData, id: string, subId: string) =>
  mapTask(data, id, (t) => ({
    ...t,
    subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
  }));

export function moveTask(data: AppData, id: string, to: DateKey): AppData {
  // Новый order — задача ляжет поверх пластов целевого дня.
  return mapTask(data, id, (t) => ({ ...t, date: to, order: Date.now() }));
}

const isVirtual = (data: AppData, id: string) =>
  !data.tasks.some((t) => t.id === id) && parseVirtualId(id) !== null;

function taskDate(data: AppData, id: string): DateKey | undefined {
  return data.tasks.find((t) => t.id === id)?.date ?? parseVirtualId(id)?.date;
}

function seriesOf(data: AppData, id: string): Series | undefined {
  const t = data.tasks.find((x) => x.id === id);
  const sid = t ? t.seriesId : parseVirtualId(id)?.seriesId;
  return data.series.find((s) => s.id === sid);
}

/** Сохраняет отметки подзадач при замене списка подзадач. */
function mergeSubtasks(next: TaskFields, prev: Task): TaskFields {
  const doneById = new Map(prev.subtasks.map((s) => [s.id, s.done]));
  return { ...next, subtasks: next.subtasks.map((s) => ({ ...s, done: doneById.get(s.id) ?? s.done })) };
}

/** Обрезает серию до дня перед `date` и удаляет её реальные экземпляры начиная с `date`. */
export function endSeriesFrom(data: AppData, seriesId: string, date: DateKey): AppData {
  const s = data.series.find((x) => x.id === seriesId);
  return s ? endSeriesBefore(data, s, date) : data;
}

function endSeriesBefore(data: AppData, s: Series, date: DateKey, keepTaskId?: string): AppData {
  const series = date <= s.start
    ? data.series.filter((x) => x.id !== s.id)
    : data.series.map((x) => (x.id === s.id
      ? { ...x, until: addDays(date, -1), taken: x.taken.filter((d) => d < date) }
      : x));
  const tasks = data.tasks.filter(
    (t) => t.id === keepTaskId || !(t.seriesId === s.id && t.date >= date),
  );
  return { ...data, series, tasks };
}

/**
 * Изменение задачи.
 * rule: undefined — повтор не трогаем; null — убрать повтор; правило — сделать/оставить повторяющейся.
 */
export function updateTask(
  data: AppData, id: string, fields: TaskFields, rule: RecurrenceRule | null | undefined, scope: EditScope,
): AppData {
  const s = seriesOf(data, id);
  const date = taskDate(data, id);
  if (!date) return data;

  // Одиночная задача.
  if (!s) {
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return data;
    if (rule) {
      const rest = { ...data, tasks: data.tasks.filter((t) => t.id !== id) };
      return addTask(rest, fields, date, rule, task.order);
    }
    return { ...data, tasks: data.tasks.map((t) => (t.id === id ? { ...t, ...mergeSubtasks(pickFields(fields), t) } : t)) };
  }

  // Только этот экземпляр серии.
  if (scope === 'this') {
    return mapTask(data, id, (t) => ({ ...t, ...mergeSubtasks(pickFields(fields), t) }));
  }

  // Этот и следующие.
  const m = materialize(data, id);
  let next = m.data;
  const newRule = rule === undefined ? s.rule : rule;

  if (!newRule) {
    // Повтор убран: серия заканчивается, текущий экземпляр остаётся одиночной задачей.
    next = endSeriesBefore(next, s, date, m.id);
    return {
      ...next,
      tasks: next.tasks.map((t) => (t.id === m.id
        ? { ...t, ...mergeSubtasks(pickFields(fields), t), seriesId: undefined }
        : t)),
    };
  }

  const template = pickFields(fields);
  template.subtasks = template.subtasks.map((st) => ({ ...st, done: false }));
  const taken = next.series.find((x) => x.id === s.id)?.taken ?? [];
  const fresh: Series = {
    id: uid(), template, rule: newRule, start: date,
    taken: taken.filter((d) => d >= date), order: s.order,
  };
  const keep = next.tasks.filter((t) => t.seriesId === s.id && t.date >= date);
  next = endSeriesBefore(next, s, date);
  return {
    ...next,
    series: [...next.series, fresh],
    // Уже материализованные будущие экземпляры получают новые поля и переезжают в новую серию.
    tasks: [
      ...next.tasks,
      ...keep.map((t) => ({ ...t, ...mergeSubtasks(pickFields(fields), t), seriesId: fresh.id })),
    ],
  };
}

export function deleteTask(data: AppData, id: string, scope: EditScope): AppData {
  const s = seriesOf(data, id);
  const date = taskDate(data, id);
  if (!date) return data;
  if (s && scope === 'following') return endSeriesBefore(data, s, date);
  const v = isVirtual(data, id) ? parseVirtualId(id) : null;
  if (v) {
    return {
      ...data,
      series: data.series.map((x) => (x.id === v.seriesId ? { ...x, taken: [...x.taken, v.date] } : x)),
    };
  }
  return { ...data, tasks: data.tasks.filter((t) => t.id !== id) };
}

/** Сократить задачу так, чтобы она занимала `minutes` на своём дне. */
export function shortenFields(fields: TaskFields, minutes: number): TaskFields {
  const m = Math.max(5, Math.floor(minutes / 5) * 5);
  if (fields.timing.kind === 'duration') return { ...fields, timing: { kind: 'duration', minutes: m } };
  return { ...fields, timing: { ...fields.timing, end: (fields.timing.start + m) % 1440 } };
}

export function setRoutineOverride(
  data: AppData, date: DateKey, itemId: string, minutes: number | null,
): AppData {
  const day = { ...(data.routineOverrides[date] ?? {}) };
  if (minutes === null) delete day[itemId];
  else day[itemId] = minutes;
  const routineOverrides = { ...data.routineOverrides };
  if (Object.keys(day).length) routineOverrides[date] = day;
  else delete routineOverrides[date];
  return { ...data, routineOverrides };
}

/** Ручные значения пункта рутины начиная с даты: [дата, минуты]. */
export function routineOverridesFrom(data: AppData, from: DateKey, itemId: string): [DateKey, number][] {
  return Object.entries(data.routineOverrides)
    .filter(([date, day]) => date >= from && itemId in day)
    .map(([date, day]) => [date, day[itemId]] as [DateKey, number])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Убрать ручные значения рутины начиная с даты (itemId = null — у всех пунктов). */
export function clearRoutineOverrides(data: AppData, from: DateKey, itemId: string | null = null): AppData {
  let next = data;
  for (const [date, day] of Object.entries(data.routineOverrides)) {
    if (date < from) continue;
    for (const id of Object.keys(day)) {
      if (itemId === null || id === itemId) next = setRoutineOverride(next, date, id, null);
    }
  }
  return next;
}

/** Значение «только на этот день» становится значением шаблона для всех дней. */
export function promoteRoutineOverride(data: AppData, date: DateKey, itemId: string): AppData {
  const minutes = data.routineOverrides[date]?.[itemId];
  if (minutes === undefined) return data;
  const withTemplate = {
    ...data,
    routine: data.routine.map((r) => (r.id === itemId ? { ...r, minutes } : r)),
  };
  return setRoutineOverride(withTemplate, date, itemId, null);
}
