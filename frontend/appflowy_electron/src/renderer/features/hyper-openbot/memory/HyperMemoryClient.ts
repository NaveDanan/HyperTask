import { hyperOpenBotRequest } from '../transport';
type Options = { method?: string; body?: unknown; fallback?: string };
export function client<T>(path: string, key: string, options?: Options): Promise<T>;
export function client(path: string, options?: Options): Promise<{ json<T>(): Promise<T> }>;
export async function client<T>(path: string, keyOrOptions?: string | Options, options?: Options): Promise<T | { json<R>(): Promise<R> }> {
  const settings = typeof keyOrOptions === 'string' ? options : keyOrOptions;
  const value = await hyperOpenBotRequest<Record<string, unknown>>(path, settings?.method, settings?.body);
  if (typeof keyOrOptions === 'string') return value?.[keyOrOptions] as T;
  return { json: async <R>() => value as R };
}
