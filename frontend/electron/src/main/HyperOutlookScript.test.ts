import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
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
