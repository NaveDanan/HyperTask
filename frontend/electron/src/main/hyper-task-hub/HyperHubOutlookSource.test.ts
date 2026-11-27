import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { HyperOutlookScript } from '../HyperOutlookScript';
import { HyperOutlookValues } from '../HyperOutlookSchema';
import type { HyperOutlookBridge } from '../HyperOutlookBridge';
import { disk, record, setup } from './HyperTaskHub.test-support';
import { HyperTaskHubService, type HyperHubSource } from './HyperTaskHubService';
import { HyperHubOutlookSource, hyperHubCalendarInterval } from './HyperHubOutlookSource';

const now = Date.parse('2026-11-29T07:00:00Z');
const interval = hyperHubCalendarInterval(now, setup.zone);
const wire = { start: interval.start.iso, end: interval.end.iso, storeId: 'AA' };
type Reply = z.infer<(typeof HyperOutlookValues)['hub.calendar']>;
const version = (s: HyperTaskHubService) => ({ scopeGeneration: 1, expectedRevision: s.version.revision });
function scenario(read: () => Promise<Reply>, storeId = () => 'AA') {
  const d = disk(), store = d.open();
  store.commit(() => true, state => { state.setup = { ...setup, outlookCalendar: true }; });
  const request = vi.fn(async (op: string) => op === 'hub.store' ? storeId() : read());
  const outlook = new HyperHubOutlookSource({ request: request as HyperOutlookBridge['request'] }, 'AA', setup.zone, Date.now);
  const task = { ...record(), effortMinutes: 45 };
  const jira: HyperHubSource = { connectionId: 'jira', kind: 'jira', queryId: 'test', label: 'Test', check: async () => {},
    read: async scope => ({ records: [{ ...task, scope }], cursor: null, completeness: 'complete' }) };
  const s = new HyperTaskHubService(store, { accountId: 'user', workspaceId: 'workspace', generation: 1, validate: async () => true,
    queries: () => [outlook, jira], changed: vi.fn(), openExternal: vi.fn() });
  return { d, s, request, refresh: () => s.refresh(version(s)) };
}

// Exercise the shipping PowerShell classifier and operation using COM-shaped appointments.
const mockCalendar = String.raw`
function Connect-Hyper {
  $script:ns = @{ DefaultStore = @{ StoreID = 'AA' } }
  $items = [pscustomobject]@{ IncludeRecurrences = $false }
  $items | Add-Member ScriptMethod Sort { param($key) }
  $items | Add-Member ScriptMethod Restrict {
    param($filter)
    $rows = @()
    for ($i=0; $i -lt 10; $i++) {
      $start = [datetime]::SpecifyKind(([datetime]'2026-11-29 07:00').AddMinutes(10 * $i), 'Utc')
      $row = [pscustomobject]@{ Start=$start; End=$start.AddMinutes(10); EntryID=('A'+$i);
        AllDayEvent=$false; RecurrenceState=0; Subject=('secret-'+$i);
        Sensitivity=@(2,3,$null,25,2,0,0,0,0,0)[$i]; BusyStatus=@(2,1,3,2,0,4,0,2,2,2)[$i];
        ResponseStatus=$(if ($i -eq 7) {4} else {3}); MeetingStatus=$(if ($i -eq 8) {5} else {3}) }
      if ($i -eq 9) {
        $row.RecurrenceState = 3
        $row | Add-Member ScriptMethod GetRecurrencePattern {
          $exceptions = [pscustomobject]@{ Count=1; Row=$this }
          $exceptions | Add-Member ScriptMethod Item { return @{ Deleted=$false; AppointmentItem=$this.Row; OriginalDate=[datetime]'2026-11-28' } }
          return @{ StartTime=[datetime]'2026-11-01 07:00'; Exceptions=$exceptions }
        }
      }
      $rows += $row
    }
    if ($request.id -eq 'cap') { return @($rows[7]) * 2000 }
    return $rows
  }
  $script:calendar = @{ StoreID='AA'; Items=$items }
}
`;
it.skipIf(process.platform !== 'win32')('reduces private, confidential and unknown COM items before wire, disk and Focus, and refuses the wrong store', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now }); onTestFinished(() => { vi.useRealTimers(); });
  const directory = mkdtempSync(join(tmpdir(), 'HyperHubOutlook-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const script = join(directory, 'test.ps1');
  writeFileSync(script, '\uFEFF' + HyperOutlookScript.replace('\nwhile ($null -ne ($line', '\n' + mockCalendar + '\nwhile ($null -ne ($line'));
  const input = [['normal', 'AA'], ['changed', 'BB'], ['cap', 'AA']].map(([id, storeId]) => JSON.stringify({ id, op: 'hub.calendar', args: { ...wire, storeId } })).join('\n') + '\n';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { encoding: 'utf8', input, timeout: 8000, windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
  const [ok, rejected, capped] = result.stdout.trim().split(/\r?\n/).map(s => JSON.parse(s));
  expect(rejected).toMatchObject({ ok: false, message: 'Outlook calendar store changed.' });
  const reply = HyperOutlookValues['hub.calendar'].parse(ok.value);
  expect(reply.exhausted).toBe(true);
  expect(capped.value).toMatchObject({ exhausted: false, completeness: 'partial', events: [] });
  expect(reply.events.at(-1)).toMatchObject({ originalStart: expect.stringMatching(/^2026-11-2[78]T/), entryId: 'A9' });
  expect(reply.events).toHaveLength(7);
  for (const event of reply.events.slice(0, 4)) expect(Object.keys(event).sort()).toEqual(['end', 'private', 'start']);
  expect(reply.events.slice(4).map(e => !e.private && e.availability)).toEqual(['working-elsewhere', 'free', 'busy']);
  const { d, refresh } = scenario(async () => reply); onTestFinished(d.cleanup);
  const snap = await refresh();
  const cached = Object.values(d.open().current.cache).find(batch => batch.status.kind === 'outlook-calendar')!.agenda;
  expect(cached).toEqual(snap.agenda);
  for (const output of [reply, cached, snap]) expect(JSON.stringify(output)).not.toMatch(/secret-[0123478]/);
  for (const e of snap.agenda!.filter(e => e.private)) expect(Object.keys(e).sort()).toEqual(
    ['allDay', 'availability', 'id', 'interval', 'isMeeting', 'private', 'sourceKind']);
  expect(snap.plan?.blocks[0].start.iso).toBe('2026-11-29T07:40:00.000Z');
});

const publicEvent = { private: false as const, entryId: 'AA01', originalStart: '2026-11-29T09:00:00Z', start: '2026-11-29T10:00:00Z',
  end: '2026-11-29T11:00:00Z', title: 'Moved meeting', availability: 'busy' as const, isMeeting: true, organizerIsOwner: false, allDay: false };
it('keys moved occurrences by original start and never infers free time from partial reads', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now }); onTestFinished(() => { vi.useRealTimers(); });
  let reply: Reply = { ...wire, exhausted: false, completeness: 'partial', events: [publicEvent] };
  const { d, s, refresh } = scenario(async () => reply); onTestFinished(d.cleanup);
  const partial = await refresh();
  expect(partial.plan?.unscheduled[0].code).toBe('no-coverage');
  const originalId = partial.agenda![0].id;
  reply = { ...wire, exhausted: true, completeness: 'complete', events: [{ ...publicEvent, start: '2026-11-29T11:00:00Z', end: '2026-11-29T12:00:00Z' }] };
  const complete = await refresh();
  expect(complete.agenda).toMatchObject([{ id: originalId, interval: { start: { iso: '2026-11-29T11:00:00.000Z' } } }]);
  expect(complete.plan?.blocks[0].provisional).toBe(false);
  vi.advanceTimersByTime(31 * 60_000);
  expect(s.snapshot().plan?.blocks[0].provisional).toBe(true);
  reply = { ...wire, exhausted: false, completeness: 'partial', events: [] };
  const stale = await refresh();
  expect(stale.plan?.blocks[0].provisional).toBe(true);
  expect(stale.agenda![0]).toMatchObject({ private: true, availability: 'busy' });
  expect(JSON.stringify(d.open().current.cache)).not.toContain('Moved meeting');
});

