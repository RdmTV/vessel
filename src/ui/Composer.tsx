import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { category, DEFAULT_PREP_MINUTES, PICKABLE_CATEGORIES } from '../domain/categories';
import { formatClock, formatDayShort, formatMinutes, parseClock, weekday } from '../domain/dates';
import {
  DAY_CAPACITY, draftMinutes, intervalLength, PRIORITY_LABEL, type DayPlan, type DayTask,
} from '../domain/day';
import { goalsOf } from '../domain/goals';
import { uid } from '../domain/id';
import { addTask, updateTask, type EditScope } from '../domain/mutations';
import type {
  Attachment, DateKey, Location, Priority, RecurrenceRule, Subtask, TaskFields,
} from '../domain/types';
import { useStore } from '../store';
import { DurationPicker, Segmented, WeekdayPicker } from './common';
import { DraftResolution } from './Resolution';

type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'everyN' | 'monthly';

interface Form {
  title: string;
  categoryId: string;
  timingKind: 'duration' | 'interval';
  duration: number;
  start: string;
  end: string;
  location: Location;
  locationTouched: boolean;
  /** null — ещё не ответили на вопрос про дорогу; 0 — не нужна. */
  travel: number | null;
  prepOn: boolean;
  prepMin: number;
  recOn: boolean;
  recMin: number;
  priority: Priority;
  subtasks: Subtask[];
  repeat: Repeat;
  weekdays: number[];
  everyN: number;
  /** '' — без цели. */
  goalId: string;
}

const TRAVEL_QUICK = [15, 30, 45, 60, 90];

function categoryDefaults(categoryId: string) {
  const c = category(categoryId);
  return {
    prepOn: true,
    prepMin: c.prepMinutes ?? DEFAULT_PREP_MINUTES,
    recOn: !!c.recovery,
    recMin: c.recovery?.minutes ?? 0,
  };
}

function blankForm(date: DateKey): Form {
  return {
    title: '', categoryId: 'chores', timingKind: 'duration', duration: 60,
    start: '19:00', end: '20:00', location: 'home', locationTouched: false, travel: null,
    ...categoryDefaults('chores'),
    priority: 'medium', subtasks: [], repeat: 'none', weekdays: [weekday(date)], everyN: 2, goalId: '',
  };
}

function formFromTask(t: DayTask, rule: RecurrenceRule | null): Form {
  const att = (k: Attachment['kind']) => t.attachments.find((a) => a.kind === k);
  const defaults = categoryDefaults(t.categoryId);
  const repeat: Repeat = !rule ? 'none'
    : rule.freq === 'weekly' && rule.weekdays.join() === '0,1,2,3,4' ? 'weekdays'
      : rule.freq;
  return {
    title: t.title,
    categoryId: t.categoryId,
    timingKind: t.timing.kind,
    duration: t.timing.kind === 'duration' ? t.timing.minutes : 60,
    start: t.timing.kind === 'interval' ? formatClock(t.timing.start) : '19:00',
    end: t.timing.kind === 'interval' ? formatClock(t.timing.end) : '20:00',
    location: t.location,
    locationTouched: true,
    travel: t.location === 'out' ? att('travel')?.minutes ?? 0 : null,
    prepOn: !!att('prep') || t.location !== 'out',
    prepMin: att('prep')?.minutes ?? defaults.prepMin,
    recOn: !!att('recovery'),
    recMin: att('recovery')?.minutes ?? defaults.recMin,
    priority: t.priority,
    subtasks: structuredClone(t.subtasks),
    repeat,
    weekdays: rule?.freq === 'weekly' ? rule.weekdays : [weekday(t.date)],
    everyN: rule?.freq === 'everyN' ? rule.interval : 2,
    goalId: t.goalId ?? '',
  };
}

