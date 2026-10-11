import { useMemo } from 'react';
import { category } from '../domain/categories';
import { addDays, formatDayShort, formatMinutes } from '../domain/dates';
import {
  displaceCandidates, minutesOnStartDay, nearestFitDays, PRIORITY_LABEL, type DayPlan, type DayTask,
} from '../domain/day';
import { deleteTask, moveTask, shortenFields, updateTask } from '../domain/mutations';
import type { DateKey, TaskFields } from '../domain/types';
import { useStore } from '../store';
import { Modal } from './common';

/** Новая задача не влезает: перенести, сократить или освободить место. */
export function DraftResolution({ date, plan, fields, deficit, onMove, onShorten }: {
  date: DateKey; plan: DayPlan; fields: TaskFields; deficit: number;
  onMove: (d: DateKey) => void; onShorten: (minutes: number) => void;
}) {
  const data = useStore((s) => s.data);
  const days = useMemo(() => nearestFitDays(data, fields, date, 3), [data, fields, date]);
  const own = minutesOnStartDay(fields.timing);
  const candidates = displaceCandidates(plan, fields.priority).slice(0, 4);

  return (
    <div className="resolve">
      <div className="resolve-title">Не влезает — не хватает {formatMinutes(deficit)}</div>
      {days.length > 0 && (
        <div className="resolve-block">
          <span className="label">Перенести на</span>
          <div className="chips">
            {days.map((d) => (
              <button key={d.date} type="button" className="chip" onClick={() => onMove(d.date)}>
                {formatDayShort(d.date)} <small>своб. {formatMinutes(d.free)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {own - deficit >= 5 && (
        <div className="resolve-block">
          <button type="button" className="chip" onClick={() => onShorten(own - deficit)}>
            Сократить до {formatMinutes(Math.floor((own - deficit) / 5) * 5)}
          </button>
        </div>
      )}
      {candidates.length > 0 && (
        <div className="resolve-block">
          <span className="label">Или освободить место</span>
          {candidates.map((t) => <CandidateRow key={t.id} task={t} date={date} />)}
        </div>
      )}
    </div>
  );
}

/** Уже запланированное переполнило сосуд — разбор выпавшего. */
export function OverflowModal({ plan, date, onClose }: { plan: DayPlan; date: DateKey; onClose: () => void }) {
  const candidates = displaceCandidates(plan);
  if (plan.overflow === 0) {
    return (
      <Modal title="Всё влезло" onClose={onClose}>
        <p className="lead ok">Сосуд больше не переполнен ✓</p>
        <div className="scope-buttons"><button type="button" className="btn primary" onClick={onClose}>Готово</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="Сосуд переполнен" onClose={onClose}>
      <p className="lead">
        Не влезло <b className="danger">{formatMinutes(plan.overflow)}</b> — это то, что выпало на пол.
        Перенеси, сократи или убери что-то из дня.
      </p>
      {candidates.length === 0 && (
        <p className="muted">Задач нет — сосуд переполнила рутина. Уменьши её на этот день в списке «Рутина».</p>
      )}
      {candidates.map((t) => <CandidateRow key={t.id} task={t} date={date} deficit={plan.overflow} />)}
    </Modal>
  );
}

function CandidateRow({ task, date, deficit }: { task: DayTask; date: DateKey; deficit?: number }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const target = useMemo(
    () => nearestFitDays(data, task, date, 1)[0]?.date ?? addDays(date, 1),
    [data, task, date],
  );
  const own = minutesOnStartDay(task.timing);
  const canShorten = deficit !== undefined && own - deficit >= 5;

  return (
    <div className="candidate">
      <span className="swatch" style={{ background: category(task.categoryId).color }} />
      <div className="candidate-main">
        <div>{task.title}</div>
        <div className="muted">{formatMinutes(own)} · {PRIORITY_LABEL[task.priority].toLowerCase()}</div>
      </div>
      <div className="candidate-actions">
        {canShorten && (
          <button type="button" className="chip" onClick={() => apply((d) => updateTask(d, task.id, shortenFields(task, own - deficit!), undefined, 'this'))}>
            −{formatMinutes(deficit!)}
          </button>
        )}
        <button type="button" className="chip" onClick={() => apply((d) => moveTask(d, task.id, target))}>
          → {formatDayShort(target)}
        </button>
        <button type="button" className="chip chip-danger" onClick={() => apply((d) => deleteTask(d, task.id, 'this'))}>
          Убрать
        </button>
      </div>
    </div>
  );
}
