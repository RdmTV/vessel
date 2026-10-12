import { useCallback, useEffect, useMemo, useState } from 'react';
import { pendingCheckIn, type PendingCheckIn } from './domain/checkin';
import { addDays, addMonths, formatDay, formatDayShort, formatMinutes, formatMonth, todayKey } from './domain/dates';
import { computeDay, taskItems, type DayItem, type DayTask } from './domain/day';
import { addYears, ageYears, pluralYears } from './domain/life';
import type { DateKey } from './domain/types';
import { weekStart } from './domain/week';
import { useStore, type StatsPeriod, type View } from './store';
import { CheckInModal } from './ui/CheckInModal';
import { itemLayer } from './ui/colors';
import { Segmented } from './ui/common';
import { Composer } from './ui/Composer';
import { LifeView } from './ui/LifeView';
import { Onboarding } from './ui/Onboarding';
import { OverflowModal } from './ui/Resolution';
import { RoutineModal } from './ui/RoutineModal';
import { ScopeDialog } from './ui/ScopeDialog';
import { SettingsModal } from './ui/SettingsModal';
import { StatsView } from './ui/StatsView';
import { TaskList } from './ui/TaskList';
import { VesselCanvas } from './ui/VesselCanvas';
import { WeekView } from './ui/WeekView';
import { YearView } from './ui/YearView';

type ModalKind = 'routine' | 'settings' | 'overflow' | null;

const KIND_LABEL: Partial<Record<DayItem['kind'], string>> = {
  routine: 'рутина', travel: 'дорога', prep: 'невидимое', recovery: 'невидимое', buffer: 'невидимое',
};

const VIEWS: { value: View; label: string }[] = [
  { value: 'life', label: 'Жизнь' },
  { value: 'year', label: 'Год' },
  { value: 'week', label: 'Неделя' },
  { value: 'day', label: 'День' },
  { value: 'stats', label: 'Итоги' },
];

/** Шаг навигации ‹ › для каждого вида. */
function shift(view: View, date: DateKey, dir: 1 | -1, period: StatsPeriod): DateKey {
  if (view === 'week' || (view === 'stats' && period === 'week')) return addDays(date, 7 * dir);
  if (view === 'stats') return addMonths(date, dir);
  if (view === 'year') return addYears(date, dir);
  return addDays(date, dir);
}

export function App() {
  const loaded = useStore((s) => s.loaded);
  const hasProfile = useStore((s) => !!s.data.profile);
  const view = useStore((s) => s.view);
  const [modal, setModal] = useState<ModalKind>(null);
  const [checkin, setCheckin] = useState<PendingCheckIn | null>(null);
  const close = useCallback(() => setModal(null), []);

  // Чек-ин — один раз при первом открытии за день.
  useEffect(() => {
    if (loaded && hasProfile) setCheckin(pendingCheckIn(useStore.getState().data, todayKey()));
  }, [loaded, hasProfile]);

  if (!loaded) return <div className="loading">…</div>;
  if (!hasProfile) return <Onboarding />;
  return (
    <div className="app">
      <TopBar onRoutine={() => setModal('routine')} onSettings={() => setModal('settings')} />
      {view === 'life' && <LifeView />}
      {view === 'year' && <YearView />}
      {view === 'week' && <WeekView />}
      {view === 'stats' && <StatsView />}
      {view === 'day' && (
        <DayView onOverflow={() => setModal('overflow')} onRoutine={() => setModal('routine')} overflowOpen={modal === 'overflow'} onCloseOverflow={close} />
      )}
      {modal === 'routine' && <RoutineModal onClose={close} />}
      {modal === 'settings' && <SettingsModal onClose={close} />}
      {checkin && !modal && <CheckInModal pending={checkin} today={todayKey()} onClose={() => setCheckin(null)} />}
      <ScopeDialog />
      <ToastView />
    </div>
  );
}

function TopBar({ onRoutine, onSettings }: { onRoutine: () => void; onSettings: () => void }) {
  const date = useStore((s) => s.date);
  const view = useStore((s) => s.view);
  const profile = useStore((s) => s.data.profile);
  const setDate = useStore((s) => s.setDate);
  const setView = useStore((s) => s.setView);
  const today = todayKey();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || document.querySelector('.modal')) return;
      const { view: v, date: d, statsPeriod: p } = useStore.getState();
      if (v === 'life') return;
      if (e.key === 'ArrowLeft') setDate(shift(v, d, -1, p));
      if (e.key === 'ArrowRight') setDate(shift(v, d, 1, p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDate]);

  const statsPeriod = useStore((s) => s.statsPeriod);
  const ws = weekStart(date);
  const weekView = view === 'week' || (view === 'stats' && statsPeriod === 'week');
  const monthView = view === 'stats' && statsPeriod === 'month';
  const title = view === 'day' ? formatDay(date)
    : weekView ? `${formatDayShort(ws)} – ${formatDayShort(addDays(ws, 6))}`
      : monthView ? formatMonth(date)
        : view === 'year' ? date.slice(0, 4)
          : profile ? `Тебе ${pluralYears(ageYears(profile.birthDate, today))}` : '';
  const isCurrent = view === 'day' ? date === today
    : weekView ? ws === weekStart(today)
      : monthView ? date.slice(0, 7) === today.slice(0, 7)
        : view === 'year' ? date.slice(0, 4) === today.slice(0, 4)
          : true;
  const currentLabel = view === 'day' ? 'сегодня' : weekView ? 'эта неделя' : monthView ? 'этот месяц' : 'этот год';

  return (
    <header className="topbar">
      <div className="brand"><span className="logo" />Vessel</div>
      <Segmented small value={view} onChange={setView} options={VIEWS} />
      <div className="datenav">
        {view !== 'life' && (
          <button type="button" className="icon-btn" onClick={() => setDate(shift(view, date, -1, statsPeriod))} aria-label="Назад">‹</button>
        )}
        <label className="date-title">
          {title}
          {view === 'day' && <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
        </label>
        {view !== 'life' && (
          <button type="button" className="icon-btn" onClick={() => setDate(shift(view, date, 1, statsPeriod))} aria-label="Вперёд">›</button>
        )}
        {view !== 'life' && (isCurrent
          ? <span className="today-badge">{currentLabel}</span>
          : <button type="button" className="chip" onClick={() => setDate(today)}>К сегодня</button>)}
      </div>
      <div className="topbar-actions">
        <button type="button" className="btn ghost" onClick={onRoutine}>Рутина</button>
        <button type="button" className="icon-btn" onClick={onSettings} aria-label="Настройки">⚙</button>
      </div>
    </header>
  );
}

