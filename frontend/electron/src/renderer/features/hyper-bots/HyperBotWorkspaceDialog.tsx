import { useEffect, useState, type FormEvent } from 'react';
import { Download, RefreshCw, Terminal } from 'lucide-react';
import { HYPER_BOT_WORKSPACE_COMMANDS, type HyperBotsApi, type HyperBotWorkspaceCommandInput } from '@shared/HyperBots';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { HyperBotModal, HyperBotModalHeader } from './HyperBotModal';
import { hyperBotDownload } from './HyperBotDownload';

export function HyperBotWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<{ name: string; size: number }[]>();
  const [revision, setRevision] = useState(0);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [error, setError] = useState('');
  const api = window.hypertask.hyperBots.workspace;
  useEffect(() => {
    let alive = true;
    if (api) void api.list().then(result => {
      if (!alive) return;
      if (result.ok) setFiles(result.value);
      else setError(result.message);
    }).catch(() => { if (alive) setError('Could not list workspace files.'); });
    return () => { alive = false; };
  }, [api, revision]);
  async function download(name: string) {
    setError('');
    try {
      const result = await api?.read({ name });
      if (!result?.ok) throw new Error(result?.message ?? 'Could not download the file.');
      hyperBotDownload(name, new Blob([result.value], { type: 'text/plain' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download the file.');
    }
  }
  return <HyperBotModal onClose={onClose} className="create-modal settings-modal" label="Bot workspace">
    <HyperBotModalHeader label="Bot workspace" onClose={onClose} />
    <div className="create-modal__body !items-stretch text-sm">
      <div className="flex justify-end gap-2">{api && <Button type="button" size="sm" variant="outline" aria-expanded={terminalOpen} onClick={() => setTerminalOpen(open => !open)}><Terminal />Terminal</Button>}<Button type="button" size="sm" variant="outline" onClick={() => { setError(''); setRevision(value => value + 1); }}><RefreshCw />Refresh</Button></div>
      {files?.length ? <ul className="grid gap-2">{files.map(file => <li key={file.name} className="panel-card flex items-center justify-between gap-2 p-2">
        <div className="min-w-0"><p className="truncate font-medium" title={file.name}>{file.name}</p><p className="text-xs text-muted-foreground">{file.size.toLocaleString()} bytes</p></div>
        <Button type="button" size="sm" variant="ghost" onClick={() => void download(file.name)}><Download />Download</Button>
      </li>)}</ul> : files && <p className="text-muted-foreground">Files created by your bots will appear here.</p>}
      {terminalOpen && api && <HyperBotWorkspaceTerminal files={files ?? []} run={api.command} />}
      {!api && <p role="alert">The workspace is unavailable.</p>}
      {!files && !error && api && <p role="status">Opening workspace…</p>}
      {error && <p role="alert" className="card__error">{error}</p>}
    </div>
  </HyperBotModal>;
}

function HyperBotWorkspaceTerminal({ files, run }: { files: { name: string }[]; run: NonNullable<HyperBotsApi['workspace']>['command'] }) {
  const [command, setCommand] = useState<HyperBotWorkspaceCommandInput['command']>('ls');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [output, setOutput] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function execute(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await run({ command, ...(command !== 'ls' ? { name } : {}), ...(command === 'grep' ? { search } : {}) });
      setOutput(result.ok ? result.value || '(no output)' : result.message);
    } catch {
      setOutput('The workspace command failed.');
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={execute} className="grid gap-2 border-t border-border pt-3" aria-label="Workspace terminal">
    <label className="grid gap-1">Command<select className="rounded-md border border-border bg-background p-2 font-mono" value={command} onChange={event => {
      const next = HYPER_BOT_WORKSPACE_COMMANDS.find(value => value === event.target.value);
      if (next) setCommand(next);
    }}>{HYPER_BOT_WORKSPACE_COMMANDS.map(value => <option key={value}>{value}</option>)}</select></label>
    {command !== 'ls' && <label className="grid gap-1">File<select className="rounded-md border border-border bg-background p-2" value={name} onChange={event => setName(event.target.value)} required>
      <option value="">Choose a workspace file</option>{files.map(file => <option key={file.name}>{file.name}</option>)}
    </select></label>}
    {command === 'grep' && <label className="grid gap-1">Text to find<Input value={search} onChange={event => setSearch(event.target.value)} maxLength={200} required /></label>}
    <Button type="submit" size="sm" disabled={busy} className="justify-self-end">{busy ? 'Running…' : 'Run command'}</Button>
    {output !== undefined && <pre role="status" className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 text-xs">{output}</pre>}
  </form>;
}
