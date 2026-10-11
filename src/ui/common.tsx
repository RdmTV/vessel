import { useEffect, type ReactNode } from 'react';
import { formatMinutes } from '../domain/dates';

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, small }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className={`segmented ${small ? 'segmented-sm' : ''}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const QUICK = [15, 30, 45, 60, 90, 120, 180, 240];

/** Длительность: быстрые варианты + шаг ±15 минут. */
export function DurationPicker({ value, onChange, quick = QUICK, min = 5, max = 24 * 60 }: {
  value: number; onChange: (m: number) => void; quick?: number[]; min?: number; max?: number;
}) {
  const clamp = (m: number) => Math.max(min, Math.min(max, m));
  const step = (dir: 1 | -1) => {
    const s = value < 30 || (value === 30 && dir < 0) ? 5 : 15;
    onChange(clamp(dir > 0 ? Math.floor(value / s) * s + s : Math.ceil(value / s) * s - s));
  };
  return (
    <div className="duration">
      <div className="stepper">
        <button type="button" onClick={() => step(-1)} aria-label="Меньше">−</button>
        <span>{formatMinutes(value)}</span>
        <button type="button" onClick={() => step(1)} aria-label="Больше">+</button>
      </div>
      <div className="chips">
        {quick.map((m) => (
          <button key={m} type="button" className={`chip ${m === value ? 'on' : ''}`} onClick={() => onChange(m)}>
            {formatMinutes(m)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  return (
    <div className="chips">
      {names.map((n, i) => (
        <button
          key={i}
          type="button"
          className={`chip ${value.includes(i) ? 'on' : ''}`}
          onClick={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
