import { category } from './categories';
import { minutesOnStartDay, type DayItem, type DayPlan, type DayTask } from './day';
import { addTask, deleteTask, patchTask, shortenFields, updateTask } from './mutations';
import type { AppData, AttachmentKind, DateKey, Parallel } from './types';
import { jobParallelKey } from './work';

/**
 * Обороты: второе дело внутри пласта первого (бег + подкаст).
 * Места в сосуде не занимает, засчитывается в свою категорию и цель — «время, прожитое дважды».
 */

/** Куда можно положить оборот: в задачу, в её дорогу/сборы/восстановление или в пункт рутины. */
export type ParallelTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'attachment'; taskId: string; attachment: AttachmentKind }
  | { kind: 'routine'; routineId: string; date: DateKey }
  /** Во время работы (незанятая часть блока) или в дороге на работу — на конкретный день. */
  | { kind: 'job'; jobId: string; part: 'block' | 'travel'; date: DateKey };

export function targetOf(item: DayItem, date: DateKey): ParallelTarget | null {
  if (item.kind === 'task' && item.taskId) return { kind: 'task', taskId: item.taskId };
  if ((item.kind === 'travel' || item.kind === 'prep' || item.kind === 'recovery') && item.taskId) {
    return { kind: 'attachment', taskId: item.taskId, attachment: item.kind };
  }
  if (item.kind === 'routine' && item.routineId) return { kind: 'routine', routineId: item.routineId, date };
  if (item.kind === 'job' && item.jobId) return { kind: 'job', jobId: item.jobId, part: 'block', date };
  if (item.kind === 'travel' && item.jobId) return { kind: 'job', jobId: item.jobId, part: 'travel', date };
  return null;
}

/** Поставить или убрать оборот (только на этот день — для рутины и экземпляров повтора). */
export function setParallel(data: AppData, target: ParallelTarget, p: Parallel | null): AppData {
  if (target.kind === 'task') {
    return patchTask(data, target.taskId, (t) => {
      const { parallel: _old, ...rest } = t;
      return p ? { ...rest, parallel: p } : rest;
    });
  }
  if (target.kind === 'attachment') {
    return patchTask(data, target.taskId, (t) => ({
      ...t,
      attachments: t.attachments.map((a) => {
        if (a.kind !== target.attachment) return a;
        const { parallel: _old, ...rest } = a;
        return p ? { ...rest, parallel: p } : rest;
      }),
    }));
  }
  if (target.kind === 'job') {
    const key = jobParallelKey(target.jobId, target.part);
    const day = { ...(data.jobParallel?.[target.date] ?? {}), [key]: p };
    return { ...data, jobParallel: { ...(data.jobParallel ?? {}), [target.date]: day } };
  }
  const day = { ...(data.routineParallel?.[target.date] ?? {}), [target.routineId]: p };
  return { ...data, routineParallel: { ...(data.routineParallel ?? {}), [target.date]: day } };
}

export function toggleParallelDone(data: AppData, target: ParallelTarget, current: Parallel): AppData {
  return setParallel(data, target, { ...current, done: !current.done });
}

/**
 * Слияние: задача становится оборотом другого пласта — её песок «впитывается», место освобождается.
 * Если задача длиннее пласта, остаток остаётся отдельной задачей.
 */
export function mergeInto(
  data: AppData, source: DayTask, target: ParallelTarget, targetMinutes: number,
): AppData {
  const own = minutesOnStartDay(source.timing);
  const minutes = Math.min(own, targetMinutes);
  const p: Parallel = {
    title: source.title,
    categoryId: source.categoryId,
    minutes,
    ...(source.done ? { done: true } : {}),
    ...(source.goalId ? { goalId: source.goalId } : {}),
  };
  let next = setParallel(data, target, p);
  next = own > minutes
    ? updateTask(next, source.id, shortenFields(source, own - minutes), undefined, 'this')
    : deleteTask(next, source.id, 'this');
  return next;
}

/** Разделить: оборот снова становится отдельной задачей этого дня и занимает своё место. */
export function splitParallel(data: AppData, target: ParallelTarget, p: Parallel, date: DateKey): AppData {
  const cat = category(p.categoryId);
  let next = setParallel(data, target, null);
  next = addTask(next, {
    title: p.title,
    categoryId: p.categoryId,
    timing: { kind: 'duration', minutes: p.minutes },
    priority: 'medium',
    location: cat.defaultLocation,
    attachments: [],
    subtasks: [],
    ...(p.goalId ? { goalId: p.goalId } : {}),
  }, date, null);
  if (p.done) {
    const created = next.tasks[next.tasks.length - 1];
    next = patchTask(next, created.id, (t) => ({ ...t, done: true }));
  }
  return next;
}

export interface MergeOption {
  target: ParallelTarget;
  label: string;
  minutes: number;
  categoryId: string;
}

/** Пласты дня, в которые можно слить задачу: без своего оборота и не сама задача. */
export function mergeOptions(plan: DayPlan, sourceTaskId: string): MergeOption[] {
  const out: MergeOption[] = [];
  for (const item of plan.items) {
    if (item.parallel || item.taskId === sourceTaskId) continue;
    const target = targetOf(item, plan.date);
    if (!target) continue;
    const owner = item.taskId ? plan.tasks.find((t) => t.id === item.taskId) : undefined;
    const label = target.kind === 'attachment' && owner ? `${item.title} (${owner.title})` : item.title;
    out.push({ target, label, minutes: item.minutes, categoryId: item.categoryId });
  }
  return out;
}

/** Можно ли слить задачу в чужой пласт: без своих скрытых затрат и без своего оборота. */
export function canMerge(t: DayTask): boolean {
  return !t.parallel && t.attachments.length === 0;
}

/** Минуты, «прожитые дважды», за день. */
export function twiceMinutes(plan: DayPlan): number {
  return plan.items.reduce((s, i) => s + (i.parallel?.minutes ?? 0), 0);
}