function buildFields(f: Form): TaskFields | null {
  const c = category(f.categoryId);
  let timing: TaskFields['timing'];
  if (f.timingKind === 'duration') {
    timing = { kind: 'duration', minutes: f.duration };
  } else {
    const start = parseClock(f.start);
    const end = parseClock(f.end);
    if (start === null || end === null || intervalLength(start, end) === 0) return null;
    timing = { kind: 'interval', start, end };
  }
  const attachments: Attachment[] = [];
  if (f.location === 'out') {
    if (f.travel) attachments.push({ kind: 'travel', label: 'Дорога', minutes: f.travel });
    if (f.prepOn && f.prepMin > 0) attachments.push({ kind: 'prep', label: 'Сборы', minutes: f.prepMin });
  }
  if (c.recovery && f.recOn && f.recMin > 0) {
    attachments.push({ kind: 'recovery', label: c.recovery.label, minutes: f.recMin });
  }
  const fields: TaskFields = {
    title: f.title.trim(), categoryId: f.categoryId, timing, priority: f.priority,
    location: f.location, attachments, subtasks: f.subtasks,
  };
  if (f.goalId) fields.goalId = f.goalId;
  return fields;
}

function buildRule(f: Form): RecurrenceRule | null {
  switch (f.repeat) {
    case 'none': return null;
    case 'daily': return { freq: 'daily' };
    case 'weekdays': return { freq: 'weekly', weekdays: [0, 1, 2, 3, 4] };
    case 'weekly': return f.weekdays.length ? { freq: 'weekly', weekdays: f.weekdays } : null;
    case 'everyN': return { freq: 'everyN', interval: Math.max(1, f.everyN) };
    case 'monthly': return { freq: 'monthly' };
  }
}

interface Props {
  date: DateKey;
  plan: DayPlan;
  editing: DayTask | null;
  onCloseEdit: () => void;
}

