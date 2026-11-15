// Adapted from OpenBot manage/plugin-{bot,tool}-page.tsx, MIT Copyright (c) 2026 CopilotKit.
import { HyperAppAccessAction } from './HyperAppAccessAction';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hyperOpenBotRequest } from '../transport';
import { hyperLoadPluginBots, hyperPluginGrant as writeGrant, type HyperPluginBot, type HyperSharedApproval, type HyperConnectionSelection } from './HyperPluginDetailsApi';
import type { HyperConnectionServer } from './HyperConnectionsApi';

export function HyperSharedApprovalFields({ value, onChange, disabled = false }: { value: HyperSharedApproval; onChange(value: HyperSharedApproval): void; disabled?: boolean }) {
  const audienceId = useId();
  const named = value.audience === 'people' || value.members.length > 0;
  const options: { audience: HyperSharedApproval['audience']; label: string }[] = [
    { audience: 'owner', label: 'Owner only' },
    ...(named ? [{ audience: 'people' as const, label: `Named: ${value.members.map(member => `${member.kind}: ${member.value}`).join(', ')}` }] : []),
    { audience: 'team', label: 'Everyone' },
  ];
  return <fieldset disabled={disabled} className="space-y-2"><legend className="font-medium">Who can use the shared account through this Bot</legend>{options.map(option => <label key={option.audience} className="flex gap-2"><input type="radio" name={`shared-audience-${audienceId}`} checked={value.audience === option.audience} onChange={() => onChange({ ...value, audience: option.audience, members: option.audience === 'people' ? value.members : [] })} />{option.label}</label>)}<label className="flex gap-2"><input type="checkbox" checked={value.outsideInput} onChange={e => onChange({ ...value, outsideInput: e.target.checked })} />Allow outside input</label></fieldset>;
}
interface HyperGrantScope { key: string; active: boolean; operation: number }
interface HyperPendingGrant { ref: string; bot: string; scope: HyperGrantScope; operation: number; serverResolved?: boolean }
interface HyperBatchApprovals { scope: HyperGrantScope; operation: number; selection: string; values: Record<string, HyperSharedApproval | undefined> }

