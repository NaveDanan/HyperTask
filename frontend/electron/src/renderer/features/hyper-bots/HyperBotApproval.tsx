// Ported from bot-hq (web/src/styles/cards.css), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { Check, CircleAlert, CircleSlash, LoaderCircle } from 'lucide-react';
import { HYPER_BOTS_TOOLS, type HyperBotsApproval, type HyperBotsApprovalStatus, type HyperBotsCardRow, type HyperBotsDelivery, type HyperBotsSettings } from '@shared/HyperBots';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HyperBotToolLogo } from './HyperBotBrandLogos';
const botName = (settings: HyperBotsSettings | null | undefined, id: string) => settings?.bots.find(bot => bot.id === id)?.name ?? id;
const STATUS_LABEL: Record<HyperBotsApprovalStatus, string> = { pending: 'waiting', approved: 'approved', executing: 'running', done: 'done', denied: 'denied', failed: 'failed', unknown: 'unknown', skipped: 'skipped — the bot no longer has this tool' };
type Decide = (id: string, approved: boolean, delivery?: HyperBotsDelivery) => void;
function HyperBotApprovalDetails({ approval, name }: { approval: HyperBotsApproval; name: string }) {
  const tool = HYPER_BOTS_TOOLS[approval.tool as keyof typeof HYPER_BOTS_TOOLS];
  const write = approval.access === 'write';
  const rows = approval.card ?? [];
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{name}</span>
      <span className="hb-tool-name text-muted-foreground"><HyperBotToolLogo tool={approval.tool} />{tool?.label ?? approval.tool}</span>
      <span className={cn('ml-auto rounded px-1.5 py-0.5 text-xs font-medium', write ? 'border border-warning/50 bg-warning-surface text-warning-foreground' : 'bg-secondary text-secondary-foreground')}>{write ? 'Write' : 'Read'}</span>
    </div>
    {approval.destination && <p className="rounded-md bg-muted px-2 py-1 text-xs"><span className="text-muted-foreground">{rows.length ? 'Via: ' : 'To: '}</span><span className="font-medium break-words">{approval.destination}</span></p>}
    <p className="break-words whitespace-pre-wrap">{approval.summary}</p>
    {!!rows.length && <HyperBotsCardRows rows={rows} />}
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Details</summary>
      <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono break-words whitespace-pre-wrap">{JSON.stringify(approval.args, null, 2)}</pre>
    </details>
  </div>;
}

export function HyperBotsApprovalCard({ approval, botName, busy, onDecide }: { approval: HyperBotsApproval; botName: string; busy: boolean; onDecide: Decide }) {
  const tool = HYPER_BOTS_TOOLS[approval.tool as keyof typeof HYPER_BOTS_TOOLS];
  const spinner = busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />;
  return <section aria-label={`${botName} needs your approval`} className={cn('card approval-card space-y-2 rounded-lg border bg-card p-3 text-sm', approval.access === 'write' ? 'border-warning/50' : 'border-border')}>
    <HyperBotApprovalDetails approval={approval} name={botName} />
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDecide(approval.id, false)}>Deny</Button>
      {tool?.delivery
        ? <>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDecide(approval.id, true, 'draft')}>Save to Drafts</Button>
          <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, true, 'send')}>{spinner}Send</Button>
        </>
        : <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, true)}>{spinner}Approve</Button>}
    </div>
  </section>;
}

export function hyperBotApprovalGroups(approvals: HyperBotsApproval[]): HyperBotsApproval[][] {
  const groups = new Map<string, HyperBotsApproval[]>();
  for (const approval of approvals) {
    if (approval.status !== 'pending') continue;
    const key = approval.turnId ?? approval.id;
    const group = groups.get(key);
    if (group) group.push(approval); else groups.set(key, [approval]);
  }
  return [...groups.values()];
}

