import { describe, expect, it } from 'vitest';
import { computeDay, dayLoad, nearestFitDays, tasksForDate } from './day';
import { emptyData } from './defaults';
import { pendingCheckIn, saveCheckIn, skipCheckIn } from './checkin';
import {
  addGoal, deleteGoal, goalStats, goalStreak, projectPace, reserveCoveredBy, updateGoal, type GoalInput,
} from './goals';
import {
  addVacation, DEFAULT_JOBS, FREELANCE_JOB_ID, MAIN_JOB_ID, migrateData, setJobDayOff,
} from './work';
import { mergeInto, mergeOptions, setParallel, splitParallel, twiceMinutes } from './parallel';
import { ageYears, lifeEnd, lifeStats, pluralDays } from './life';
import { periodRange, periodStats } from './stats';
import { aggregateWeek, weekDays, weekStart } from './week';
import {
  addTask, clearRoutineOverrides, deleteTask, moveTask, promoteRoutineOverride, routineOverridesFrom,
  setRoutineOverride, toggleDone, updateTask,
} from './mutations';
import type { AppData, TaskFields } from './types';

// 2026-10-12 — понедельник, 2026-10-17 — суббота.
const MON = '2026-10-12';
const SAT = '2026-10-17';

const fields = (over: Partial<TaskFields> = {}): TaskFields => ({
  title: 'Зал', categoryId: 'sport', timing: { kind: 'duration', minutes: 120 },
  priority: 'medium', location: 'home', attachments: [], subtasks: [], ...over,
});

/** День без рутины и без работы — только то, что добавит тест. */
const bare = (): AppData => ({ ...emptyData(), routine: [], jobs: [] });

describe('computeDay', () => {
  it('учитывает рутину по дням недели', () => {
    const d = emptyData();
    expect(computeDay(d, MON).total).toBe(8 * 60 + 90 + 60 + 8 * 60 + 60);
    expect(computeDay(d, SAT).total).toBe(8 * 60 + 90 + 60);
  });

  it('делит интервал через полночь между днями', () => {
    const d = addTask(bare(), fields({ timing: { kind: 'interval', start: 22 * 60, end: 60 } }), MON, null);
    expect(computeDay(d, MON).total).toBe(120);
    expect(computeDay(d, '2026-10-13').total).toBe(60);
  });

  it('добавляет скрытые затраты и буфер', () => {
    let d = addTask(bare(), fields({
      attachments: [{ kind: 'travel', label: 'Дорога', minutes: 30 }, { kind: 'recovery', label: 'Душ', minutes: 20 }],
    }), MON, null);
    expect(computeDay(d, MON).total).toBe(170);
    d = { ...d, settings: { bufferMinutes: 10 } };
    expect(computeDay(d, MON).total).toBe(180);
  });
});

