import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer'),
      '@resources': resolve(__dirname, '../resources'),
      '@assets': resolve(__dirname, 'resources/assets'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
