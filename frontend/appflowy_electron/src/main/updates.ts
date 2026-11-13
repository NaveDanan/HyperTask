// App updates against the GitHub release of NaveDanan/HyperTask, ported from CPA-Desktop's
// src/updates.cts + update-installer.cts. Checks release pages, compares semver tags, streams
// the installer with SHA-256 verification and hands the install off outside the app process.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';

export const REPOSITORY = 'NaveDanan/HyperTask';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/**
 * The installer artifact each release must attach for in-app updates. CI uploads an NSIS
 * `HyperTask-Setup-<version>.exe` (Windows) or a self-contained `HyperTask-<version>.AppImage`
 * (Linux), both with a GitHub `sha256:` asset digest.
 */
const INSTALLER_ASSET: Partial<Record<NodeJS.Platform, (version: string) => string>> = {
  win32: (version) => `HyperTask-Setup-${version}.exe`,
  linux: (version) => `HyperTask-${version}.AppImage`,
};

function parseVersion(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  return match ? { parts: match.slice(1, 4).map(BigInt), prerelease: Boolean(match[4]) } : null;
}

interface ReleaseAsset { name: string; size: number; digest?: string; state?: string }
interface Release { tag_name: string; draft?: boolean; prerelease?: boolean; body?: string; assets?: ReleaseAsset[] }

function releaseInstaller(release: Release, platform: NodeJS.Platform) {
  const build = INSTALLER_ASSET[platform];
  if (!build) return null;
  const version = release.tag_name.replace(/^v/, '');
  const name = build(version);
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item?.name === name && item.state === 'uploaded')
    : null;
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
    return null;
  }
  return {
    name, size: asset.size, sha256: asset.digest.slice(7).toLowerCase(),
    url: `${RELEASES_URL}/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(name)}`,
  };
}

function newerRelease(release: Release, currentVersion: string, platform: NodeJS.Platform) {
  const current = parseVersion(currentVersion);
  const next = parseVersion(release?.tag_name);
  if (!current || !next || next.prerelease || release.draft || release.prerelease) return null;
  let newer = current.prerelease;
  for (let i = 0; i < 3; i++) {
    if (next.parts[i] === current.parts[i]) continue;
    newer = next.parts[i] > current.parts[i];
    break;
  }
  if (!newer) return null;
  return {
    version: release.tag_name.replace(/^v/, ''),
    // Construct the destination ourselves; never open a URL supplied by release notes.
    url: `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`,
    installer: releaseInstaller(release, platform),
    notes: typeof release.body === 'string' && release.body.trim()
      ? release.body.trim().slice(0, 16000) : 'No release notes were provided.',
  };
}

export interface UpdateState {
  currentVersion: string;
  status: 'idle' | 'checking' | 'current' | 'available' | 'error' | 'downloading' | 'downloaded' | 'installing';
  release: ReturnType<typeof newerRelease> | null;
  error: string | null;
  canInstall: boolean;
  progress: { received: number; total: number } | null;
}

export interface DownloadedUpdate {
  version: string;
  directory: string;
  file: string;
  sha256: string;
  size: number;
}

interface UpdateOptions {
  currentVersion: string;
  fetchRelease?: typeof fetch;
  fetchInstaller?: typeof fetch;
  onChange?: (state: UpdateState) => void;
  now?: () => number;
  cacheDir?: string;
  installUpdate?: (update: DownloadedUpdate) => Promise<void>;
  installationError?: string | null;
}

class DownloadError extends Error {}

// ---- Installer staging helpers ----

function assertUpdateDirectory(cacheDir: string, directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(cacheDir) || !/^update-[A-Za-z0-9]+$/.test(path.basename(resolved))) {
    throw new Error('Invalid temporary update directory.');
  }
  return resolved;
}

