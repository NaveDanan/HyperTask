// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// routes/_authed/settings/_personal/activity.tsx; components/manage/audit-page.tsx; components/audit/audit-table.tsx
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperActivityApi, hyperActivitySearch, HYPER_ACTIVITY_VIEWS } from './HyperActivityApi';
import { type AuditEvent, HyperWhenCell, HyperWhatCell, HyperWhoCell, HyperDecisionCell, searchTextOf, botText, startedByText } from './HyperActivityCells';
import { oneRowPerAction, outcomeOf } from './HyperActivityOutcome';

export function HyperPersonalActivity({ bot: initialBot }: { bot?: string }) {
  const [bot, setBot] = useState(initialBot);
  const [view, setView] = useState(''); const [query, setQuery] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]); const [cursor, setCursor] = useState<string>();
  const [names, setNames] = useState<{ bots: Record<string, string>; skills: Record<string, string> }>({ bots: {}, skills: {} });
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  const [ascending, setAscending] = useState(false); const [exporting, setExporting] = useState(false); const [exportError, setExportError] = useState(''); const [capped, setCapped] = useState(0);
  const [facets, setFacets] = useState<Record<string, string[]>>({ Outcome: [], Bot: [], 'Started by': [] });
  const search = useMemo(() => hyperActivitySearch(view, bot), [view, bot]);
  useEffect(() => { setBot(initialBot); }, [initialBot]);
  useEffect(() => {
    let active = true; setBusy(true); setLoaded(false); setError('');
    void hyperActivityApi.events(search).then(page => { if (active) { setEvents(page.events); setCursor(page.nextCursor); setLoaded(true); } }).catch(() => { if (active) setError('Could not load these events. Try again.'); }).finally(() => { if (active) setBusy(false); });
    void hyperActivityApi.names().then(value => { if (active) setNames(value); }).catch(() => { /* Stored IDs remain readable when names cannot be loaded. */ });
    return () => { active = false; };
  }, [search, attempt]);
  const nameFor = (id: string) => names.bots[id] || id;
  const rows = oneRowPerAction(events).map(event => event.targetType === 'skill' && event.targetId && names.skills[event.targetId] ? { ...event, subjectTitle: names.skills[event.targetId] } : event);
  const facet = (event: AuditEvent, key: string) => key === 'Outcome' ? ({ allowed: 'Allowed', refused: 'Blocked', 'did-not-happen': 'Did not happen' }[outcomeOf(event)]) : key === 'Bot' ? botText(event, nameFor) || 'None' : startedByText(event, nameFor, 'OpenBot');
  const shown = rows.filter(event => searchTextOf(event, nameFor, 'OpenBot').includes(query.trim().toLowerCase()) && Object.entries(facets).every(([key, values]) => !values.length || values.includes(facet(event, key)))).sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * (ascending ? 1 : -1));
  return <div className="flex min-h-0 flex-col gap-4">
    <h2 className="text-lg font-semibold">Activity</h2><p className="text-sm text-muted-foreground">See what your Bots did, and which of their actions were allowed, blocked or didn't happen.</p>
    <fieldset aria-label="View" className="flex flex-wrap gap-2">{HYPER_ACTIVITY_VIEWS.map(([label, value]) => <Button key={label} variant={view === value ? 'default' : 'outline'} aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>)}</fieldset>
    <Input type="search" aria-label="Search events" placeholder="Search events…" value={query} onChange={event => setQuery(event.target.value)} />
    {bot && <Button variant="outline" onClick={() => setBot(undefined)}>Only {nameFor(bot)} · Show every Bot</Button>}
    <div className="flex flex-wrap gap-3">{Object.keys(facets).map(key => <details key={key}><summary className="cursor-pointer text-sm">{key}{facets[key].length ? ` (${facets[key].length})` : ''}</summary><div className="flex flex-col gap-2 rounded-lg border p-3">{[...new Set(rows.map(row => facet(row, key)))].map(value => <label key={value} className="text-sm"><input type="checkbox" checked={facets[key].includes(value)} onChange={event => setFacets(current => ({ ...current, [key]: event.target.checked ? [...current[key], value] : current[key].filter(item => item !== value) }))} /> {value} ({rows.filter(row => facet(row, key) === value).length})</label>)}<Button variant="ghost" onClick={() => setFacets(current => ({ ...current, [key]: [] }))}>Clear filter</Button></div></details>)}</div>
    <div className="flex flex-wrap items-center gap-2"><span data-audit-count className="text-xs text-muted-foreground">{shown.length} of {cursor ? 'the newest ' : ''}{rows.length} events</span><Button variant="outline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Refresh</Button><Button variant="outline" disabled={exporting} onClick={async () => {
      setExporting(true); setExportError(''); setCapped(0);
      try { const result = await hyperActivityApi.export(search); if (Number.isInteger(result.capped) && result.capped > 0) setCapped(result.capped); const url = URL.createObjectURL(result.blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `audit-events-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); }
      catch { setExportError('Could not export these events. Try again.'); } finally { setExporting(false); }
    }}>{exporting ? 'Exporting…' : 'Export CSV'}</Button></div>
    {exportError && <p role="alert">{exportError}</p>}{capped > 0 && <p role="status">The file has the newest {capped.toLocaleString()} events, not all of them. Narrow the filter or dates to export the rest.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{busy && <p role="status">Loading events…</p>}
    {loaded && <><div className="overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Outcome</th><th><button onClick={() => setAscending(value => !value)}>When, {ascending ? 'oldest first' : 'newest first'}</button></th><th>What</th><th>Bot</th><th>Decision</th></tr></thead><tbody>{shown.map(event => <tr key={event.id} data-outcome={outcomeOf(event)} className="border-t"><td className="p-3">{facet(event, 'Outcome')}</td><td className="p-3 text-xs"><HyperWhenCell event={event} /></td><td className="p-3"><HyperWhatCell event={event} storedName={false} /></td><td className="p-3"><HyperWhoCell event={event} nameFor={nameFor} deployment="OpenBot" /></td><td className="p-3"><HyperDecisionCell event={event} storedNames={false} /></td></tr>)}</tbody></table></div>{shown.length === 0 && <p className="text-sm text-muted-foreground">No matches. No events match this search and these filters.</p>}</>}
    {loaded && cursor && <Button disabled={busy} variant="outline" onClick={async () => {
      setBusy(true); setError(''); try { const page = await hyperActivityApi.events(search, cursor); setEvents(current => [...current, ...page.events]); setCursor(page.nextCursor); } catch { setError('Could not load older events. Try again.'); } finally { setBusy(false); }
    }}>{busy ? 'Loading…' : 'Show older events'}</Button>}
  </div>;
}