export function HyperPluginGrants({ server, busy, selection, navigate, run, callbackAllowed, admin = false }: { server: HyperConnectionServer; busy: boolean; callbackAllowed?: boolean; admin?: boolean; selection?: HyperConnectionSelection; navigate(value: HyperConnectionSelection): void; run(action: () => Promise<void>): Promise<void> }) {
  const [bots, setBots] = useState<HyperPluginBot[]>();
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<HyperPendingGrant>();
  const [approval, setApproval] = useState<HyperSharedApproval>({ audience: 'owner', outsideInput: false, members: [] });
  const [batch, setBatch] = useState(false);
  const [batchBots, setBatchBots] = useState<string[]>([]);
  const [batchTools, setBatchTools] = useState<string[]>([]);
  const [batchGrant, setBatchGrant] = useState(true);
  const [batchApprovals, setBatchApprovals] = useState<HyperBatchApprovals>();
  const [progress, setProgress] = useState('');
  useEffect(() => { let active = true; Promise.all([hyperLoadPluginBots(), hyperOpenBotRequest<{ edition: string }>('/api/capabilities')]).then(([value, capabilities]) => { if (active) { if (!['personal', 'team'].includes(capabilities.edition)) throw new Error('Edition unavailable'); setBots(value); setEdition(capabilities.edition); } }).catch(() => { if (active) setError('Could not load Bots. Refresh this app to retry.'); }); return () => { active = false; }; }, [server.id]);
  const [edition, setEdition] = useState<string>();
  const chosenBot = selection?.page === 'bot' ? selection.agentId : undefined;
  const chosenTool = selection?.page === 'tool' ? selection.tool : undefined;
  const scopeKey = JSON.stringify([server.id, server.accountMode, selection?.page, chosenBot, chosenTool, admin, callbackAllowed, edition]);
  const currentScope = useRef<HyperGrantScope>({ key: scopeKey, active: true, operation: 0 });
  if (currentScope.current.key !== scopeKey) currentScope.current = { key: scopeKey, active: true, operation: 0 };
  const scope = currentScope.current, operation = scope.operation;
  const currentApproval = useRef(approval); currentApproval.current = approval;
  const currentBatch = useRef(batchApprovals); currentBatch.current = batchApprovals;
  const valid = (ticket: number) => currentScope.current === scope && scope.active && scope.operation === ticket;
  useEffect(() => { scope.active = true; setPending(undefined); setBatch(false); setBatchApprovals(undefined); setProgress(''); return () => { scope.active = false; }; }, [scope]);
  function invalidate() { scope.operation++; }
  function close() { if (!valid(operation)) return; invalidate(); setPending(undefined); setBatch(false); setBatchApprovals(undefined); setProgress(''); }
  function go(value: HyperConnectionSelection) { if (!valid(operation)) return; close(); navigate(value); }
  async function execute(ticket: number, action: () => Promise<void>) {
    if (!valid(ticket)) return;
    try { await run(async () => { if (valid(ticket)) await action(); }); }
    catch { if (valid(ticket)) setError('Access could not be changed. Refresh the server state and retry.'); }
  }
  async function grant(ticket: number, ...args: Parameters<typeof writeGrant>) {
    if (!valid(ticket)) throw new Error('The grant target or operation changed. Start again.');
    await writeGrant(...args);
  }
  async function exposure(ticket: number, bot: string) {
    if (!valid(ticket)) throw new Error('The grant target changed.');
    const page = await hyperOpenBotRequest<{ apps: { serverId: string; needed: HyperSharedApproval; covered: boolean }[] }>(`/api/approvals/shared-use/bot/${encodeURIComponent(bot)}`);
    if (!valid(ticket)) throw new Error('The grant target changed.');
    const app = page.apps.find(value => value.serverId === server.id);
    // This endpoint lists held apps only. The original grant endpoint resolves
    // first-grant exposure itself when approval is omitted, preserving admin decisions.
    if (!app) return { needed: undefined, covered: false, serverResolved: true };
    if (!app.needed || !Array.isArray(app.needed.members) || !['owner', 'people', 'team'].includes(app.needed.audience)) throw new Error('Server-proposed shared access is unavailable.');
    return { ...app, serverResolved: false };
  }
  const tools = server.tools.filter(t => !chosenTool || t.name === chosenTool);
  const reads = server.tools.filter(tool => tool.effect === 'read');
  const alwaysOn = server.id === 'routines' || edition === 'personal';
  const holders = new Set([...server.tools.flatMap(t => t.grantedTo ?? []), ...(server.withdrawn?.flatMap(t => t.grantedTo) ?? [])]);
  const roster: HyperPluginBot[] = [...(bots ?? []).filter(b => !b.hidden || holders.has(b.id)), ...[...holders].filter(id => !bots?.some(b => b.id === id)).map(id => ({ id, name: 'Bot no longer here', hidden: true }))];
  async function change(ref: string, bot: string, granted: boolean) {
    if (edition === 'personal' || busy || !valid(operation)) return;
    const ticket = ++scope.operation; setPending(undefined); setBatchApprovals(undefined); setError('');
    await execute(ticket, async () => {
      if (granted && server.accountMode === 'shared') {
        const app = await exposure(ticket, bot);
        if (app.covered) await grant(ticket, ref, bot, true);
        else { if (app.needed) setApproval(app.needed); setPending({ ref, bot, scope, operation: ticket, serverResolved: app.serverResolved }); }
      } else await grant(ticket, ref, bot, granted);
    });
  }
  async function readBulk() {
    if (!chosenBot || busy || !valid(operation)) return;
    const ticket = ++scope.operation; setError('');
    await execute(ticket, async () => {
      if (server.accountMode === 'shared') { const app = await exposure(ticket, chosenBot); if (app.needed) setApproval(app.needed); setPending({ ref: '*reads*', bot: chosenBot, scope, operation: ticket, serverResolved: app.serverResolved }); return; }
      let done = 0;
      try { for (const tool of reads) { await grant(ticket, tool.ref ?? `${server.id}/${tool.name}`, chosenBot, true); if (valid(ticket)) setProgress(`${++done}/${reads.length}`); } }
      finally { if (valid(ticket)) setProgress(''); }
    });
  }
  function updateBatch(update: () => void) { if (!valid(operation)) return; invalidate(); setBatchApprovals(undefined); update(); }
  const batchSelection = JSON.stringify([batchBots, batchTools, batchGrant]);
  const sharedBatch = server.accountMode === 'shared' && batchGrant;
  const proof = batchApprovals?.scope === scope && batchApprovals.operation === operation && batchApprovals.selection === batchSelection ? batchApprovals : undefined;
  async function reviewBatch() {
    if (busy || !valid(operation) || !batchBots.length || !batchTools.length) return;
    const ticket = ++scope.operation;
    await execute(ticket, async () => {
      const values: Record<string, HyperSharedApproval | undefined> = {};
      for (const bot of batchBots) values[bot] = (await exposure(ticket, bot)).needed;
      if (valid(ticket)) setBatchApprovals({ scope, operation: ticket, selection: batchSelection, values });
    });
  }
  async function confirmBatch() {
    if (busy || !valid(operation) || !batchBots.length || !batchTools.length || sharedBatch && !proof) return;
    await execute(operation, async () => {
      if (sharedBatch && currentBatch.current !== proof) return;
      let done = 0; const total = batchBots.length * batchTools.length; setProgress(`0/${total}`);
      try {
        for (const bot of batchBots) for (const ref of batchTools) {
          if (sharedBatch && currentBatch.current !== proof) return;
          await grant(operation, ref, bot, batchGrant, sharedBatch ? proof!.values[bot] : undefined);
          if (valid(operation)) setProgress(`${++done}/${total}`);
        }
        if (valid(operation)) setBatch(false);
      } finally { if (valid(operation)) setProgress(''); }
    });
  }
  async function approvePending() {
    if (busy || !pending || pending.scope !== scope || !valid(pending.operation) || !pending.serverResolved && currentApproval.current !== approval) return;
    await execute(pending.operation, async () => {
      if (!pending.serverResolved && currentApproval.current !== approval) return;
      if (pending.ref === '*reads*') {
        let done = 0;
        try { for (const tool of reads) { if (!pending.serverResolved && currentApproval.current !== approval) return; await grant(pending.operation, tool.ref ?? `${server.id}/${tool.name}`, pending.bot, true, pending.serverResolved ? undefined : approval); if (valid(pending.operation)) setProgress(`${++done}/${reads.length}`); } }
        finally { if (valid(pending.operation)) setProgress(''); }
      } else await grant(pending.operation, pending.ref, pending.bot, true, pending.serverResolved ? undefined : approval);
      if (valid(pending.operation)) setPending(undefined);
    });
  }
  if (edition === 'personal') return <div className="space-y-3"><h2>Bot and tool access</h2><p>Every app you connect is available to every Bot. Disconnect or turn off this app in Connections to take it from all Bots.</p>{tools.map(tool => <p key={tool.name}>{tool.name} · {tool.description}</p>)}</div>;
  return <div className="space-y-3"><h2 className="font-medium">Bot and tool access</h2>{error && <p role="alert" className="text-destructive">{error}</p>}{!bots && !error && <p role="status">Loading Bots…</p>}
    {!chosenBot && !chosenTool && roster.map(bot => <Button variant="outline" key={bot.id} onClick={() => go({ page: 'bot', key: server.id, agentId: bot.id })}>{bot.name}{bot.hidden ? ' · hidden' : ''}</Button>)}
    {(chosenBot || chosenTool) && <Button variant="outline" onClick={() => go({ page: 'app', key: server.id })}>Back to app</Button>}
    {chosenBot && <HyperAppAccessAction agentId={chosenBot} app={server.id} admin={admin} onSettled={() => { if (valid(operation)) void run(async () => {}); }} onOpenConnection={key => go({ page: 'app', key })} />}{chosenBot && <h3>{bots?.find(b => b.id === chosenBot)?.name ?? chosenBot}</h3>}
    {chosenBot && !alwaysOn && <Button disabled={busy || !bots} onClick={() => void readBulk()}>Grant every read-only action · {reads.length}</Button>}{progress && <p role="status">Granting {progress}</p>}
    {!alwaysOn && <Button disabled={busy || !bots} variant="outline" onClick={() => { if (!valid(operation)) return; invalidate(); setPending(undefined); setBatch(true); setBatchBots([]); setBatchTools([]); setBatchApprovals(undefined); }}>Choose Bots and tools in a batch</Button>}
    {batch && <div role="dialog" aria-label="Grant tools to Bots" className="space-y-3 rounded-lg border border-border p-4"><h3>Choose Bots and tools</h3><p>Each change is saved separately. If a request fails, earlier changes remain and the current server state is reloaded.</p>
      {roster.filter(bot => bots?.some(b => b.id === bot.id)).map(bot => <label className="flex gap-2" key={bot.id}><input type="checkbox" disabled={busy} checked={batchBots.includes(bot.id)} onChange={e => updateBatch(() => setBatchBots(e.target.checked ? [...batchBots, bot.id] : batchBots.filter(id => id !== bot.id)))} />{bot.name}{bot.hidden ? ' · hidden' : ''}</label>)}
      {server.tools.map(tool => { const ref = tool.ref ?? `${server.id}/${tool.name}`; return <label className="flex gap-2" key={ref}><input type="checkbox" disabled={busy} checked={batchTools.includes(ref)} onChange={e => updateBatch(() => setBatchTools(e.target.checked ? [...batchTools, ref] : batchTools.filter(id => id !== ref)))} />{tool.name} · {tool.effect === 'read' ? 'Reads' : 'Changes things'}{tool.destructive ? ' · Destructive' : ''}</label>; })}
      <label>Action<select disabled={busy} value={String(batchGrant)} onChange={e => updateBatch(() => setBatchGrant(e.target.value === 'true'))}><option value="true">Grant</option><option value="false">Revoke</option></select></label>
      {sharedBatch && <><p>These Bots act as the team account. Review each Bot's server-proposed audience and outside input.</p>{proof && batchBots.map(bot => <div key={bot}><h4>{roster.find(row => row.id === bot)?.name ?? bot}</h4>{proof.values[bot] ? <HyperSharedApprovalFields disabled={busy} value={proof.values[bot]} onChange={value => setBatchApprovals({ ...proof, values: { ...proof.values, [bot]: value } })} /> : <p>This Bot has not held this shared app. The server will preserve any administrator approval or resolve this Bot's current audience and outside input on its first grant. No client membership is supplied.</p>}</div>)}</>}
      <p>{batchBots.length} Bots × {batchTools.length} tools = {batchBots.length * batchTools.length} changes.</p>
      {sharedBatch && !proof ? <Button disabled={busy || !batchBots.length || !batchTools.length} onClick={() => void reviewBatch()}>Review shared audiences</Button> : <Button disabled={busy || !batchBots.length || !batchTools.length || !!proof && batchBots.some(bot => proof.values[bot]?.audience === 'people' && !proof.values[bot]!.members.length)} onClick={() => void confirmBatch()}>Confirm {batchGrant ? 'grant' : 'revoke'} batch</Button>}
      <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
    </div>}
    <Input aria-label="Search tools" value={search} onChange={e => setSearch(e.target.value)} />{!tools.length && <p>{chosenTool ? 'Tool not found. It may have been withdrawn.' : 'No tools reported.'}</p>}
    {(['read', 'write'] as const).map(effect => <div key={effect}><h3>{effect === 'read' ? 'Reads' : 'Changes things, including unknown actions'}</h3>{tools.filter(t => (t.effect === 'read' ? 'read' : 'write') === effect && `${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase())).map(tool => <div key={tool.name} className="space-y-2 rounded-lg border border-border p-4"><Button variant="ghost" onClick={() => go({ page: 'tool', key: server.id, tool: tool.name })}>{tool.name}</Button><p>{tool.description}</p>{tool.destructive && <p className="text-destructive">Vendor marks this action as destructive.</p>}{chosenTool && <pre className="overflow-x-auto text-xs">{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre>}{(chosenBot ? roster.filter(b => b.id === chosenBot) : chosenTool ? roster : []).map(bot => <label key={bot.id} className="flex gap-2"><input type="checkbox" checked={alwaysOn || !!tool.grantedTo?.includes(bot.id)} disabled={busy || alwaysOn || !bots || !bots.some(b => b.id === bot.id)} onChange={e => void change(tool.ref ?? `${server.id}/${tool.name}`, bot.id, e.target.checked)} />{bot.name}{bot.hidden ? ' · hidden' : ''}{!callbackAllowed && !bot.hasCallbackToken && <span className="text-muted-foreground">Callback authentication also requires a Bot credential or deployment callback secret.</span>}</label>)}</div>)}</div>)}
    {server.withdrawn?.map(tool => <div key={tool.ref} className="rounded-lg border border-border p-3"><p>{tool.name} · Withdrawn. Held grants are not offered; they become active again if the vendor restores this tool.</p>{tool.grantedTo.map(bot => <Button key={bot} disabled={busy} variant="outline" onClick={() => void execute(operation, async () => { await grant(operation, tool.ref, bot, false); })}>Revoke from {bots?.find(b => b.id === bot)?.name ?? bot}</Button>)}</div>)}
    {pending?.scope === scope && valid(pending.operation) && <div role="alertdialog" aria-label="Approve shared app access" className="space-y-3 rounded-lg border border-border p-4"><p>{roster.find(bot => bot.id === pending.bot)?.name ?? pending.bot} will use the deployment's shared account. Approve its audience and outside input before granting access.</p>{pending.serverResolved ? <p>This Bot has not held this shared app. The server will preserve any administrator approval or resolve this Bot's current audience and outside input on its first grant. No client membership is supplied.</p> : <HyperSharedApprovalFields value={approval} onChange={setApproval} disabled={busy} />}<Button disabled={busy || !pending.serverResolved && approval.audience === 'people' && !approval.members.length} onClick={() => void approvePending()}>Approve and grant</Button><Button disabled={busy} variant="outline" onClick={close}>Cancel</Button></div>}
  </div>;
}