export async function removeUpdateDirectory(cacheDir: string, directory: string) {
  const target = assertUpdateDirectory(cacheDir, directory);
  const stat = await fs.lstat(target).catch((): null => null);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid temporary update directory.');
  await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Removes leftover update-* directories whose extracting helper is no longer running. */
export async function cleanupUpdateCache(cacheDir: string) {
  for (const entry of await fs.readdir(cacheDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^update-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const directory = path.join(cacheDir, entry.name);
    try {
      const runner = JSON.parse(await fs.readFile(path.join(directory, 'runner.json'), 'utf8'));
      if (Number.isSafeInteger(runner.pid) && runner.pid > 0) {
        try { process.kill(runner.pid, 0); continue; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
        }
      }
    } catch { /* Interrupted downloads have no running installer helper. */ }
    await removeUpdateDirectory(cacheDir, directory).catch(() => {});
  }
}

/** A failed install of the previous session left `last-install.json` behind. */
export async function takeInstallError(cacheDir: string) {
  const file = path.join(cacheDir, 'last-install.json');
  try {
    const result = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.unlink(file);
    return result.success === false ? 'The update could not be installed. Download it again and retry, or use the GitHub installer.' : null;
  } catch { return null; }
}

export async function verifyInstaller(update: DownloadedUpdate) {
  const stat = await fs.lstat(update.file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== update.size) throw new Error('The downloaded installer has changed. Download it again.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(update.file)) hash.update(bytes);
  if (hash.digest('hex') !== update.sha256) throw new Error('The downloaded installer has changed. Download it again.');
}

/**
 * Runs the downloaded installer outside this process: waits for the app to exit, replaces the
 * AppImage (Linux) or runs the NSIS setup silently (Windows), then restarts the app. Failures
 * are reported through `last-install.json` and read by the next launch.
 */
export async function launchInstaller(update: { version: string; directory: string; file: string; sha256: string; size: number } & {
  cacheDir: string;
  parentPid: number;
  /** The installed AppImage to replace (process.env.APPIMAGE); undefined on Windows. */
  appImage?: string | null;
  /** The NSIS installer replaces this and restarts it. */
  appPath?: string;
}) {
  assertUpdateDirectory(update.cacheDir, update.directory);
  if (path.dirname(path.resolve(update.file)) !== path.resolve(update.directory)) throw new Error('Invalid installer path.');
  const lastInstall = path.join(update.cacheDir, 'last-install.json');
  if (process.platform === 'win32') {
    const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `Wait-Process -Id ${update.parentPid} -ErrorAction SilentlyContinue`,
      `try {`,
      `  $hash = (Get-FileHash -Path ${q(update.file)} -Algorithm SHA256).Hash.ToLower()`,
      `  if ($hash -ne '${update.sha256}') { throw 'The installer could not be verified.' }`,
      `  Start-Process -FilePath ${q(update.file)} -ArgumentList '/S','--updated'`,
      `  Start-Process -FilePath ${q(update.appPath ?? '')}`,
      `} catch {`,
      `  Set-Content -Path ${q(lastInstall)} -Value ((@{ version = ${q(update.version)}; success = $false; error = $($_.Exception.Message) } | ConvertTo-Json)) -Encoding UTF8`,
      `} finally {`,
      `  Remove-Item -Path ${q(path.join(update.directory, 'runner.json'))} -ErrorAction SilentlyContinue`,
      `}`,
    ].join('\n');
    const command = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', command], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    return;
  }
  if (process.platform === 'linux') {
    if (!update.appImage) throw new Error('In-app installation requires the packaged AppImage.');
    const appImage = update.appImage.replace(/'/g, `'\\''`);
    const file = update.file.replace(/'/g, `'\\''`);
    const directory = update.directory.replace(/'/g, `'\\''`);
    const last = lastInstall.replace(/'/g, `'\\''`);
    const json = `{"version":"${update.version.replace(/"/g, '\\"')}","success":false,"error":"The update could not be installed."}`;
    // The running desktop entry is the AppImage file: replace it on exit and relaunch.
    const script = [
      `echo $$ > '${directory}/runner.json'`,
      `while kill -0 ${update.parentPid} 2>/dev/null; do sleep 1; done`,
      `hash="$(sha256sum '${file}' 2>/dev/null | cut -d' ' -f1)"`,
      `if [ "$hash" = '${update.sha256}' ]; then`,
      `  chmod +x '${file}' && mv -f '${file}' '${appImage}' && exec '${appImage}' || printf '%s' '${json}' > '${last}'`,
      `else`,
      `  printf '%s' '${json}' > '${last}'`,
      `fi`,
    ].join('\n');
    const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  throw new Error('In-app installation is not available on this platform.');
}

function createUpdateChecker({ currentVersion, fetchRelease = fetch, fetchInstaller = fetch, onChange = () => {}, now = Date.now, cacheDir, installUpdate, installationError = null }: UpdateOptions) {
  const platform = process.platform;
  let state: UpdateState = { currentVersion, status: 'idle', release: null, error: installationError, canInstall: Boolean(cacheDir && installUpdate), progress: null };
  let pending: Promise<UpdateState> | null;
  let action: Promise<UpdateState> | null;
  let downloadController: AbortController | null = null;
  let downloaded: DownloadedUpdate | null = null;
  let handedOff = false;
  let lastAttempt = -Infinity;
  let stopped = false;
  const controller = new AbortController();
  const userAgent = 'HyperTask';
  const publish = (changes: Partial<UpdateState>) => {
    state = { ...state, ...changes };
    if (!stopped) onChange({ ...state });
    return { ...state };
  };
  const check = () => {
    if (action || state.status === 'downloaded' || state.status === 'installing') return Promise.resolve({ ...state });
    if (pending) return pending;
    if (stopped || now() - lastAttempt < 60000) return Promise.resolve({ ...state });
    lastAttempt = now();
    publish({ status: 'checking', error: installationError });
    pending = (async () => {
      try {
        if (!parseVersion(currentVersion)) throw new Error('The installed version is invalid.');
        let release: UpdateState['release'] = null;
        let hasEntries = false;
        let hasVersion = false;
        // GitHub's manually selected "Latest" release can lag behind a newer stable version.
        // Inspect every page and compare versions instead of relying on that designation or ordering.
        for (let page = 1; ; page++) {
          const response = await fetchRelease(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent, 'Cache-Control': 'no-cache' },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
          const data = await response.json();
          if (!Array.isArray(data)) throw new Error('GitHub returned an invalid release list.');
          hasEntries ||= data.length > 0;
          for (const item of data) {
            if (!parseVersion(item?.tag_name)) continue;
            hasVersion = true;
            const candidate = newerRelease(item, release?.version || currentVersion, platform);
            if (candidate) release = candidate;
          }
          if (data.length < 100) break;
        }
        if (hasEntries && !hasVersion) throw new Error('Published releases have unsupported version tags.');
        return publish({ status: release ? 'available' : 'current', release, error: installationError });
      } catch {
        return publish({ status: 'error', error: 'Unable to check GitHub. Try again later.' });
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  const download = (): Promise<UpdateState> => {
    if (action) return action;
    if (pending) return pending.then(download);
    if (stopped || state.status === 'downloaded' || state.status === 'installing' || !state.release) return Promise.resolve({ ...state });
    const release = state.release;
    const installer = release.installer;
    if (!state.canInstall || !installer || !cacheDir) return Promise.resolve(publish({ status: 'available', error: 'This release does not have an installer available for in-app updating. Use View release on GitHub.' }));
    const cache = cacheDir;
    downloadController = new AbortController();
    const signal = AbortSignal.any([controller.signal, downloadController.signal]);
    installationError = null;
    publish({ status: 'downloading', error: null, progress: { received: 0, total: installer.size } });
    action = (async () => {
      let directory: string | null = null;
      let file: fs.FileHandle | null = null;
      try {
        await fs.mkdir(cache, { recursive: true });
        directory = await fs.mkdtemp(path.join(cache, 'update-'));
        const partial = path.join(directory, `${installer.name}.part`);
        file = await fs.open(partial, 'wx', 0o600);
        const response = await fetchInstaller(installer.url, { signal, headers: { 'User-Agent': userAgent } });
        if (!response.ok || !response.body) throw new DownloadError('Unable to download the update from GitHub. Try again later.');
        const reader = response.body.getReader();
        const hash = createHash('sha256');
        let received = 0;
        let lastProgress = 0;
        try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > installer.size) throw new DownloadError('The installer size does not match the release. Download it again.');
            hash.update(value);
            await file.writeFile(value);
            if (Date.now() - lastProgress >= 200) {
              publish({ progress: { received, total: installer.size } });
              lastProgress = Date.now();
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        await file.close();
        file = null;
        signal.throwIfAborted();
        if (received !== installer.size || hash.digest('hex') !== installer.sha256) throw new DownloadError('The installer could not be verified. Download it again.');
        const target = path.join(directory, installer.name);
        await fs.rename(partial, target);
        downloaded = { version: release.version, directory, file: target, sha256: installer.sha256, size: installer.size };
        return publish({ status: 'downloaded', progress: { received, total: installer.size } });
      } catch (error) {
        if (file) await file.close().catch(() => {});
        if (directory) await removeUpdateDirectory(cache, directory).catch(() => {});
        return publish({
          status: 'available', progress: null,
          error: signal.aborted ? null : (error instanceof DownloadError ? error.message : 'Unable to download the update. Check your connection and try again.'),
        });
      }
    })().finally(() => { action = null; downloadController = null; });
    return action;
  };
  const install = (): Promise<UpdateState> => {
    if (action) return action;
    if (stopped || handedOff || !downloaded || !installUpdate || !cacheDir || state.status !== 'downloaded') return Promise.resolve({ ...state });
    const update = downloaded;
    publish({ status: 'installing', error: null });
    action = (async () => {
      try {
        await verifyInstaller(update);
        await installUpdate(update);
        handedOff = true;
        return { ...state };
      } catch {
        await removeUpdateDirectory(cacheDir, update.directory).catch(() => {});
        downloaded = null;
        return publish({ status: 'available', progress: null, error: 'Unable to start the update. Download it again and retry, or use the GitHub installer.' });
      }
    })().finally(() => { action = null; });
    return action;
  };
  return {
    check, download, install,
    cancelDownload: async () => { downloadController?.abort(); return action ? await action : { ...state }; },
    getState: () => ({ ...state }),
    stop: async () => {
      stopped = true;
      controller.abort();
      await pending;
      await action;
      if (downloaded && !handedOff && cacheDir) {
        await removeUpdateDirectory(cacheDir, downloaded.directory).catch(() => {});
        downloaded = null;
      }
    },
  };
}

export { createUpdateChecker, newerRelease, RELEASES_URL, releaseInstaller, parseVersion };
