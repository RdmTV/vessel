import { useState, type CSSProperties } from 'react';
import { category } from '../domain/categories';
import { addDays, formatClock, formatDayShort, formatMinutes, todayKey, weekday } from '../domain/dates';
import { PRIORITY_RANK, routineParallelOn, timingMinutes, type DayItem, type DayPlan, type DayTask } from '../domain/day';
import { reserveCoveredBy } from '../domain/goals';
import {
  deleteTask, moveTask, promoteRoutineOverride, setRoutineOverride, toggleDone, toggleSubtask,
} from '../domain/mutations';
import { canMerge, mergeInto, mergeOptions, type ParallelTarget } from '../domain/parallel';
import { describeRule } from '../domain/recurrence';
import type { DateKey } from '../domain/types';
import { useStore } from '../store';
import { mix } from './colors';
import { ParallelSlot } from './Parallel';
import { WorkGroup } from './Work';

const PRIO_MARK = { high: '!!', medium: '!', low: '' } as const;
const ATTACHMENT_KINDS = ['travel', 'prep', 'recovery'];

function sortTasks(tasks: DayTask[]): DayTask[] {
  return [...tasks].sort((a, b) =>
    Number(a.done) - Number(b.done)
    || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    || startOf(a) - startOf(b)
    || a.order - b.order);
}

const startOf = (t: DayTask) => (t.timing.kind === 'interval' ? t.timing.start : 24 * 60);

