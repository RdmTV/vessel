import { useState } from 'react';
import { addDays, addMonths, diffDays, formatDayShort, formatMinutes, todayKey } from '../domain/dates';
import { type DayPlan, type DayTask, type JobDay } from '../domain/day';
import { addGoal, deleteGoal, goalsOf, isProject, projectPace, updateGoal } from '../domain/goals';
import type { DateKey, Goal, Job } from '../domain/types';
import {
  addVacation, deleteVacation, jobsOf, onVacation, setJobDayOff, updateJob,
} from '../domain/work';
import { useStore } from '../store';
import { DurationPicker, Modal, WeekdayPicker } from './common';
import { ParallelSlot } from './Parallel';
import { TaskCard } from './TaskList';

/**
 * Работа в дне. Основная — контейнер: шкала заполнения блока задачами, переработка, выходной,
 * обороты во время работы и в дороге. Фриланс — проекты с темпом до дедлайна и их задачи.
 */
export function WorkGroup({ plan, date, onEdit, onOpenWork }: {
  plan: DayPlan; date: DateKey; onEdit: (t: DayTask) => void; onOpenWork: () => void;
}) {
  const data = useStore((s) => s.data);
  const [projectModal, setProjectModal] = useState<Goal | 'new' | null>(null);
  const jobs = jobsOf(data);
  if (!jobs.length) return null;

  const allProjects = new Set(goalsOf(data).filter(isProject).map((g) => g.id));
  const projects = goalsOf(data).filter((g) => isProject(g) && g.start <= date && date <= g.end);

  return (
    <div className="group group-work">
      <div className="group-head">
        <span>Работа</span>
        <button type="button" className="link" onClick={onOpenWork}>график и отпуска</button>
      </div>
      {jobs.map((job) => (job.kind === 'fixed'
        ? <FixedJob key={job.id} job={job} jd={plan.jobs.find((j) => j.job.id === job.id)} plan={plan} date={date} onEdit={onEdit} />
        : (
          <FreelanceJob
            key={job.id}
            job={job}
            projects={projects}
            tasks={plan.tasks.filter((t) => t.jobId === job.id || (!!t.goalId && allProjects.has(t.goalId)))}
            plan={plan}
            date={date}
            onEdit={onEdit}
            onProject={setProjectModal}
          />
        )))}
      {projectModal && <ProjectModal project={projectModal === 'new' ? null : projectModal} onClose={() => setProjectModal(null)} />}
    </div>
  );
}

function FixedJob({ job, jd, plan, date, onEdit }: {
  job: Job; jd?: JobDay; plan: DayPlan; date: DateKey; onEdit: (t: DayTask) => void;
}) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const presetComposer = useStore((s) => s.presetComposer);
  const off = data.jobOverrides?.[date]?.[job.id] === 0;
  const vacation = onVacation(data, date, job.id);
  const addTask = () => presetComposer({ jobId: job.id, categoryId: 'work' });

  if (!jd) {
    return (
      <div className="job-block job-off">
        <div className="job-head">
          <i style={{ background: job.color }} />
          <span className="job-title">{job.title}</span>
          <span className="muted small">{vacation ? `отпуск — ${vacation.title}` : off ? 'выходной' : 'не по графику'}</span>
        </div>
        <div className="task-actions">
          {off && <button type="button" className="chip" onClick={() => apply((d) => setJobDayOff(d, date, job.id, false))}>Вернуть рабочий день</button>}
          <button type="button" className="chip" onClick={addTask}>+ задача (будет переработкой)</button>
        </div>
      </div>
    );
  }

  const tasks = plan.tasks.filter((t) => t.jobId === job.id);
  const filler = plan.items.find((i) => i.key === `j:${job.id}`);
  const commute = plan.items.find((i) => i.key === `j:${job.id}:travel`);
  const cap = Math.max(jd.block, jd.used, 1);
  return (
    <div className="job-block">
      <div className="job-head">
        <i style={{ background: job.color }} />
        <span className="job-title">{job.title}</span>
        <span className="muted small">{formatMinutes(jd.block)}</span>
      </div>
      <div className="job-bar" title="Сколько блока работы распределено по задачам">
        <i className="job-bar-used" style={{ width: `${(Math.min(jd.used, jd.block) / cap) * 100}%`, background: job.color }} />
        {jd.overtime > 0 && <i className="job-bar-over" style={{ width: `${(jd.overtime / cap) * 100}%` }} />}
      </div>
      <div className="job-status small">
        {jd.block === 0
          ? <span className="warn-text">Не рабочий день — всё это переработка: {formatMinutes(jd.overtime)}</span>
          : jd.overtime > 0
            ? <span className="warn-text">Переработка {formatMinutes(jd.overtime)} — она съела время «своего»</span>
            : <span className="muted">Распределено {formatMinutes(jd.used)} · свободно в блоке {formatMinutes(jd.block - jd.used)}</span>}
      </div>
      <div className="task-actions">
        <button type="button" className="chip" onClick={addTask}>+ задача в работу</button>
        {jd.block > 0 && !vacation && (
          <button type="button" className="chip" onClick={() => apply((d) => setJobDayOff(d, date, job.id, true))}>Выходной</button>
        )}
        {off && (
          <button type="button" className="chip" onClick={() => apply((d) => setJobDayOff(d, date, job.id, false))}>Вернуть рабочий день</button>
        )}
      </div>
      {filler && (
        <ParallelSlot
          label="Во время работы"
          target={{ kind: 'job', jobId: job.id, part: 'block', date }}
          parallel={filler.parallel}
          maxMinutes={filler.minutes}
          date={date}
          allowDone={false}
        />
      )}
      {commute && (
        <ParallelSlot
          label={`Дорога на работу · ${formatMinutes(commute.minutes)}`}
          target={{ kind: 'job', jobId: job.id, part: 'travel', date }}
          parallel={commute.parallel}
          maxMinutes={commute.minutes}
          date={date}
          allowDone={false}
        />
      )}
      {tasks.map((t) => <TaskCard key={t.id} task={t} plan={plan} date={date} onEdit={onEdit} />)}
    </div>
  );
}

