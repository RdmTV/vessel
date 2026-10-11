import { CATEGORIES } from '../domain/categories';
import { formatMinutes } from '../domain/dates';
import { DAY_CAPACITY } from '../domain/day';
import { uid } from '../domain/id';
import type { RoutineItem } from '../domain/types';
import { useStore } from '../store';
import { DurationPicker, Modal, WeekdayPicker } from './common';

const ROUTINE_QUICK = [30, 60, 90, 120, 480, 540];

export function RoutineModal({ onClose }: { onClose: () => void }) {
  const routine = useStore((s) => s.data.routine);
  const apply = useStore((s) => s.apply);

  const setRoutine = (fn: (r: RoutineItem[]) => RoutineItem[]) =>
    apply((d) => ({ ...d, routine: fn(d.routine) }));
  const patch = (id: string, p: Partial<RoutineItem>) =>
    setRoutine((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const totalFor = (wd: number) => routine.filter((r) => r.weekdays.includes(wd)).reduce((s, r) => s + r.minutes, 0);
  const weekdayTotal = totalFor(0);
  const weekendTotal = totalFor(5);

  return (
    <Modal title="Шаблон рутины" onClose={onClose} wide>
      <p className="lead">
        Это фундамент каждого дня — он уже лежит на дне сосуда.
        Будни: <b>{formatMinutes(weekdayTotal)}</b> → свободно {formatMinutes(DAY_CAPACITY - weekdayTotal)}.
        Выходные: <b>{formatMinutes(weekendTotal)}</b> → свободно {formatMinutes(DAY_CAPACITY - weekendTotal)}.
      </p>
      <div className="routine-edit-list">
        {routine.map((r) => (
          <div key={r.id} className="routine-edit">
            <div className="routine-edit-top">
              <input value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} />
              <select value={r.categoryId} onChange={(e) => patch(r.id, { categoryId: e.target.value })}>
                {CATEGORIES.filter((c) => c.id !== 'hidden').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label="Удалить" onClick={() => setRoutine((x) => x.filter((i) => i.id !== r.id))}>✕</button>
            </div>
            <DurationPicker value={r.minutes} onChange={(m) => patch(r.id, { minutes: m })} quick={ROUTINE_QUICK} />
            <WeekdayPicker value={r.weekdays} onChange={(w) => patch(r.id, { weekdays: w })} />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => setRoutine((r) => [...r, { id: uid(), title: 'Новый пункт', categoryId: 'chores', minutes: 30, weekdays: [0, 1, 2, 3, 4, 5, 6] }])}
      >
        + Пункт рутины
      </button>
    </Modal>
  );
}