describe('серии', () => {
  it('генерирует виртуальные экземпляры и материализует при отметке', () => {
    let d = addTask(bare(), fields(), MON, { freq: 'daily' });
    const [v] = tasksForDate(d, '2026-10-14');
    expect(v.virtual).toBe(true);
    d = toggleDone(d, v.id);
    const [real] = tasksForDate(d, '2026-10-14');
    expect(real.virtual).toBeUndefined();
    expect(real.done).toBe(true);
    expect(tasksForDate(d, '2026-10-15')[0].virtual).toBe(true);
  });

  it('материализованный экземпляр сохраняет id (пласт не перезаливается)', () => {
    let d = addTask(bare(), fields(), MON, { freq: 'daily' });
    const id = tasksForDate(d, MON)[0].id;
    d = toggleDone(d, id);
    expect(tasksForDate(d, MON)[0].id).toBe(id);
    d = toggleDone(d, id);
    expect(tasksForDate(d, MON)[0].done).toBe(false);
  });

  it('удаляет только один экземпляр', () => {
    let d = addTask(bare(), fields(), MON, { freq: 'daily' });
    d = deleteTask(d, tasksForDate(d, '2026-10-14')[0].id, 'this');
    expect(tasksForDate(d, '2026-10-14')).toHaveLength(0);
    expect(tasksForDate(d, '2026-10-15')).toHaveLength(1);
  });

  it('«этот и следующие» разрезает серию', () => {
    let d = addTask(bare(), fields(), MON, { freq: 'daily' });
    const id = tasksForDate(d, '2026-10-14')[0].id;
    d = updateTask(d, id, fields({ title: 'Бассейн' }), undefined, 'following');
    expect(tasksForDate(d, '2026-10-13')[0].title).toBe('Зал');
    expect(tasksForDate(d, '2026-10-14')[0].title).toBe('Бассейн');
    expect(tasksForDate(d, '2026-10-20')[0].title).toBe('Бассейн');
    expect(tasksForDate(d, '2026-10-20')).toHaveLength(1);
  });

  it('по будням не появляется в субботу', () => {
    const d = addTask(bare(), fields(), MON, { freq: 'weekly', weekdays: [0, 1, 2, 3, 4] });
    expect(tasksForDate(d, SAT)).toHaveLength(0);
    expect(tasksForDate(d, '2026-10-16')).toHaveLength(1);
  });

  it('перенос экземпляра не порождает дубль на старой дате', () => {
    let d = addTask(bare(), fields(), MON, { freq: 'daily' });
    d = moveTask(d, tasksForDate(d, '2026-10-14')[0].id, '2026-10-15');
    expect(tasksForDate(d, '2026-10-14')).toHaveLength(0);
    expect(tasksForDate(d, '2026-10-15')).toHaveLength(2);
  });
});

describe('жизнь', () => {
  const p = { birthDate: '1990-03-15', lifeYears: 80 };

  it('считает конец жизни и возраст', () => {
    expect(lifeEnd(p)).toBe('2070-03-14');
    expect(ageYears(p.birthDate, '2026-03-14')).toBe(35);
    expect(ageYears(p.birthDate, '2026-03-15')).toBe(36);
  });

  it('прожито + осталось = всего', () => {
    const s = lifeStats(p, MON);
    expect(s.lived + s.left).toBe(s.total);
    expect(s.total).toBe(29220); // 80 лет с 20 високосными
  });

  it('склоняет дни', () => {
    expect(pluralDays(1)).toMatch(/1 день/);
    expect(pluralDays(3)).toMatch(/3 дня/);
    expect(pluralDays(11)).toMatch(/11 дней/);
    expect(pluralDays(22)).toMatch(/22 дня/);
  });
});

describe('неделя', () => {
  it('начинается с понедельника', () => {
    expect(weekStart('2026-10-15')).toBe(MON);
    expect(weekStart('2026-10-18')).toBe(MON);
    expect(weekStart(MON)).toBe(MON);
  });

  it('группирует по категориям и сохраняет сумму', () => {
    let d = emptyData();
    d = addTask(d, fields(), MON, null);
    d = addTask(d, fields({ title: 'Бассейн' }), '2026-10-14', null);
    d = toggleDone(d, tasksForDate(d, MON)[0].id);
    const w = aggregateWeek(d, MON);
    const daysTotal = weekDays(MON).reduce((s, day) => s + computeDay(d, day).total, 0);
    expect(w.total).toBe(daysTotal);
    expect(w.groups.find((g) => g.key === 'wd:sport')?.minutes).toBe(120);
    expect(w.groups.find((g) => g.key === 'wp:sport')?.minutes).toBe(120);
    expect(w.groups[0].kind).toBe('routine');
  });
});

describe('dayLoad', () => {
  it('отделяет рутину от запланированного', () => {
    const d = addTask(emptyData(), fields(), SAT, null);
    const l = dayLoad(d, SAT);
    expect(l.routine).toBe(8 * 60 + 90 + 60);
    expect(l.planned).toBe(120);
    expect(l.hasPlan).toBe(true);
  });
});