export function TaskList({ plan, date, onEdit, onOpenRoutine }: {
  plan: DayPlan; date: DateKey; onEdit: (t: DayTask) => void; onOpenRoutine: () => void;
}) {
  const data = useStore((s) => s.data);
  // Рабочие задачи и проекты фриланса живут в разделе «Работа», здесь — только своё.
  const projectIds = new Set((data.goals ?? []).filter((g) => g.jobId).map((g) => g.id));
  const personal = plan.tasks.filter((t) => !t.jobId && !(t.goalId && projectIds.has(t.goalId)));
  const tasks = sortTasks(personal);
  const carry = plan.items.filter((i) => i.kind === 'carry');
  const doneCount = personal.filter((t) => t.done).length;

  return (
    <div className="tasklist">
      <RoutineGroup date={date} plan={plan} onOpenRoutine={onOpenRoutine} />
      <WorkGroup plan={plan} date={date} onEdit={onEdit} onOpenWork={onOpenRoutine} />

      {carry.length > 0 && (
        <div className="group">
          <div className="group-head"><span>С прошлого вечера</span></div>
          {carry.map((c) => (
            <div key={c.key} className="row-carry">
              <span className="swatch" style={{ background: category(c.categoryId).color }} />
              <span>{c.title}</span>
              <span className="muted">{formatMinutes(c.minutes)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="group">
        <div className="group-head">
          <span>Своё</span>
          {personal.length > 0 && <span className="muted">{doneCount} / {personal.length}</span>}
        </div>
        {tasks.length === 0 && <div className="empty">Пока пусто. Добавь первое дело — и посмотри, сколько места оно займёт.</div>}
        {tasks.map((t) => <TaskCard key={t.id} task={t} plan={plan} date={date} onEdit={onEdit} />)}
      </div>
    </div>
  );
}

/**
 * Карточка задачи. Лицевая сторона — само дело, оборотная — что делаю параллельно
 * (во время дела и во время его дороги/сборов). Переворот — кнопкой ⇄.
 */
export function TaskCard({ task, plan, date, onEdit }: { task: DayTask; plan: DayPlan; date: DateKey; onEdit: (t: DayTask) => void }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const expanded = useStore((s) => s.expandedTask === task.id);
  const setExpanded = useStore((s) => s.setExpandedTask);
  const askScope = useStore((s) => s.askScope);
  const showToast = useStore((s) => s.showToast);
  const [moveDate, setMoveDate] = useState(addDays(date, 1));
  const [flipped, setFlipped] = useState(false);
  const [merging, setMerging] = useState(false);

  const key = `t:${task.id}`;
  const color = category(task.categoryId).color;
  const extra = task.attachments.reduce((s, a) => s + a.minutes, 0);
  const series = task.seriesId ? data.series.find((s) => s.id === task.seriesId) : undefined;
  const goal = task.goalId ? data.goals?.find((g) => g.id === task.goalId) : undefined;
  const subDone = task.subtasks.filter((s) => s.done).length;

  // Пласты этой задачи в сосуде: сама задача и её скрытые затраты — у каждого может быть оборот.
  const ownItems = plan.items.filter((i) => i.taskId === task.id && (i.kind === 'task' || ATTACHMENT_KINDS.includes(i.kind)));
  const twice = ownItems.filter((i) => i.parallel);

  // Резерв цели в этот день уже закрыт оборотом (английский в наушниках по дороге).
  const reserveGoal = task.seriesId ? data.goals?.find((g) => g.seriesId === task.seriesId) : undefined;
  const coveredBy = reserveGoal && !task.done ? reserveCoveredBy(data, date, reserveGoal.id) : null;

  const remove = async () => {
    let scope: 'this' | 'following' = 'this';
    if (task.seriesId) {
      const s = await askScope('Удалить повторяющуюся задачу');
      if (!s) return;
      scope = s;
    }
    const prev = useStore.getState().data;
    apply((d) => deleteTask(d, task.id, scope));
    setExpanded(null);
    showToast({ text: `«${task.title}» удалено`, action: { label: 'Вернуть', run: () => useStore.setState({ data: prev }) } });
  };

  const move = (to: DateKey) => {
    apply((d) => moveTask(d, task.id, to));
    setExpanded(null);
  };

  const merge = (target: ParallelTarget, minutes: number, label: string) => {
    const freed = Math.min(minutes, timingMinutes(task.timing));
    apply((d) => mergeInto(d, task, target, minutes));
    setExpanded(null);
    showToast({ text: `«${task.title}» идёт параллельно с «${label}» — освободилось ${formatMinutes(freed)}` });
  };

  const targetFor = (i: DayItem): ParallelTarget => (i.kind === 'task'
    ? { kind: 'task', taskId: task.id }
    : { kind: 'attachment', taskId: task.id, attachment: i.kind as 'travel' | 'prep' | 'recovery' });

  return (
    <div
      data-task={task.id}
      className={`tcard ${flipped ? 'flipped' : ''} ${task.done ? 'done' : ''} ${highlight === key ? 'lit' : ''} ${expanded ? 'open' : ''}`}
      onMouseEnter={() => setHighlight(key)}
      onMouseLeave={() => setHighlight(null)}
    >
      <div className="tcard-inner">
        {/* ── лицевая сторона */}
        <div className="tcard-face tcard-front" aria-hidden={flipped}>
          <div className="task-row">
            <button
              type="button"
              className="check"
              style={{ borderColor: color, background: task.done ? color : 'transparent' }}
              onClick={() => apply((d) => toggleDone(d, task.id))}
              aria-label={task.done ? 'Отметить невыполненной' : 'Отметить выполненной'}
            >
              {task.done ? '✓' : ''}
            </button>
            <div className="task-main" onClick={() => setExpanded(expanded ? null : task.id)}>
              <div className="task-title">
                {task.title}
                {PRIO_MARK[task.priority] && <span className={`prio prio-${task.priority}`}>{PRIO_MARK[task.priority]}</span>}
              </div>
              <div className="task-meta">
                <span style={{ color: mix(color, '#ffffff', 0.35) }}>{category(task.categoryId).name}</span>
                <span>
                  {task.timing.kind === 'interval'
                    ? `${formatClock(task.timing.start)}–${formatClock(task.timing.end)}`
                    : formatMinutes(timingMinutes(task.timing))}
                </span>
                {extra > 0 && <span className="muted">+{formatMinutes(extra)} невидимого</span>}
                {goal && <span className="goal-tag" style={{ '--c': goal.color } as CSSProperties}>{goal.title}</span>}
                {series && <span className="muted" title={describeRule(series.rule)}>↻ {describeRule(series.rule)}</span>}
                {task.subtasks.length > 0 && <span className="muted">☑ {subDone}/{task.subtasks.length}</span>}
              </div>
            </div>
            <button type="button" className={`flip-btn ${twice.length ? 'has' : ''}`} onClick={() => setFlipped(true)} title="Оборот: что делаю параллельно">
              ⇄
            </button>
          </div>

          {twice.map((i) => (
            <button key={i.key} type="button" className="twice-line" onClick={() => setFlipped(true)}>
              <i style={{ background: category(i.parallel!.categoryId).color }} />
              <span className={i.parallel!.done ? 'done-text' : ''}>{i.parallel!.title}</span>
              <span className="muted">
                {formatMinutes(i.parallel!.minutes)}
                {i.kind !== 'task' ? ` · ${i.title.toLowerCase()}` : ''}
              </span>
            </button>
          ))}

          {coveredBy && (
            <div className="covered-hint">
              «{reserveGoal!.title}» сегодня уже идёт параллельно с «{coveredBy}».
              <button type="button" className="link" onClick={() => apply((d) => deleteTask(d, task.id, 'this'))}>Убрать этот пласт</button>
            </div>
          )}

          {expanded && (
            <div className="task-details">
              {task.subtasks.length > 0 && (
                <div className="subtasks">
                  {task.subtasks.map((s) => (
                    <label key={s.id} className={`subtask ${s.done ? 'done' : ''}`}>
                      <input type="checkbox" checked={s.done} onChange={() => apply((d) => toggleSubtask(d, task.id, s.id))} />
                      {s.title}
                    </label>
                  ))}
                </div>
              )}
              {task.attachments.length > 0 && (
                <div className="muted small">
                  {task.attachments.map((a) => `${a.label} ${formatMinutes(a.minutes)}`).join(' · ')}
                </div>
              )}
              <div className="task-actions">
                <button type="button" className="chip" onClick={() => onEdit(task)}>Изменить</button>
                <button type="button" className="chip" onClick={() => move(addDays(date, 1))}>→ Завтра</button>
                <span className="move-to">
                  <input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
                  <button type="button" className="chip" disabled={!moveDate || moveDate === date} onClick={() => move(moveDate)}>Перенести</button>
                </span>
                {canMerge(task) && (
                  <button type="button" className={`chip ${merging ? 'on' : ''}`} onClick={() => setMerging(!merging)}>Совместить с…</button>
                )}
                <button type="button" className="chip chip-danger" onClick={remove}>Удалить</button>
              </div>
              {merging && (
                <div className="merge-pick">
                  <div className="muted small">Сделать «{task.title}» параллельным делом — песок впитается, место освободится:</div>
                  <div className="chips">
                    {mergeOptions(plan, task.id).map((o) => (
                      <button key={`${o.label}-${o.minutes}`} type="button" className="chip chip-cat" style={{ '--cat': category(o.categoryId).color } as CSSProperties} onClick={() => merge(o.target, o.minutes, o.label)}>
                        <i />{o.label} · {formatMinutes(o.minutes)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── оборотная сторона: что делаю параллельно */}
        <div className="tcard-face tcard-back" aria-hidden={!flipped}>
          <div className="tcard-back-head">
            <span>Параллельно с «{task.title}»</span>
            <button type="button" className="flip-btn" onClick={() => setFlipped(false)} title="Назад к задаче">↩</button>
          </div>
          {flipped && ownItems.map((i) => (
            <ParallelSlot
              key={i.key}
              label={i.kind === 'task' ? 'Во время дела' : i.title}
              target={targetFor(i)}
              parallel={i.parallel}
              maxMinutes={i.minutes}
              date={date}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RoutineGroup({ date, plan, onOpenRoutine }: { date: DateKey; plan: DayPlan; onOpenRoutine: () => void }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const showToast = useStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [parallelFor, setParallelFor] = useState<string | null>(null);

  const wd = weekday(date);
  const overrides = data.routineOverrides[date] ?? {};
  const changedCount = Object.keys(overrides).length;
  const items = data.routine.filter((r) => r.weekdays.includes(wd));
  const total = items.reduce((s, r) => s + (overrides[r.id] ?? r.minutes), 0);
  const dayLabel = date === todayKey() ? 'сегодня' : formatDayShort(date);

  /** −/+ меняют только этот день — говорим об этом сразу и предлагаем сделать для всех дней. */
  const setForDay = (id: string, title: string, m: number) => {
    apply((d) => setRoutineOverride(d, date, id, m));
    showToast({
      text: `${title}: ${m === 0 ? 'пропуск' : formatMinutes(m)} — только ${dayLabel === 'сегодня' ? 'на сегодня' : `на ${dayLabel}`}`,
      action: { label: 'Для всех дней', run: () => apply((d) => promoteRoutineOverride(d, date, id)) },
    });
  };

  return (
    <div className="group group-routine">
      <button type="button" className="group-head group-toggle" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} Рутина</span>
        <span className="muted">
          {formatMinutes(total)}
          {changedCount > 0 && <span className="badge-warn">изменена на {dayLabel}</span>}
        </span>
      </button>
      {open && (
        <>
          {items.map((r) => {
            const m = overrides[r.id] ?? r.minutes;
            const changed = r.id in overrides;
            const key = `r:${r.id}`;
            const parallel = routineParallelOn(data, date, r);
            const item = plan.items.find((i) => i.key === key);
            const showParallel = parallelFor === r.id || !!parallel;
            return (
              <div key={r.id} className="routine-block">
                <div
                  className={`routine-row ${m === 0 ? 'skipped' : ''} ${changed ? 'changed' : ''} ${highlight === key ? 'lit' : ''}`}
                  onMouseEnter={() => setHighlight(key)}
                  onMouseLeave={() => setHighlight(null)}
                >
                  <span className="swatch" style={{ background: mix(category(r.categoryId).color, '#2B2D36', 0.38) }} />
                  <span className="routine-title">
                    {r.title}
                    {changed && <small>только {dayLabel === 'сегодня' ? 'сегодня' : dayLabel} · в шаблоне {formatMinutes(r.minutes)}</small>}
                  </span>
                  <div className="stepper stepper-sm">
                    <button type="button" onClick={() => setForDay(r.id, r.title, Math.max(0, m - 15))}>−</button>
                    <span>{m === 0 ? 'пропуск' : formatMinutes(m)}</span>
                    <button type="button" onClick={() => setForDay(r.id, r.title, m + 15)}>+</button>
                  </div>
                  {changed ? (
                    <span className="routine-actions">
                      <button type="button" className="link" onClick={() => apply((d) => setRoutineOverride(d, date, r.id, null))}>как в шаблоне</button>
                      <button type="button" className="link" onClick={() => apply((d) => promoteRoutineOverride(d, date, r.id))}>в шаблон</button>
                    </span>
                  ) : (
                    <span className="routine-actions">
                      <button type="button" className="link" onClick={() => setForDay(r.id, r.title, 0)}>пропустить</button>
                      {!parallel && m > 0 && (
                        <button type="button" className="link" onClick={() => setParallelFor(parallelFor === r.id ? null : r.id)}>⇄ параллельно</button>
                      )}
                    </span>
                  )}
                </div>
                {showParallel && item && (
                  <ParallelSlot
                    label={parallel && r.parallel && parallel === r.parallel ? 'Параллельно · по шаблону' : 'Параллельно'}
                    target={{ kind: 'routine', routineId: r.id, date }}
                    parallel={item.parallel}
                    maxMinutes={item.minutes}
                    date={date}
                    allowDone={false}
                  />
                )}
              </div>
            );
          })}
          <p className="muted small routine-hint">
            −/+ и параллельные дела здесь — только на {dayLabel === 'сегодня' ? 'сегодняшний день' : dayLabel}. Для всех дней — шаблон.
            {changedCount > 1 && (
              <>
                {' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => apply((d) => Object.keys(overrides).reduce((acc, id) => setRoutineOverride(acc, date, id, null), d))}
                >
                  Вернуть всё как в шаблоне
                </button>
              </>
            )}
          </p>
          <button type="button" className="link link-block" onClick={onOpenRoutine}>Настроить шаблон рутины →</button>
        </>
      )}
    </div>
  );
}
