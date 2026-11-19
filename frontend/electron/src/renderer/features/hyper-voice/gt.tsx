// The parts of gt-react that t3code's voice components use, resolved in English with gt-i18n's own formatter.
// HyperTask's voice UI is English-only, so <T> and <Var> render their children and useGT/useMessages format
// ICU text ({name}, plurals) exactly as gt-react does when no translation exists.
import { gtFallback, mFallback, msg } from 'gt-i18n';
import type { MFunctionType } from 'gt-i18n/types';
import type { ReactNode } from 'react';

export { msg };

type Variables = Record<string, unknown>;

/** gt-react's `T`: translatable JSX. */
export function T({ children }: { children?: ReactNode; id?: string; context?: string }) {
  return <>{children}</>;
}

/** gt-react's `Var`: a value inside `T` that is not translated. */
export function Var({ children }: { children?: ReactNode; name?: string }) {
  return <>{children}</>;
}

const gt = (text: string, variables?: Variables) =>
  gtFallback(text, { ...(variables as object), $locale: 'en' } as Parameters<typeof gtFallback>[1]);

/** gt-react's `useGT`: formats inline source text. */
export function useGT() {
  return gt;
}

/** Formats a `msg()` string (or plain text) outside React, as t3code's `m` does in English. */
export const m: MFunctionType = mFallback;

/** gt-react's `useMessages`: resolves `msg()` strings. */
export function useMessages() {
  return m;
}

/** gt-react's `useLocale`. */
export function useLocale() {
  return 'en';
}

/** t3code's MessageResolver (apps/web/src/i18n/messages.ts). */
export type MessageResolver = typeof m;