describe('ручные значения рутины', () => {
  it('перекрывают шаблон только на свой день', () => {
    let d = setRoutineOverride(emptyData(), MON, 'sleep', 450);
    d = { ...d, routine: d.routine.map((r) => (r.id === 'sleep' ? { ...r, minutes: 390 } : r)) };
    expect(computeDay(d, MON).items.find((i) => i.key === 'r:sleep')?.minutes).toBe(450);
    expect(computeDay(d, '2026-10-13').items.find((i) => i.key === 'r:sleep')?.minutes).toBe(390);
  });

  it('сброс с даты и перенос в шаблон', () => {
    let d = setRoutineOverride(emptyData(), '2026-10-10', 'sleep', 300);
    d = setRoutineOverride(d, MON, 'sleep', 450);
    d = setRoutineOverride(d, MON, 'food', 60);
    expect(routineOverridesFrom(d, MON, 'sleep')).toEqual([[MON, 450]]);
    const cleared = clearRoutineOverrides(d, MON, 'sleep');
    expect(cleared.routineOverrides[MON]).toEqual({ food: 60 });
    expect(cleared.routineOverrides['2026-10-10']).toEqual({ sleep: 300 });
    const promoted = promoteRoutineOverride(d, MON, 'sleep');
    expect(promoted.routine.find((r) => r.id === 'sleep')?.minutes).toBe(450);
    expect(promoted.routineOverrides[MON]).toEqual({ food: 60 });
  });
});

describe('цели', () => {
  const input = (over: Partial<GoalInput> = {}): GoalInput => ({
    title: 'Английский', categoryId: 'study', color: '#4FD1E8',
    start: '2026-10-01', end: '2026-12-31', reserve: { minutes: 30, weekdays: [0, 1, 2, 3, 4, 5, 6] }, ...over,
  });

  it('резерв кладёт пласт цели в каждый день — с сегодняшнего, не задним числом', () => {
    const d = addGoal(bare(), input(), MON);
    const goal = d.goals![0];
    expect(tasksForDate(d, MON).map((t) => t.goalId)).toEqual([goal.id]);
    expect(tasksForDate(d, '2026-10-05')).toHaveLength(0); // до сегодня — нет
    expect(tasksForDate(d, '2027-01-01')).toHaveLength(0); // после конца цели — нет
    expect(computeDay(d, '2026-10-20').total).toBe(30);
  });

  it('считает часы цели и серию чек-инов', () => {
    let d = addGoal(bare(), input(), MON);
    const goal = d.goals![0];
    d = toggleDone(d, tasksForDate(d, MON)[0].id);
    const s = goalStats(d, goal, MON, '2026-10-18');
    expect(s).toEqual({ planned: 7 * 30, done: 30 });
    d = saveCheckIn(d, { date: '2026-10-11', rating: 4, goals: { [goal.id]: 'yes' } }, MON);
    d = saveCheckIn(d, { date: '2026-10-10', rating: 3, goals: { [goal.id]: 'little' } }, MON);
    d = saveCheckIn(d, { date: '2026-10-09', rating: 2, goals: { [goal.id]: 'no' } }, MON);
    expect(goalStreak(d, goal.id, '2026-10-11')).toBe(2);
  });

  it('удаление цели заканчивает резерв и снимает привязку', () => {
    let d = addGoal(bare(), input(), MON);
    d = toggleDone(d, tasksForDate(d, MON)[0].id);
    d = deleteGoal(d, d.goals![0].id, '2026-10-13');
    expect(d.goals).toHaveLength(0);
    expect(tasksForDate(d, '2026-10-14')).toHaveLength(0);
    expect(tasksForDate(d, MON)[0].goalId).toBeUndefined();
  });

  it('изменение резерва не трогает прошлое', () => {
    let d = addGoal(bare(), input(), MON);
    d = toggleDone(d, tasksForDate(d, MON)[0].id);
    d = updateGoal(d, d.goals![0].id, input({ reserve: { minutes: 60, weekdays: [0, 1, 2, 3, 4, 5, 6] } }), '2026-10-13');
    expect(computeDay(d, MON).total).toBe(30);
    expect(computeDay(d, '2026-10-14').total).toBe(60);
  });
});

