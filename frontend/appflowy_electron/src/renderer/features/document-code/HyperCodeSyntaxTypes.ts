export const hyperCodeSyntaxLimits = { source: 32_768, lines: 1024, line: 4096, html: 524_288, nodes: 16_384, ranges: 4096, totalRanges: 16_384, queue: 16, jobMs: 250, startupMs: 5000, visibleBlocks: 128, observedBlocks: 1024, layoutNodes: 4096 } as const;
export type HyperCodeSyntaxKind = 'keyword' | 'string' | 'number' | 'comment' | 'title';
export interface HyperCodeSyntaxRange { start: number; end: number; kind: HyperCodeSyntaxKind }
export interface HyperCodeSyntaxReply { version: 1; id: number; status: 'ready' | 'plain'; html: string; language: string | null }
export interface HyperCodeHighlighter {
  versionString: string;
  registerLanguage(name: string, grammar: unknown): void;
  highlight(source: string, options: { language: string; ignoreIllegals: boolean }): { value: string; language?: string };
  highlightAuto(source: string, languages: string[]): { value: string; language?: string };
}
export const hyperCodeSyntaxLanguages = ['bash', 'css', 'xml', 'javascript', 'json', 'markdown', 'python', 'rust', 'sql', 'typescript'] as const;
const aliases: Record<string, string> = { bash: 'bash', sh: 'bash', shell: 'bash', css: 'css', xml: 'xml', html: 'xml', markup: 'xml', javascript: 'javascript', js: 'javascript', json: 'json', markdown: 'markdown', md: 'markdown', python: 'python', py: 'python', rust: 'rust', rs: 'rust', sql: 'sql', typescript: 'typescript', ts: 'typescript' };
/** Lookup is transient. The stored language string, including spelling and whitespace, is never rewritten. */
export function hyperCodeSyntaxLanguage(raw: string | null): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.length > 256) return undefined;
  const key = raw.trim().toLowerCase(); return Object.hasOwn(aliases, key) ? aliases[key] : undefined;
}
export function hyperCodeSyntaxSource(source: unknown): source is string {
  if (typeof source !== 'string' || source.length > hyperCodeSyntaxLimits.source) return false;
  const lines = source.split('\n'); return lines.length <= hyperCodeSyntaxLimits.lines && lines.every(line => line.length <= hyperCodeSyntaxLimits.line);
}
export function hyperCodeSyntaxBoundary(source: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= source.length && !(offset > 0 && offset < source.length && /[\uD800-\uDBFF]/u.test(source[offset - 1]) && /[\uDC00-\uDFFF]/u.test(source[offset]));
}
export function hyperCodeSyntaxReply(value: unknown, id: number): value is HyperCodeSyntaxReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reply = value as HyperCodeSyntaxReply;
  return Object.keys(reply).every(key => ['version', 'id', 'status', 'html', 'language'].includes(key)) && reply.version === 1 && reply.id === id && ['ready', 'plain'].includes(reply.status) && typeof reply.html === 'string' && reply.html.length <= hyperCodeSyntaxLimits.html && (reply.language === null || hyperCodeSyntaxLanguages.includes(reply.language as typeof hyperCodeSyntaxLanguages[number]));
}
