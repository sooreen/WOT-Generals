import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Арты карт лежат в data/assets и отдаются как статика: копировать 62 МБ
// в папку клиента не нужно, достаточно смонтировать каталог.
export default defineConfig({
  plugins: [react()],
  publicDir: resolve(__dirname, 'public'),
  resolve: {
    alias: { '@data': resolve(__dirname, '../../data') },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
