import { todayKey } from '../domain/dates';
import { lifeStats, pluralDays, pluralYears } from '../domain/life';
import { useStore } from '../store';
import { LifeGrid } from './LifeGrid';

export function LifeView() {
  const data = useStore((s) => s.data);
  const date = useStore((s) => s.date);
  const setDate = useStore((s) => s.setDate);
  const setView = useStore((s) => s.setView);
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
    </main>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><i style={{ background: '#3A3C46' }} />прожито</span>
      <span><i style={{ background: '#55C46A' }} />сегодня</span>
      <span><i style={{ background: '#22242C', outline: '1px solid #33363f' }} />впереди</span>
      <span><i style={{ background: '#8A97FF' }} />запланировано</span>
      <span><i style={{ background: '#FF5A5F' }} />переполнено</span>
    </div>
  );
}
