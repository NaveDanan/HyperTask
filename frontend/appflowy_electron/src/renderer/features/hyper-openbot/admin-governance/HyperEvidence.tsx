// Native presentation of OpenBot governance readings and replay reports.
// Copyright (c) 2026 CopilotKit. MIT licensed. HyperTask developed by NaveDanan.
import type { ReactNode } from 'react';
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
export function HyperEvidence({ value }: { value: unknown }): ReactNode {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'object') return <span className="break-words">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <p className="text-muted-foreground">None.</p>;
    if (value.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
      const keys = [...new Set(value.flatMap(row => Object.keys(row)))];
      return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{keys.map(key => <th className="border-b p-2 capitalize" key={key}>{words(key)}</th>)}</tr></thead><tbody>{value.map((row, index) => <tr key={index}>{keys.map(key => <td className="border-b p-2 align-top" key={key}><HyperEvidence value={row[key]} /></td>)}</tr>)}</tbody></table></div>;
    }
    return <ul className="list-disc pl-5">{value.map((v, index) => <li key={index}><HyperEvidence value={v} /></li>)}</ul>;
  }
  const object = value as Record<string, unknown>;
  const { summary, explanation, warning, check, compile, ...fields } = object;
  return <div className="grid gap-2">{summary != null && <p className="font-medium">{String(summary)}</p>}{explanation != null && <p>{String(explanation)}</p>}{warning && <p role="status" className="text-destructive">{String(warning)}</p>}{[check, compile].filter(Boolean).map((item, index) => { const c = item as { ok: boolean; error?: string; problems?: unknown[] }; return <div role={c.ok ? 'status' : 'alert'} key={index}><p>{c.ok ? 'Validation passed.' : c.error || 'Validation failed.'}</p>{c.problems && <HyperEvidence value={c.problems} />}</div>; })}<dl className="grid gap-2">{Object.entries(fields).filter(([, v]) => v != null).map(([key, v]) => <div key={key}><dt className="font-medium capitalize">{words(key)}</dt><dd><HyperEvidence value={v} /></dd></div>)}</dl></div>;
}