export function HyperBotTurnApproval({ approvals, settings, deciding, onDecide }: {
  approvals: HyperBotsApproval[]; settings?: HyperBotsSettings | null; deciding: readonly string[]; onDecide: Decide;
}) {
  const first = approvals[0];
  if (!first) return null;
  const busy = approvals.some(row => deciding.includes(row.id));
  if (!first.turnId) return <HyperBotsApprovalCard approval={first} botName={botName(settings, first.botId)} busy={busy} onDecide={onDecide} />;
  return <section aria-label="Approve Hyper-Bot turn" className="card approval-card space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
    <div className="space-y-1">
      <h3 className="font-medium">Allow tools for this turn?</h3>
      <p className="text-xs text-muted-foreground">Your choice covers these actions and any follow-up actions for this request. Approving can send mail.</p>
    </div>
    {approvals.map(row => <div key={row.id} id={'hyper-bot-request-' + row.id} tabIndex={-1} className="rounded-md border border-border p-2"><HyperBotApprovalDetails approval={row} name={botName(settings, row.botId)} /></div>)}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDecide(first.id, false)}>Decline turn</Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDecide(first.id, true, 'draft')}>Approve, draft mail</Button>
      <Button size="sm" disabled={busy} onClick={() => onDecide(first.id, true, 'send')}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Approve turn</Button>
    </div>
  </section>;
}
/** What the owner approves, line by line. Each value takes its own direction, so Hebrew reads right to left. */
function HyperBotsCardRows({ rows }: { rows: HyperBotsCardRow[] }) {
  return <dl className="divide-y divide-border overflow-hidden rounded-md border border-border text-xs">
    {rows.map((row, index) => <div key={index} className={cn('px-2 py-1.5', row.long ? 'space-y-1' : 'grid grid-cols-[minmax(5rem,8rem)_1fr] gap-2', row.tone === 'warning' && 'bg-warning-surface text-warning-foreground')}>
      <dt className={cn('font-medium', row.tone === 'warning' ? '' : 'text-muted-foreground')}>{row.label}</dt>
      <dd className={cn('min-w-0 break-words text-start [unicode-bidi:plaintext]', row.long && 'max-h-56 overflow-y-auto rounded bg-muted px-2 py-1.5 text-sm whitespace-pre-wrap')}>{row.value}</dd>
    </div>)}
  </dl>;
}
const outcome = (approval: HyperBotsApproval) => approval.status === 'done' && approval.delivery ? approval.delivery === 'draft' ? 'saved to Drafts' : 'sent' : approval.status === 'skipped' && approval.error ? 'skipped' : STATUS_LABEL[approval.status];

export function HyperBotTurnTools({ approvals, settings, deciding, onDecide }: {
  approvals: HyperBotsApproval[]; settings: HyperBotsSettings; deciding: string[];
  onDecide: (id: string, approved: boolean, delivery?: HyperBotsDelivery) => void;
}) {
  return <ol className="hb-turn-tools" aria-label="Tools used in this turn">{hyperBotApprovalGroups(approvals).map(group => <li key={group[0]!.id} id={group[0]!.turnId ? undefined : 'hyper-bot-request-' + group[0]!.id} tabIndex={-1}>
    <p className="hb-tool-waiting">Waiting for you</p>
    <HyperBotTurnApproval approvals={group} settings={settings} deciding={deciding} onDecide={onDecide} />
  </li>)}{approvals.filter(approval => approval.status !== 'pending').map(approval => {
    const name = botName(settings, approval.botId);
    const tool = HYPER_BOTS_TOOLS[approval.tool as keyof typeof HYPER_BOTS_TOOLS];
    const Status = approval.status === 'done' ? Check : approval.status === 'failed' || approval.status === 'unknown' ? CircleAlert :
      approval.status === 'skipped' || approval.status === 'denied' ? CircleSlash : LoaderCircle;
    return <li key={approval.id} className="hb-tool-step" data-status={approval.status}>
      <div className="hb-tool-step__line"><HyperBotToolLogo tool={approval.tool} />
        <strong>{tool?.label ?? approval.tool}</strong>
        <span className="hb-tool-step__status"><Status size={13} aria-hidden="true" />{outcome(approval)}{approval.decidedBy === 'policy' && ' (allowed by policy)'}</span>
      </div>
      <p className="hb-tool-step__summary" dir="auto">{approval.summary}</p>
      <p className="hb-tool-step__meta">{name} · {approval.access === 'read' ? 'Read' : 'Write'}{approval.destination && ' · to ' + approval.destination}</p>
      {approval.error && <p className="hb-tool-step__error">{approval.error}</p>}
    </li>;
  })}</ol>;
}
/** `flat`: the bare list, for the details panel, whose section already says "Recent decisions". */
export function HyperBotsDecided({ approvals, settings, flat }: { approvals: HyperBotsApproval[]; settings: HyperBotsSettings; flat?: boolean }) {
  const list = <ul className={cn('space-y-1', !flat && 'mt-1')}>
      {approvals.map(approval => <li key={approval.id} className="flex flex-wrap gap-x-2">
        <span className="font-medium text-foreground">{botName(settings, approval.botId)}</span>
        <span className="hb-tool-name"><HyperBotToolLogo tool={approval.tool} />{HYPER_BOTS_TOOLS[approval.tool as keyof typeof HYPER_BOTS_TOOLS]?.label ?? approval.tool}</span>
        <span className={cn(approval.status === 'failed' || approval.status === 'unknown' ? 'text-destructive' : approval.status === 'denied' ? 'text-warning' : '')}>{outcome(approval)}{approval.decidedBy === 'policy' ? ' (allowed by policy)' : ''}</span>
        {approval.destination && <span className="min-w-0 break-words">to {approval.destination}</span>}
        {approval.error && <span className="min-w-0 break-words">{approval.error}</span>}
      </li>)}
    </ul>;
  return flat ? <div className="text-xs text-muted-foreground">{list}</div> : <details className="text-xs text-muted-foreground">
    <summary className="cursor-pointer">Recent decisions ({approvals.length})</summary>
    {list}
  </details>;
}
