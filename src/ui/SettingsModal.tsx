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

  return (
    <Modal title="Настройки" onClose={onClose}>
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