describe('чек-ин', () => {
  it('спрашивает про вчера и собирает невыполненное', () => {
    let d = addTask(bare(), fields(), '2026-10-11', null);
    d = addTask(d, fields({ title: 'Сделано' }), '2026-10-11', null);
    d = toggleDone(d, tasksForDate(d, '2026-10-11').find((t) => t.title === 'Сделано')!.id);
    const p = pendingCheckIn(d, MON)!;
    expect(p.date).toBe('2026-10-11');
    expect(p.undone.map((t) => t.title)).toEqual(['Зал']);
  });

  it('не спрашивает повторно после пропуска и если вчера пусто', () => {
    const d = addTask(bare(), fields(), '2026-10-11', null);
    expect(pendingCheckIn(skipCheckIn(d, MON), MON)).toBeNull();
    expect(pendingCheckIn(bare(), MON)).toBeNull();
    expect(pendingCheckIn({ ...d, settings: { ...d.settings, checkinEnabled: false } }, MON)).toBeNull();
  });
});

describe('итоги', () => {
  it('делит дни по загрузке', () => {
    let d = emptyData();
    d = addTask(d, fields({ timing: { kind: 'duration', minutes: 4 * 60 } }), MON, null); // свободно 30м
    d = addTask(d, fields({ timing: { kind: 'duration', minutes: 6 * 60 } }), '2026-10-13', null); // переполнен
    const s = periodStats(d, ...periodRange(MON, 'week'));
    expect(s.days.find((x) => x.date === MON)?.cls).toBe('tight');
    expect(s.days.find((x) => x.date === '2026-10-13')?.cls).toBe('over');
    expect(s.days.find((x) => x.date === SAT)?.cls).toBe('free'); // выходной: свободно 13ч 30м
    expect(s.classes.tight + s.classes.over + s.classes.free + s.classes.normal).toBe(7);
    expect(s.tasks).toEqual({ count: 2, doneCount: 0, minutes: 600, doneMinutes: 0 });
  });

  it('границы месяца', () => {
    expect(periodRange('2026-02-14', 'month')).toEqual(['2026-02-01', '2026-02-28']);
  });
});

