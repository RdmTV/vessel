import { useState, type CSSProperties } from 'react';
import { category, PICKABLE_CATEGORIES } from '../domain/categories';
import { addDays, addMonths, diffDays, formatMinutes, todayKey } from '../domain/dates';
import { addGoal, deleteGoal, GOAL_COLORS, goalsOf, updateGoal, type GoalInput } from '../domain/goals';
import type { Goal } from '../domain/types';
import { useStore } from '../store';
import { DurationPicker, Modal, WeekdayPicker } from './common';

const QUICK_RANGES: { label: string; months: number }[] = [
  { label: 'Месяц', months: 1 },
  { label: '3 месяца', months: 3 },
  { label: 'Полгода', months: 6 },
  { label: 'Год', months: 12 },
];

/** Создание и правка цели. Диапазон — формой (на сетке жизни клетки слишком мелкие для выделения). */
export function GoalModal({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const today = todayKey();
  const used = new Set(goalsOf(data).map((g) => g.color));

  const [title, setTitle] = useState(goal?.title ?? '');
  const [categoryId, setCategoryId] = useState(goal?.categoryId ?? 'study');
  const [color, setColor] = useState(goal?.color ?? GOAL_COLORS.find((c) => !used.has(c)) ?? GOAL_COLORS[0]);
  const [start, setStart] = useState(goal?.start ?? today);
  const [end, setEnd] = useState(goal?.end ?? addDays(addMonths(today, 3), -1));
  const [reserveOn, setReserveOn] = useState(!!goal?.reserve);
  const [minutes, setMinutes] = useState(goal?.reserve?.minutes ?? 30);
  const [weekdays, setWeekdays] = useState(goal?.reserve?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const valid = title.trim().length > 0 && start <= end && (!reserveOn || weekdays.length > 0);
  const input: GoalInput = {
    title: title.trim(), categoryId, color, start, end,
    reserve: reserveOn ? { minutes, weekdays } : null,
  };

  // Сколько стоит резерв: в неделю и до конца цели (считаем только с сегодняшнего дня).
  const reserveFrom = start > today ? start : today;
  const reserveDays = reserveFrom <= end ? diffDays(reserveFrom, end) + 1 : 0;
  const perWeek = minutes * weekdays.length;
  const total = Math.round((reserveDays / 7) * perWeek);

  const save = () => {
    if (!valid) return;
    apply((d) => (goal ? updateGoal(d, goal.id, input, today) : addGoal(d, input, today)));
    onClose();
  };

  return (
    <Modal title={goal ? 'Цель' : 'Новая цель'} onClose={onClose}>
      <div className="goal-form">
        <input
          className="composer-title"
          placeholder="Например: выучить английский"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />

        <div className="field">
          <span className="label">Срок</span>
          <div className="interval">
            <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
            <span>—</span>
            <input type="date" value={end} min={start} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </div>
          <div className="chips">
            {QUICK_RANGES.map((q) => (
              <button key={q.months} type="button" className="chip" onClick={() => setEnd(addDays(addMonths(start, q.months), -1))}>
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Цвет на сетке</span>
          <div className="chips">
            {GOAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-dot ${c === color ? 'on' : ''}`}
                style={{ '--c': c } as CSSProperties}
                onClick={() => setColor(c)}
                aria-label={`Цвет ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Категория — цвет пласта в сосуде</span>
          <div className="chips">
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
        </div>

        <div className={`hidden-costs ${reserveOn ? '' : 'off'}`}>
          <label className="reserve-toggle">
            <input type="checkbox" checked={reserveOn} onChange={(e) => setReserveOn(e.target.checked)} />
            <span>Выделять время на цель каждый день</span>
          </label>
          {reserveOn && (
            <>
              <DurationPicker value={minutes} onChange={setMinutes} quick={[15, 30, 45, 60, 90, 120]} />
              <WeekdayPicker value={weekdays} onChange={setWeekdays} />
              <div className="muted small">
                {formatMinutes(perWeek)} в неделю
                {reserveDays > 0 && <> · ≈ {formatMinutes(total)} до конца цели</>}
                . Пласт «{title.trim() || 'цель'}» цвета «{category(categoryId).name}» появится в каждом таком дне
                {start < today ? ', начиная с сегодня' : ''}.
              </div>
            </>
          )}
        </div>

        <div className="composer-actions">
          {goal && (
            confirmDelete ? (
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  apply((d) => deleteGoal(d, goal.id, today));
                  onClose();
                }}
              >
                Точно удалить?
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>Удалить</button>
            )
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn primary" disabled={!valid} onClick={save}>
            {goal ? 'Сохранить' : 'Создать цель'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
