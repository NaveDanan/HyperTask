// HyperTask governance form and asynchronous state primitives.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { hyperGovernanceRequest as request } from './HyperGovernanceApi';
const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm';
export function HyperField({
  label,
  value,
  onChange,
  secret = false,
  required = true,
  maxLength,
  disabled = false,
  inputType = 'text'
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  secret?: boolean;
  required?: boolean;
  maxLength?: number;
  disabled?: boolean;
  inputType?: 'text' | 'url';
}) {
  return <label className="grid gap-1 text-sm">{label}<input className={inputClass} disabled={disabled} type={secret ? 'password' : inputType} autoComplete={secret ? 'new-password' : 'off'} value={value} required={required} maxLength={maxLength} onChange={e => onChange(e.target.value)} /></label>;
}
export function HyperResult({
  value
}: {
  value: unknown;
}) {
  if (value == null) return <p>No results.</p>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <div className="grid gap-3">{value.length ? value.map((v, i) => <div className="rounded-md border p-3" key={i}><HyperResult value={v} /></div>) : <p>No results.</p>}</div>;
  return <dl className="grid gap-2">{Object.entries(value).map(([key, v]) => <div key={key}><dt className="text-sm text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="break-words text-sm"><HyperResult value={v} /></dd></div>)}</dl>;
}
export function hyperGovernanceFailure(error: unknown): string {
  const status = error instanceof Error ? error.message.match(/\((\d{3})\)/)?.[1] : undefined;
  if (status === '401') return 'Sign in to OpenBot to continue.';
  if (status === '403') return 'The server refused access. This action requires an authorized administrator.';
  if (status === '400' || status === '422') return 'The server refused these values. Check the fields and validation results.';
  if (status === '503') return 'This feature is unavailable or has not been configured on the server.';
  if (status === '429') return 'The server is busy. Wait a moment and retry.';
  return 'The server could not complete this request. Refresh and try again.';
}
export function useHyperResource<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(undefined);
    request<T>(path).then(v => {
      if (active) setData(v);
    }, error => {
      if (active) setError(hyperGovernanceFailure(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [path, version]);
  return {
    data,
    error,
    loading,
    reload: useCallback(() => setVersion(v => v + 1), [])
  };
}
export function HyperStatus({
  resource,
  children
}: {
  resource: {
    loading: boolean;
    error: string;
    reload(): void;
  };
  children: ReactNode;
}) {
  return resource.loading ? <p role="status">Loading…</p> : resource.error ? <div role="alert">{resource.error} <Button onClick={resource.reload}>Retry</Button></div> : <>{children}</>;
}
export function useHyperAction(reload?: () => void) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      reload?.();
    } catch (error) {
      setError(hyperGovernanceFailure(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return {
    busy,
    run,
    error
  };
}
export function HyperError({
  message
}: {
  message: string;
}) {
  return message ? <p role="alert" className="text-destructive">{message}</p> : null;
}
