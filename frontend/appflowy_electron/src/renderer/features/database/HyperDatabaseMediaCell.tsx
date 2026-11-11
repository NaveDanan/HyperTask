import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Paperclip, Trash2, Upload } from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import type { FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FileUploadTypePB } from '@shared/protobuf/flowy-database2/file_entities_pb';
import { MediaFilePBSchema, MediaFileTypePB, type MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { DocumentEventDownloadFile, DocumentEventUploadFile } from '@/backend/events/flowy-document';
import { unwrap } from '@/backend/dispatch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/reui/badge';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import { hyperDatabaseError } from './HyperDatabaseStore';
import { useHyperDatabaseText } from './HyperDatabaseI18n';
import type { HyperDatabaseDraftInputs } from './HyperDatabaseDraftCell';
import { hyperCloudAssetIsProtected } from '../cloud-assets/HyperCloudAssetPreview';
import { HyperDatabaseMediaPreview } from './HyperDatabaseMediaPreview';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';

export function hyperMediaFileType(name: string): MediaFileTypePB {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'].includes(extension)) return MediaFileTypePB.Image;
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(extension)) return MediaFileTypePB.Video;
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(extension)) return MediaFileTypePB.Audio;
  if (['pdf', 'doc', 'docx', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extension)) return MediaFileTypePB.Document;
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(extension)) return MediaFileTypePB.Archive;
  if (['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(extension)) return MediaFileTypePB.Text;
  return MediaFileTypePB.Other;
}

export function HyperMediaCell({ repository, viewId, rowId, field, files, editable, saving, save, drafts }: {
  repository: HyperDatabaseRepository; viewId: string; rowId: string; field: FieldPB; files: MediaFilePB[];
  drafts?: HyperDatabaseDraftInputs;
  editable: boolean; saving: boolean; save(operation: () => Promise<void>): Promise<boolean>;
}) {
  const text = useHyperDatabaseText(), owner = useHyperDocumentOwner(), ownerKey = hyperDocumentOwnerKey(owner);
  const [openPopover, setOpenPopover] = useState(false), [page, setPage] = useState(0);
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(files.length / 20) - 1));
  useEffect(() => { setOpenPopover(false); setPage(0); setError(''); openingVersion.current++; setOpening(false); }, [ownerKey, viewId, rowId, field.id, repository]);
  useEffect(() => { if (pageIndex !== page) setPage(pageIndex); }, [pageIndex, page]);
  const workspace = useWorkspaceStore(state => state.currentWorkspace);
  const [localUrl, setLocalUrl] = useState(''), [localName, setLocalName] = useState(''), [error, setError] = useState(''), [opening, setOpening] = useState(false), [picking, setPicking] = useState(false);
  const url = drafts?.value('mediaUrl') ?? localUrl, name = drafts?.value('mediaName') ?? localName;
  const setUrl = (value: string) => drafts ? drafts.change('mediaUrl', value) : setLocalUrl(value);
  const setName = (value: string) => drafts ? drafts.change('mediaName', value) : setLocalName(value);
  const active = useRef(true), pickingNow = useRef(false), openingVersion = useRef(0);
  const scope = useRef({ repository, viewId, rowId, fieldId: field.id, editable, files });
  scope.current = { repository, viewId, rowId, fieldId: field.id, editable, files };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const upload = async () => {
    if (!editable || saving || pickingNow.current || !workspace) return;
    pickingNow.current = true; setPicking(true);
    setError('');
    const captured = hyperCaptureDuplicateOwner(owner);
    const target = { repository, viewId, rowId, fieldId: field.id, workspaceId: workspace.workspaceId, workspaceType: workspace.workspaceType };
    const requireCurrent = () => {
      const current = scope.current, selected = useWorkspaceStore.getState().currentWorkspace;
      if (owner && !captured?.isCurrent() || !active.current || !current.editable || current.repository !== target.repository || current.viewId !== target.viewId || current.rowId !== target.rowId || current.fieldId !== target.fieldId || selected?.workspaceId !== target.workspaceId || selected.workspaceType !== target.workspaceType) throw new Error(text('attachmentContextChanged'));
    };
    try {
      const paths = await window.appflowy.dialog.pickFiles({ title: text('attachFiles'), multiple: true });
      if (!paths.length) return;
      requireCurrent();
      if (drafts) { await drafts.upload(paths, target.workspaceId, target.workspaceType); return; }
      // Keep each successful copy/upload and its ID when a later file or cell write fails.
      // Retrying the saved operation must not duplicate already prepared attachments.
      const attachments: MediaFilePB[] = [];
      await save(async () => {
        requireCurrent();
        while (attachments.length < paths.length) {
          const source = paths[attachments.length];
          requireCurrent();
          const local = target.workspaceType === WorkspaceTypePB.LocalW;
          const imported = local ? await window.appflowy.assets.importFile(source) : null;
          const uploaded = imported ? null : unwrap(await DocumentEventUploadFile({ workspaceId: target.workspaceId, documentId: target.rowId, localFilePath: source }));
          const name = imported?.name || source.split(/[\\/]/).at(-1) || text('fileName');
          attachments.push(create(MediaFilePBSchema, { id: crypto.randomUUID(), name, url: imported?.path || uploaded!.url, uploadType: local ? FileUploadTypePB.LocalFile : FileUploadTypePB.CloudFile, fileType: hyperMediaFileType(name) }));
        }
        requireCurrent();
        await target.repository.attachMediaFiles(target.viewId, target.rowId, target.fieldId, attachments);
      });
    } catch (error) { if (active.current) setError(hyperDatabaseError(error)); }
    finally { pickingNow.current = false; if (active.current) setPicking(false); }
  };
  const open = async (file: MediaFilePB) => {
    const version = ++openingVersion.current;
    const captured = hyperCaptureDuplicateOwner(owner), source = JSON.stringify(file), target = { repository, viewId, rowId, fieldId: field.id };
    const current = () => { const now = scope.current; return active.current && (!owner || !!captured?.isCurrent()) && now.repository === target.repository && now.viewId === target.viewId && now.rowId === target.rowId && now.fieldId === target.fieldId && now.files.some(item => item.id === file.id && JSON.stringify(item) === source); };
    const requireCurrent = () => { if (!current()) throw new Error(text('attachmentContextChanged')); };
    setError(''); setOpening(true);
    try {
      requireCurrent();
      if (file.uploadType === FileUploadTypePB.LocalFile) {
        const result = await window.appflowy.shell.openPath(file.url);
        if (result) throw new Error(result);
      } else if (file.uploadType === FileUploadTypePB.NetworkFile && !hyperCloudAssetIsProtected(file.url)) {
        const url = new URL(file.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error(text('invalidMediaUrl'));
        await window.appflowy.shell.openExternal(url.href);
      } else {
        const target = await window.appflowy.dialog.saveFile({ defaultPath: file.name });
        if (target) { requireCurrent(); unwrap(await DocumentEventDownloadFile({ url: file.url, localFilePath: target, waitForCompletion: true })); }
      }
    } catch (error) { if (current()) setError(hyperDatabaseError(error)); }
    finally { if (active.current && openingVersion.current === version) setOpening(false); }
  };
  return <Popover open={openPopover} onOpenChange={setOpenPopover}><PopoverTrigger render={<Button variant="ghost" className="min-h-8 w-full justify-start overflow-hidden px-2 font-normal" aria-label={field.name} />}>
    <Paperclip className="size-3.5 shrink-0" /><span className="max-w-60 truncate">{files.map(file => file.name).join(', ') || text('noValue')}</span>{!!files.length && <Badge variant="secondary" size="sm">{files.length}</Badge>}
  </PopoverTrigger><PopoverContent className="max-h-96 w-96 overflow-y-auto" aria-label={field.name}>
    {files.slice(pageIndex * 20, pageIndex * 20 + 20).map(file => <div key={`${file.id}:${file.name}`} className="flex items-center gap-1">
      {file.fileType === MediaFileTypePB.Image && <HyperDatabaseMediaPreview file={file} scope={JSON.stringify([viewId, rowId, field.id])} />}
      <Input aria-label={text('fileName')} defaultValue={drafts ? undefined : file.name} value={drafts?.value('file:' + file.id, file.name)} onChange={drafts ? event => drafts.change('file:' + file.id, event.target.value, file.name) : undefined} disabled={!editable || saving} className="min-w-0 flex-1" onBlur={event => {
        const name = event.currentTarget.value.trim();
        if (name && name !== file.name) void save(() => repository.renameMedia(viewId, rowId, field.id, file.id, name));
        else { event.currentTarget.value = file.name; drafts?.change('file:' + file.id, file.name, file.name); }
      }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = file.name; drafts?.change('file:' + file.id, file.name, file.name); event.currentTarget.blur(); } }} />
      <Button variant="ghost" size="icon-sm" aria-label={`${file.uploadType === FileUploadTypePB.CloudFile || hyperCloudAssetIsProtected(file.url) ? text('downloadFile') : text('openFile')}: ${file.name}`} disabled={opening} onClick={() => { void open(file); }}>{file.uploadType === FileUploadTypePB.CloudFile || hyperCloudAssetIsProtected(file.url) ? <Download /> : <ExternalLink />}</Button>
      {editable && <Button variant="ghost" size="icon-sm" aria-label={`${text('removeFile')}: ${file.name}`} disabled={saving} onClick={() => { void save(() => repository.removeMedia(viewId, rowId, field.id, file.id)); }}><Trash2 /></Button>}
    </div>)}
    {files.length > 20 && <nav aria-label={field.name} className="flex items-center justify-between gap-2 py-1 text-xs text-muted-foreground" onKeyDown={event => { if (!(event.target instanceof HTMLButtonElement)) return; const next = event.key === 'Home' ? 0 : event.key === 'End' ? Math.ceil(files.length / 20) - 1 : event.key === 'ArrowLeft' ? pageIndex - 1 : event.key === 'ArrowRight' ? pageIndex + 1 : null; if (next !== null) { event.preventDefault(); setPage(Math.max(0, Math.min(Math.ceil(files.length / 20) - 1, next))); } }}><Button type="button" size="sm" variant="outline" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>{text('previous')}</Button><span aria-live="polite">{pageIndex * 20 + 1}–{Math.min(files.length, pageIndex * 20 + 20)} / {files.length}</span><Button type="button" size="sm" variant="outline" disabled={(pageIndex + 1) * 20 >= files.length} onClick={() => setPage(pageIndex + 1)}>{text('next')}</Button></nav>}
    {!files.length && <p className="text-xs text-muted-foreground">{text('noFiles')}</p>}
    {editable && <><Button variant="outline" size="sm" disabled={saving || picking || !workspace} onClick={() => { void upload(); }}><Upload />{text('attachFiles')}</Button><form className="flex flex-col gap-2 border-t pt-2" onSubmit={event => {
      event.preventDefault(); if (!url.trim() || saving) return;
      void save(() => repository.attachMediaLink(viewId, rowId, field.id, url.trim(), name)).then(saved => { if (saved) { setName(''); setUrl(''); } });
    }}><Input type="url" required aria-label={text('fileUrl')} placeholder="https://" value={url} disabled={saving} onChange={event => setUrl(event.target.value)} /><Input aria-label={text('fileName')} placeholder={text('fileName')} value={name} disabled={saving} onChange={event => setName(event.target.value)} /><Button type="submit" size="sm" disabled={saving || !url.trim()}>{text('attachLink')}</Button></form></>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </PopoverContent></Popover>;
}
