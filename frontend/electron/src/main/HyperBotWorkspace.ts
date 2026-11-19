import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HYPER_BOT_WORKSPACE_COMMANDS, HYPER_BOTS_TOOLS, type HyperBotsToolName } from '@shared/HyperBots';
import { hyperBotsReadCapped } from './HyperBotsEngine';
import { HyperBotsToolError, type HyperBotsTool } from './HyperBotsRuntime';

const sizeLimit = 32 * 1024;
const fileLimit = 200;
export const HyperBotWorkspaceName = z.string().regex(/^[a-z0-9][a-z0-9._ -]{0,100}\.(txt|md|csv|json|log)$/i, 'Use a plain text file name.');
const File = z.strictObject({ name: HyperBotWorkspaceName });
const Write = File.extend({ text: z.string().max(16_000) });
const Page = z.strictObject({ url: z.url().max(1600) });
const None = z.strictObject({});
export const HyperBotWorkspaceCommand = z.strictObject({ command: z.enum(HYPER_BOT_WORKSPACE_COMMANDS), name: HyperBotWorkspaceName.optional(), search: z.string().min(1).max(200).optional() })
  .refine(input => input.command === 'ls' || Boolean(input.name), 'Choose a workspace file.')
  .refine(input => input.command !== 'grep' || Boolean(input.search), 'Enter literal text to find.');

function refused(message: string): never {
  throw new HyperBotsToolError('refused', message);
}

export class HyperBotWorkspace {
  constructor(private readonly directory: string) {}

  list(): { name: string; size: number }[] {
    try {
      if (fs.lstatSync(this.directory).isSymbolicLink()) return refused('The workspace directory is unavailable.');
      return fs.readdirSync(this.directory, { withFileTypes: true }).flatMap(entry => {
        if (!entry.isFile() || !HyperBotWorkspaceName.safeParse(entry.name).success) return [];
        return [{ name: entry.name, size: fs.statSync(path.join(this.directory, entry.name)).size }];
      }).sort((a, b) => a.name.localeCompare(b.name)).slice(0, fileLimit);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  read(name: string): string {
    const file = path.join(this.directory, HyperBotWorkspaceName.parse(name));
    if (!this.list().some(entry => entry.name === name)) return refused('The workspace file does not exist.');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > sizeLimit) return refused('The workspace file is too large.');
      const bytes = Buffer.alloc(sizeLimit + 1);
      const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (size > sizeLimit) return refused('The workspace file is too large.');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
    } finally { fs.closeSync(fd); }
  }

  command({ command, name, search }: z.infer<typeof HyperBotWorkspaceCommand>): string {
    if (command === 'ls') return this.list().map(file => file.name).join('\n');
    const text = this.read(name!);
    const lines = text.split(/\r?\n/);
    switch (command) {
      case 'cat': return text;
      case 'head': return lines.slice(0, 20).join('\n');
      case 'tail': return lines.slice(-20).join('\n');
      case 'wc': return [text ? lines.length - Number(/\r?\n$/.test(text)) : 0, text.trim().split(/\s+/).filter(Boolean).length, Buffer.byteLength(text)].join('\t');
      case 'grep': return lines.flatMap((line, index) => line.includes(search!) ? [(index + 1) + ': ' + line] : []).join('\n');
    }
  }

  create(name: string, text: string) {
    const file = path.join(this.directory, HyperBotWorkspaceName.parse(name));
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[. ]|$)/i.test(name)) return refused('Choose a different file name.');
    if (Buffer.byteLength(text) > sizeLimit) return refused('The workspace file is too large.');
    const existing = this.list();
    if (existing.some(entry => entry.name.toLowerCase() === name.toLowerCase())) return refused('A file with this name already exists.');
    if (existing.length >= fileLimit) return refused('The workspace holds up to 200 files.');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, '.' + randomUUID() + '.tmp');
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    try { fs.linkSync(temporary, file); } finally { fs.unlinkSync(temporary); }
    return { name };
  }
}

