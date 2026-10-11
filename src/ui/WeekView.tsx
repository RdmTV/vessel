import { useMemo, useState } from 'react';
import { category } from '../domain/categories';
import { formatDayShort, formatMinutes, todayKey } from '../domain/dates';
import { DAY_CAPACITY } from '../domain/day';
import { aggregateWeek, weekStart, type WeekGroupKind } from '../domain/week';
import { useStore } from '../store';
import { WEEK_SCALE } from '../vessel/VesselEngine';
import { weekGroupLayer } from './colors';
import { VesselCanvas } from './VesselCanvas';

const KIND_LABEL: Record<WeekGroupKind, string> = { routine: 'рутина', done: 'сделано', planned: 'запланировано' };

/** Неделя одним сосудом на 168 часов — только просмотр. */
export function WeekView() {
  const data = useStore((s) => s.data);
  const date = useStore((s) => s.date);
  const openDay = useStore((s) => s.openDay);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const start = weekStart(date);
  const today = todayKey();

  const plan = useMemo(() => aggregateWeek(data, start), [data, start]);
  const layers = useMemo(() => plan.groups.map(weekGroupLayer), [plan]);
  const labels = useMemo(() => ({
    free: plan.overflow ? '' : `Свободно за неделю ${formatMinutes(plan.free)}`,
    overflow: plan.overflow ? `Неделя переполнена на ${formatMinutes(plan.overflow)}` : null,
  }), [plan]);

  // Сводка по категориям: сколько всего недели уходит на каждую.
  const byCategory = useMemo(() => {
    const m = new Map<string, { routine: number; done: number; planned: number }>();
    for (const g of plan.groups) {
      const v = m.get(g.categoryId) ?? { routine: 0, done: 0, planned: 0 };
      v[g.kind] += g.minutes;
      m.set(g.categoryId, v);
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v, total: v.routine + v.done + v.planned }))
      .sort((a, b) => b.total - a.total);
  }, [plan]);

  return (
    <main className="day">
      <section className="vessel-pane">
        <div className="day-summary">
          <Stat label="Рутина" value={sumKind(plan, 'routine')} />
          <Stat label="Сделано" value={sumKind(plan, 'done')} />
          <Stat label="Запланировано" value={sumKind(plan, 'planned')} />
          <Stat label="Свободно" value={plan.free} accent />
        </div>
        <VesselCanvas
          sceneKey={`week:${start}`}
          layers={layers}
          labels={labels}
          highlight={highlight}
          scale={WEEK_SCALE}
          onHover={(key, x, y) => {
            setHighlight(key);
            const g = key ? plan.groups.find((x) => x.key === key) : null;
            setTip(g ? { text: `${category(g.categoryId).name} (${KIND_LABEL[g.kind]}) · ${formatMinutes(g.minutes)}`, x, y } : null);
          }}
        />
      </section>
      <aside className="side">
        <div className="group">
          <div className="group-head"><span>Дни</span><span className="muted">нажми, чтобы открыть</span></div>
          {plan.days.map((d) => {
            let routine = 0;
            for (const i of d.items) if (i.kind === 'routine') routine += i.minutes;
            const planned = d.total - routine;
            return (
              <button key={d.date} type="button" className={`week-day ${d.date === today ? 'is-today' : ''}`} onClick={() => openDay(d.date)}>
                <span className="week-day-name">{formatDayShort(d.date)}</span>
                <span className="week-bar">
                  <i className="fill-routine" style={{ width: `${(Math.min(routine, DAY_CAPACITY) / DAY_CAPACITY) * 100}%` }} />
                  <i className="fill-planned" style={{ width: `${(Math.min(planned, DAY_CAPACITY - Math.min(routine, DAY_CAPACITY)) / DAY_CAPACITY) * 100}%` }} />
                </span>
                <span className={d.overflow ? 'danger' : 'muted'}>
                  {d.overflow ? `+${formatMinutes(d.overflow)}` : `своб. ${formatMinutes(d.free)}`}
                </span>
              </button>
            );
          })}
        </div>
        <div className="group">
          <div className="group-head"><span>Куда уходит неделя</span></div>
          {byCategory.map((c) => (
            <div key={c.id} className="cat-row">
              <span className="swatch" style={{ background: category(c.id).color }} />
              <span className="cat-name">{category(c.id).name}</span>
              <span className="cat-bar"><i style={{ width: `${(c.total / plan.total) * 100}%`, background: category(c.id).color }} /></span>
              <span className="cat-total">{formatMinutes(c.total)}</span>
            </div>
          ))}
        </div>
      </aside>
      {tip && <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>}
    </main>
  );
}

function sumKind(plan: ReturnType<typeof aggregateWeek>, kind: WeekGroupKind): number {
  return plan.groups.filter((g) => g.kind === kind).reduce((s, g) => s + g.minutes, 0);
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'stat-accent' : ''}`}>
      <span>{label}</span>
      <b>{formatMinutes(value)}</b>
    </div>
  );
}