describe('обороты', () => {
  const podcast = (over: Partial<TaskFields> = {}) =>
    fields({ title: 'Подкаст', categoryId: 'study', timing: { kind: 'duration', minutes: 40 }, ...over });

  it('слияние освобождает место, разделение возвращает', () => {
    let d = addTask(bare(), fields({ title: 'Бег', timing: { kind: 'duration', minutes: 60 } }), MON, null);
    d = addTask(d, podcast(), MON, null);
    expect(computeDay(d, MON).total).toBe(100);
    const plan = computeDay(d, MON);
    const source = plan.tasks.find((t) => t.title === 'Подкаст')!;
    const target = mergeOptions(plan, source.id)[0];
    d = mergeInto(d, source, target.target, target.minutes);
    const merged = computeDay(d, MON);
    expect(merged.total).toBe(60); // подкаст впитался
    expect(merged.items[0].parallel).toMatchObject({ title: 'Подкаст', minutes: 40 });
    expect(twiceMinutes(merged)).toBe(40);
    d = splitParallel(d, target.target, merged.items[0].parallel!, MON);
    expect(computeDay(d, MON).total).toBe(100);
    expect(computeDay(d, MON).items[0].parallel).toBeUndefined();
  });

  it('длинный источник: остаток остаётся отдельной задачей', () => {
    let d = addTask(bare(), fields({ title: 'Бег', timing: { kind: 'duration', minutes: 30 } }), MON, null);
    d = addTask(d, podcast(), MON, null);
    const plan = computeDay(d, MON);
    const source = plan.tasks.find((t) => t.title === 'Подкаст')!;
    const opt = mergeOptions(plan, source.id)[0];
    d = mergeInto(d, source, opt.target, opt.minutes);
    const after = computeDay(d, MON);
    expect(after.items[0].parallel?.minutes).toBe(30);
    expect(after.tasks.find((t) => t.title === 'Подкаст')?.timing).toEqual({ kind: 'duration', minutes: 10 });
  });

  it('оборот рутины: шаблон и переопределение на день', () => {
    let d = emptyData();
    d = { ...d, routine: d.routine.map((r) => (r.id === 'food' ? { ...r, parallel: { title: 'Сериал', categoryId: 'rest', minutes: 60 } } : r)) };
    const food = (day: string) => computeDay(d, day).items.find((i) => i.key === 'r:food');
    expect(food(MON)?.parallel?.title).toBe('Сериал');
    d = setParallel(d, { kind: 'routine', routineId: 'food', date: MON }, null);
    expect(food(MON)?.parallel).toBeUndefined();
    expect(food('2026-10-13')?.parallel?.title).toBe('Сериал');
  });

  it('оборот в дороге на работу', () => {
    let d = emptyData();
    d = setParallel(d, { kind: 'job', jobId: MAIN_JOB_ID, part: 'travel', date: MON }, { title: 'Подкаст', categoryId: 'study', minutes: 60 });
    const travel = computeDay(d, MON).items.find((i) => i.key === `j:${MAIN_JOB_ID}:travel`);
    expect(travel?.parallel?.title).toBe('Подкаст');
    expect(computeDay(d, '2026-10-13').items.find((i) => i.key === `j:${MAIN_JOB_ID}:travel`)?.parallel).toBeUndefined();
  });

  it('засчитывается в цель и «прожито дважды»', () => {
    let d = addGoal(bare(), {
      title: 'Английский', categoryId: 'study', color: '#4FD1E8', start: MON, end: '2026-10-31', reserve: null,
    }, MON);
    const goalId = d.goals![0].id;
    d = addTask(d, fields({ title: 'Бег', timing: { kind: 'duration', minutes: 60 } }), MON, null);
    const t = tasksForDate(d, MON)[0];
    d = setParallel(d, { kind: 'task', taskId: t.id }, { title: 'Подкаст EN', categoryId: 'study', minutes: 45, goalId, done: true });
    expect(goalStats(d, d.goals![0])).toEqual({ planned: 45, done: 45 });
    expect(reserveCoveredBy(d, MON, goalId)).toBe('Бег');
    const s = periodStats(d, MON, MON);
    expect(s.twiceTotal).toBe(45);
    expect(s.byCategory.find((c) => c.categoryId === 'study')?.parallel).toBe(45);
  });

  it('новый экземпляр повтора — оборот не отмечен', () => {
    let d = addTask(bare(), fields({ parallel: { title: 'Подкаст', categoryId: 'study', minutes: 30, done: true } }), MON, { freq: 'daily' });
    const next = tasksForDate(d, '2026-10-13')[0];
    d = toggleDone(d, next.id);
    expect(tasksForDate(d, '2026-10-13')[0].parallel?.done).toBe(false);
  });
});