function DayView({ onOverflow, onRoutine, overflowOpen, onCloseOverflow }: {
  onOverflow: () => void; onRoutine: () => void; overflowOpen: boolean; onCloseOverflow: () => void;
}) {
  const data = useStore((s) => s.data);
  const date = useStore((s) => s.date);
  const draft = useStore((s) => s.draft);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const setExpanded = useStore((s) => s.setExpandedTask);
  const [editing, setEditing] = useState<DayTask | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => setEditing(null), [date]);

  const plan = useMemo(() => computeDay(data, date), [data, date]);
  const layers = useMemo(() => plan.items.map(itemLayer), [plan]);
  const draftLayers = useMemo(
    () => (draft
      ? taskItems({ ...draft, id: 'draft', done: false }, data.settings.bufferMinutes, 'd').map((i) => ({ ...itemLayer(i), alpha: 1 }))
      : null),
    [draft, data.settings.bufferMinutes],
  );
  const labels = useMemo(() => ({
    free: plan.overflow ? '' : plan.free === 0 ? 'Сосуд полон' : `Свободно ${formatMinutes(plan.free)}`,
    overflow: plan.overflow ? `Не влезло ${formatMinutes(plan.overflow)} — нажми, чтобы разобрать` : null,
  }), [plan]);

  const sum = (pred: (i: DayItem) => boolean) => plan.items.filter(pred).reduce((s, i) => s + i.minutes, 0);
  const routineMin = sum((i) => i.kind === 'routine');
  const hiddenMin = sum((i) => ['travel', 'prep', 'recovery', 'buffer'].includes(i.kind));
  const tasksMin = sum((i) => i.kind === 'task' || i.kind === 'carry');
  const twiceMin = plan.items.reduce((s, i) => s + (i.parallel?.minutes ?? 0), 0);

  const onHover = (key: string | null, x: number, y: number) => {
    if (!key) {
      setHighlight(null);
      setTip(null);
      return;
    }
    setHighlight(key.split(':').slice(0, 2).join(':'));
    const item = plan.items.find((i) => i.key === key);
    if (item) {
      const isGoal = item.kind === 'task' && !!item.goalId;
      const kind = isGoal ? 'цель' : KIND_LABEL[item.kind];
      const twice = item.parallel ? ` ⇄ ${item.parallel.title} ${formatMinutes(item.parallel.minutes)}` : '';
      setTip({ text: `${item.title}${kind ? ` (${kind})` : ''}${twice} · ${formatMinutes(item.minutes)}`, x, y });
    }
  };

  const onLayerClick = (key: string) => {
    const [kind, id] = key.split(':');
    if (kind !== 't') return;
    setExpanded(id);
    document.querySelector(`[data-task="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <main className="day">
      <section className="vessel-pane">
        <div className="day-summary">
          <Stat label="Рутина" value={routineMin} />
          <Stat label="Дела" value={tasksMin} />
          <Stat label="Невидимое" value={hiddenMin} />
          {twiceMin > 0 && <Stat label="Дважды" value={twiceMin} />}
          {plan.overflow > 0
            ? <button type="button" className="stat stat-danger" onClick={onOverflow}><span>Переполнено</span><b>{formatMinutes(plan.overflow)}</b></button>
            : <Stat label="Свободно" value={plan.free} accent />}
        </div>
        <VesselCanvas
          sceneKey={date}
          layers={layers}
          draft={draftLayers}
          labels={labels}
          highlight={highlight}
          onHover={onHover}
          onLayerClick={onLayerClick}
          onSpillClick={onOverflow}
        />
      </section>
      <aside className="side">
        <Composer date={date} plan={plan} editing={editing} onCloseEdit={() => setEditing(null)} />
        <TaskList plan={plan} date={date} onEdit={setEditing} onOpenRoutine={onRoutine} />
      </aside>
      {tip && <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>}
      {overflowOpen && <OverflowModal plan={plan} date={date} onClose={onCloseOverflow} />}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'stat-accent' : ''}`}>
      <span>{label}</span>
      <b>{formatMinutes(value)}</b>
    </div>
  );
}

function ToastView() {
  const toast = useStore((s) => s.toast);
  const showToast = useStore((s) => s.showToast);
  if (!toast) return null;
  return (
    <div className="toast">
      <span>{toast.text}</span>
      {toast.action && (
        <button type="button" className="link" onClick={() => { toast.action!.run(); showToast(null); }}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
