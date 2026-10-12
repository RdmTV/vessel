import { weekday } from './dates';
import { uid } from './id';
import type { AppData, DateKey, Job, Parallel, Series, Task, Vacation } from './types';

export const MAIN_JOB_ID = 'main';
export const FREELANCE_JOB_ID = 'freelance';

export const DEFAULT_JOBS: Job[] = [
  {
    id: MAIN_JOB_ID, title: 'Основная работа', kind: 'fixed', color: '#E2A33C',
    minutes: 8 * 60, weekdays: [0, 1, 2, 3, 4], commuteMinutes: 60,
  },
  {
    id: FREELANCE_JOB_ID, title: 'Фриланс', kind: 'freelance', color: '#F07C3E',
    minutes: 0, weekdays: [], commuteMinutes: 0,
  },
];

export const jobsOf = (data: AppData): Job[] => data.jobs ?? [];
export const jobById = (data: AppData, id: string | undefined): Job | undefined =>
  id ? jobsOf(data).find((j) => j.id === id) : undefined;

export function onVacation(data: AppData, date: DateKey, jobId: string): Vacation | undefined {
  return (data.vacations ?? []).find((v) => (v.jobId === null || v.jobId === jobId) && v.start <= date && date <= v.end);
}

/** Длина блока работы в этот день: отпуск → 0, выходной/своё значение → оно, иначе по графику. */
export function blockMinutes(data: AppData, job: Job, date: DateKey): number {
  if (job.kind !== 'fixed') return 0;
  if (onVacation(data, date, job.id)) return 0;
  const override = data.jobOverrides?.[date]?.[job.id];
  if (override !== undefined) return override;
  return job.weekdays.includes(weekday(date)) ? job.minutes : 0;
}

/** Ключ оборота работы на день. */
export const jobParallelKey = (jobId: string, part: 'block' | 'travel') => (part === 'block' ? jobId : `${jobId}:travel`);

export function jobParallelOn(data: AppData, date: DateKey, job: Job, part: 'block' | 'travel'): Parallel | undefined {
  const day = data.jobParallel?.[date];
  const key = jobParallelKey(job.id, part);
  if (day && key in day) return day[key] ?? undefined;
  return part === 'block' ? job.parallel : job.commuteParallel;
}

/** «Выходной сегодня»: блок на этот день = 0; повторное нажатие возвращает график. */
export function setJobDayOff(data: AppData, date: DateKey, jobId: string, off: boolean): AppData {
  const day = { ...(data.jobOverrides?.[date] ?? {}) };
  if (off) day[jobId] = 0;
  else delete day[jobId];
  const jobOverrides = { ...(data.jobOverrides ?? {}) };
  if (Object.keys(day).length) jobOverrides[date] = day;
  else delete jobOverrides[date];
  return { ...data, jobOverrides };
}

export function addVacation(data: AppData, v: Omit<Vacation, 'id'>): AppData {
  return { ...data, vacations: [...(data.vacations ?? []), { ...v, id: uid() }] };
}

export function deleteVacation(data: AppData, id: string): AppData {
  return { ...data, vacations: (data.vacations ?? []).filter((v) => v.id !== id) };
}

export function updateJob(data: AppData, id: string, patch: Partial<Job>): AppData {
  return { ...data, jobs: jobsOf(data).map((j) => (j.id === id ? { ...j, ...patch } : j)) };
}

/**
 * Миграция: раньше работа и дорога на работу были пунктами рутины.
 * Переносим их в основную работу (с переопределениями и оборотами), задачи категории «Работа» —
 * внутрь блока, чтобы они его заполняли, а не ложились поверх.
 */
export function migrateData(data: AppData): AppData {
  if (data.jobs) return data;
  const work = data.routine.find((r) => r.id === 'work') ?? data.routine.find((r) => r.categoryId === 'work');
  const commute = data.routine.find((r) => r.id === 'commute') ?? data.routine.find((r) => r.categoryId === 'commute');
  const main: Job = {
    ...DEFAULT_JOBS[0],
    ...(work
      ? { title: work.title === 'Работа' ? DEFAULT_JOBS[0].title : work.title, minutes: work.minutes, weekdays: work.weekdays }
      : { weekdays: [] }),
    commuteMinutes: commute ? commute.minutes : 0,
    ...(work?.parallel ? { parallel: work.parallel } : {}),
    ...(commute?.parallel ? { commuteParallel: commute.parallel } : {}),
  };
  const movedIds = new Set([work?.id, commute?.id].filter((x): x is string => !!x));

  const routineOverrides: AppData['routineOverrides'] = {};
  const jobOverrides: NonNullable<AppData['jobOverrides']> = {};
  for (const [date, day] of Object.entries(data.routineOverrides)) {
    const rest: Record<string, number> = {};
    for (const [id, m] of Object.entries(day)) {
      if (work && id === work.id) jobOverrides[date] = { [main.id]: m };
      else if (!movedIds.has(id)) rest[id] = m;
    }
    if (Object.keys(rest).length) routineOverrides[date] = rest;
  }

  const routineParallel: NonNullable<AppData['routineParallel']> = {};
  const jobParallel: NonNullable<AppData['jobParallel']> = {};
  for (const [date, day] of Object.entries(data.routineParallel ?? {})) {
    const rest: Record<string, Parallel | null> = {};
    for (const [id, p] of Object.entries(day)) {
      if (work && id === work.id) jobParallel[date] = { ...(jobParallel[date] ?? {}), [jobParallelKey(main.id, 'block')]: p };
      else if (commute && id === commute.id) jobParallel[date] = { ...(jobParallel[date] ?? {}), [jobParallelKey(main.id, 'travel')]: p };
      else rest[id] = p;
    }
    if (Object.keys(rest).length) routineParallel[date] = rest;
  }

  const toMain = <T extends { categoryId: string; jobId?: string }>(t: T): T =>
    (t.categoryId === 'work' && !t.jobId ? { ...t, jobId: main.id } : t);

  return {
    ...data,
    jobs: [main, DEFAULT_JOBS[1]],
    routine: data.routine.filter((r) => !movedIds.has(r.id)),
    routineOverrides,
    routineParallel,
    jobOverrides,
    jobParallel,
    tasks: data.tasks.map((t) => toMain<Task>(t)),
    series: data.series.map((s): Series => ({ ...s, template: toMain(s.template) })),
  };
}
