import { defineConfig } from 'vitest/config';
import base from '../../vitest.config';
export default defineConfig({ ...base, test: { ...base.test, include: ['scripts/web-harness/HyperDatabase.live.test.ts'], testTimeout: 240000 } });