it('discards a queued old-store response and revokes its last complete coverage', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now }); onTestFinished(() => { vi.useRealTimers(); });
  let profile = 'AA', release: (() => void) | undefined;
  let queue = Promise.resolve();
  const { d, s } = scenario(async () => { await queue; return { ...wire, exhausted: true, completeness: 'complete', events: [publicEvent] }; }, () => profile);
  onTestFinished(d.cleanup);
  const refresh = () => s.refresh(version(s), 'outlook-calendar');
  expect((await refresh()).agenda).toHaveLength(1);
  queue = new Promise(r => { release = r; });
  const pending = refresh();
  profile = 'BB'; release!();
  const result = await pending;
  expect(result.agenda).toEqual([]);
  expect(result.day?.coverage.every(c => c.basis === 'missing')).toBe(true);
  const persisted = d.open().current;
  expect(Object.values(persisted.cache).some(batch => batch.status.kind === 'outlook-calendar')).toBe(false);
  expect(JSON.stringify(persisted)).not.toContain('Moved meeting');
});

it('coalesces open, focus and recovery reads and observes active and Focus cadences', async ({ onTestFinished }) => {
  vi.useFakeTimers({ now }); onTestFinished(() => { vi.useRealTimers(); });
  const { d, s, request } = scenario(async () => ({ ...wire, exhausted: true, completeness: 'complete', events: [] })); onTestFinished(d.cleanup);
  const auto = (period?: number) => s.refresh(version(s), 'outlook-calendar', false, period);
  await Promise.all([auto(), auto(), auto()]);
  vi.advanceTimersByTime(59_999);
  await auto();
  expect(request.mock.calls.filter(([op]) => op === 'hub.calendar')).toHaveLength(1);
  vi.advanceTimersByTime(1); await auto();
  vi.advanceTimersByTime(299_999); await auto(300_000);
  expect(request.mock.calls.filter(([op]) => op === 'hub.calendar')).toHaveLength(2);
  vi.advanceTimersByTime(1); await auto(300_000);
  expect(request.mock.calls.filter(([op]) => op === 'hub.calendar')).toHaveLength(3);
});
