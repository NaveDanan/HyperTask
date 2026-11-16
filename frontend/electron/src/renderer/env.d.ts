/// <reference types="vite/client" />
import type { HypertaskApi } from '@shared/api';

declare global {
  interface Window {
    hypertask: HypertaskApi;
  }
}

export {};
