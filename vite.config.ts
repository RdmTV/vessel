import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Относительные пути: сборка работает и в корне домена, и в подпапке (GitHub Pages /vessel/).
  base: './',
  server: { port: 5173, host: true },
});
