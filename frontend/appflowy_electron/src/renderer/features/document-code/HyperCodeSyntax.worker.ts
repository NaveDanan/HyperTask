import { hyperCodeSyntaxTokenize } from './HyperCodeSyntaxEngine';
import { hyperCodeSyntaxLimits } from './HyperCodeSyntaxTypes';
import license from './vendor/highlightjs/LICENSE?raw';
const worker = self as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage(value: unknown): void };
worker.onmessage = event => {
  const data = event.data as { version?: unknown; id?: unknown; source?: unknown; language?: unknown } | null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['version', 'id', 'source', 'language'].includes(key)) || data.version !== 1 || !Number.isSafeInteger(data.id) || typeof data.id !== 'number' || data.id < 1 || typeof data.source !== 'string' || data.source.length > hyperCodeSyntaxLimits.source) return;
  worker.postMessage(hyperCodeSyntaxTokenize(data.source, data.language, data.id));
};
// Carry the unchanged third-party notice in the distributed worker as well as the source tree.
worker.postMessage({ version: 1, ready: true, engine: 'highlight.js@11.11.1', license });
