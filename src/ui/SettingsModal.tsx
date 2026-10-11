import { useRef } from 'react';
import { todayKey } from '../domain/dates';
import { emptyData } from '../domain/defaults';
import type { AppData } from '../domain/types';
import { useStore } from '../store';
import { Modal, Segmented } from './common';

function isAppData(x: unknown): x is AppData {
  const d = x as AppData;
  return !!d && d.version === 1 && Array.isArray(d.tasks) && Array.isArray(d.series) && Array.isArray(d.routine);
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const apply = useStore((s) => s.apply);
  const showToast = useStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vessel-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isAppData(parsed)) throw new Error('format');
      if (!confirm('Заменить все текущие данные данными из файла?')) return;
      useStore.setState({ data: parsed });
      showToast({ text: 'Данные загружены' });
      onClose();
    } catch {
      showToast({ text: 'Не получилось прочитать файл — это не бэкап Vessel' });
    }
  };

  const profile = data.profile;
  const setProfile = (p: Partial<NonNullable<AppData['profile']>>) =>
    apply((d) => (d.profile ? { ...d, profile: { ...d.profile, ...p } } : d));

  return (
    <Modal title="Настройки" onClose={onClose}>
      {profile && (
        <div className="setting">
          <div>
            <div>Сетка жизни</div>
            <div className="muted small">Дата рождения и сколько лет считать.</div>
          </div>
          <div className="row-gap">
            <input
              type="date" value={profile.birthDate} max={todayKey()}
              onChange={(e) => e.target.value && setProfile({ birthDate: e.target.value })}
            />
            <input
              type="number" className="num" min={30} max={120} value={profile.lifeYears}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 30 && n <= 120) setProfile({ lifeYears: n });
              }}
            />
          </div>
        </div>
      )}

      <div className="setting">
        <div>
          <div>Переключение между задачами</div>
          <div className="muted small">Буфер после каждой задачи — время «войти» в следующее дело.</div>
        </div>
        <Segmented
          small
          value={data.settings.bufferMinutes}
          onChange={(v) => apply((d) => ({ ...d, settings: { ...d.settings, bufferMinutes: v } }))}
          options={[{ value: 0, label: 'Выкл' }, { value: 10, label: '10м' }, { value: 15, label: '15м' }]}
        />
      </div>

      <div className="setting">
        <div>
          <div>Утренний чек-ин</div>
          <div className="muted small">При первом открытии за день — как прошёл вчерашний.</div>
        </div>
        <Segmented
          small
          value={data.settings.checkinEnabled === false ? 'off' : 'on'}
          onChange={(v) => apply((d) => ({ ...d, settings: { ...d.settings, checkinEnabled: v === 'on' } }))}
          options={[{ value: 'on', label: 'Вкл' }, { value: 'off', label: 'Выкл' }]}
        />
      </div>

      <div className="setting">
        <div>
          <div>Резервная копия</div>
          <div className="muted small">Данные хранятся только в этом браузере.</div>
        </div>
        <div className="row-gap">
          <button type="button" className="btn" onClick={exportJson}>Экспорт</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Импорт</button>
          <input
            ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
        </div>
      </div>

      <div className="setting">
        <div>
          <div>Сбросить всё</div>
          <div className="muted small">Удалит задачи и вернёт рутину по умолчанию.</div>
        </div>
        <button
          type="button"
          className="btn danger"
          onClick={() => confirm('Удалить все данные без возможности восстановления?') && useStore.setState({ data: emptyData() })}
        >
          Сбросить
        </button>
      </div>
    </Modal>
  );
}
