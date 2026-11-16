import { create } from 'zustand';
import { FileStorageEventQueryFile, FileStorageEventRegisterStream } from '@/backend/events';
import { openReceivePort, type ReceivePort } from '@/backend/ports';

export interface FileProgress {
  fileUrl: string;
  progress: number;
  error?: string;
}

/** FileStorageService (startup/tasks/file_storage_task.dart): upload progress per file URL. */
export const useFileProgressStore = create<{ files: Record<string, FileProgress> }>(() => ({ files: {} }));

let port: ReceivePort | null = null;

/** FileProgress.fromJsonString: `{"file_url", "progress", "error"?}`; invalid input is ignored. */
export function parseFileProgress(value: unknown): FileProgress | null {
  if (typeof value !== 'string') return null;
  try {
    const json = JSON.parse(value) as { file_url?: unknown; progress?: unknown; error?: unknown };
    if (typeof json.file_url !== 'string' || typeof json.progress !== 'number') return null;
    return { fileUrl: json.file_url, progress: json.progress, error: typeof json.error === 'string' ? json.error : undefined };
  } catch {
    return null;
  }
}

/** FileStorageTask: registers the progress stream with the core (once per launch). */
export function startFileStorageService(): () => void {
  port?.close();
  useFileProgressStore.setState({ files: {} });
  port = openReceivePort((value) => {
    const progress = parseFileProgress(value);
    if (!progress) return;
    // Only files someone watches (onFileProgress) are tracked, as with Dart's notifier list.
    const { files } = useFileProgressStore.getState();
    if (files[progress.fileUrl]) useFileProgressStore.setState({ files: { ...files, [progress.fileUrl]: progress } });
  });
  void FileStorageEventRegisterStream({ port: port.port });
  return () => {
    port?.close();
    port = null;
  };
}

/** onFileProgress: start tracking a file and request its current state. */
export function watchFileProgress(fileUrl: string): () => void {
  const { files } = useFileProgressStore.getState();
  useFileProgressStore.setState({ files: { ...files, [fileUrl]: { fileUrl, progress: 0 } } });
  void FileStorageEventQueryFile({ url: fileUrl });
  return () => {
    const { [fileUrl]: _removed, ...rest } = useFileProgressStore.getState().files;
    useFileProgressStore.setState({ files: rest });
  };
}
