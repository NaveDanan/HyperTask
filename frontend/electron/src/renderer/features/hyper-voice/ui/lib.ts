// The helpers t3code's UI primitives import from apps/web/src/lib (utils.ts, windowControlsOverlay.ts).
// Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
export { cn } from '@/lib/utils';

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/** HyperTask draws its own caption bar inside the page, so popups need no native titlebar inset. */
export function useNativeTitlebarHeight(): number {
  return 0;
}
