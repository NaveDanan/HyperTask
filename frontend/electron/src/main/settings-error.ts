import type { IpcResult } from '@shared/api';

export type SettingsErrorKind = 'format' | 'state' | 'unsupported' | 'other';

/**
 * An error carrying the Dart exception kind it stands for: FormatException ('format'),
 * StateError ('state'), UnsupportedError ('unsupported') or anything else ('other').
 */
export class SettingsError extends Error {
  readonly kind: SettingsErrorKind;

  constructor(kind: SettingsErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'SettingsError';
  }
}

export const formatError = (message: string) => new SettingsError('format', message);
export const stateError = (message: string) => new SettingsError('state', message);

const KINDS: readonly string[] = ['format', 'state', 'unsupported', 'other'];

/**
 * Maps any thrown value to an IpcResult failure. Errors with a known `kind` (SettingsError,
 * the shared EndpointError) keep it; JSON syntax errors are FormatExceptions, as jsonDecode's.
 */
export function toIpcFailure(error: unknown): IpcResult<never> {
  if (error instanceof Error && 'kind' in error && typeof error.kind === 'string' && KINDS.includes(error.kind)) {
    return { ok: false, kind: error.kind as SettingsErrorKind, message: error.message };
  }
  if (error instanceof SyntaxError) return { ok: false, kind: 'format', message: error.message };
  return { ok: false, kind: 'other', message: error instanceof Error ? error.message : String(error) };
}

export async function toIpcResult<T>(run: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return toIpcFailure(error);
  }
}
