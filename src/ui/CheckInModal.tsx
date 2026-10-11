import { useState } from 'react';
import { category } from '../domain/categories';
import { RATING_COLORS, saveCheckIn, skipCheckIn, type PendingCheckIn } from '../domain/checkin';
import { formatDay, formatDayShort, formatMinutes } from '../domain/dates';
import { timingMinutes } from '../domain/day';
import { moveTask } from '../domain/mutations';
import type { DateKey, GoalProgress } from '../domain/types';
import { useStore } from '../store';
import { Modal, Segmented } from './common';

const RATING_HINT = ['плохо', 'так себе', 'нормально', 'хорошо', 'отлично'];
const PROGRESS: { value: GoalProgress; label: string }[] = [
  { value: 'yes', label: 'Продвинулся' },
  { value: 'little', label: 'Чуть-чуть' },
  { value: 'no', label: 'Нет' },
];

/** Утренний вопрос про вчера: прогресс по целям, оценка дня, перенос невыполненного. */
export function CheckInModal({ pending, today, onClose }: { pending: PendingCheckIn; today: DateKey; onClose: () => void }) {
  const apply = useStore((s) => s.apply);
  const showToast = useStore((s) => s.showToast);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [goals, setGoals] = useState<Record<string, GoalProgress>>({});
  // Повторяющиеся по умолчанию не переносим — они и так будут сегодня.
  const [move, setMove] = useState<Set<string>>(() => new Set(pending.undone.filter((t) => !t.seriesId).map((t) => t.id)));

  const toggleMove = (id: string) => setMove((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const skip = () => {
    apply((d) => skipCheckIn(d, today));
    onClose();
  };

  const save = () => {
    if (!rating) return;
    apply((d) => {
      let next = saveCheckIn(d, { date: pending.date, rating, note: note.trim() || undefined, goals }, today);
      for (const id of move) next = moveTask(next, id, today);
      return next;
    });
    if (move.size) showToast({ text: `Перенесено на сегодня: ${move.size}` });
    onClose();
  };

  return (
    <Modal title="Как прошёл вчерашний день?" onClose={skip}>
      <div className="checkin">
        <p className="muted">{formatDay(pending.date)}</p>

        <div className="field">
          <span className="label">Оценка дня</span>
          <div className="rating">
            {RATING_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`rating-btn ${rating === i + 1 ? 'on' : ''}`}
                onClick={() => setRating(i + 1)}
              >
                <i style={{ background: c }} />
                <b>{i + 1}</b>
                <small>{RATING_HINT[i]}</small>
              </button>
            ))}
          </div>
        </div>

        {pending.goals.length > 0 && (
          <div className="field">
            <span className="label">Цели</span>
            {pending.goals.map((g) => (
              <div key={g.id} className="checkin-goal">
                <span><i style={{ background: g.color }} />{g.title}</span>
                <Segmented
                  small
                  value={goals[g.id] ?? ('' as GoalProgress)}
                  onChange={(v) => setGoals((s) => ({ ...s, [g.id]: v }))}
                  options={PROGRESS}
                />
              </div>
            ))}
          </div>
        )}

        <textarea
          className="note"
          rows={2}
          placeholder="Заметка — по желанию"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {pending.undone.length > 0 && (
          <div className="field">
            <span className="label">Не сделано — отметь, что перенести на сегодня</span>
            <div className="undone-list">
              {pending.undone.map((t) => (
                <label key={t.id} className="undone">
                  <input type="checkbox" checked={move.has(t.id)} onChange={() => toggleMove(t.id)} />
                  <span className="swatch" style={{ background: category(t.categoryId).color }} />
                  <span className="undone-title">{t.title}{t.seriesId ? ' ↻' : ''}</span>
                  <span className="muted small">{formatDayShort(t.date)} · {formatMinutes(timingMinutes(t.timing))}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="composer-actions">
          <button type="button" className="btn ghost" onClick={skip}>Пропустить</button>
          <button type="button" className="btn primary" disabled={!rating} onClick={save}>
            {rating ? (move.size ? `Сохранить и перенести (${move.size})` : 'Сохранить') : 'Поставь оценку'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