function FreelanceJob({ job, projects, tasks, plan, date, onEdit, onProject }: {
  job: Job; projects: Goal[]; tasks: DayTask[]; plan: DayPlan; date: DateKey;
  onEdit: (t: DayTask) => void; onProject: (p: Goal | 'new') => void;
}) {
  const data = useStore((s) => s.data);
  const presetComposer = useStore((s) => s.presetComposer);
  const today = todayKey();
  return (
    <div className="job-block job-freelance">
      <div className="job-head">
        <i style={{ background: job.color }} />
        <span className="job-title">{job.title}</span>
        <button type="button" className="link" onClick={() => onProject('new')}>+ проект</button>
      </div>
      {projects.map((p) => {
        const pace = projectPace(data, p, today > date ? today : date);
        const daysToDeadline = diffDays(today, p.end);
        return (
          <div key={p.id} className="project-row">
            <button type="button" className="project-main" onClick={() => onProject(p)}>
              <b>{p.title}</b>
              <span className="muted small">
                сделано {formatMinutes(pace.done)} из {formatMinutes(p.estimate ?? 0)}
                {' · '}до {formatDayShort(p.end)}
                {daysToDeadline >= 0 && pace.left > 0 && <> · нужно ≈{formatMinutes(pace.perDay)}/день</>}
                {pace.left === 0 && p.estimate ? ' · оценка выбрана' : ''}
              </span>
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => presetComposer({ jobId: job.id, goalId: p.id, categoryId: 'work' })}
            >
              + задача
            </button>
          </div>
        );
      })}
      {tasks.map((t) => <TaskCard key={t.id} task={t} plan={plan} date={date} onEdit={onEdit} />)}
      {!projects.length && !tasks.length && <div className="muted small">Заказов на этот день нет.</div>}
    </div>
  );
}

const ESTIMATE_QUICK = [120, 240, 480, 720, 1200, 2400];

