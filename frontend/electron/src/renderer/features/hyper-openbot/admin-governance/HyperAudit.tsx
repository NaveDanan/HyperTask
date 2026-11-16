// Adapted from OpenBot components/manage/audit-page and components/audit. Copyright (c) 2026 CopilotKit. MIT licensed.
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { hyperOpenBotFetch, HYPER_OPENBOT_ORIGIN } from '../transport';
import { hyperGovernanceRequest as request, hyperAuditExportPath } from './HyperGovernanceApi';
import { HyperStatus, HyperError, HyperResult, useHyperAction, useHyperResource } from './HyperGovernanceUi';
import { hyperAuditEventName } from './HyperAuditNames';
import { HyperRecordingSettings } from './HyperEnterpriseSettings';
import { HyperVerdict, HyperWhatIf } from './HyperWhatIf';
import { whatIfExplainable, type WhatIfAction, type WhatIfResult } from './HyperWhatIfModel';
import { AUDIT_FILTER_KEYS, hyperAuditViewParams, type AuditFilters, type AuditFilterKey } from './HyperAuditFilters';
import { outcomeOf, REFUSED_EVENT_TYPES, DID_NOT_HAPPEN_EVENT_TYPES, COMPUTER_ACTION_EVENT_TYPES } from './HyperAuditOutcome';
import { oneRowPerAction, OPENBOT_WORKING_EVENT_TYPES, CALLS_RECORDED_AS_CHANGES } from './HyperActivityRows';
type HyperEvent = {
  id: string;
  eventType: string;
  createdAt: string;
  actorUserId: string | null;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  initiatorKind?: string;
};
type HyperVocabulary = {
  bots: {
    id: string;
    name: string;
  }[];
  people: {
    id: string;
    name: string | null;
    email: string;
  }[];
  apps: {
    key: string;
    name: string;
  }[];
  tools: {
    app: string;
    tool: string;
    calls: number;
  }[];
  rules: {
    rule: string;
    name: string | null;
  }[];
};
export function HyperAudit({
  navigate, initialFilters
}: {
  navigate?(page: string): void;
  initialFilters?: AuditFilters;
}) {
  const [filters, setFilters] = useState<AuditFilters>(initialFilters ?? {});
  const [cursor, setCursor] = useState('');
  const [events, setEvents] = useState<HyperEvent[]>([]);
  const [query, setQuery] = useState('');
  const [exportCap, setExportCap] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{
    reading: string | null;
    unanswered: string | null;
    answerable: string;
  }>();
  const [explanation, setExplanation] = useState<{
    action: WhatIfAction;
    recorded: {
      summary: string;
    };
    result: WhatIfResult;
  }>();
  const [tryAction, setTryAction] = useState<WhatIfAction>();
  const [viewFilters, setViewFilters] = useState<AuditFilters>({});
  const v = useHyperResource<HyperVocabulary>('/api/admin/audit-events/vocabulary');
  const edition = useHyperResource<{
    edition?: string;
  }>('/api/capabilities');
  const params = hyperAuditViewParams(viewFilters, filters);
  if (edition.data?.edition === 'personal') {
    params.set('excludeEventType', OPENBOT_WORKING_EVENT_TYPES.join(','));
    params.set('excludeCalls', CALLS_RECORDED_AS_CHANGES.join(','));
  }
  const search = params.toString();
  if (cursor) params.set('cursor', cursor);
  const r = useHyperResource<{
    events: HyperEvent[];
    nextCursor?: string;
  }>(`/api/admin/audit-events?${params}`);
  const a = useHyperAction();
  useEffect(() => {
    if (r.data) setEvents(old => cursor ? [...old, ...r.data!.events.filter(e => !old.some(o => o.id === e.id))] : r.data!.events);
  }, [r.data]);
  function update(next: AuditFilters) {
    setFilters(next);
    setCursor('');
    setEvents([]);
    setAnswer(undefined);
  }
  const lists = new Set(['eventType', 'initiatorKind', 'app', 'tool', 'intent']);
  const choices = (key: AuditFilterKey) => key === 'bot' ? v.data?.bots.map(e => ({
    value: e.id,
    label: e.name
  })) : key === 'actorUserId' ? v.data?.people.map(e => ({
    value: e.id,
    label: e.name || e.email
  })) : key === 'app' ? v.data?.apps.map(e => ({
    value: e.key,
    label: e.name
  })) : key === 'tool' ? v.data?.tools.map(e => ({
    value: e.tool,
    label: `${e.app}/${e.tool}`
  })) : key === 'rule' ? v.data?.rules.map(e => ({
    value: e.rule,
    label: e.name || e.rule
  })) : [];
  const visible = oneRowPerAction(events).filter(e => `${e.eventType} ${e.actorUserId} ${e.targetId} ${JSON.stringify(e.payload)}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="grid gap-4"><form className="flex gap-2" onSubmit={e => {
      e.preventDefault();
      void a.run(async () => {
        const result = await request<{
          filters: AuditFilters;
          reading: string | null;
          unanswered: string | null;
          answerable: string;
        }>('/api/admin/audit-events/ask', 'POST', {
          question: question.trim(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        });
        if (result.answerable !== 'no') update(result.filters);
        setAnswer(result);
      });
    }}><input aria-label="Ask the audit trail" className="flex-1 rounded border bg-background p-2" value={question} maxLength={500} onChange={e => setQuestion(e.target.value)} /><Button type="submit" disabled={a.busy || !question.trim()}>Ask trail</Button></form>{answer && <div role="status"><p>{answer.reading}</p><p>{answer.unanswered}</p></div>}
    <div className="flex flex-wrap gap-2">{[{
        label: 'Everything',
        filters: {}
      }, {
        label: 'Computer actions',
        filters: {
          eventType: [...COMPUTER_ACTION_EVENT_TYPES]
        }
      }, {
        label: 'Blocked',
        filters: {
          eventType: [...REFUSED_EVENT_TYPES]
        }
      }, {
        label: 'Did not happen',
        filters: {
          eventType: [...DID_NOT_HAPPEN_EVENT_TYPES]
        }
      }, {
        label: 'Nobody watching',
        filters: {
          initiatorKind: ['routine', 'handoff', 'responsibility', 'memory']
        }
      }].map(view => <Button variant="outline" key={view.label} onClick={() => { setViewFilters(view.filters); setCursor(''); setEvents([]); setAnswer(undefined); }}>{view.label}</Button>)}</div>
    <details><summary>Filters</summary><HyperStatus resource={v}><div className="grid gap-3 sm:grid-cols-2">{AUDIT_FILTER_KEYS.map(key => <label key={key} className="grid gap-1">{key}{lists.has(key) ? ' · comma-separated alternatives' : ''}<input className="rounded border bg-background p-2" list={`audit-${key}`} value={Array.isArray(filters[key]) ? (filters[key] as string[]).join(',') : filters[key] || ''} onChange={e => update({
              ...filters,
              [key]: lists.has(key) ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : e.target.value
            })} /><datalist id={`audit-${key}`}>{choices(key)?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist></label>)}</div></HyperStatus><Button onClick={() => update({})}>Clear filters</Button></details>
    <label>Search loaded events<input className="rounded border bg-background p-2" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="flex gap-2"><Button onClick={() => {
        setCursor('');
        r.reload();
      }}>Refresh</Button><Button disabled={a.busy} onClick={() => void a.run(async () => {
        setExportCap(0);
        const response = await hyperOpenBotFetch(HYPER_OPENBOT_ORIGIN + hyperAuditExportPath(search));
        if (!response.ok) throw new Error();
        const capped = Number(response.headers.get('x-audit-export-truncated'));
        if (Number.isSafeInteger(capped) && capped > 0) setExportCap(capped);
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'hyper-openbot-audit.csv';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}>Export matching CSV</Button></div>
    {exportCap > 0 && <p role="status">The file has the newest {exportCap.toLocaleString()} events, not all of them. Narrow the filter or dates to export the rest.</p>}
    <HyperStatus resource={r}>{!visible.length && <p>No matching events.</p>}{visible.map(event => <details className="rounded border p-3" key={event.id}><summary>{new Date(event.createdAt).toLocaleString()} · {hyperAuditEventName(event.eventType, event.payload.action)} · {outcomeOf(event)}</summary><p>Person: {v.data?.people.find(p => p.id === event.actorUserId)?.email || event.actorUserId || 'OpenBot'}</p><p>Target: {event.targetType} {event.targetId} · Started by {event.initiatorKind || 'unknown'}</p><HyperResult value={event.payload} />{whatIfExplainable(event) && <Button disabled={a.busy} onClick={() => void a.run(async () => {
          setTryAction(undefined);
          setExplanation(await request(`/api/admin/what-if/explain/${encodeURIComponent(event.id)}`));
        })}>Why did this happen?</Button>}</details>)}{r.data?.nextCursor && <Button disabled={r.loading} onClick={() => setCursor(r.data!.nextCursor!)}>Load older events</Button>}</HyperStatus><HyperError message={a.error} />
    {explanation && <div className="grid gap-3 rounded border p-4"><h3>Recorded outcome</h3><p>{explanation.recorded.summary}</p><h3>Controls today</h3><HyperVerdict result={explanation.result} navigate={navigate} /><Button onClick={() => setTryAction(explanation.action)}>Try a change</Button></div>}{tryAction && <HyperWhatIf key={JSON.stringify(tryAction)} initial={tryAction} navigate={navigate} />}<HyperRecordingSettings />
  </div>;
}
