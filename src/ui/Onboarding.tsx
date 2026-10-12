import { useState } from 'react';
import { todayKey } from '../domain/dates';
import { DEFAULT_LIFE_YEARS, lifeStats, pluralDays, pluralYears } from '../domain/life';
import type { Profile } from '../domain/types';
import { useStore } from '../store';
import { LifeGrid } from './LifeGrid';
import { RoutineEditor } from './RoutineModal';
import { JobsEditor } from './Work';

type Step = 'birth' | 'life' | 'routine';

/** Первый запуск: сначала эмоция (сетка жизни), потом настройка (рутина), потом сегодняшний сосуд. */
export function Onboarding() {
  const apply = useStore((s) => s.apply);
  const openDay = useStore((s) => s.openDay);
  const today = todayKey();
  const [step, setStep] = useState<Step>('birth');
  const [birthDate, setBirthDate] = useState('');
  const [lifeYears, setLifeYears] = useState(DEFAULT_LIFE_YEARS);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && birthDate < today && birthDate > '1900-01-01'
    && lifeYears >= 30 && lifeYears <= 120;
  const profile: Profile = { birthDate, lifeYears };

  const finish = () => {
    apply((d) => ({ ...d, profile }));
    openDay(today);
  };

  return (
    <div className="onboarding">
      {step === 'birth' && (
        <div className="ob-card">
          <div className="ob-logo"><span className="logo" /> Vessel</div>
          <h1>Каждый день — это сосуд на 24 часа.</h1>
          <p className="lead">Сначала посмотрим, сколько таких сосудов у тебя всего.</p>
          <label className="ob-field">
            <span>Дата рождения</span>
            <input type="date" value={birthDate} max={today} onChange={(e) => setBirthDate(e.target.value)} autoFocus />
          </label>
          <label className="ob-field">
            <span>Сколько лет жизни считать</span>
            <input
              type="number" min={30} max={120} value={lifeYears}
              onChange={(e) => setLifeYears(Number(e.target.value) || DEFAULT_LIFE_YEARS)}
            />
            <small className="muted">По умолчанию 80 — можно поменять потом в настройках.</small>
          </label>
          <button type="button" className="btn primary ob-next" disabled={!valid} onClick={() => setStep('life')}>
            Показать
          </button>
        </div>
      )}

      {step === 'life' && valid && <LifeStep profile={profile} onNext={() => setStep('routine')} />}

      {step === 'routine' && (
        <div className="ob-card ob-card-wide">
          <h2>Что у тебя каждый день?</h2>
          <p className="muted">Средние значения уже подставлены — поправь под себя. Это дно каждого сосуда.</p>
          <RoutineEditor />
          <h2>Работа</h2>
          <p className="muted">Блок по графику: рабочие задачи потом заполняют его изнутри. Если работы нет — убери все дни недели.</p>
          <JobsEditor />
          <div className="ob-actions">
            <button type="button" className="btn ghost" onClick={() => setStep('life')}>Назад</button>
            <button type="button" className="btn primary" onClick={finish}>Открыть сегодняшний день</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LifeStep({ profile, onNext }: { profile: Profile; onNext: () => void }) {
  const data = useStore((s) => s.data);
  const today = todayKey();
  const s = lifeStats(profile, today);
  return (
    <div className="ob-card ob-card-wide">
      <h2>
        Из {pluralDays(s.total)} прожито {pluralDays(s.lived)}.
      </h2>
      <p className="lead">
        Осталось <b className="ok">{pluralDays(s.left)}</b> — примерно {Math.round(s.left / 7).toLocaleString('ru-RU')} недель,
        если считать {pluralYears(profile.lifeYears)}. Каждая клетка — один день. Зелёная — сегодня.
      </p>
      <LifeGrid data={data} profile={profile} today={today} revealMs={2200} />
      <div className="ob-actions">
        <button type="button" className="btn primary" onClick={onNext}>Дальше</button>
      </div>
    </div>
  );
}
