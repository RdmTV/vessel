import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadData } from './store';
import './styles.css';

loadData();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Сервис-воркер не зарегистрирован', e));
}

// Просим браузер не вычищать данные (на iPhone хранилище иначе могут почистить при нехватке места).
navigator.storage?.persist?.().catch(() => {});