describe('работа', () => {
  const workTask = (minutes: number, title = 'Отчёт') =>
    fields({ title, categoryId: 'work', timing: { kind: 'duration', minutes }, jobId: MAIN_JOB_ID });
  const onlyWork = (): AppData => ({ ...emptyData(), routine: [] });

  it('рабочие задачи заполняют блок изнутри', () => {
    let d = onlyWork();
    expect(computeDay(d, MON).total).toBe(8 * 60 + 60); // блок + дорога
    d = addTask(d, workTask(120), MON, null);
    const plan = computeDay(d, MON);
    expect(plan.total).toBe(8 * 60 + 60); // объём тот же
    expect(plan.items.find((i) => i.kind === 'job')?.minutes).toBe(6 * 60);
    expect(plan.jobs[0]).toMatchObject({ block: 480, used: 120, overtime: 0 });
  });

  it('превышение блока — переработка', () => {
    const d = addTask(addTask(onlyWork(), workTask(300), MON, null), workTask(240, 'Релиз'), MON, null);
    const plan = computeDay(d, MON);
    expect(plan.overtime).toBe(60);
    expect(plan.items.find((i) => i.kind === 'job')).toBeUndefined();
    expect(plan.total).toBe(540 + 60);
  });

  it('выходной и отпуск убирают блок и дорогу', () => {
    let d = setJobDayOff(onlyWork(), MON, MAIN_JOB_ID, true);
    expect(computeDay(d, MON).total).toBe(0);
    d = setJobDayOff(d, MON, MAIN_JOB_ID, false);
    expect(computeDay(d, MON).total).toBe(540);
    d = addVacation(d, { jobId: null, start: '2026-10-13', end: '2026-10-15', title: 'Отпуск' });
    expect(computeDay(d, '2026-10-14').total).toBe(0);
    expect(computeDay(d, '2026-10-16').total).toBe(540);
  });

  it('фриланс — ярус поверх, цветом работы', () => {
    const d = addTask(onlyWork(), fields({ title: 'Лендинг', categoryId: 'work', jobId: FREELANCE_JOB_ID }), MON, null);
    const plan = computeDay(d, MON);
    expect(plan.total).toBe(540 + 120);
    expect(plan.items.find((i) => i.title === 'Лендинг')?.color).toBe(DEFAULT_JOBS[1].color);
  });

  it('проект: темп до дедлайна', () => {
    let d = addGoal(onlyWork(), {
      title: 'Лендинг', categoryId: 'work', color: '#F07C3E', start: MON, end: '2026-10-21',
      reserve: null, jobId: FREELANCE_JOB_ID, estimate: 12 * 60,
    }, MON);
    const g = d.goals![0];
    d = addTask(d, fields({ title: 'Макет', categoryId: 'work', goalId: g.id, timing: { kind: 'duration', minutes: 120 } }), MON, null);
    d = toggleDone(d, tasksForDate(d, MON)[0].id);
    expect(projectPace(d, g, '2026-10-13')).toEqual({ done: 120, left: 600, daysLeft: 9, perDay: 70 });
    expect(computeDay(d, MON).items.find((i) => i.title === 'Макет')?.jobId).toBe(FREELANCE_JOB_ID);
  });

  it('миграция: работа и дорога из рутины в основную работу', () => {
    const old: AppData = {
      version: 1,
      tasks: [],
      series: [],
      routine: [
        { id: 'sleep', title: 'Сон', categoryId: 'sleep', minutes: 390, weekdays: [0, 1, 2, 3, 4, 5, 6] },
        { id: 'work', title: 'Работа', categoryId: 'work', minutes: 480, weekdays: [0, 1, 2, 3, 4] },
        { id: 'commute', title: 'Дорога на работу', categoryId: 'commute', minutes: 60, weekdays: [0, 1, 2, 3, 4], parallel: { title: 'Подкаст', categoryId: 'study', minutes: 30 } },
      ],
      routineOverrides: { [MON]: { work: 360, sleep: 420 } },
      settings: { bufferMinutes: 0 },
    };
    const withTask = addTask(old, fields({ title: 'Созвон', categoryId: 'work', timing: { kind: 'duration', minutes: 60 } }), MON, null);
    const before = computeDay(withTask, '2026-10-13').total;
    const m = migrateData(withTask);
    expect(m.routine.map((r) => r.id)).toEqual(['sleep']);
    expect(m.jobs![0]).toMatchObject({ id: MAIN_JOB_ID, minutes: 480, commuteMinutes: 60, commuteParallel: { title: 'Подкаст' } });
    expect(m.jobOverrides).toEqual({ [MON]: { [MAIN_JOB_ID]: 360 } });
    expect(m.routineOverrides).toEqual({ [MON]: { sleep: 420 } });
    expect(m.tasks[0].jobId).toBe(MAIN_JOB_ID);
    expect(computeDay(m, '2026-10-13').total).toBe(before); // обычный день не изменился
    // раньше созвон ложился поверх 6ч работы, теперь он внутри блока
    expect(computeDay(withTask, MON).total).toBe(420 + 360 + 60 + 60);
    expect(computeDay(m, MON).total).toBe(420 + 360 + 60);
    expect(migrateData(m)).toBe(m); // повторно не мигрирует
  });
});

describe('nearestFitDays', () => {
  it('пропускает дни, куда задача не влезает', () => {
    let d = bare();
    d = addTask(d, fields({ timing: { kind: 'duration', minutes: 1400 } }), '2026-10-13', null);
    const fit = nearestFitDays(d, fields(), MON, 2);
    expect(fit.map((f) => f.date)).toEqual(['2026-10-14', '2026-10-15']);
  });
});
