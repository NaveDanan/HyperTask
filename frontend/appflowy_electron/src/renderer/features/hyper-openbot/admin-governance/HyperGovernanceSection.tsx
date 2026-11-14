import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HYPER_ADMIN_PAGE_PATHS, hyperAdminBackSelection, hyperAdminSelectionFromPath, type HyperAdminSelection, type HyperAdminPage } from './HyperAdminNavigation';
// Adapted from OpenBot admin routes and components. Copyright (c) 2026 CopilotKit. MIT licensed.
import { useEffect, useState, type ReactNode } from 'react';
import { HyperField, HyperStatus, HyperError, useHyperAction, useHyperResource } from './HyperGovernanceUi';
const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm';
import { HyperWhatIf } from './HyperWhatIf';
import { HyperAudit } from './HyperAudit';
import { HyperSignInSettings } from './HyperEnterpriseSettings';
import { RULE_TEMPLATES, RULE_ATTRIBUTES, ruleLabel } from './HyperBoundaryRules';
import { HyperDescribeChanges, HyperTeamApprovals, HyperBoundaryEditor } from './HyperGovernanceFlows';
import { Button } from '../../../components/ui/button';
import { HyperGovernanceReport } from './HyperGovernanceReports';
import { hyperGovernanceRequest as request, hyperSetPersonAccess, hyperSetPersonRole, hyperProviderBody, type HyperPerson, type HyperPolicy, type HyperEnterprise, type HyperProvider } from './HyperGovernanceApi';
function HyperPeople() {
  const me = useHyperResource<{
    user: {
      id: string;
    };
  }>('/api/me');
  const [stopped, setStopped] = useState<{
    stopped: string[];
    failed: {
      botId: string;
      reason: string;
    }[];
  }>();
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState('');
  const [rows, setRows] = useState<HyperPerson[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams();
  if (query) params.set('search', query);
  if (cursor) params.set('cursor', cursor);
  const r = useHyperResource<{
    people: HyperPerson[];
    nextCursor: string | null;
  }>(`/api/admin/people?${params}`);
  const a = useHyperAction(() => {
    setCursor('');
    setRows([]);
    r.reload();
  });
  useEffect(() => {
    if (r.data) setRows(old => cursor ? [...old, ...r.data!.people.filter(p => !old.some(o => o.id === p.id))] : r.data!.people);
  }, [r.data]);
  return <><HyperField label="Search people" value={search} onChange={v => {
      setSearch(v);
      setCursor('');
      setRows([]);
    }} /><HyperStatus resource={r}>{!rows.length && <p>No people found.</p>}{rows.map(p => <article className="border-b py-4 grid gap-2" key={p.id}><strong>{p.name || p.email}</strong><Button disabled={a.busy} variant="outline" onClick={() => void a.run(async () => setStopped(await request(`/api/admin/enterprise/people/${encodeURIComponent(p.id)}/terminate-computers`, 'POST')))}>Stop computers</Button><p>{p.email} · {p.providers.join(', ')} · {p.lastSignedInAt || 'Never signed in'}</p><p>{p.revoked ? 'Access removed' : 'Active'}{p.configuredAdmin ? ' · Configured administrator' : ''}</p><div className="flex gap-2"><select aria-label={`Role for ${p.email}`} className={inputClass} value={p.role} disabled={a.busy || p.configuredAdmin || !me.data || p.id === me.data.user.id} onChange={e => void a.run(() => hyperSetPersonRole(p.id, e.target.value as 'admin' | 'user'))}><option value="user">User</option><option value="admin">Admin</option></select><Button disabled={a.busy || p.configuredAdmin || !me.data || p.id === me.data.user.id} variant="outline" onClick={() => {
            if (window.confirm(`${p.revoked ? 'Restore' : 'Remove'} access for ${p.email}?`)) void a.run(() => hyperSetPersonAccess(p.id, !p.revoked));
          }}>{p.revoked ? 'Restore access' : 'Remove access'}</Button></div></article>)}{r.data?.nextCursor && <Button onClick={() => setCursor(r.data!.nextCursor!)}>Load more</Button>}</HyperStatus>{stopped && <p role="status">Stopped {stopped.stopped.length} computers. {stopped.failed.length} could not be stopped. Disks are kept.</p>}<HyperError message={a.error} /></>;
}
function HyperPermissions() {
  const r = useHyperResource<HyperEnterprise>('/api/admin/enterprise');
  const a = useHyperAction(r.reload);
  const [scope, setScope] = useState('organization:');
  return <HyperStatus resource={r}><label>Scope <select className={inputClass} value={scope} onChange={e => setScope(e.target.value)}><option value="organization:">Everybody</option><option value="role:admin">Administrators</option><option value="role:user">Users</option>{r.data?.groups.map(g => <option key={g} value={`group:${g}`}>{g}</option>)}</select></label>{r.data?.capabilities.map(c => {
      const [scopeKind, ...rest] = scope.split(':');
      const scopeId = rest.join(':');
      const value = scopeKind === 'organization' ? c.organization : scopeKind === 'role' ? c.roles[scopeId] : c.groups[scopeId];
      return <div className="border-b py-4" key={c.capability}><strong>{c.title}</strong><p className="text-sm text-muted-foreground">{c.description}</p><select aria-label={c.title} className={inputClass} value={value == null ? 'inherit' : String(value)} disabled={a.busy} onChange={e => void a.run(() => request('/api/admin/enterprise/capabilities', 'PUT', {
          scopeKind,
          scopeId,
          capability: c.capability,
          allowed: e.target.value === 'inherit' ? null : e.target.value === 'true'
        }))}><option value="inherit">Inherit{scopeKind === 'organization' ? ` (${c.default ? 'allowed' : 'refused'})` : ''}</option><option value="true">Allow</option>{scopeKind !== 'group' && <option value="false">Refuse</option>}</select></div>;
    })}<HyperError message={a.error} /></HyperStatus>;
}
export function HyperBoundaries({ navigate, selection, onSelect }: { navigate(page: string): void; selection?: HyperAdminSelection; onSelect?(selection: HyperAdminSelection): void }) {
  const r = useHyperResource<{
    policy: HyperPolicy;
  }>('/api/computers/policy');
  const a = useHyperAction(r.reload);
  const p = r.data?.policy;
  const save = (policy: HyperPolicy) => request('/api/computers/policy', 'PUT', policy);
  if (selection?.page === 'Boundaries' && selection.boundary !== undefined) return <HyperStatus resource={r}>{p && <HyperBoundaryDestination key={String(selection.boundary)} policy={p} boundary={selection.boundary} reload={r.reload} onBack={()=>onSelect?.({page:'Boundaries'})}/>}</HyperStatus>;
  return <HyperStatus resource={r}>{p && <><Button variant="outline" onClick={()=>onSelect?.({page:'Boundaries',boundary:'new'})}>New boundary</Button><label className="flex gap-2"><input type="checkbox" checked={p.mode === 'dry-run'} disabled={a.busy} onChange={e => void a.run(() => save({
          ...p,
          mode: e.target.checked ? 'dry-run' : 'enforce'
        }))} />Trial mode</label><p className="text-sm text-muted-foreground">Trial mode records matching actions without stopping them.</p>{p.deny.length === 0 && <p>No rules yet.</p>}{p.deny.map((rule,index) => <details className="border-b py-3" key={rule}><summary>{ruleLabel(p, rule).name}</summary><Button variant="outline" onClick={()=>onSelect?.({page:'Boundaries',boundary:index})}>Open rule</Button><p>{p.labels?.[rule]?.description}</p><code className="break-words">{rule}</code><HyperBoundaryEditor policy={p} original={rule} reload={r.reload} /><div><Button disabled={a.busy} variant="destructive" onClick={() => {
            if (window.confirm('Remove this boundary rule?')) {
              const labels = {
                ...p.labels
              };
              delete labels[rule];
              void a.run(() => save({
                ...p,
                deny: p.deny.filter(v => v !== rule),
                labels
              }));
            }
          }}>Remove rule</Button></div></details>)}<Button variant="outline" onClick={() => navigate('Activity')}>View stopped actions in Activity</Button><p>Everything else: {p.allow.join(' · ') || 'Nothing is allowed'}</p><HyperBoundaryEditor policy={p} reload={r.reload} /><details><summary>Boundary templates and attributes</summary>{RULE_TEMPLATES.map(t => <article className="border-b p-3" key={t.rule}><strong>{t.name}</strong><p>{t.description}</p><p>{t.cost}</p><HyperBoundaryEditor policy={p} reload={r.reload} template={t} /></article>)}<dl>{RULE_ATTRIBUTES.map(a => <div key={a.name}><dt><code>{a.name}</code></dt><dd>{a.meaning}</dd></div>)}</dl><p>Guard attributes by tool name. An attribute absent from an action counts as a match.</p></details></>}<HyperError message={a.error} /></HyperStatus>;
}
function HyperProviders() {
  const r = useHyperResource<{
    providers: HyperProvider[];
  }>('/api/admin/identity-providers');
  const a = useHyperAction(r.reload);
  const [form, setForm] = useState<Record<string, string>>({
    protocol: 'oidc',
    providerId: '',
    domain: '',
    issuer: '',
    clientId: '',
    clientSecret: '',
    entryPoint: '',
    metadata: ''
  });
  const field = (key: string, label: string, secret = false) => <HyperField key={key} label={label} secret={secret} inputType={key === 'issuer' || key === 'entryPoint' ? 'url' : 'text'} disabled={a.busy} value={form[key]} onChange={v => setForm(f => ({
    ...f,
    [key]: v
  }))} />;
  return <HyperStatus resource={r}>{!r.data?.providers.length && <p>No identity providers registered.</p>}{r.data?.providers.map(p => <article className="border-b py-3" key={p.providerId}><strong>{p.providerId}</strong><p>{p.domain} · {p.protocol} · {p.issuer}</p><p>Registered by {p.registeredBy || 'a removed account'}</p><Button variant="destructive" disabled={a.busy} onClick={() => {
        if (window.confirm(`Remove identity provider ${p.providerId}?`)) void a.run(() => request(`/api/admin/identity-providers/${encodeURIComponent(p.providerId)}`, 'DELETE'));
      }}>Remove provider</Button></article>)}<form className="grid gap-3" onSubmit={e => {
      e.preventDefault();
      void a.run(async () => {
        try {
          await request('/api/auth/sso/register', 'POST', hyperProviderBody(form));
          setForm(f => ({
            protocol: f.protocol,
            providerId: '',
            domain: '',
            issuer: '',
            clientId: '',
            clientSecret: '',
            entryPoint: '',
            metadata: ''
          }));
        } finally {
          setForm(f => ({
            ...f,
            clientSecret: '',
            metadata: ''
          }));
        }
      });
    }}><h3>Register identity provider</h3><select aria-label="Protocol" className={inputClass} value={form.protocol} onChange={e => setForm(f => ({
        ...f,
        protocol: e.target.value,
        clientSecret: '',
        metadata: ''
      }))}><option value="oidc">OIDC</option><option value="saml">SAML</option></select>{field('providerId', 'Provider ID')}{field('domain', 'Email domain')}<p>Anybody with an address at this domain signs in here. Separate several domains with commas.</p>{field('issuer', 'Issuer URL')}{form.protocol === 'oidc' ? <>{field('clientId', 'Client ID')}{field('clientSecret', 'Client secret', true)}</> : <>{field('entryPoint', 'Entry point')}<label className="grid gap-1">Metadata XML<textarea className={inputClass} disabled={a.busy} autoComplete="off" required value={form.metadata} onChange={e => setForm(f => ({ ...f, metadata: e.target.value }))} /></label></>}<Button type="submit" disabled={a.busy}>Register</Button><Button type="button" variant="outline" disabled={a.busy} onClick={() => setForm(f => ({
        ...f,
        clientSecret: '',
        metadata: ''
      }))}>Clear secrets</Button></form><HyperSignInSettings /><HyperError message={a.error} /></HyperStatus>;
}
function HyperGuidance() {
  const r = useHyperResource<{
    guidance: string | null;
  }>('/api/approvals/team/guidance');
  const preview = useHyperResource<{
    calls: number;
  }>('/api/approvals/team/guidance/backtest');
  const a = useHyperAction();
  const [text, setText] = useState('');
  const [result, setResult] = useState<unknown>();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (r.data) setText(r.data.guidance || '');
  }, [r.data]);
  return <HyperStatus resource={r}><label className="grid gap-2">Guidance for auto-review<textarea className={inputClass} maxLength={2000} disabled={a.busy} value={text} onChange={e => {
        setText(e.target.value);
        setChecked(false);
        setResult(undefined);
      }} /></label><div className="flex gap-2"><Button disabled={a.busy || !text.trim()} onClick={() => void a.run(async () => {
        setChecked(false);
          const v = await request<{
          check: {
            ok: boolean;
          };
        }>('/api/approvals/team/guidance/check', 'POST', {
          text: text.trim()
        });
        setResult(v);
        setChecked(v.check.ok);
      })}>Check guidance</Button><Button disabled={a.busy || !checked || text.trim() === (r.data?.guidance || '')} onClick={() => void a.run(async () => {
        await request('/api/approvals/team/guidance', 'PUT', {
          text: text.trim()
        });
        r.reload();
        setChecked(false);
      })}>Save guidance</Button><Button disabled={a.busy || !preview.data || !text.trim()} onClick={() => {
        if (window.confirm(`Test on recent requests? This makes ${preview.data?.calls} model calls.`)) void a.run(async () => setResult(await request('/api/approvals/team/guidance/backtest', 'POST', {
          text
        })));
      }}>Test recent requests</Button><Button variant="destructive" disabled={a.busy || !r.data?.guidance} onClick={() => {
        if (window.confirm('Remove saved guidance?')) void a.run(async () => {
          await request('/api/approvals/team/guidance', 'DELETE');
          r.reload();
        });
      }}>Remove guidance</Button></div><HyperStatus resource={preview}><p>{preview.data?.calls || 0} model calls for a replay of recent decisions.</p></HyperStatus><HyperError message={a.error} />{result !== undefined && <HyperGovernanceReport kind="guidance" value={result} />}</HyperStatus>;
}
const pages: Record<string, {
  description: string;
  component: (props: {
    navigate(page: string): void;
    selection?: HyperAdminSelection;
    onSelect?(selection: HyperAdminSelection): void;
  }) => ReactNode;
}> = {
  People: {
    description: 'Manage roles and access for people who signed in.',
    component: HyperPeople
  },
  'Describe permissions': {
    description: 'Preview who gains or loses access before saving.',
    component: () => <HyperDescribeChanges kind="permissions" />
  },
  Approvals: {
    description: 'Set team approval controls and rules.',
    component: HyperTeamApprovals
  },
  'Describe approval rules': {
    description: 'Check proposed rules against recent actions.',
    component: () => <HyperDescribeChanges kind="approvals" />
  },
  Permissions: {
    description: 'Set permissions for everybody, a role, or a directory group.',
    component: HyperPermissions
  },
  Boundaries: {
    description: 'Define actions Bots must never take.',
    component: HyperBoundaries
  },
  Activity: {
    description: 'Inspect the deployment audit trail.',
    component: props => <HyperAudit navigate={props.navigate} initialFilters={props.selection?.page === 'Activity' ? props.selection.filters : undefined}/>
  },
  'Identity providers': {
    description: 'Register and remove SAML and OIDC providers.',
    component: HyperProviders
  },
  'Approval guidance': {
    description: 'Check, test and save guidance for auto-review.',
    component: HyperGuidance
  },
  'What would happen': {
    description: 'Check an action against the deployment controls.',
    component: props => <HyperWhatIf navigate={props.navigate} initial={props.selection?.page === 'What would happen' ? props.selection.action : undefined}/>
  }
};
export default function HyperGovernanceSection({path,context}: {path?: string;context?:HyperOpenBotSectionContext}) {
  const identity = useHyperResource<{
    user: {
      role: string;
    };
  }>('/api/me');
  const edition = useHyperResource<{
    edition?: string;
  }>('/api/capabilities');
  const [selection,setSelection] = useState(()=>hyperAdminSelectionFromPath(path));
  const page=selection.page;
  const setPage=(page:string)=>{
    const destination=({Plugins:'admin-plugins',Computers:'admin-computers'} as Record<string,string>)[page];
    if(destination&&context?.navigate){context.navigate(destination);return;}
    setSelection(Object.hasOwn(HYPER_ADMIN_PAGE_PATHS,page) ? {page:page as HyperAdminPage} : {page:'missing'});
  };
  const Component = page === 'Admin' ? undefined : pages[page]?.component;
  if (identity.loading || identity.error) return <HyperStatus resource={identity}>{null}</HyperStatus>;
  if (identity.data?.user.role !== 'admin') return <p role="alert" className="p-6">Administrator access is required.</p>;
  if (page === 'missing') return <section className="p-6"><p role="alert">This admin destination is unavailable.</p><Button onClick={()=>setPage('Admin')}>Back to admin</Button></section>;
  if (edition.loading || edition.error) return <HyperStatus resource={edition}>{null}</HyperStatus>;
  const teamOnly = ['People', 'Permissions', 'Describe permissions', 'Identity providers', 'Approvals', 'Describe approval rules', 'Approval guidance'];
  return <section className="mx-auto grid w-full max-w-4xl gap-5 p-6"><h2 className="text-xl font-semibold">{page}</h2><p className="text-sm text-muted-foreground">{pages[page]?.description || 'Manage settings that apply to everyone and every Bot in this deployment.'}</p>{page!=='Admin'&&<Button variant="outline" onClick={()=>setSelection(hyperAdminBackSelection(selection))}>Back to {hyperAdminBackSelection(selection).page.toLowerCase()}</Button>}<nav aria-label="Admin pages" className="flex flex-wrap gap-2"><Button variant={page === 'Admin' ? 'secondary' : 'ghost'} onClick={() => setPage('Admin')}>Overview</Button>{Object.keys(pages).map(name => <Button key={name} variant={page === name ? 'secondary' : 'ghost'} onClick={() => setPage(name)}>{name}</Button>)}</nav>{Component && edition.data?.edition === 'personal' && teamOnly.includes(page) ? <p>This page applies to a team. Your own approvals remain available in the approvals section.</p> : Component ? <Component key={page} navigate={setPage} selection={selection} onSelect={setSelection} /> : <div className="grid gap-2">{Object.entries(pages).map(([name, value]) => <button className="rounded-lg border p-4 text-left hover:bg-muted" key={name} onClick={() => setPage(name)}><strong>{name}</strong><p className="text-sm text-muted-foreground">{value.description}</p></button>)}</div>}</section>;
}

export function HyperBoundaryDestination({policy,boundary,reload,onBack}:{policy:HyperPolicy;boundary:'new'|number;reload():void;onBack():void}) {
  const original=boundary==='new'?undefined:policy.deny[boundary];
  return <section aria-label="Boundary detail" className="grid gap-3"><Button variant="outline" onClick={onBack}>Back to boundaries</Button>{boundary!=='new'&&original===undefined?<p role="alert">This boundary rule is no longer in place.</p>:<><h3>{original ? ruleLabel(policy,original).name : 'New boundary'}</h3><HyperBoundaryEditor key={original??'new'} policy={policy} original={original} reload={reload} initialOpen /></>}</section>;
}
