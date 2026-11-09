import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = resolve(__dirname, 'src/shared');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { externalizeDeps: true },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { externalizeDeps: true },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': shared,
        '@': resolve(__dirname, 'src/renderer'),
        '@resources': resolve(__dirname, '../resources'),
        '@flutter-assets': resolve(__dirname, '../appflowy_flutter/assets'),
      },
    },
    server: { fs: { allow: [resolve(__dirname, '..')] } },
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
