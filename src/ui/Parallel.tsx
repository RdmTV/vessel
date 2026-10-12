import { useState, type CSSProperties } from 'react';
import { category, PICKABLE_CATEGORIES } from '../domain/categories';
import { formatMinutes } from '../domain/dates';
import { goalsOf } from '../domain/goals';
import { setParallel, splitParallel, toggleParallelDone, type ParallelTarget } from '../domain/parallel';
import type { DateKey, Parallel } from '../domain/types';
import { useStore } from '../store';
import { DurationPicker } from './common';

const QUICK = [15, 30, 45, 60, 90];

/** Форма оборота: что делаю параллельно, какой категории, сколько из длины основного дела. */
export function ParallelForm({ value, maxMinutes, date, onSave, onCancel, saveLabel = 'Готово' }: {
  value?: Parallel;
  maxMinutes: number;
  date?: DateKey;
  onSave: (p: Parallel) => void;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const data = useStore((s) => s.data);
  const [title, setTitle] = useState(value?.title ?? '');
  const [categoryId, setCategoryId] = useState(value?.categoryId ?? 'study');
  const [minutes, setMinutes] = useState(Math.min(value?.minutes ?? maxMinutes, maxMinutes));
  const [goalId, setGoalId] = useState(value?.goalId ?? '');
  const goals = goalsOf(data).filter((g) => !date || (g.start <= date && date <= g.end) || g.id === goalId);
  const valid = title.trim().length > 0 && minutes > 0;

  const save = () => {
    if (!valid) return;
    onSave({
      title: title.trim(),
      categoryId,
      minutes: Math.min(minutes, maxMinutes),
      ...(value?.done ? { done: true } : {}),
      ...(goalId ? { goalId } : {}),
    });
  };

  return (
    <div className="parallel-form">
      <input
        className="parallel-title"
        placeholder="Что параллельно? Например: подкаст"
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onCancel?.();
        }}
      />
      <div className="chips chips-compact">
        {PICKABLE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip chip-cat ${c.id === categoryId ? 'on' : ''}`}
            style={{ '--cat': c.color } as CSSProperties}
            onClick={() => setCategoryId(c.id)}
          >
            <i />{c.name}
          </button>
        ))}
      </div>
      <DurationPicker
        value={minutes}
        onChange={(m) => setMinutes(Math.min(m, maxMinutes))}
        quick={[...QUICK.filter((q) => q < maxMinutes), maxMinutes]}
        max={maxMinutes}
      />
      <div className="muted small">Не дольше основного дела — {formatMinutes(maxMinutes)}. Места в сосуде не займёт.</div>
      {goals.length > 0 && (
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          <option value="">Без цели</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
      )}
      <div className="parallel-actions">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>}
        <button type="button" className="btn primary" disabled={!valid} onClick={save}>{saveLabel}</button>
      </div>
    </div>
  );
}

/**
 * Слот оборота у конкретного пласта дня: показывает оборот (галочка, правка, разделить, убрать)
 * или кнопку «+ параллельно».
 */
export function ParallelSlot({ label, target, parallel, maxMinutes, date, allowDone = true }: {
  label: string;
  target: ParallelTarget;
  parallel?: Parallel;
  maxMinutes: number;
  date: DateKey;
  allowDone?: boolean;
}) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const showToast = useStore((s) => s.showToast);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="parallel-slot">
        <div className="parallel-slot-label">{label}</div>
        <ParallelForm
          value={parallel}
          maxMinutes={maxMinutes}
          date={date}
          saveLabel={parallel ? 'Сохранить' : 'Добавить'}
          onCancel={() => setEditing(false)}
          onSave={(p) => {
            apply((d) => setParallel(d, target, p));
            setEditing(false);
          }}
        />
      </div>
    );
  }

  if (!parallel) {
    return (
      <div className="parallel-slot parallel-slot-empty">
        <div className="parallel-slot-label">{label}</div>
        <button type="button" className="link" onClick={() => setEditing(true)}>+ параллельно</button>
      </div>
    );
  }

  const goal = parallel.goalId ? data.goals?.find((g) => g.id === parallel.goalId) : undefined;
  const color = category(parallel.categoryId).color;
  return (
    <div className="parallel-slot">
      <div className="parallel-slot-label">{label}</div>
      <div className="parallel-item">
        {allowDone ? (
          <button
            type="button"
            className="check"
            style={{ borderColor: color, background: parallel.done ? color : 'transparent' }}
            onClick={() => apply((d) => toggleParallelDone(d, target, parallel))}
            aria-label={parallel.done ? 'Отметить невыполненным' : 'Отметить выполненным'}
          >
            {parallel.done ? '✓' : ''}
          </button>
        ) : <span className="swatch" style={{ background: color }} />}
        <div className="parallel-main">
          <div className={parallel.done ? 'done-text' : ''}>{parallel.title}</div>
          <div className="task-meta">
            <span style={{ color }}>{category(parallel.categoryId).name}</span>
            <span>{formatMinutes(parallel.minutes)}</span>
            {goal && <span className="goal-tag" style={{ '--c': goal.color } as CSSProperties}>{goal.title}</span>}
          </div>
        </div>
      </div>
      <div className="task-actions">
        <button type="button" className="chip" onClick={() => setEditing(true)}>Изменить</button>
        <button
          type="button"
          className="chip"
          onClick={() => {
            apply((d) => splitParallel(d, target, parallel, date));
            showToast({ text: `«${parallel.title}» снова отдельным пластом — заняло ${formatMinutes(parallel.minutes)}` });
          }}
        >
          Разделить
        </button>
        <button type="button" className="chip chip-danger" onClick={() => apply((d) => setParallel(d, target, null))}>Убрать</button>
      </div>
    </div>
  );
}
