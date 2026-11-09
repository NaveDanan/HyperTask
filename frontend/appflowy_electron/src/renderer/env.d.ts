/// <reference types="vite/client" />
import type { AppFlowyApi } from '@shared/api';

declare global {
  interface Window {
    appflowy: AppFlowyApi;
  }
}

export {};
