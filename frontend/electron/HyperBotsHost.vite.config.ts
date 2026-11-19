import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  build: {
    outDir: 'out/host',
    emptyOutDir: true,
    target: 'node22',
    ssr: 'src/main/HyperBotsHostEntry.ts',
    rollupOptions: { output: { entryFileNames: 'HyperBotsHost.mjs' } },
  },
});