/** Проект (заказ) фриланса: оценка часов, дедлайн, «по N минут в эти дни». Устроен как цель. */
export function ProjectModal({ project, onClose }: { project: Goal | null; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const today = todayKey();
  const freelance = jobsOf(data).find((j) => j.kind === 'freelance');
  const [title, setTitle] = useState(project?.title ?? '');
  const [estimate, setEstimate] = useState(project?.estimate ?? 720);
  const [start, setStart] = useState(project?.start ?? today);
  const [end, setEnd] = useState(project?.end ?? addDays(today, 10));
  const [reserveOn, setReserveOn] = useState(!!project?.reserve);
  const [minutes, setMinutes] = useState(project?.reserve?.minutes ?? 90);
  const [weekdays, setWeekdays] = useState(project?.reserve?.weekdays ?? [0, 1, 2, 3, 4]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!freelance) return null;

  const days = Math.max(1, diffDays(start > today ? start : today, end) + 1);
  const suggested = Math.ceil(estimate / days / 5) * 5;
  const valid = title.trim().length > 0 && start <= end && estimate > 0;

  const save = () => {
    if (!valid) return;
    const input = {
      title: title.trim(), categoryId: 'work', color: freelance.color, start, end,
      reserve: reserveOn ? { minutes, weekdays } : null, jobId: freelance.id, estimate,
    };
    apply((d) => (project ? updateGoal(d, project.id, input, today) : addGoal(d, input, today)));
    onClose();
  };

  return (
    <Modal title={project ? 'Проект' : 'Новый проект фриланса'} onClose={onClose}>
      <div className="goal-form">
        <input
          className="composer-title"
          placeholder="Например: лендинг для кафе"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="field">
          <span className="label">Оценка — сколько часов уйдёт на проект</span>
          <DurationPicker value={estimate} onChange={setEstimate} quick={ESTIMATE_QUICK} max={500 * 60} />
        </div>
        <div className="field">
          <span className="label">Срок</span>
          <div className="interval">
            <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
            <span>—</span>
            <input type="date" value={end} min={start} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </div>
          <div className="chips">
            {[7, 14].map((n) => <button key={n} type="button" className="chip" onClick={() => setEnd(addDays(start, n - 1))}>{n} дней</button>)}
            <button type="button" className="chip" onClick={() => setEnd(addDays(addMonths(start, 1), -1))}>Месяц</button>
          </div>
          <div className="muted small">Чтобы успеть, нужно ≈{formatMinutes(suggested)} в день.</div>
        </div>
        <div className={`hidden-costs ${reserveOn ? '' : 'off'}`}>
          <label className="reserve-toggle">
            <input type="checkbox" checked={reserveOn} onChange={(e) => setReserveOn(e.target.checked)} />
            <span>Выделять время на проект</span>
          </label>
          {reserveOn && (
            <>
              <DurationPicker value={minutes} onChange={setMinutes} quick={[60, 90, 120, 180, suggested].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)} />
              <WeekdayPicker value={weekdays} onChange={setWeekdays} />
              <div className="muted small">Пласт проекта появится в эти дни — поверх работы, в «своё» время.</div>
            </>
          )}
        </div>
        <div className="composer-actions">
          {project && (confirmDelete
            ? <button type="button" className="btn danger" onClick={() => { apply((d) => deleteGoal(d, project.id, today)); onClose(); }}>Точно удалить?</button>
            : <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>Удалить</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn primary" disabled={!valid} onClick={save}>{project ? 'Сохранить' : 'Создать проект'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Настройка работы: график основной работы, дорога, отпуска; проекты фриланса. */
export function JobsEditor() {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const today = todayKey();
  const [vacTitle, setVacTitle] = useState('Отпуск');
  const [vacStart, setVacStart] = useState(today);
  const [vacEnd, setVacEnd] = useState(addDays(today, 13));
  const [projectModal, setProjectModal] = useState<Goal | 'new' | null>(null);
  const jobs = jobsOf(data);
  const projects = goalsOf(data).filter(isProject);

  return (
    <div className="jobs-editor">
      {jobs.filter((j) => j.kind === 'fixed').map((job) => (
        <div key={job.id} className="routine-edit">
          <div className="routine-edit-top">
            <input value={job.title} onChange={(e) => apply((d) => updateJob(d, job.id, { title: e.target.value }))} />
          </div>
          <span className="label">Блок работы в день</span>
          <DurationPicker value={job.minutes} onChange={(m) => apply((d) => updateJob(d, job.id, { minutes: m }))} quick={[240, 360, 480, 540, 600, 720]} />
          <WeekdayPicker value={job.weekdays} onChange={(w) => apply((d) => updateJob(d, job.id, { weekdays: w }))} />
          <span className="label">Дорога на работу (туда и обратно)</span>
          <DurationPicker value={job.commuteMinutes} min={0} onChange={(m) => apply((d) => updateJob(d, job.id, { commuteMinutes: m }))} quick={[0, 30, 60, 90, 120]} />
        </div>
      ))}

      <div className="routine-edit">
        <span className="label">Отпуска, больничные, праздники — блок работы и дорога в эти дни исчезают</span>
        {(data.vacations ?? []).map((v) => (
          <div key={v.id} className="vacation-row">
            <span>{v.title}</span>
            <span className="muted small">{formatDayShort(v.start)} – {formatDayShort(v.end)}</span>
            <button type="button" className="icon-btn" aria-label="Удалить" onClick={() => apply((d) => deleteVacation(d, v.id))}>✕</button>
          </div>
        ))}
        <div className="vacation-add">
          <input value={vacTitle} onChange={(e) => setVacTitle(e.target.value)} />
          <input type="date" value={vacStart} onChange={(e) => e.target.value && setVacStart(e.target.value)} />
          <input type="date" value={vacEnd} min={vacStart} onChange={(e) => e.target.value && setVacEnd(e.target.value)} />
          <button
            type="button"
            className="btn"
            disabled={!vacTitle.trim() || vacEnd < vacStart}
            onClick={() => apply((d) => addVacation(d, { jobId: null, start: vacStart, end: vacEnd, title: vacTitle.trim() }))}
          >
            Добавить
          </button>
        </div>
      </div>

      {jobs.some((j) => j.kind === 'freelance') && (
        <div className="routine-edit">
          <span className="label">Проекты фриланса</span>
          {projects.map((p) => (
            <button key={p.id} type="button" className="vacation-row vacation-btn" onClick={() => setProjectModal(p)}>
              <span>{p.title}</span>
              <span className="muted small">{formatMinutes(p.estimate ?? 0)} · до {formatDayShort(p.end)}</span>
            </button>
          ))}
          <button type="button" className="btn" onClick={() => setProjectModal('new')}>+ Проект</button>
        </div>
      )}
      {projectModal && <ProjectModal project={projectModal === 'new' ? null : projectModal} onClose={() => setProjectModal(null)} />}
    </div>
  );
}
