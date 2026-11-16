import { useEffect, useState } from 'react';
import { HyperMentionTextarea } from './HyperMentionInput';
import { HyperPeoplePicker } from './HyperPeoplePicker';
import { hyperIsPeopleField } from './HyperPeopleProperty';
import type { HyperField } from '../hyper-database/HyperDatabaseTypes';
import type { HyperDatabaseController } from '../hyper-database/HyperDatabaseController';
export function HyperPeopleTextProperty({ controller, rowId, field, value, disabled }: { controller: HyperDatabaseController; rowId: string; field: HyperField; value: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(value), [error, setError] = useState('');
  useEffect(() => { setDraft(value); }, [value]);
  const save = async (next: string) => { setError(''); try { await controller.updateCell(rowId, field.id, { kind: 'text', text: next }); } catch { setError('Could not save ' + field.name + '. Try again.'); } };
  return <div className="min-w-0 w-full">{hyperIsPeopleField(field.proto) ? <HyperPeoplePicker label={field.name} value={draft} disabled={disabled} onChange={async next => { await controller.updateCell(rowId, field.id, { kind: 'text', text: next }); setDraft(next); }} /> : <HyperMentionTextarea aria-label={field.name} className="min-h-8 border-0 px-2 py-1 shadow-none" placeholder="Empty" value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== value) void save(draft); }} />}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}
