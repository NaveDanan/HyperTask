// Adapted from OpenBot server/src/computer/routes.ts and schema.ts. Copyright (c) 2026 CopilotKit. MIT.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { hyperListFiles, hyperReadFile, hyperWriteFile, hyperDownloadFile, type HyperListing, type HyperFile } from './HyperWorkspaceApi';
export function HyperFiles({ agentId }: { agentId: string }) {
  const [path, setPath] = useState(''); const [listing, setListing] = useState<HyperListing>(); const [file, setFile] = useState<HyperFile>();
  const [contents, setContents] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const epoch = useRef(0); useEffect(() => { epoch.current++; setListing(undefined); setFile(undefined); setContents(''); return () => { epoch.current++; }; }, [agentId]);
  async function act(action: 'list' | 'read' | 'write' | 'download', target = path) {
    if ((action === 'list' || action === 'read') && file && contents !== file.text && !window.confirm('Discard unsaved file changes?')) return;
    const generation = epoch.current; setBusy(true); setError('');
    try {
      if (action === 'download') {
        const blob = await hyperDownloadFile(agentId, target);
        if (generation !== epoch.current) return;
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = target.split('/').pop() || 'download'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (action === 'list') {
        const result = await hyperListFiles(agentId, target); if (generation === epoch.current) { setListing(result); setFile(undefined); setPath(result.path); }
      } else if (action === 'read') {
        const result = await hyperReadFile(agentId, target); if (generation === epoch.current) { setFile(result); setContents(result.text); setPath(result.path); }
      } else {
        const result = await hyperWriteFile(agentId, target, contents); if (generation === epoch.current) { setFile(result); setContents(result.text); }
      }
    } catch { if (generation === epoch.current) setError('The file operation failed or was refused. Your draft is preserved.'); } finally { if (generation === epoch.current) { setBusy(false); setConfirm(false); } }
  }
  return <section className="space-y-3"><h3 className="font-semibold">Workspace files</h3><form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act('list'); }}><Input aria-label="Workspace path" disabled={busy} value={path} onChange={e => setPath(e.target.value)} /><Button disabled={busy}>List folder</Button><Button type="button" variant="outline" disabled={busy || !path.trim()} onClick={() => void act('read')}>Read file</Button></form>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Working…</p>}
    {listing && <div>{listing.entries.length === 0 && <p>This folder is empty.</p>}{listing.entries.map(entry => <div key={entry.path} className="flex gap-2 border-b py-2"><Button variant="ghost" disabled={busy} onClick={() => void act(entry.kind === 'folder' ? 'list' : 'read', entry.path)}>{entry.path}</Button><span>{entry.kind}{entry.bytes !== undefined ? ` · ${entry.bytes} bytes` : ''}</span>{entry.kind === 'file' && <Button variant="outline" disabled={busy} onClick={() => void act('download', entry.path)}>Download</Button>}</div>)}{listing.truncated && <p>Only part of this folder was returned.</p>}</div>}
    {file && <><p>{file.path} · {file.bytes} bytes{file.truncated ? ' · Partial extract. Overwriting is disabled.' : ''}</p><Textarea aria-label="File contents" disabled={busy} className="min-h-72 font-mono" value={contents} onChange={e => setContents(e.target.value)} /><Button disabled={busy || file.truncated || path !== file.path || contents === file.text} onClick={() => setConfirm(true)}>Save changes…</Button><Button variant="outline" disabled={busy} onClick={() => void act('download', file.path)}>Download original</Button></>}
    {confirm && <div role="alertdialog" aria-label="Overwrite file"><p>Replace the contents of {path}?</p><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={busy} onClick={() => void act('write')}>Replace file</Button></div>}
  </section>;
}
