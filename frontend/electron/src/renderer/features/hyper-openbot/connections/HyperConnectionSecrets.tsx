// Adapted from OpenBot connection-fields.tsx and HyperVault/HyperSignInForm's ephemeral FormData pattern.
// Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { HyperBrokerField } from './HyperPluginDetailsApi';
export interface HyperConnectionSecretsProps { fields: HyperBrokerField[]; busy: boolean; onSubmit(values: Record<string, string>): Promise<unknown>; onCancel(): void }
/** Uncontrolled secrets are removed before the asynchronous request and never reach mutation state. */
export function HyperConnectionSecrets({ fields, busy, onSubmit, onCancel }: HyperConnectionSecretsProps) {
  return <form autoComplete="off" className="space-y-3 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); if (busy) return; const form = event.currentTarget; const data = new FormData(form); const values = Object.fromEntries(fields.map(f => [f.name, String(data.get(f.name) ?? '')])); form.reset(); void onSubmit(values).finally(() => { for (const key of Object.keys(values)) delete values[key]; }); }}><fieldset disabled={busy} className="space-y-3">{fields.map(field => <label className="block space-y-2" key={field.name}><span>{field.label}</span><Input name={field.name} type={field.secret ? 'password' : 'text'} required={field.required} defaultValue={field.secret ? undefined : field.default} autoComplete="off" /><span className="text-xs text-muted-foreground">{field.help}</span></label>)}<Button type="submit">Connect</Button><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button></fieldset></form>;
}
