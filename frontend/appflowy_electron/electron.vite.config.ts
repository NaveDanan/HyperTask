import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
        '@assets': resolve(__dirname, 'resources/assets'),
      },
    },
    server: { fs: { allow: [resolve(__dirname, '..')] } },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
