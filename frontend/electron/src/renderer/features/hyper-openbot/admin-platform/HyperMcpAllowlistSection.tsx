// Adapted from OpenBot f8af37a, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE.
// app/components/admin/controls/{mcp-allowlist-section,controls-section}.tsx.
import { useEffect, useRef, useState } from 'react';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { hyperLoadMcpAllowlist, hyperLoadMcpAllowlistAccess, hyperSaveMcpAllowlist, type HyperMcpAllowlist, type HyperMcpAllowlistAccess, type HyperMcpAllowlistOverview } from './HyperPlatformApi';
import { hyperMcpAddressLabel, hyperMcpListedAddress, hyperMcpServerApproved, hyperMcpWithdrawServer } from './HyperMcpAllowlistPolicy';

type HyperMcpConfirmation = { value: HyperMcpAllowlist; title: string; description: string; destructive?: boolean };
type HyperMcpView = {
  phase: 'loading' | 'ready' | 'personal' | 'denied' | 'failed';
  data?: HyperMcpAllowlistOverview;
  access?: HyperMcpAllowlistAccess;
  confirmation?: HyperMcpConfirmation;
  address: string;
  busy: boolean;
  error: string;
  notice: string;
};
const hyperMcpInitialView: HyperMcpView = { phase: 'loading', address: '', busy: false, error: '', notice: '' };
const hyperMcpReadError = 'Could not load MCP settings. Check administrator access and refresh to retry.';

