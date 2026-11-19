import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { HYPER_BOT_ATTACHMENT_BYTES, HYPER_BOT_ATTACHMENT_COUNT, HYPER_BOT_ATTACHMENT_TYPES, type HyperBotAttachment, type HyperBotUpload } from '@shared/HyperBots';

const MAX_STORED_BYTES = 128 * 1024 * 1024;
const SafeName = z.string().trim().min(1).max(180).refine(name => !/[\x00-\x1f\x7f\/\\]/.test(name), 'Invalid filename.');
const Types = z.enum(HYPER_BOT_ATTACHMENT_TYPES);
export const HyperBotAttachmentSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: SafeName,
  type: Types,
  size: z.int().min(1).max(HYPER_BOT_ATTACHMENT_BYTES),
});
export const HyperBotUploadSchema = z.array(z.strictObject({
  name: SafeName,
  type: Types,
  data: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0 && bytes.byteLength <= HYPER_BOT_ATTACHMENT_BYTES, 'File is empty or too large.'),
})).max(HYPER_BOT_ATTACHMENT_COUNT);

function validateContent(data: Buffer, type: HyperBotAttachment['type']) {
  if (type === 'image/png') return data.length > 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return data.length > 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === 'image/webp') return data.length > 16 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (data.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(data); return true; } catch { return false; }
}

/** Account-local file store. Content addresses never come from renderer paths. */
export class HyperBotFiles {
  constructor(private readonly directory: string) {}

  prepare(input: HyperBotUpload[]) {
    const uploads = HyperBotUploadSchema.parse(input);
    return uploads.map(file => {
      const data = Buffer.from(file.data);
      if (!validateContent(data, file.type)) throw new Error('The contents of ' + file.name + ' do not match a supported file type.');
      const id = createHash('sha256').update(data).digest('hex');
      const attachment: HyperBotAttachment = { id, name: file.name, type: file.type, size: data.length };
      return { attachment, data };
    });
  }

  save(files: ReturnType<HyperBotFiles['prepare']>, referenced: () => Set<string>) {
    if (!files.length) return;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const existing = new Set(fs.readdirSync(this.directory).filter(name => /^[a-f0-9]{64}$/.test(name)));
    let used = [...existing].reduce((total, name) => total + fs.statSync(path.join(this.directory, name)).size, 0);
    const missing = files.filter(({ attachment }) => {
      if (existing.has(attachment.id)) return false;
      existing.add(attachment.id);
      used += attachment.size;
      return true;
    });
    if (used > MAX_STORED_BYTES) {
      const retain = referenced();
      for (const { attachment } of files) retain.add(attachment.id);
      for (const name of existing) {
        if (retain.has(name)) continue;
        const file = path.join(this.directory, name);
        const size = fs.lstatSync(file).size;
        fs.unlinkSync(file);
        used -= size;
      }
    }
    if (used > MAX_STORED_BYTES) throw new Error('The Hyper-Bot attachment storage limit has been reached.');
    for (const { attachment, data } of missing) {
      const dest = path.join(this.directory, attachment.id);
      fs.writeFileSync(dest + '.tmp', data, { mode: 0o600 });
      fs.renameSync(dest + '.tmp', dest);
    }
  }

  read(attachment: HyperBotAttachment): Uint8Array {
    const { id, size, type } = HyperBotAttachmentSchema.parse(attachment);
    const filename = path.join(this.directory, id);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size !== size) throw new Error('The attachment is missing or damaged.');
    const data = fs.readFileSync(filename);
    if (data.length !== size || createHash('sha256').update(data).digest('hex') !== id || !validateContent(data, type)) throw new Error('The attachment is missing or damaged.');
    return data;
  }
}
