import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { HyperImportedAsset } from '@shared/api';

const folders = { image: 'images', file: 'files' } as const;
const assetFolders = new Set<string>(Object.values(folders));
const imageMime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };
type AssetKind = keyof typeof folders;
export interface HyperGeneratedAssetInfo {
  extension: 'png' | 'jpg' | 'gif' | 'webp';
  sha256: string;
  name: string;
  expectedApplicationRoot: string;
}

/** Managed attachments use the same images/ and files/ directories as Flutter. */
export class HyperAssets {
  constructor(private readonly dataDirectory: () => string | null, private readonly contextRevision: () => number = () => 0) {}

  private async directory(folder: string, create = false): Promise<string> {
    const configured = this.dataDirectory();
    if (!configured || !path.isAbsolute(configured)) throw new Error('Workspace storage is not initialized.');
    const root = await fs.realpath(configured);
    const directory = path.join(root, folder);
    if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // An attachment directory must not redirect reads or writes into another directory.
    if (await fs.realpath(directory) !== directory) throw new Error('The attachment directory is not a regular storage directory.');
    return directory;
  }

  async importFile(sourcePath: string, kind: AssetKind = 'file'): Promise<HyperImportedAsset> {
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || sourcePath.includes('\0')) throw new Error('Choose a local file to import.');
    if (kind !== 'image' && kind !== 'file') throw new Error('Unsupported attachment kind.');
    const configured = this.dataDirectory(), revision = this.contextRevision();
    if (!configured || !path.isAbsolute(configured)) throw new Error('Workspace storage is not initialized.');
    const expectedRoot = await fs.realpath(configured);
    const check = async () => {
      if (this.dataDirectory() !== configured || this.contextRevision() !== revision
        || await fs.realpath(configured) !== expectedRoot || this.dataDirectory() !== configured || this.contextRevision() !== revision) {
        throw new Error('The attachment workspace or account changed.');
      }
    };
    await check();
    const source = await fs.stat(sourcePath);
    await check();
    if (!source.isFile()) throw new Error('Choose a regular file to import.');
    const folder = folders[kind], directory = await this.directory(folder, true);
    await check();
    if (directory !== path.join(expectedRoot, folder)) throw new Error('The attachment storage changed.');
    const extension = path.extname(sourcePath).slice(0, 32).replace(/[^A-Za-z0-9.]/g, '');
    const filename = `${randomUUID()}${extension}`;
    const target = path.join(directory, filename), temporary = path.join(directory, `.${filename}.partial`);
    try {
      await fs.copyFile(sourcePath, temporary, constants.COPYFILE_EXCL);
      await check();
      await fs.chmod(temporary, 0o600);
      const file = await fs.open(temporary, 'r+');
      try { await file.sync(); } finally { await file.close(); }
      await check();
      await fs.rename(temporary, target);
      const size = (await fs.stat(target)).size;
      await check();
      return { path: target, name: path.basename(sourcePath), size, previewUrl: this.url(folder, filename) };
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** Receives validated image bytes from the generated-image bridge, never renderer paths. */
  async importGeneratedImage(bytes: Buffer, info: HyperGeneratedAssetInfo): Promise<HyperImportedAsset> {
    if (!['png', 'jpg', 'gif', 'webp'].includes(info.extension) || !/^[a-f0-9]{64}$/.test(info.sha256)
      || !bytes.length || bytes.length > 32 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== info.sha256) throw new Error('Invalid generated image.');
    const configured = this.dataDirectory();
    const revision = this.contextRevision();
    const checkRoot = async () => {
      if (!configured || this.dataDirectory() !== configured || this.contextRevision() !== revision || await fs.realpath(configured) !== info.expectedApplicationRoot
        || this.dataDirectory() !== configured || this.contextRevision() !== revision) throw new Error('The active image storage changed.');
    };
    await checkRoot();
    const directory = await this.directory('images', true);
    if (directory !== path.join(info.expectedApplicationRoot, 'images')) throw new Error('The active image storage changed.');
    await checkRoot();
    const filename = `Hyper-generated-${info.sha256}.${info.extension}`;
    const target = path.join(directory, filename), temporary = path.join(directory, `.${randomUUID()}.partial`);
    // Content-derived names make repeated message renders and application restarts idempotent.
    // An existing file is verified, never replaced, including when another import wins a race.
    const verify = async () => {
      if (await fs.realpath(target) !== target) throw new Error('The generated image target is not a regular file.');
      const existing = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await existing.stat();
        if (!stat.isFile() || stat.size !== bytes.length) throw new Error('The generated image target has different content.');
        const saved = Buffer.alloc(bytes.length);
        let offset = 0;
        while (offset < saved.length) {
          const { bytesRead } = await existing.read(saved, offset, saved.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        if (offset !== bytes.length || !saved.equals(bytes)) throw new Error('The generated image target has different content.');
      } finally { await existing.close(); }
    };
    let temporaryCreated = false;
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      temporaryCreated = true;
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await checkRoot();
      if (await fs.realpath(directory) !== directory) throw new Error('The attachment directory changed.');
      try { await fs.link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await verify();
      await checkRoot();
      return { path: target, name: info.name, size: bytes.length, previewUrl: this.url('images', filename) };
    } finally {
      if (temporaryCreated) await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  private url(folder: string, filename: string): string {
    return `appflowy-file://local/${folder}/${encodeURIComponent(filename)}`;
  }

  /** Only managed assets can become renderer URLs; absolute paths stay in the core model. */
  async previewUrl(filePath: string): Promise<string> {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) throw new Error('Invalid attachment path.');
    // Normalize the configured root's aliases and Windows casing without accepting paths
    // that resolve outside managed storage. Existing Flutter files may use that alias.
    const canonical = await fs.realpath(filePath);
    const folder = path.basename(path.dirname(canonical));
    if (!assetFolders.has(folder)) throw new Error('This file is outside attachment storage.');
    const directory = await this.directory(folder);
    const filename = path.basename(canonical);
    if (canonical !== path.join(directory, filename)) throw new Error('This file is outside attachment storage.');
    await this.resolve(this.url(folder, filename));
    return this.url(folder, filename);
  }

  async exportFile(sourcePath: string, targetPath: string): Promise<void> {
    const source = await this.source(sourcePath);
    if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || targetPath.includes('\0')) throw new Error('Choose an absolute export path.');
    let created = false;
    try {
      await fs.copyFile(source, targetPath, constants.COPYFILE_EXCL);
      created = true;
      await fs.chmod(targetPath, 0o600);
      const file = await fs.open(targetPath, 'r+');
      try { await file.sync(); } finally { await file.close(); }
    } catch (error) {
      if (created) await fs.rm(targetPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async inlineUrl(sourcePath: string): Promise<string> {
    const source = await this.source(sourcePath);
    const file = await fs.open(source, 'r');
    try {
      const limit = 16 * 1024 * 1024;
      if ((await file.stat()).size > limit) throw new Error('This attachment is too large for clipboard export. Save HTML or Markdown instead.');
      // Bound the actual read as well, in case another process extends the file after stat.
      const bytes = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > limit) throw new Error('This attachment is too large for clipboard export. Save HTML or Markdown instead.');
      const mime = imageMime[path.extname(source).toLowerCase()] ?? 'application/octet-stream';
      return `data:${mime};base64,${bytes.subarray(0, length).toString('base64')}`;
    } finally { await file.close(); }
  }

  private source(value: string): Promise<string> {
    return typeof value === 'string' && value.startsWith('appflowy-file:') ? this.resolve(value) : this.previewUrl(value).then(url => this.resolve(url));
  }

  async writeExportText(targetPath: string, content: string): Promise<void> {
    if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || targetPath.includes('\0') || typeof content !== 'string') throw new Error('Invalid export file.');
    await this.writeAtomicExport(targetPath, content);
  }

  async writeExportBytes(targetPath: string, content: Uint8Array): Promise<void> {
    if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || targetPath.includes('\0') || !(content instanceof Uint8Array) || content.length > 64 * 1024 * 1024) throw new Error('Invalid binary export file.');
    await this.writeAtomicExport(targetPath, content);
  }

  private async writeAtomicExport(targetPath: string, content: string | Uint8Array): Promise<void> {
    const temporary = path.join(path.dirname(targetPath), `.HyperTask-export-${randomUUID()}.partial`);
    let created = false;
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      created = true;
      try { await file.writeFile(content, typeof content === 'string' ? 'utf8' : undefined); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, targetPath);
    } catch (error) {
      if (created) await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** Resolve the read-only protocol without granting access to the rest of the filesystem. */
  async resolve(value: string): Promise<string> {
    const url = new URL(value);
    if (url.protocol !== 'appflowy-file:' || url.hostname !== 'local' || url.port || url.username || url.password || url.search || url.hash) throw new Error('Invalid attachment URL.');
    const parts = url.pathname.split('/');
    if (parts.length !== 3 || !assetFolders.has(parts[1])) throw new Error('Invalid attachment URL.');
    const filename = decodeURIComponent(parts[2]);
    if (!filename || filename === '.' || filename === '..' || /[/\\\0]/.test(filename)) throw new Error('Invalid attachment filename.');
    const directory = await this.directory(parts[1]);
    const candidate = path.join(directory, filename);
    if (await fs.realpath(candidate) !== candidate || !(await fs.stat(candidate)).isFile()) throw new Error('Attachment is missing or outside storage.');
    return candidate;
  }
}
