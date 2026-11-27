import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import catalog from '../src/main/hyper-voice/catalog.json' with { type: 'json' };
import bundle from '../src/main/hyper-voice/HyperBundledSpeechModels.json' with { type: 'json' };

const directory = fileURLToPath(new URL('../.cache/windows-release-models/', import.meta.url));
const whisper = catalog.models.find(model => model.id === bundle.whisperId);
if (!whisper) throw new Error(`Bundled model ${bundle.whisperId} is missing from the speech catalog.`);

async function matches(file, model) {
  const info = await stat(file).catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!info?.isFile() || info.size !== model.size) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === model.sha256;
}

async function stage(model) {
  const destination = path.join(directory, model.filename);
  if (!(await matches(destination, model))) {
    const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${model.filename}`;
    const temporary = `${destination}.${process.pid}.part`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
      if (!response.ok || !response.body) throw new Error(`Could not download ${model.filename} (HTTP ${response.status}).`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
      if (!(await matches(temporary, model))) throw new Error(`Integrity check failed for ${model.filename}.`);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  console.log(`Verified ${model.filename}`);
}

await mkdir(directory, { recursive: true });
await Promise.all([stage(whisper), stage(bundle.silero)]);
