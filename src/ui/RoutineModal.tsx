import { useState } from 'react';
import { CATEGORIES, category } from '../domain/categories';
import { formatDayShort, formatMinutes, todayKey } from '../domain/dates';
import { DAY_CAPACITY } from '../domain/day';
import { uid } from '../domain/id';
import { clearRoutineOverrides, routineOverridesFrom } from '../domain/mutations';
import type { DateKey, Parallel, RoutineItem } from '../domain/types';
import { useStore } from '../store';
import { DurationPicker, Modal, WeekdayPicker } from './common';
import { ParallelForm } from './Parallel';

const ROUTINE_QUICK = [30, 60, 90, 120, 480, 540];

export function RoutineModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Шаблон рутины" onClose={onClose} wide>
      <RoutineEditor />
    </Modal>
  );
}

/** Оборот пункта рутины по шаблону: каждый раз, когда пункт есть в дне. */
function TemplateParallel({ value, maxMinutes, onChange }: {
  value?: Parallel; maxMinutes: number; onChange: (p: Parallel | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <ParallelForm
        value={value}
        maxMinutes={maxMinutes}
        saveLabel={value ? 'Сохранить' : 'Добавить'}
        onCancel={() => setEditing(false)}
        onSave={(p) => {
          onChange(p);
          setEditing(false);
        }}
      />
    );
  }
  if (!value) {
    return <button type="button" className="link" onClick={() => setEditing(true)}>⇄ + Параллельно по шаблону</button>;
  }
  return (
    <div className="template-parallel">
      <i style={{ background: category(value.categoryId).color }} />
      <span>⇄ {value.title} · {formatMinutes(Math.min(value.minutes, maxMinutes))}</span>
      <button type="button" className="link" onClick={() => setEditing(true)}>изменить</button>
      <button type="button" className="link" onClick={() => onChange(null)}>убрать</button>
    </div>
  );
}

/** Предупреждение: на эти дни стоит своё значение, и шаблон к ним не применяется. */
function OverrideNotice({ list, today, onReset }: { list: [DateKey, number][]; today: DateKey; onReset: () => void }) {
  if (!list.length) return null;
  const shown = list.slice(0, 3).map(([d, m]) => `${d === today ? 'сегодня' : formatDayShort(d)} — ${m === 0 ? 'пропуск' : formatMinutes(m)}`);
  return (
    <div className="override-notice">
      <span>
        Своё значение: {shown.join(', ')}{list.length > 3 ? ` и ещё ${list.length - 3}` : ''}. Шаблон на эти дни не действует.
      </span>
      <button type="button" className="link" onClick={onReset}>Применить шаблон</button>
    </div>
  );
}

/** Редактор шаблона рутины — в модалке и в онбординге. */
export function RoutineEditor() {
  const routine = useStore((s) => s.data.routine);
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const today = todayKey();

  const setRoutine = (fn: (r: RoutineItem[]) => RoutineItem[]) =>
    apply((d) => ({ ...d, routine: fn(d.routine) }));
  const patch = (id: string, p: Partial<RoutineItem>) =>
    setRoutine((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const totalFor = (wd: number) => routine.filter((r) => r.weekdays.includes(wd)).reduce((s, r) => s + r.minutes, 0);
  const weekdayTotal = totalFor(0);
  const weekendTotal = totalFor(5);

  return (
    <>
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
            <TemplateParallel
              value={r.parallel}
              maxMinutes={r.minutes}
              onChange={(p) => setRoutine((list) => list.map((x) => {
                if (x.id !== r.id) return x;
                const { parallel: _old, ...rest } = x;
                return p ? { ...rest, parallel: p } : rest;
              }))}
            />
            <OverrideNotice
              list={routineOverridesFrom(data, today, r.id)}
              today={today}
              onReset={() => apply((d) => clearRoutineOverrides(d, today, r.id))}
            />
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
    </>
  );
}
