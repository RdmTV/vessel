import { useMemo, useState } from 'react';
import { category } from '../domain/categories';
import { formatDayShort, formatMinutes, fromKey } from '../domain/dates';
import { goalsOf, goalStats } from '../domain/goals';
import { LOAD_LABEL, periodRange, periodStats, type LoadClass } from '../domain/stats';
import type { GoalProgress } from '../domain/types';
import { useStore } from '../store';
import { Segmented } from './common';

/** Цвета загрузки дня — статусные, всегда вместе с подписью. */
const LOAD_COLOR: Record<LoadClass, string> = {
  free: '#55C46A',
  normal: '#6F7896',
  tight: '#E2A33C',
  over: '#FF5A5F',
};
const LOAD_ORDER: LoadClass[] = ['free', 'normal', 'tight', 'over'];

const DONE = '#8A97FF';
const PLANNED = '#454D7E';
const ROUTINE = '#34374A';
const TWICE = '#D2B4FF';

export function StatsView() {
  const data = useStore((s) => s.data);
  const date = useStore((s) => s.date);
  const period = useStore((s) => s.statsPeriod);
  const setPeriod = useStore((s) => s.setStatsPeriod);
  const openDay = useStore((s) => s.openDay);
  const [withRoutine, setWithRoutine] = useState(false);

  const [from, to] = periodRange(date, period);
  const st = useMemo(() => periodStats(data, from, to), [data, from, to]);
  const days = st.days.length;

  const catTotal = (c: (typeof st.byCategory)[number]) => c.done + c.planned + c.parallel + (withRoutine ? c.routine : 0);
  const catMax = Math.max(1, ...st.byCategory.map(catTotal));
  const cats = st.byCategory.filter((c) => catTotal(c) > 0);
  const donePct = st.tasks.count ? Math.round((st.tasks.doneCount / st.tasks.count) * 100) : null;

  const goals = goalsOf(data).filter((g) => g.start <= to && g.end >= from);

  return (
    <main className="page stats">
      <div className="stats-head">
        <Segmented
          small
          value={period}
          onChange={setPeriod}
          options={[{ value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }]}
        />
        <span className="muted">{formatDayShort(from)} – {formatDayShort(to)} · {days} дн.</span>
      </div>

      <div className="tiles">
        <Tile label="Свободно за период" value={formatMinutes(st.freeTotal)} sub={`≈ ${formatMinutes(st.freeTotal / days)} в день`} />
        <Tile
          label="Выполнено задач"
          value={donePct === null ? '—' : `${donePct}%`}
          sub={st.tasks.count ? `${st.tasks.doneCount} из ${st.tasks.count} · ${formatMinutes(st.tasks.doneMinutes)} из ${formatMinutes(st.tasks.minutes)}` : 'задач не было'}
        />
        <Tile
          label="Оценка дней"
          value={st.ratingAvg === null ? '—' : st.ratingAvg.toFixed(1)}
          sub={st.checkinCount ? `чек-инов: ${st.checkinCount}` : 'чек-инов не было'}
        />
        <Tile label="Переполнено дней" value={String(st.classes.over)} sub={st.classes.over ? 'что-то выпало из сосуда' : 'всё влезало'} danger={st.classes.over > 0} />
        <Tile
          label="Прожито дважды"
          value={formatMinutes(st.twiceTotal)}
          sub={st.twiceTotal ? 'параллельные дела — сверх 24 часов' : 'совмести что-нибудь: подкаст в дороге'}
        />
      </div>

      <section className="card">
        <h3>Дни по загрузке <span className="muted">— по свободному времени</span></h3>
        <div className="load-counts">
          {LOAD_ORDER.map((c) => (
            <div key={c} className="load-count">
              <i style={{ background: LOAD_COLOR[c] }} />
              <span>{LOAD_LABEL[c]}</span>
              <b>{st.classes[c]}</b>
              <small className="muted">{c === 'free' ? '> 4ч' : c === 'normal' ? '1–4ч' : c === 'tight' ? '< 1ч' : 'не влезло'}</small>
            </div>
          ))}
        </div>
        <div className={`day-strip ${period}`}>
          {st.days.map((d) => (
            <button
              key={d.date}
              type="button"
              className="strip-day"
              style={{ background: LOAD_COLOR[d.cls] }}
              title={`${formatDayShort(d.date)} — ${LOAD_LABEL[d.cls].toLowerCase()}: ${d.plan.overflow ? `не влезло ${formatMinutes(d.plan.overflow)}` : `свободно ${formatMinutes(d.plan.free)}`}`}
              onClick={() => openDay(d.date)}
            >
              {fromKey(d.date).getDate()}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Куда ушло время</h3>
          <label className="check-label">
            <input type="checkbox" checked={withRoutine} onChange={(e) => setWithRoutine(e.target.checked)} />
            с рутиной
          </label>
        </div>
        <div className="legend legend-inline">
          <span><i style={{ background: DONE }} />сделано</span>
          <span><i style={{ background: PLANNED }} />запланировано</span>
          <span><i style={{ background: TWICE }} />параллельно</span>
          {withRoutine && <span><i style={{ background: ROUTINE }} />рутина</span>}
        </div>
        {cats.length === 0 && <p className="muted">Пока ничего не запланировано.</p>}
        {cats.map((c) => {
          const segs = [
            { v: c.done, color: DONE, label: 'сделано' },
            { v: c.planned, color: PLANNED, label: 'запланировано' },
            { v: c.parallel, color: TWICE, label: 'параллельно' },
            ...(withRoutine ? [{ v: c.routine, color: ROUTINE, label: 'рутина' }] : []),
          ].filter((s) => s.v > 0);
          const total = segs.reduce((s, x) => s + x.v, 0);
          return (
            <div key={c.categoryId} className="hbar-row">
              <span className="hbar-name"><i style={{ background: category(c.categoryId).color }} />{category(c.categoryId).name}</span>
              <span className="hbar-track">
                {segs.map((s) => (
                  <i
                    key={s.label}
                    style={{ width: `${(s.v / catMax) * 100}%`, background: s.color }}
                    title={`${category(c.categoryId).name}, ${s.label}: ${formatMinutes(s.v)}`}
                  />
                ))}
              </span>
              <span className="hbar-value">
                {formatMinutes(total)}
                {c.done > 0 && c.planned > 0 && <small className="muted"> · сделано {formatMinutes(c.done)}</small>}
              </span>
            </div>
          );
        })}
      </section>

      {goals.length > 0 && (
        <section className="card">
          <h3>Цели</h3>
          {goals.map((g) => {
            const gs = goalStats(data, g, from, to);
            const marks = countProgress(data.checkins ?? {}, g.id, from, to);
            return (
              <div key={g.id} className="goal-stat">
                <span className="hbar-name"><i style={{ background: g.color }} />{g.title}</span>
                <span className="hbar-track">
                  {gs.done > 0 && <i style={{ width: `${(gs.done / Math.max(gs.planned, 1)) * 100}%`, background: DONE }} title={`Сделано ${formatMinutes(gs.done)}`} />}
                  {gs.planned - gs.done > 0 && <i style={{ width: `${((gs.planned - gs.done) / Math.max(gs.planned, 1)) * 100}%`, background: PLANNED }} title={`Осталось ${formatMinutes(gs.planned - gs.done)}`} />}
                </span>
                <span className="hbar-value">
                  {formatMinutes(gs.done)} из {formatMinutes(gs.planned)}
                  {(marks.yes + marks.little + marks.no) > 0 && (
                    <small className="muted"> · продвинулся {marks.yes}, чуть-чуть {marks.little}, нет {marks.no}</small>
                  )}
                </span>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

function countProgress(checkins: Record<string, { goals: Record<string, GoalProgress> }>, goalId: string, from: string, to: string) {
  const r = { yes: 0, little: 0, no: 0 };
  for (const [d, c] of Object.entries(checkins)) {
    if (d < from || d > to) continue;
    const p = c.goals[goalId];
    if (p) r[p]++;
  }
  return r;
}

function Tile({ label, value, sub, danger }: { label: string; value: string; sub: string; danger?: boolean }) {
  return (
    <div className={`tile ${danger ? 'tile-danger' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}
