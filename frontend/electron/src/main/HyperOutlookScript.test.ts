import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { HyperOutlookValues } from './HyperOutlookSchema';
import { HyperOutlookScript } from './HyperOutlookScript';

const addressListFixture = String.raw`
$ErrorActionPreference = 'Stop'
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:HYPER_TEST_OUTLOOK_SCRIPT, [ref]$null, [ref]$errors)
if ($errors) { throw ($errors | Out-String) }
$required = @('Hyper-ValidEmail', 'Hyper-ClipField', 'Hyper-AddPerson', 'Hyper-QueryMatches', 'Hyper-OutlookPeople')
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $required }, $false)
. ([scriptblock]::Create(($functions.Extent.Text -join [Environment]::NewLine)))

function Connect-Hyper {}
function Hyper-EntryPerson($entry) {
  return @{ name = $entry.Name; email = $entry.Address; source = 'outlook' }
}
function New-HyperTestEntries([object[]]$rows, [bool]$indexedPartial) {
  $entries = [pscustomobject]@{ Count = $rows.Count; Rows = $rows; IndexedPartial = $indexedPartial }
  $entries | Add-Member ScriptMethod Item {
    param($key)
    if ($key -is [string]) {
      if ($this.IndexedPartial) { return $this.Rows[0] }
      throw 'String lookup unavailable'
    }
    return $this.Rows[$key-1]
  }
  return $entries
}
$ns = [pscustomobject]@{ AddressLists = $null }
$ns | Add-Member ScriptMethod GetDefaultFolder { throw 'No local folders' }
$ns | Add-Member ScriptMethod CreateRecipient { throw 'Ambiguous name' }

$partial = @(1..415 | ForEach-Object { [pscustomobject]@{ Name = "Miller $_"; Address = "match$_@example.com" } })
foreach ($case in @(@{ Rows = 400; Limit = 10 }, @{ Rows = 401; Limit = 10 }, @{ Rows = 1; Limit = 1; IndexedPartial = $true })) {
  $exact = @([pscustomobject]@{ Name = 'Miller'; Address = 'exact@example.com' })
  for ($i = 1; $i -lt $case.Rows; $i++) {
    $exact += [pscustomobject]@{ Name = "Unrelated $i"; Address = "other$i@example.com" }
  }
  $ns.AddressLists = [pscustomobject]@{ Count = 2; Items = @(
    [pscustomobject]@{ AddressEntries = (New-HyperTestEntries $partial ([bool]$case.IndexedPartial)) }
    [pscustomobject]@{ AddressEntries = (New-HyperTestEntries $exact $false) }
  ) }
  $ns.AddressLists | Add-Member ScriptMethod Item { param($key) $this.Items[$key-1] }
  $actual = @(Hyper-OutlookPeople 'Miller' $case.Limit $false)
  if ($actual.Count -ne $case.Limit -or $actual[0].email -ne 'exact@example.com') {
    throw "List with $($case.Rows) entries returned $($actual.email -join ',')"
  }
}
`;

