import { useState } from 'react';
import { category } from '../domain/categories';
import { addDays, formatClock, formatMinutes, weekday } from '../domain/dates';
import { PRIORITY_RANK, timingMinutes, type DayPlan, type DayTask } from '../domain/day';
import { deleteTask, moveTask, setRoutineOverride, toggleDone, toggleSubtask } from '../domain/mutations';
import { describeRule } from '../domain/recurrence';
import type { DateKey } from '../domain/types';
import { useStore } from '../store';
import { mix } from './colors';

const PRIO_MARK = { high: '!!', medium: '!', low: '' } as const;

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
  const tasks = sortTasks(plan.tasks);
  const carry = plan.items.filter((i) => i.kind === 'carry');
  const doneCount = plan.tasks.filter((t) => t.done).length;

  return (
    <div className="tasklist">
      <RoutineGroup date={date} onOpenRoutine={onOpenRoutine} />

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
          <span>Задачи</span>
          {plan.tasks.length > 0 && <span className="muted">{doneCount} / {plan.tasks.length}</span>}
        </div>
        {tasks.length === 0 && <div className="empty">Пока пусто. Добавь первое дело — и посмотри, сколько места оно займёт.</div>}
        {tasks.map((t) => <TaskRow key={t.id} task={t} date={date} onEdit={onEdit} />)}
      </div>
    </div>
  );
}

function TaskRow({ task, date, onEdit }: { task: DayTask; date: DateKey; onEdit: (t: DayTask) => void }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const expanded = useStore((s) => s.expandedTask === task.id);
  const setExpanded = useStore((s) => s.setExpandedTask);
  const askScope = useStore((s) => s.askScope);
  const showToast = useStore((s) => s.showToast);
  const [moveDate, setMoveDate] = useState(addDays(date, 1));

  const key = `t:${task.id}`;
  const color = category(task.categoryId).color;
  const extra = task.attachments.reduce((s, a) => s + a.minutes, 0);
  const series = task.seriesId ? data.series.find((s) => s.id === task.seriesId) : undefined;
  const subDone = task.subtasks.filter((s) => s.done).length;

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

  return (
    <div
      data-task={task.id}
      className={`task ${task.done ? 'done' : ''} ${highlight === key ? 'lit' : ''} ${expanded ? 'open' : ''}`}
      onMouseEnter={() => setHighlight(key)}
      onMouseLeave={() => setHighlight(null)}
    >
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
            {series && <span className="muted" title={describeRule(series.rule)}>↻ {describeRule(series.rule)}</span>}
            {task.subtasks.length > 0 && <span className="muted">☑ {subDone}/{task.subtasks.length}</span>}
          </div>
        </div>
      </div>

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
            <button type="button" className="chip chip-danger" onClick={remove}>Удалить</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoutineGroup({ date, onOpenRoutine }: { date: DateKey; onOpenRoutine: () => void }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const [open, setOpen] = useState(false);

  const wd = weekday(date);
  const overrides = data.routineOverrides[date] ?? {};
  const items = data.routine.filter((r) => r.weekdays.includes(wd));
  const total = items.reduce((s, r) => s + (overrides[r.id] ?? r.minutes), 0);
  const set = (id: string, m: number | null) => apply((d) => setRoutineOverride(d, date, id, m));

  return (
    <div className="group group-routine">
      <button type="button" className="group-head group-toggle" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} Рутина</span>
        <span className="muted">{formatMinutes(total)}{Object.keys(overrides).length > 0 ? ' · изменена на сегодня' : ''}</span>
      </button>
      {open && (
        <>
          {items.map((r) => {
            const m = overrides[r.id] ?? r.minutes;
            const changed = r.id in overrides;
            const key = `r:${r.id}`;
            return (
              <div
                key={r.id}
                className={`routine-row ${m === 0 ? 'skipped' : ''} ${highlight === key ? 'lit' : ''}`}
                onMouseEnter={() => setHighlight(key)}
                onMouseLeave={() => setHighlight(null)}
              >
                <span className="swatch" style={{ background: mix(category(r.categoryId).color, '#2B2D36', 0.38) }} />
                <span className="routine-title">{r.title}</span>
                <div className="stepper stepper-sm">
                  <button type="button" onClick={() => set(r.id, Math.max(0, m - 15))}>−</button>
                  <span>{m === 0 ? 'пропуск' : formatMinutes(m)}</span>
                  <button type="button" onClick={() => set(r.id, m + 15)}>+</button>
                </div>
                {changed
                  ? <button type="button" className="link" onClick={() => set(r.id, null)}>сбросить</button>
                  : <button type="button" className="link" onClick={() => set(r.id, 0)}>пропустить</button>}
              </div>
            );
          })}
          <button type="button" className="link link-block" onClick={onOpenRoutine}>Настроить шаблон рутины →</button>
        </>
      )}
    </div>
  );
}