export function hyperBotWebOrigins(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Hyper-Bot web origins must be HTTPS origins.');
    return url.origin;
  }));
}

const params = (properties: Record<string, { type: string }>) => ({ type: 'object', properties, additionalProperties: false, required: Object.keys(properties) });

function workspaceTool<S extends z.ZodType>(
  name: HyperBotsToolName, description: string, schema: S, parameters: Record<string, unknown>,
  run: (args: z.output<S>, signal: AbortSignal) => unknown,
  details?: (args: z.output<S>) => { label: string; value: string; long?: boolean }[],
): HyperBotsTool {
  return {
    name, access: HYPER_BOTS_TOOLS[name].access, description, parameters,
    parse: args => schema.parse(args),
    summarize: () => HYPER_BOTS_TOOLS[name].label,
    bind: async args => ({ destination: name === 'workspace_read_page' ? 'Approved web origin' : 'Hyper-Bot workspace', fingerprint: name, card: details?.(schema.parse(args)) }),
    run: async (args, signal) => {
      signal.throwIfAborted();
      return run(schema.parse(args), signal);
    },
  };
}

export function hyperBotWorkspaceTools(workspace: HyperBotWorkspace, webOrigins: Set<string>, fetcher = globalThis.fetch): HyperBotsTool[] {
  const text = { type: 'string' };
  const tools = [
    workspaceTool('workspace_command', 'Inspect files in the workspace with ls, cat, head, tail, wc (lines, words, bytes), or grep (literal search). Uses only workspace files and requires owner approval.', HyperBotWorkspaceCommand,
      { type: 'object', additionalProperties: false, required: ['command'], properties: { command: { type: 'string', enum: HYPER_BOT_WORKSPACE_COMMANDS }, name: text, search: text } },
      args => ({ output: workspace.command(args).slice(0, 9000) }), ({ command, name, search }) => [
        { label: 'Command', value: command }, ...(name ? [{ label: 'File', value: name }] : []), ...(search ? [{ label: 'Search', value: search }] : []),
      ]),
    workspaceTool('workspace_list_files', 'List the plain text files in the shared Hyper-Bot workspace.', None, params({}), () => workspace.list()),
    workspaceTool('workspace_read_file', 'Read one UTF-8 text file in the shared Hyper-Bot workspace by name.', File, params({ name: text }), ({ name }) => ({ name, text: workspace.read(name).slice(0, 9000) }), ({ name }) => [{ label: 'File', value: name }]),
    workspaceTool('workspace_create_file', 'Create one new UTF-8 text file in the shared Hyper-Bot workspace. Use a .txt, .md, .csv, .json or .log filename. The owner approves the exact contents.', Write, params({ name: text, text }), ({ name, text }) => workspace.create(name, text), ({ name, text }) => [{ label: 'File', value: name }, { label: 'Contents', value: text, long: true }]),
  ];
  if (webOrigins.size) {
    const target = (value: string) => {
      const url = new URL(value);
      if (!webOrigins.has(url.origin) || url.username || url.password || url.hash) return refused('This URL is outside the configured Hyper-Bot web origins.');
      return url;
    };
    tools.push(workspaceTool('workspace_read_page', 'Read text from a page on a configured HTTPS origin. This operation needs the owner’s approval.', Page, params({ url: text }), async ({ url }, signal) => {
      const destination = target(url);
      const response = await fetcher(destination.href, { method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !/^(text\/(?:html|plain|markdown)|application\/json)\b/i.test(contentType)) {
        await response.body?.cancel().catch(() => {});
        return refused('The page did not return supported text.');
      }
      const body = await hyperBotsReadCapped(response, 768 * 1024);
      const textContent = /text\/html/i.test(contentType) ? body.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]{0,2000}>/g, ' ').replace(/\s+/g, ' ').trim() : body;
      return { url: destination.href, text: textContent.slice(0, 9000) };
    }, ({ url }) => [{ label: 'URL', value: target(url).href, long: true }]));
  }
  return tools;
}
