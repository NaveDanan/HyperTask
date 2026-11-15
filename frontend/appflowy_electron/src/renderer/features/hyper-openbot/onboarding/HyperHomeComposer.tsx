// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { HyperBotProfile } from '../bots/HyperBotsApi';
import { hyperOpenBotRequest } from '../transport';
import { HyperDefaultHomeBot, HyperStartHomeDraft, type HyperHomeContext } from './HyperHomeApi';
import { HyperStarterTasks } from './HyperStarterTasks';
// Memory only. Files and unsent text never enter browser storage or logs.
import { hyperHomeDraftStore } from './HyperHomeDraft';
export function HyperHomeComposer({ context, bots, userId, initialText = '' }: { context: HyperHomeContext; bots: HyperBotProfile[]; userId: string; initialText?: string }) {
  const hyperHeldDraft = hyperHomeDraftStore.read(userId);
  const lease = useRef(0);
  const mounted = useRef(true);
  const routing = useRef(new AbortController());
  useEffect(() => { mounted.current = true; const controller = new AbortController(); routing.current = controller; return () => { mounted.current = false; controller.abort(); }; }, [userId]);
  const [text, setText] = useState(() => hyperHeldDraft?.text ?? initialText.slice(0, 2000));
  const [files, setFiles] = useState<File[]>(() => hyperHeldDraft?.files ?? []);
  const [commands, setCommands] = useState<string[]>(() => hyperHeldDraft?.commandIds ?? []);
  const [skills, setSkills] = useState<{ slug: string; title: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const fallback = HyperDefaultHomeBot(bots);
  useEffect(() => { lease.current = hyperHomeDraftStore.write(userId, { text, files, commandIds: commands, submit: true }); }, [text, files, commands, userId]);
  useEffect(() => {
    let active = true;
    void Promise.all(bots.map(bot => hyperOpenBotRequest<{ skills: { slug: string; title: string }[] }>(`/api/plugins/for/${encodeURIComponent(bot.id)}`).catch(() => ({ skills: [] })))).then(results => {
      if (active) setSkills([...new Map(results.flatMap(result => result.skills).map(skill => [skill.slug, skill])).values()]);
    });
    return () => { active = false; };
  }, [bots]);
  const send = async (message = text, bot = chosen, consumeDraft = true) => {
    if (lock.current || !fallback || (!message.trim() && (!consumeDraft || !files.length))) return;
    lock.current = true; setBusy(true); setError('');
    const draft = { text: [...(consumeDraft ? commands.map(slug => `/${slug}`) : []), message].join(' '), files: consumeDraft ? [...files] : [], commandIds: consumeDraft ? [...commands] : [], submit: true };
    const submittedLease = lease.current;
    try {
      await HyperStartHomeDraft(context, bots, draft, bot || undefined, routing.current.signal);
      if (consumeDraft && hyperHomeDraftStore.consume(userId, submittedLease) && mounted.current) {
        setText(current => current === message ? '' : current);
        setFiles(current => current.filter(file => !draft.files.includes(file)));
        setCommands(current => current.length === draft.commandIds.length && current.every((command, index) => command === draft.commandIds[index]) ? [] : current);
      }
    } catch {
      setError("Couldn't start the conversation. Your draft and files are kept. Choose a Bot or try again.");
      throw new Error('Conversation could not be started.');
    } finally { lock.current = false; setBusy(false); }
  };
  return <div className="flex flex-col gap-3">
    <HyperStarterTasks agentId={fallback?.id} disabled={busy} onSelect={message => send(message, fallback?.id, false)} />
    <form className="flex flex-col gap-3 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); void send().catch(() => {}); }}>
      <label className="flex flex-col gap-2 text-sm">Task<Textarea aria-label="Message" disabled={busy || !fallback} value={text} onChange={event => setText(event.target.value)} /></label>
      <label className="flex flex-col gap-2 text-sm">Bot<select aria-label="Choose Bot" className="rounded-md border bg-background p-2" disabled={busy} value={chosen} onChange={event => setChosen(event.target.value)}><option value="">Pick the right Bot automatically</option>{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      {skills.length ? <fieldset disabled={busy} className="flex flex-wrap gap-2"><legend className="text-sm">Skills</legend>{skills.map(skill => <label key={skill.slug} className="flex gap-2 text-sm"><input type="checkbox" checked={commands.includes(skill.slug)} onChange={event => setCommands(current => event.target.checked ? [...current, skill.slug] : current.filter(slug => slug !== skill.slug))} />{skill.title || skill.slug}</label>)}</fieldset> : null}
      <label className="text-sm">Attach files<input aria-label="Attach files" type="file" multiple disabled={busy} onChange={event => { setFiles(current => [...current, ...Array.from(event.target.files ?? [])]); event.target.value = ''; }} /></label>
      <ul>{files.map((file, index) => <li key={index} className="flex items-center gap-2 text-sm"><span>{file.name}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => setFiles(current => current.filter((_, at) => at !== index))}>Remove</Button></li>)}</ul>
      <Button type="submit" disabled={busy || !fallback || (!text.trim() && !files.length)}>{busy ? 'Starting…' : 'Send'}</Button>
      <p className="text-xs text-muted-foreground">OpenBot picks the right Bot. Choose one above to send to a specific Bot.</p>
    </form>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