export function Composer({ date, plan, editing, onCloseEdit }: Props) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const setDraft = useStore((s) => s.setDraft);
  const showToast = useStore((s) => s.showToast);
  const setDate = useStore((s) => s.setDate);
  const askScope = useStore((s) => s.askScope);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => blankForm(date));
  const [subInput, setSubInput] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Режим правки существующей задачи.
  useEffect(() => {
    if (!editing) return;
    const rule = editing.seriesId ? data.series.find((s) => s.id === editing.seriesId)?.rule ?? null : null;
    setForm(formFromTask(editing, rule));
    setOpen(true);
    titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const cat = category(form.categoryId);
  // Цели, которые идут в этот день, — первыми; уже привязанная остаётся в списке, даже если закончилась.
  const goals = goalsOf(data).filter((g) => (g.start <= date && date <= g.end) || g.id === form.goalId);
  const fields = useMemo(() => buildFields(form), [form]);
  const rule = buildRule(form);
  const need = fields ? draftMinutes(fields, data.settings.bufferMinutes) : 0;
  const isNew = !editing;
  const deficit = plan.total + need - DAY_CAPACITY;
  const fits = deficit <= 0;
  const travelMissing = form.location === 'out' && form.travel === null;
  const hasTitle = form.title.trim().length > 0;

  // Призрачный контур черновика в сосуде.
  useEffect(() => {
    setDraft(isNew && open && hasTitle && fields ? fields : null);
  }, [isNew, open, hasTitle, fields, setDraft]);
  useEffect(() => () => setDraft(null), [setDraft]);

  const reset = (keepOpen: boolean) => {
    setForm(blankForm(date));
    setSubInput('');
    setOpen(keepOpen);
    if (keepOpen) setTimeout(() => titleRef.current?.focus(), 0);
  };

  const cancel = () => {
    if (editing) onCloseEdit();
    reset(false);
  };

  const accept = (target: DateKey = date) => {
    if (!fields || !hasTitle || travelMissing) return;
    apply((d) => addTask(d, fields, target, rule));
    if (target !== date) {
      showToast({
        text: `«${fields.title}» запланировано на ${formatDayShort(target)}`,
        action: { label: 'Открыть день', run: () => setDate(target) },
      });
    }
    reset(true);
  };

  const save = async () => {
    if (!editing || !fields || !hasTitle || travelMissing) return;
    let scope: EditScope = 'this';
    if (editing.seriesId) {
      const s = await askScope('Изменить повторяющуюся задачу');
      if (!s) return;
      scope = s;
    }
    apply((d) => updateTask(d, editing.id, fields, rule, scope));
    onCloseEdit();
    reset(false);
  };

  const setCategory = (id: string) => {
    const c = category(id);
    setForm((f) => ({
      ...f,
      categoryId: id,
      ...categoryDefaults(id),
      location: f.locationTouched ? f.location : c.defaultLocation,
      travel: (f.locationTouched ? f.location : c.defaultLocation) === 'out' ? f.travel : null,
    }));
  };

  const shortenTo = (minutes: number) => {
    const m = Math.max(5, Math.floor(minutes / 5) * 5);
    if (form.timingKind === 'duration') set({ duration: m });
    else {
      const start = parseClock(form.start) ?? 0;
      set({ end: formatClock(start + m) });
    }
  };

  const addSubtask = () => {
    const title = subInput.trim();
    if (!title) return;
    set({ subtasks: [...form.subtasks, { id: uid(), title, done: false }] });
    setSubInput('');
  };

  if (!open) {
    return (
      <div className="composer composer-closed">
        <input
          ref={titleRef}
          className="composer-title"
          placeholder="Что планируешь? Например: зал"
          value={form.title}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            set({ title: e.target.value });
            setOpen(true);
          }}
        />
      </div>
    );
  }

  const blockedReason = !hasTitle ? 'Назови задачу'
    : !fields ? 'Проверь время'
      : travelMissing ? 'Укажи дорогу'
        : isNew && !fits ? 'Не влезает'
          : null;

  return (
    <div className={`composer ${isNew && hasTitle && !fits ? 'composer-blocked' : ''}`}>
      <div className="composer-top">
        <input
          ref={titleRef}
          className="composer-title"
          placeholder="Что планируешь?"
          value={form.title}
          autoFocus
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !blockedReason) (isNew ? accept() : save());
            if (e.key === 'Escape') cancel();
          }}
        />
        {editing && <span className="badge">правка</span>}
      </div>

      <div className="field">
        <div className="chips">
          {PICKABLE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip chip-cat ${c.id === form.categoryId ? 'on' : ''}`}
              style={{ '--cat': c.color } as CSSProperties}
              onClick={() => setCategory(c.id)}
            >
              <i />{c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <Segmented
          small
          value={form.timingKind}
          onChange={(v) => set({ timingKind: v })}
          options={[{ value: 'duration', label: 'Длительность' }, { value: 'interval', label: 'С — до' }]}
        />
        {form.timingKind === 'duration' ? (
          <DurationPicker value={form.duration} onChange={(m) => set({ duration: m })} />
        ) : (
          <div className="interval">
            <input type="time" value={form.start} onChange={(e) => set({ start: e.target.value })} />
            <span>—</span>
            <input type="time" value={form.end} onChange={(e) => set({ end: e.target.value })} />
            {fields?.timing.kind === 'interval' && (
              <span className="muted">
                {formatMinutes(intervalLength(fields.timing.start, fields.timing.end))}
                {fields.timing.end < fields.timing.start && fields.timing.end > 0 ? ' · через полночь' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="field">
        <Segmented
          small
          value={form.location}
          onChange={(v) => set({ location: v, locationTouched: true })}
          options={[{ value: 'home', label: 'Дома' }, { value: 'out', label: 'Вне дома' }]}
        />
      </div>

      {form.location === 'out' && (
        <div className={`ask ${form.travel === null ? 'ask-pending' : ''}`}>
          <div className="ask-q">Сколько на дорогу — туда и обратно?</div>
          <div className="chips">
            {TRAVEL_QUICK.map((m) => (
              <button key={m} type="button" className={`chip ${form.travel === m ? 'on' : ''}`} onClick={() => set({ travel: m })}>
                {formatMinutes(m)}
              </button>
            ))}
            <button type="button" className={`chip ${form.travel === 0 ? 'on' : ''}`} onClick={() => set({ travel: 0 })}>
              Не нужно
            </button>
          </div>
          {form.travel !== null && form.travel > 0 && !TRAVEL_QUICK.includes(form.travel) && (
            <div className="muted">{formatMinutes(form.travel)}</div>
          )}
        </div>
      )}

      {(form.location === 'out' || cat.recovery) && (
        <div className="hidden-costs">
          <div className="hidden-costs-title">Невидимое время <span className="muted">— обычно его не учитывают</span></div>
          {form.location === 'out' && (
            <HiddenToggle
              label="Сборы перед выходом" on={form.prepOn} minutes={form.prepMin}
              onToggle={() => set({ prepOn: !form.prepOn })} onMinutes={(m) => set({ prepMin: m })}
            />
          )}
          {cat.recovery && (
            <HiddenToggle
              label={`${cat.recovery.label} после`} on={form.recOn} minutes={form.recMin}
              onToggle={() => set({ recOn: !form.recOn })} onMinutes={(m) => set({ recMin: m })}
            />
          )}
        </div>
      )}

      <div className="field field-row">
        <span className="label">Приоритет</span>
        <Segmented
          small
          value={form.priority}
          onChange={(v) => set({ priority: v })}
          options={(['low', 'medium', 'high'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        />
      </div>

      {goals.length > 0 && (
        <div className="field field-row">
          <span className="label">Цель</span>
          <select value={form.goalId} onChange={(e) => set({ goalId: e.target.value })}>
            <option value="">Без цели</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
      )}

      <div className="field field-row">
        <span className="label">Повтор</span>
        <select value={form.repeat} onChange={(e) => set({ repeat: e.target.value as Repeat })}>
          <option value="none">Не повторять</option>
          <option value="daily">Каждый день</option>
          <option value="weekdays">По будням</option>
          <option value="weekly">По дням недели…</option>
          <option value="everyN">Каждые N дней…</option>
          <option value="monthly">Раз в месяц</option>
        </select>
        {form.repeat === 'everyN' && (
          <input
            type="number" min={1} max={60} className="num" value={form.everyN}
            onChange={(e) => set({ everyN: Number(e.target.value) || 1 })}
          />
        )}
      </div>
      {form.repeat === 'weekly' && (
        <div className="field"><WeekdayPicker value={form.weekdays} onChange={(v) => set({ weekdays: v })} /></div>
      )}

      <div className="field">
        <span className="label">Подпункты</span>
        {form.subtasks.map((s) => (
          <div key={s.id} className="subtask-edit">
            <span>• {s.title}</span>
            <button type="button" className="icon-btn" onClick={() => set({ subtasks: form.subtasks.filter((x) => x.id !== s.id) })}>✕</button>
          </div>
        ))}
        <input
          className="sub-input"
          placeholder="+ подпункт (Enter)"
          value={subInput}
          onChange={(e) => setSubInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addSubtask();
            }
          }}
        />
      </div>

      {fields && (
        <div className="composer-summary">
          Займёт <b>{formatMinutes(need)}</b>
          {fields.attachments.length > 0 && (
            <span className="muted"> (из них невидимого {formatMinutes(fields.attachments.reduce((s, a) => s + a.minutes, 0))})</span>
          )}
          {isNew && <> · свободно {formatMinutes(Math.max(0, DAY_CAPACITY - plan.total))}</>}
        </div>
      )}

      {isNew && hasTitle && fields && !fits && (
        <DraftResolution
          date={date} plan={plan} fields={fields} deficit={deficit}
          onMove={(d) => accept(d)} onShorten={shortenTo}
        />
      )}

      <div className="composer-actions">
        <button type="button" className="btn ghost" onClick={cancel}>Отмена</button>
        <button
          type="button"
          className="btn primary"
          disabled={!!blockedReason}
          onClick={() => (isNew ? accept() : save())}
        >
          {blockedReason ?? (isNew ? 'Принять' : 'Сохранить')}
        </button>
      </div>
    </div>
  );
}

function HiddenToggle({ label, on, minutes, onToggle, onMinutes }: {
  label: string; on: boolean; minutes: number; onToggle: () => void; onMinutes: (m: number) => void;
}) {
  return (
    <div className={`hidden-toggle ${on ? 'on' : ''}`}>
      <button type="button" className="check-sm" onClick={onToggle} aria-pressed={on}>{on ? '✓' : ''}</button>
      <span>{label}</span>
      <div className="stepper stepper-sm">
        <button type="button" onClick={() => onMinutes(Math.max(5, minutes - 5))}>−</button>
        <span>{formatMinutes(minutes)}</span>
        <button type="button" onClick={() => onMinutes(minutes + 5)}>+</button>
      </div>
    </div>
  );
}