export function HyperMcpAllowlistSection({ context }: { context: HyperOpenBotSectionContext }) {
  const [storedView, setView] = useState<HyperMcpView>(hyperMcpInitialView);
  const state = useRef(storedView);
  const lifetime = useRef({ active: false, sequence: 0 });
  const navigation = useRef({ guard: context.isCurrentNavigation, revision: 0 });
  // The native host can navigate back to this same path without unmounting it. Its previous
  // guard then expires. Ordinary rerenders keep the guard current and retain the draft.
  if (navigation.current.guard?.() === false && context.isCurrentNavigation?.() !== false) navigation.current.revision++;
  navigation.current.guard = context.isCurrentNavigation;
  const revision = navigation.current.revision;
  const viewRevision = useRef(revision);
  const view = viewRevision.current === revision ? storedView : hyperMcpInitialView;
  function current() {
    return lifetime.current.active && navigation.current.revision === revision && context.isCurrentNavigation?.() !== false;
  }
  function update(patch: Partial<HyperMcpView>) {
    viewRevision.current = revision;
    state.current = { ...state.current, ...patch };
    setView(state.current);
  }
  function available(data: HyperMcpAllowlistOverview) {
    return current() && !state.current.busy && state.current.phase === 'ready' && state.current.data === data;
  }
  async function reload() {
    if (!current() || state.current.busy) return;
    const sequence = ++lifetime.current.sequence;
    update({ ...hyperMcpInitialView, data: undefined, access: undefined, confirmation: undefined });
    const valid = () => current() && lifetime.current.sequence === sequence;
    try {
      const access = await hyperLoadMcpAllowlistAccess();
      if (!valid()) return;
      if (access.user.role !== 'admin' || access.edition === 'personal') {
        update({ phase: access.user.role !== 'admin' ? 'denied' : 'personal', access });
        return;
      }
      const data = await hyperLoadMcpAllowlist();
      if (valid()) update({ phase: 'ready', data, access });
    } catch { if (valid()) update({ phase: 'failed', error: hyperMcpReadError }); }
  }
  useEffect(() => {
    lifetime.current.active = true;
    void reload();
    return () => { lifetime.current.active = false; lifetime.current.sequence++; state.current = { ...hyperMcpInitialView }; };
  }, [revision]);

  function propose(data: HyperMcpAllowlistOverview, confirmation: HyperMcpConfirmation) {
    if (!available(data) || state.current.confirmation) return;
    update({ confirmation, error: '', notice: '', address: '' });
  }
  function cancel(confirmation: HyperMcpConfirmation) {
    if (current() && state.current.confirmation === confirmation && !state.current.busy) update({ confirmation: undefined });
  }
  async function confirm(data: HyperMcpAllowlistOverview, confirmation: HyperMcpConfirmation) {
    if (!available(data) || state.current.confirmation !== confirmation || !state.current.access) return;
    const access = state.current.access;
    const sequence = ++lifetime.current.sequence;
    // Consume synchronously, before the first await. A cached confirmation cannot be used twice.
    update({ confirmation: undefined, busy: true, error: '', notice: '' });
    const valid = () => current() && lifetime.current.sequence === sequence && state.current.data === data;
    let wrote = false;
    try {
      const freshAccess = await hyperLoadMcpAllowlistAccess();
      if (!valid()) return;
      if (freshAccess.user.role !== 'admin' || freshAccess.edition !== 'team' || freshAccess.user.id !== access.user.id) {
        update({ data: undefined, access: freshAccess, phase: freshAccess.user.role !== 'admin' ? 'denied' : freshAccess.edition === 'personal' ? 'personal' : 'failed', error: 'Administrator access changed. Refresh before changing these settings.' });
        return;
      }
      const fresh = await hyperLoadMcpAllowlist();
      if (!valid()) return;
      // The server exposes a whole-list PUT, with no conditional-write revision. Never knowingly
      // overwrite changes made after the administrator reviewed this exact policy and roster.
      if (JSON.stringify(fresh) !== JSON.stringify(data)) {
        update({ data: fresh, error: 'MCP settings changed. Review the current list and confirm your change again.' });
        return;
      }
      await hyperSaveMcpAllowlist(confirmation.value);
      wrote = true;
      if (!valid()) return;
      const saved = await hyperLoadMcpAllowlist();
      if (valid()) update({ data: saved, notice: 'MCP settings saved.' });
    } catch {
      if (valid()) update({ data: undefined, phase: 'failed', error: wrote
        ? 'The change was saved, but MCP settings could not be reloaded. Refresh before changing them again.'
        : 'Could not confirm the MCP change. The server may have received it. Refresh before trying again.' });
    } finally { if (current() && lifetime.current.sequence === sequence) update({ busy: false }); }
  }

  const data = view.data;
  const disabled = view.busy || !!view.confirmation;
  const candidate = hyperMcpListedAddress(view.address);
  const policy = data?.settings.mcpAllowlist;
  const looseEntries = data && policy ? policy.servers.filter(entry => !data.mcpServers.some(server => {
    const address = hyperMcpListedAddress(entry);
    return entry === server.id || (address !== null && address === hyperMcpListedAddress(server.url));
  })) : [];
  return <section className="mx-auto w-full max-w-6xl shrink-0 px-8 py-6 text-sm text-foreground" aria-label="MCP allowlist">
    <SettingsSection title="MCP servers" description="With the allowlist on, Bots can only call tools on approved MCP servers, and people can only add a server by its address once it is approved. Existing Bot access still applies.">
      {view.error && <p role="alert" className="text-destructive">{view.error}</p>}
      {view.notice && <p role="status">{view.notice}</p>}
      {view.phase === 'loading' && <p role="status" className="text-muted-foreground">Loading MCP settings…</p>}
      {view.busy && <p role="status" className="text-muted-foreground">Saving MCP settings…</p>}
      {view.phase === 'personal' && <p>This applies when HyperTask runs for a team.</p>}
      {view.phase === 'denied' && <p role="alert">Administrator access is required.</p>}
      {view.phase !== 'loading' && <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={() => void reload()}>Refresh MCP settings</Button>}
      {view.phase === 'ready' && data && policy && <>
        <SettingsGroup>
          <SettingsRow label="Only approved servers" description={policy.enabled ? `${policy.servers.length} approvals saved. Calls to other servers are refused. Built-in tools keep their server-defined exceptions.` : 'Off. Bots can use any registered server they have access to.'}
            control={<Switch aria-label="Only approved MCP servers" checked={policy.enabled} disabled={disabled} onCheckedChange={enabled => propose(data, { value: { ...policy, enabled }, title: enabled ? 'Require approved MCP servers?' : 'Turn off the MCP allowlist?', description: enabled ? 'Bots will be refused tools on unapproved servers. Existing access grants are still required.' : 'Bots may use any registered MCP server they have access to. Saved approvals are kept.' })} />} />
          {data.mcpServers.map(server => {
            const approved = hyperMcpServerApproved(data, server);
            return <SettingsRow key={server.id} label={server.title || 'MCP server'} description={`${hyperMcpAddressLabel(server.url)} · ${approved ? 'Approved' : 'Not approved'}`}
              control={<Button type="button" variant={approved ? 'destructive' : 'outline'} disabled={disabled || (!approved && policy.servers.length >= 500)} aria-label={`${approved ? 'Withdraw approval for' : 'Approve'} ${server.title || 'MCP server'}`} onClick={() => propose(data, {
                value: { ...policy, servers: approved ? hyperMcpWithdrawServer(data, server.id) : [...new Set([...policy.servers, server.id])] },
                title: approved ? 'Withdraw server approval?' : 'Approve this server?',
                destructive: approved,
                description: approved ? `Withdraw approval for ${server.title || 'this server'}. Matching address approvals are also removed, affecting other servers at that address. Existing access grants stay saved; with the allowlist on, calls will be refused.` : `Approve ${server.title || 'this server'} for the allowlist. This does not grant a Bot or person access.`,
              })}>{approved ? 'Withdraw approval' : 'Approve server'}</Button>} />;
          })}
          {looseEntries.map((entry, index) => <SettingsRow key={`${index}:${entry}`} label={`${hyperMcpAddressLabel(entry)} · Approval ${index + 1}`} description={hyperMcpListedAddress(entry) ? 'Approved address. Not added yet.' : 'Approved server is no longer in the registered list.'}
            control={<Button type="button" variant="destructive" disabled={disabled} aria-label={`Withdraw saved approval ${index + 1}`} onClick={() => propose(data, { value: { ...policy, servers: policy.servers.filter(value => value !== entry) }, title: 'Withdraw saved approval?', destructive: true, description: `Remove this approval for ${hyperMcpAddressLabel(entry)}. With the allowlist on, it will no longer permit adding or calling that server.` })}>Withdraw approval</Button>} />)}
        </SettingsGroup>
        {data.mcpServers.length === 0 && looseEntries.length === 0 && <p className="text-muted-foreground">No MCP servers or approvals saved.</p>}
        <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-border p-4">
          <label htmlFor="hyper-mcp-address" className="font-medium">Approve a server by its address</label>
          <p className="text-xs text-muted-foreground">Use an HTTP or HTTPS address so people can add it from Connections. Credentials, query values and fragments are excluded. Only the host is displayed.</p>
          <Input id="hyper-mcp-address" aria-label="MCP server address" type="password" autoComplete="off" spellCheck={false} value={view.address} disabled={disabled} onChange={event => { if (available(data) && !state.current.confirmation) update({ address: event.target.value }); }} />
          <Button type="button" className="self-start" variant="outline" disabled={disabled || candidate === null || candidate.length > 200 || policy.servers.length >= 500} onClick={() => {
            if (!available(data) || !candidate || candidate !== hyperMcpListedAddress(state.current.address) || candidate.length > 200) return;
            propose(data, { value: { ...policy, servers: policy.servers.some(entry => hyperMcpListedAddress(entry) === candidate) ? [...policy.servers] : [...policy.servers, candidate] }, title: 'Approve this address?', description: `Approve the entered address at ${hyperMcpAddressLabel(candidate)}. People may add a server at this address and Bots with access may call its tools.` });
          }}>Review address approval</Button>
        </div>
      </>}
      <Dialog open={!!view.confirmation} onOpenChange={open => { if (!open && view.confirmation) cancel(view.confirmation); }}>
        {view.confirmation && data && <DialogContent>
          <DialogHeader><DialogTitle>{view.confirmation.title}</DialogTitle><DialogDescription>{view.confirmation.description}</DialogDescription></DialogHeader>
          <DialogFooter><Button type="button" variant="outline" onClick={() => cancel(view.confirmation!)}>Cancel</Button><Button type="button" className={view.confirmation.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined} onClick={() => void confirm(data, view.confirmation!)}>Confirm MCP change</Button></DialogFooter>
        </DialogContent>}
      </Dialog>
    </SettingsSection>
  </section>;
}
