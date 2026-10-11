import { useMemo, useState } from 'react';
import { addDays, formatDayShort, formatMinutes, todayKey } from '../domain/dates';
import { goalsOf, goalStats, goalStreak } from '../domain/goals';
import { lifeStats, pluralDays, pluralYears } from '../domain/life';
import type { Goal } from '../domain/types';
import { useStore } from '../store';
import { GoalModal } from './GoalModal';
import { LifeGrid } from './LifeGrid';

export function LifeView() {
  const data = useStore((s) => s.data);
  const date = useStore((s) => s.date);
  const setDate = useStore((s) => s.setDate);
  const setView = useStore((s) => s.setView);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const profile = data.profile!;
  const today = todayKey();
  const s = lifeStats(profile, today);

  return (
    <main className="page">
      <div className="life-head">
        <div className="life-stat">
          <span>Прожито</span>
          <b>{pluralDays(s.lived)}</b>
        </div>
        <div className="life-stat life-stat-accent">
          <span>Осталось</span>
          <b>{pluralDays(s.left)}</b>
        </div>
        <div className="life-stat">
          <span>Это примерно</span>
          <b>{Math.round(s.left / 7).toLocaleString('ru-RU')} недель</b>
        </div>
        <div className="life-progress" title={`${Math.round(s.share * 100)}% из ${pluralYears(profile.lifeYears)}`}>
          <i style={{ width: `${s.share * 100}%` }} />
        </div>
      </div>

      <GoalsBar onOpen={setEditing} />

      <LifeGrid
        data={data}
        profile={profile}
        today={today}
        selected={date}
        onPick={(d) => {
          setDate(d);
          setView('year');
        }}
      />
      <Legend />
      {editing && <GoalModal goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

/** Цели над сеткой: срок, часы «сделано / запланировано», серия дней с прогрессом. */
export function GoalsBar({ onOpen }: { onOpen: (g: Goal | 'new') => void }) {
  const data = useStore((s) => s.data);
  const today = todayKey();
  const goals = goalsOf(data);
  const stats = useMemo(
    () => new Map(goals.map((g) => [g.id, goalStats(data, g)])),
    [data, goals],
  );

  return (
    <div className="goals-bar">
      {goals.map((g) => {
        const st = stats.get(g.id)!;
        const streak = goalStreak(data, g.id, addDays(today, -1));
        const past = g.end < today;
        return (
          <button key={g.id} type="button" className={`goal-chip ${past ? 'past' : ''}`} onClick={() => onOpen(g)}>
            <i style={{ background: g.color }} />
            <span className="goal-title">{g.title}</span>
            <span className="goal-meta">
              {goalDate(g.start, today)} – {goalDate(g.end, today)}
              {st.planned > 0 && <> · {formatMinutes(st.done)} из {formatMinutes(st.planned)}</>}
              {streak > 1 && <> · серия {streak} дн.</>}
            </span>
          </button>
        );
      })}
      <button type="button" className="goal-chip goal-add" onClick={() => onOpen('new')}>+ Цель</button>
    </div>
  );
}

/** «12.10» в текущем году, «11.01.2027» — в другом. */
function goalDate(key: string, today: string): string {
  const short = formatDayShort(key).split(' ')[1];
  return key.slice(0, 4) === today.slice(0, 4) ? short : `${short}.${key.slice(0, 4)}`;
}

export function Legend() {
  return (
    <div className="legend">
      <span><i style={{ background: '#575A66' }} />прожито</span>
      <span><i style={{ background: '#55C46A' }} />сегодня</span>
      <span><i style={{ background: '#22242C', outline: '1px solid #33363f' }} />впереди</span>
      <span><i style={{ background: '#8A97FF' }} />запланировано</span>
      <span><i style={{ background: '#FF5A5F' }} />переполнено</span>
      <span><i style={{ background: 'linear-gradient(90deg, #D9605F, #D8C152, #55C46A)' }} />оценка дня (чек-ин)</span>
    </div>
  );
}
