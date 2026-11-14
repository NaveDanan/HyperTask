// Adapted from OpenBot, copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { useEffect, useState } from 'react';
import { Plus, RefreshCw, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { hyperDeleteSkill, hyperLoadSkills, hyperSaveSkill, hyperSetSkillGrant, type HyperSkill, type HyperSkillDraft } from './HyperSkillsApi';

const hyperEmptyDraft = (): HyperSkillDraft => ({ slug: '', title: '', summary: '', instructions: '', tools: [] });
export function HyperSkillsPanel({}: Record<string, never>) {
  const [data, setData] = useState<Awaited<ReturnType<typeof hyperLoadSkills>>>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [draft, setDraft] = useState<HyperSkillDraft>(hyperEmptyDraft);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    hyperLoadSkills().then(value => { if (active) setData(value); }).catch(e => { if (active) setError(String(e.message ?? e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function refresh() {
    setLoading(true); setError('');
    try { setData(await hyperLoadSkills()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(success); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  function open(skill?: HyperSkill) {
    setSelection(skill?.slug ?? ''); setDraft(skill ? { slug: skill.slug, title: skill.title, summary: skill.summary ?? '', instructions: skill.instructions, tools: skill.tools ?? [] } : hyperEmptyDraft());
    setDeleting(false); setError(''); setNotice('');
  }
  const skill = data?.catalogue.skills.find(item => item.slug === selection);
  const tools = data?.catalogue.servers.flatMap(server => server.tools.map(tool => ({ ...tool, server: server.title }))) ?? [];
  const unavailable = draft.tools.filter(ref => !tools.some(tool => tool.ref === ref));
  const changeTool = (ref: string, on: boolean) => setDraft(current => ({ ...current, tools: on ? [...new Set([...current.tools, ref])] : current.tools.filter(value => value !== ref) }));
  return <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6" aria-label="Skills">
    <header className="flex flex-wrap items-center gap-3"><FileText className="size-5" /><div className="flex-1"><h1 className="text-lg font-semibold">Skills</h1><p className="text-xs text-muted-foreground">Write instructions for the / menu and choose which Bots offer them.</p></div><Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button><Button disabled={busy || !data} onClick={() => open()}><Plus />New skill</Button></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading skills…</p>}
    {data && <div className="grid gap-6 lg:grid-cols-2"><div className="flex flex-col gap-3"><Input aria-label="Search skills" placeholder="Search skills" value={search} onChange={e => setSearch(e.target.value)} /><div className="divide-y rounded-lg border border-border">{data.catalogue.skills.filter(item => `${item.title} ${item.slug} ${item.summary}`.toLowerCase().includes(search.toLowerCase())).map(item => <button type="button" disabled={busy} key={item.slug} aria-pressed={selection === item.slug} className="flex w-full flex-col gap-1 p-4 text-left transition-colors hover:bg-muted aria-pressed:bg-accent" onClick={() => open(item)}><span className="text-sm font-medium">{item.title} <code className="text-xs text-muted-foreground">/{item.slug}</code></span><span className="text-xs text-muted-foreground">{item.summary}</span><span className="text-xs text-muted-foreground">{item.grantedTo.length} Bot grants</span></button>)}{!data.catalogue.skills.length && <p className="p-4 text-sm text-muted-foreground">No skills yet. Write one, then choose which Bots offer it.</p>}</div></div>
    {selection !== null && <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"><h2 className="text-base font-semibold">{selection ? 'Edit skill' : 'New skill'}</h2>{selection && !skill && <p role="alert" className="text-sm text-destructive">This skill was deleted or is no longer available. Close this editor and refresh the list.</p>}<form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void run(async () => { const result = await hyperSaveSkill(draft); setData(current => current ? { ...current, catalogue: { ...current.catalogue, skills: result.skills } } : current); setSelection(draft.slug); }, 'Skill saved.'); }}><fieldset disabled={busy || (!!selection && !skill)} className="flex flex-col gap-4">
      <label className="text-sm font-medium">Command<Input required readOnly={!!selection} value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} /><span className="text-xs font-normal text-muted-foreground">{skill ? 'The command is fixed. Create a new skill to use another command.' : '2–40 lowercase letters, numbers and hyphens.'}</span></label>
      <label className="text-sm font-medium">Title<Input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="text-sm font-medium">One-liner<Input value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
      <label className="text-sm font-medium">Instructions<Textarea required className="min-h-56" value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-medium">Tools it needs</h3><p className="text-xs text-muted-foreground">These declarations load tools for a reply. A Bot can only use tools it already has.</p>{tools.map(tool => <label key={tool.ref} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm"><input type="checkbox" checked={draft.tools.includes(tool.ref)} onChange={e => changeTool(tool.ref, e.target.checked)} /><span>{tool.server} · {tool.name}<span className="block text-xs text-muted-foreground">{tool.description} {tool.effect === 'write' ? 'Changes data.' : ''}</span></span></label>)}{unavailable.map(ref => <label key={ref} className="flex gap-2 text-sm"><input type="checkbox" checked onChange={() => changeTool(ref, false)} />{ref} (unavailable, uncheck to remove)</label>)}{!tools.length && <p className="text-xs text-muted-foreground">No connected tools available.</p>}</div>
      <div className="flex gap-2"><Button type="submit">{busy ? 'Saving…' : 'Save skill'}</Button><Button type="button" variant="outline" onClick={() => setSelection(null)}>Close</Button></div></fieldset></form>
      {skill && <><h3 className="text-sm font-medium">Bots</h3><p className="text-xs text-muted-foreground">Grant changes save immediately. Selected Bots offer /{skill.slug}.</p>{data.bots.map(bot => <label key={bot.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={skill.grantedTo.includes(bot.id)} onChange={e => { const granted = e.target.checked; void run(async () => { await hyperSetSkillGrant(skill.slug, bot.id, granted); setData(current => current ? { ...current, catalogue: { ...current.catalogue, skills: current.catalogue.skills.map(item => item.slug === skill.slug ? { ...item, grantedTo: granted ? [...new Set([...item.grantedTo, bot.id])] : item.grantedTo.filter(id => id !== bot.id) } : item) } } : current); }, 'Bot grant saved.'); }} />{bot.name}{bot.hidden ? ' (hidden)' : ''}</label>)}{!data.bots.length && <p className="text-xs text-muted-foreground">You don't have a Bot of your own yet.</p>}
      {!deleting ? <Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>Delete skill</Button> : <div className="flex flex-col gap-2"><p className="text-sm">Delete {skill.title}? This removes its Bot grants and cannot be undone.</p><div className="flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await hyperDeleteSkill(skill.slug); setData(current => current ? { ...current, catalogue: { ...current.catalogue, skills: current.catalogue.skills.filter(item => item.slug !== skill.slug) } } : current); setSelection(null); }, 'Skill deleted.')}>Confirm delete</Button><Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>Cancel</Button></div></div>}</>}
    </div>}</div>}
  </section>;
}