it.skipIf(process.platform !== 'win32')('keeps exact Outlook address-list matches ahead of partials', () => {
  const folder = mkdtempSync(join(tmpdir(), 'HyperTask-Outlook-'));
  try {
    const production = join(folder, 'production.ps1');
    const fixture = join(folder, 'fixture.ps1');
    writeFileSync(production, '\uFEFF' + HyperOutlookScript, 'utf8');
    writeFileSync(fixture, addressListFixture, 'utf8');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture], {
      encoding: 'utf8',
      env: { ...process.env, HYPER_TEST_OUTLOOK_SCRIPT: production },
      timeout: 8000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 10000);

it.skipIf(process.platform !== 'win32')('PowerShell cancels a meeting, deletes a personal event, and refuses permanent or stale mail removal', () => {
  const folder = mkdtempSync(join(tmpdir(), 'HyperTask-Outlook-delete-'));
  try {
    const script = join(folder, 'fixture.ps1');
    const mocks = String.raw`
$fixtureFolder = @{ 3 = 'DD'; 6 = 'AA'; 5 = 'BB'; 16 = 'CC' }
function Connect-Hyper {}
function Hyper-Account { return @{ SmtpAddress = 'owner@example.com' } }
function Hyper-SameSender($item, [string]$address) { if ($address -ne 'owner@example.com') { throw 'Wrong sender' } }
function Hyper-MockItem($id, $meeting, $folder) {
  $item = [pscustomobject]@{
    Id = $id; MeetingStatus = $meeting; RecurrenceState = 0; Recipients = $(if ($meeting -eq 1) { @('test@example.com') } else { @() });
    Parent = @{ EntryID = $folder; StoreID = 'primary' }; LastModificationTime = [datetime]::SpecifyKind([datetime]'1970-01-01', [DateTimeKind]::Utc)
  }
  $item | Add-Member ScriptMethod Send { [Console]::Error.WriteLine(('send:' + $this.Id + ':' + $this.MeetingStatus)) }
  $item | Add-Member ScriptMethod Delete { [Console]::Error.WriteLine(('delete:' + $this.Id)) }
  return $item
}
$ns = [pscustomobject]@{ DefaultStore = @{ StoreID = 'primary' } }
$ns | Add-Member ScriptMethod GetDefaultFolder { param($key) return @{ EntryID = $fixtureFolder[$key] } }
function Hyper-Resolve($id) { return Hyper-MockItem $id $(if ($id -eq 'A1') { 1 } else { 0 }) '00' }
function Hyper-MailResolve($id) { return Hyper-MockItem $id 0 $(if ($id -eq 'D4') { 'DD' } else { 'AA' }) }
function Hyper-MailSummary($item) { return @{ subject = 'Test message'; from = @{ name = 'Tester'; email = 'test@example.com' } } }
`;
    const epoch = '1970-01-01T00:00:00.0000000Z';
    const auth = { account: 'owner@example.com', expect: epoch };
    const request = (op: string, args: unknown) => JSON.stringify({ id: op, op, args });
    const input = [
      request('event.delete', { id: 'A1', send: true, ...auth }),
      request('event.delete', { id: 'B2', send: false, ...auth }),
      request('mail.deleteTarget', { id: 'C3' }),
      request('mail.delete', { id: 'C3', folder: 'AA', ...auth }),
      request('mail.delete', { id: 'D4', folder: 'DD', ...auth }),
      request('mail.delete', { id: 'C3', folder: 'BB', ...auth }),
    ].join('\n') + '\n';
    writeFileSync(script, '\uFEFF' + HyperOutlookScript.replace('\nwhile ($null -ne ($line', '\n' + mocks + '\nwhile ($null -ne ($line'), 'utf8');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8', input, timeout: 8000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(replies.map(reply => reply.ok)).toEqual([true, true, true, true, false, false]);
    expect(replies[2].value).toMatchObject({ folder: 'AA', lastModified: epoch });
    expect(result.stderr.trim().split(/\r?\n/)).toEqual(['send:A1:5', 'delete:A1', 'delete:B2', 'delete:C3']);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 10000);

it.skipIf(process.platform !== 'win32')('pages modification ties, reports exhaustion and filters protected mail inside the PowerShell host', () => {
  const folder = mkdtempSync(join(tmpdir(), 'HyperTask-Outlook-mail-'));
  try {
    const script = join(folder, 'fixture.ps1');
    const mocks = `
function Reset-Hyper {}
function Connect-Hyper {}
function Hyper-ComGet($item,$field) { return $item.$field }
function Hyper-HubStore { return 'AA' }
function Hyper-HubMapi($item,$tag) { if ($tag -eq '0x007D001F') { return 'Date: Sun, 1 Nov 2026 02:00:00 +0200' }; return $null }
$items = New-Object Collections.ArrayList
foreach ($id in @('33','11','22','44','55')) {
  $time = [datetime]::SpecifyKind([datetime]'2026-11-01', [DateTimeKind]::Utc)
  [void]$items.Add([pscustomobject]@{ EntryID = $id; Class = 43; MessageClass = 'IPM.Note'; Sensitivity = $(if ($id -eq '22') {3} else {0});
    Permission = $(if ($id -eq '55') {1} else {0}); SentOn = $time; LastModificationTime = $time; FlagStatus = 2;
    TaskDueDate = [datetime]'4501-01-01'; ConversationID = 'thread'; Subject = 'Sensitive marker' })
}
Add-Member -InputObject $items -MemberType ScriptMethod -Name Sort -Value { param($field) } -Force
$container = [pscustomobject]@{ Rows = $items }
$container | Add-Member ScriptMethod Restrict { return ,$this.Rows }
function Hyper-Folder($name) { return @{ Items = $container; StoreID = 'AA' } }
`;
    writeFileSync(script, '\uFEFF' + HyperOutlookScript.replace('\nwhile ($null -ne ($line', '\n' + mocks + '\nwhile ($null -ne ($line'), 'utf8');
    const modified = '2026-11-01T00:00:00.0000000Z';
    const args = { storeId: 'AA', folder: 'inbox', since: '2026-10-01T00:00:00Z', activeFlags: false, limit: 2 };
    const input = [null, { modified, entryId: '22' }, { modified, entryId: '44' }].map(after =>
      JSON.stringify({ id: 'test', op: 'hub.mailHeaders', args: { ...args, after } })).join('\n') + '\n';
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8', input, windowsHide: true, timeout: 8000,
    });
    expect(result.status, result.stderr).toBe(0);
    const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(replies.every(r => r.ok), result.stdout).toBe(true);
    const pages = replies.map(r => HyperOutlookValues['hub.mailHeaders'].parse(r.value));
    expect(pages.map(p => p.next?.entryId)).toEqual(['22', '44', undefined]);
    expect(pages.map(p => p.exhausted)).toEqual([false, false, true]);
    expect(pages.flatMap(p => p.headers.map((h: { entryId: string }) => h.entryId))).toEqual(['11', '33', '44']);
    expect(pages.flatMap(p => p.excludedIds)).toEqual(['22', '55']);
    expect(pages[0].headers[0]).toMatchObject({ flagDue: null, authoredZone: '+02:00' });
    expect(result.stdout).not.toContain('Sensitive marker');
  } finally { rmSync(folder, { recursive: true, force: true }); }
}, 10000);

it('decodes unknown mail metadata conservatively and removes unclassified details', () => {
  const modified = '2026-11-29T07:00:00Z';
  const page = HyperOutlookValues['hub.mailHeaders'].parse({ storeId: 'AA', exhausted: true, complete: false,
    replyCoverage: false, next: null, excludedIds: [], headers: [{ entryId: '11', modified, flag: 9, flagDue: '4501-01-01T00:00:00Z' }] });
  expect(page.headers[0]).toMatchObject({ visibility: 'unknown', flag: 'unknown', flagDue: null, authoredAt: null });
  expect(HyperOutlookValues['hub.mailDetail'].parse({ storeId: 'AA', entryId: '11', modified, body: 'Hidden text',
    subject: 'Hidden subject', to: [], sender: '', distributionList: null })).toBeNull();
  expect(HyperOutlookValues['hub.mailHeaders'].safeParse({ ...page, exhausted: false }).success).toBe(false);
});
