import { get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { todayKey } from './domain/dates';
import { emptyData } from './domain/defaults';
import type { EditScope } from './domain/mutations';
import type { AppData, DateKey, TaskFields } from './domain/types';

const STORAGE_KEY = 'vessel-data';

export interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

export interface ScopeAsk {
  title: string;
  resolve: (scope: EditScope | null) => void;
}

interface State {
  data: AppData;
  loaded: boolean;
  date: DateKey;
  /** Черновик новой задачи — призрачный контур в сосуде. */
  draft: TaskFields | null;
  /** Ключ подсвеченного пласта: `t:<taskId>` или `r:<routineId>`. */
  highlight: string | null;
  /** Раскрытая строка в списке задач. */
  expandedTask: string | null;
  toast: Toast | null;
  scopeAsk: ScopeAsk | null;

  setDate: (d: DateKey) => void;
  apply: (fn: (d: AppData) => AppData) => void;
  setDraft: (f: TaskFields | null) => void;
  setHighlight: (k: string | null) => void;
  setExpandedTask: (id: string | null) => void;
  showToast: (t: Toast | null) => void;
  /** Спросить «только эту / эту и следующие» для повторяющейся задачи. */
  askScope: (title: string) => Promise<EditScope | null>;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  data: emptyData(),
  loaded: false,
  date: todayKey(),
  draft: null,
  highlight: null,
  expandedTask: null,
  toast: null,
  scopeAsk: null,

  setDate: (date) => set({ date, highlight: null, expandedTask: null }),
  apply: (fn) => set({ data: fn(get().data) }),
  setDraft: (draft) => set({ draft }),
  setHighlight: (highlight) => {
    if (get().highlight !== highlight) set({ highlight });
  },
  setExpandedTask: (expandedTask) => set({ expandedTask }),
  showToast: (toast) => {
    clearTimeout(toastTimer);
    set({ toast });
    if (toast) toastTimer = setTimeout(() => set({ toast: null }), 5000);
  },
  askScope: (title) =>
    new Promise((resolve) => {
      set({
        scopeAsk: {
          title,
          resolve: (scope) => {
            set({ scopeAsk: null });
            resolve(scope);
          },
        },
      });
    }),
}));

// ───────────── сохранение

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save(data: AppData) {
  idbSet(STORAGE_KEY, data).catch((e) => console.error('Не удалось сохранить данные', e));
}

export async function loadData() {
  let data: AppData | undefined;
  try {
    data = await idbGet<AppData>(STORAGE_KEY);
  } catch (e) {
    console.error('Не удалось прочитать данные', e);
  }
  useStore.setState({ data: data ?? emptyData(), loaded: true });

  useStore.subscribe((s, prev) => {
    if (s.data === prev.data) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(s.data), 250);
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(saveTimer);
    save(useStore.getState().data);
  });
}
