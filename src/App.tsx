import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, formatDay, formatMinutes, todayKey } from './domain/dates';
import { computeDay, taskItems, type DayItem, type DayTask } from './domain/day';
import { useStore } from './store';
import { itemLayer } from './ui/colors';
import { Composer } from './ui/Composer';
import { OverflowModal } from './ui/Resolution';
import { RoutineModal } from './ui/RoutineModal';
import { ScopeDialog } from './ui/ScopeDialog';
import { SettingsModal } from './ui/SettingsModal';
import { TaskList } from './ui/TaskList';
import { VesselCanvas } from './ui/VesselCanvas';

type ModalKind = 'routine' | 'settings' | 'overflow' | null;

const KIND_LABEL: Partial<Record<DayItem['kind'], string>> = {
  routine: 'рутина', travel: 'дорога', prep: 'невидимое', recovery: 'невидимое', buffer: 'невидимое',
};

export function App() {
  const loaded = useStore((s) => s.loaded);
  const [modal, setModal] = useState<ModalKind>(null);
  const close = useCallback(() => setModal(null), []);

  if (!loaded) return <div className="loading">…</div>;
  return (
    <div className="app">
      <TopBar onRoutine={() => setModal('routine')} onSettings={() => setModal('settings')} />
      <DayView onOverflow={() => setModal('overflow')} onRoutine={() => setModal('routine')} overflowOpen={modal === 'overflow'} onCloseOverflow={close} />
      {modal === 'routine' && <RoutineModal onClose={close} />}
      {modal === 'settings' && <SettingsModal onClose={close} />}
      <ScopeDialog />
      <ToastView />
    </div>
  );
}

function TopBar({ onRoutine, onSettings }: { onRoutine: () => void; onSettings: () => void }) {
  const date = useStore((s) => s.date);
  const setDate = useStore((s) => s.setDate);
  const isToday = date === todayKey();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || document.querySelector('.modal')) return;
      if (e.key === 'ArrowLeft') setDate(addDays(useStore.getState().date, -1));
      if (e.key === 'ArrowRight') setDate(addDays(useStore.getState().date, 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDate]);

  return (
    <header className="topbar">
      <div className="brand"><span className="logo" />Vessel</div>
      <div className="datenav">
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день">‹</button>
        <label className="date-title">
          {formatDay(date)}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Следующий день">›</button>
        {isToday
          ? <span className="today-badge">сегодня</span>
          : <button type="button" className="chip" onClick={() => setDate(todayKey())}>К сегодня</button>}
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

  const onHover = (key: string | null, x: number, y: number) => {
    if (!key) {
      setHighlight(null);
      setTip(null);
      return;
    }
    setHighlight(key.split(':').slice(0, 2).join(':'));
    const item = plan.items.find((i) => i.key === key);
    if (item) {
      const kind = KIND_LABEL[item.kind];
      setTip({ text: `${item.title}${kind ? ` (${kind})` : ''} · ${formatMinutes(item.minutes)}`, x, y });
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
          {plan.overflow > 0
            ? <button type="button" className="stat stat-danger" onClick={onOverflow}><span>Переполнено</span><b>{formatMinutes(plan.overflow)}</b></button>
            : <Stat label="Свободно" value={plan.free} accent />}
        </div>
        <VesselCanvas
          date={date}
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
