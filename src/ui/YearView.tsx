import { useMemo, useState } from 'react';
import { RATING_COLORS } from '../domain/checkin';
import { formatMinutes, toKey, todayKey, weekday } from '../domain/dates';
import { DAY_CAPACITY, dayLoad, type DayLoad } from '../domain/day';
import { goalsOf } from '../domain/goals';
import { lifeEnd } from '../domain/life';
import type { DateKey, Goal } from '../domain/types';
import { useStore } from '../store';
import { GoalModal } from './GoalModal';
import { GoalsBar, Legend } from './LifeView';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function YearView() {
  const data = useStore((s) => s.data);
  const date = useStore((s) => s.date);
  const openDay = useStore((s) => s.openDay);
  const year = Number(date.slice(0, 4));
  const today = todayKey();
  const profile = data.profile;
  const end = profile ? lifeEnd(profile) : null;
  const goals = goalsOf(data);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);

  const loads = useMemo(() => {
    const m = new Map<DateKey, DayLoad>();
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
      const key = toKey(d);
      m.set(key, dayLoad(data, key));
    }
    return m;
  }, [data, year]);

  return (
    <main className="page">
      <GoalsBar onOpen={setEditing} />
      {editing && <GoalModal goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <div className="year-grid">
        {MONTHS.map((name, m) => {
          const first = toKey(new Date(year, m, 1));
          const days = new Date(year, m + 1, 0).getDate();
          return (
            <section key={m} className="month">
              <h3>{name}</h3>
              <div className="month-grid">
                {WD.map((w) => <span key={w} className="wd">{w}</span>)}
                {Array.from({ length: weekday(first) }, (_, i) => <span key={`e${i}`} />)}
                {Array.from({ length: days }, (_, i) => {
                  const key = toKey(new Date(year, m, i + 1));
                  const outside = !!profile && (key < profile.birthDate || (end !== null && key > end));
                  return (
                    <DayCell
                      key={key}
                      day={i + 1}
                      date={key}
                      load={loads.get(key)!}
                      today={today}
                      selected={key === date}
                      outside={outside}
                      goals={goals.filter((g) => g.start <= key && key <= g.end)}
                      rating={data.checkins?.[key]?.rating}
                      onClick={() => openDay(key)}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <Legend />
    </main>
  );
}

/**
 * Клетка-день — маленький сосуд: бледное основание рутины, яркое запланированное.
 * Под клеткой — полоски целей, в углу — точка оценки дня из чек-ина.
 */
function DayCell({ day, date, load, today, selected, outside, goals, rating, onClick }: {
  day: number; date: DateKey; load: DayLoad; today: DateKey; selected: boolean; outside: boolean;
  goals: Goal[]; rating?: number; onClick: () => void;
}) {
  const stripes = goals.slice(0, 3).map((g, i) => `0 ${3 + i * 3}px 0 -0.5px ${g.color}`);
  // рамки «выбран» / «сегодня» тоже box-shadow — объединяем, чтобы полоски их не затёрли
  if (stripes.length && selected) stripes.unshift('0 0 0 2px #fff');
  else if (stripes.length && date === today) stripes.unshift('0 0 0 1px var(--ok)');
  const routine = Math.min(load.routine, DAY_CAPACITY) / DAY_CAPACITY;
  const planned = Math.min(load.planned, DAY_CAPACITY - Math.min(load.routine, DAY_CAPACITY)) / DAY_CAPACITY;
  const cls = [
    'yday',
    date < today && 'past',
    date === today && 'today',
    selected && 'selected',
    load.overflow > 0 && 'over',
    outside && 'outside',
  ].filter(Boolean).join(' ');
  let title = load.overflow
    ? `Переполнен на ${formatMinutes(load.overflow)}`
    : `Рутина ${formatMinutes(load.routine)} · запланировано ${formatMinutes(load.planned)} · свободно ${formatMinutes(Math.max(0, DAY_CAPACITY - load.total))}`;
  if (goals.length) title += `\nЦели: ${goals.map((g) => g.title).join(', ')}`;
  if (rating) title += `\nОценка дня: ${rating}/5`;
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={title}
      disabled={outside}
      style={stripes.length ? { boxShadow: stripes.join(', '), marginBottom: stripes.length * 3 } : undefined}
    >
      <i className="fill-routine" style={{ height: `${routine * 100}%` }} />
      <i className="fill-planned" style={{ height: `${planned * 100}%`, bottom: `${routine * 100}%` }} />
      <span>{day}</span>
      {rating && <b className="rating-dot" style={{ background: RATING_COLORS[rating - 1] }} />}
    </button>
  );
}
