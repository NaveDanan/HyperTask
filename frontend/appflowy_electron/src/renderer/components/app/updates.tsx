// App updates control (CPA-Desktop's title-bar "Updates" panel, restyled for HyperTask):
// a caption-area button that opens a dropdown with release notes, progress and actions.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCheck, Download, ExternalLink, RefreshCw, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { customWindowChrome } from './window-controls';
import type { AppUpdateState } from '@shared/api';

// ---- Shared update state (pushed by the main process, fetched on first use) ----

let state: AppUpdateState | null = null;
let connected = false;
const listeners = new Set<() => void>();

function publish(next: AppUpdateState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function connect() {
  const api = window.appflowy?.updates;
  if (!api) return;
  void api.state().then(publish);
  api.onChange(publish);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!connected && window.appflowy?.updates) {
    connected = true;
    connect();
  }
  return () => listeners.delete(listener);
}

/** The latest update state, or null before the first fetch (the harness has no bridge). */
export function useUpdateState(): AppUpdateState | null {
  return useSyncExternalStore(subscribe, () => state, () => null);
}

/** Runs one update action and refreshes the shared state from its result. */
async function run(kind: 'check' | 'download' | 'cancelDownload' | 'install'): Promise<void> {
  await window.appflowy?.updates?.[kind]().then(publish);
}

// ---- UI ----

const MB = 1048576;
const mb = (value: number) => `${(value / MB).toFixed(1)}`;

/** The title-bar trigger button (rendered by TitleBar next to the caption buttons). */
export function UpdateButton() {
  const state = useUpdateState();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number>(undefined);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  if (!customWindowChrome) return null;
  const status = state?.status;
  const release = state?.release ?? null;
  // Button labels per status, as in CPA-Desktop's title bar.
  const label = state?.status === 'downloading' ? 'Downloading update…'
    : downloadedLabel(status) ?? (release ? `Update ${release.version} available`
      : status === 'checking' ? 'Checking updates…'
        : status === 'current' ? 'Up to date'
          : status === 'error' ? 'Check failed'
            : 'Updates');
  const available = Boolean(release);
  const close = () => setOpen(false);
  return (
    <div
      className="no-drag relative flex h-full items-center pr-2 pl-1"
      onPointerEnter={() => {
        window.clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onPointerLeave={() => {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(close, 160);
      }}
    >
      <Button
        variant="outline"
        size="sm"
        data-available={available ? 'true' : undefined}
        aria-label="App updates"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'rounded-lg text-xs',
          available ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </Button>
      {open && <UpdatePanel state={state} onClose={close} />}
    </div>
  );
}

function downloadedLabel(status: AppUpdateState['status'] | undefined) {
  if (status === 'downloaded') return 'Update ready to install';
  if (status === 'installing') return 'Installing update…';
  return null;
}

function UpdatePanel({ state, onClose }: { state: AppUpdateState | null; onClose: () => void }) {
  const [busy, setBusy] = useState<'check' | 'download' | 'cancel' | 'install' | null>(null);
  const release = state?.release ?? null;
  const downloading = state?.status === 'downloading';
  const downloaded = state?.status === 'downloaded';
  const installing = state?.status === 'installing';
  const checking = state?.status === 'checking';
  const progress = downloading ? state?.progress : null;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const canDownload = Boolean(release?.installer && state?.canInstall) && !downloaded && !installing && !downloading;
  const showGitHub = Boolean(release) && !canDownload && !downloaded && !installing && !downloading;

  const act = (kind: 'check' | 'download' | 'cancelDownload' | 'install', pending: typeof busy) =>
    () => {
      setBusy(pending);
      void run(kind).catch(() => undefined).finally(() => setBusy(null));
    };

  return (
    // Outside clicks land on the drag region and dismiss; opening is hover + click.
    <div className="fixed inset-0 z-40" onClick={onClose} onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <section
        aria-label="App updates"
        className="absolute top-12 right-1.5 z-50 w-[380px] rounded-xl border border-border/80 bg-popover p-2 text-popover-foreground shadow-lg outline-none"
      >
        <div className="flex items-center justify-between gap-2 px-1.5 pt-1 pb-2">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">App updates</span>
            <span className="truncate text-xs text-muted-foreground">Installed version: {state?.currentVersion ?? '…'}</span>
          </div>
          {release && (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              Update {release.version} available
            </span>
          )}
          {downloaded && (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Ready to install</span>
          )}
        </div>

        {release && (
          <div className="my-1 max-h-48 min-h-0 overflow-y-auto border-y border-border/60 px-1.5 py-2">
            <span className="text-xs font-medium">What's new in {release.version}</span>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{release.notes}</p>
          </div>
        )}

        {progress && (
          <div className="px-1.5 py-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {percent}% · {mb(progress.received)} of {mb(progress.total)} MB
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1">
          {canDownload && (
            <Button size="xs" disabled={busy !== null} onClick={act('download', 'download')}>
              <Download data-icon="inline-start" />Download update
            </Button>
          )}
          {downloaded && (
            <Button size="xs" disabled={busy !== null} onClick={act('install', 'install')}>
              <RotateCcw data-icon="inline-start" />Restart and install
            </Button>
          )}
          {downloading && (
            <Button variant="outline" size="xs" disabled={busy !== null} onClick={act('cancelDownload', 'cancel')}>
              <X data-icon="inline-start" />Cancel download
            </Button>
          )}
          {showGitHub && (
            <Button variant="outline" size="xs" onClick={() => void window.appflowy?.updates.openRelease()}>
              <ExternalLink data-icon="inline-start" />View release on GitHub
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            disabled={busy !== null || checking || downloading || installing}
            onClick={act('check', 'check')}
          >
            {checking ? <RefreshCw data-icon="inline-start" className="animate-spin" /> : <CheckCheck data-icon="inline-start" />}
            Check for updates
          </Button>
        </div>

        <div className="min-h-0 space-y-1 px-1.5 pt-2 text-xs" aria-live="polite">
          {installing && <p className="text-muted-foreground">Installing the update. The app restarts when it completes.</p>}
          {!release && !checking && state?.status === 'current' && <p className="text-muted-foreground">You're up to date.</p>}
          {release && !state?.canInstall && !downloaded && !installing && !downloading && (
            <p className="text-muted-foreground">In-app installation is available in the installed app. Download the installer from GitHub to update.</p>
          )}
          {state?.error && <p className="text-destructive">{state.error}</p>}
        </div>
      </section>
    </div>
  );
}
