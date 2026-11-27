import { HYPER_BOT_PROMPT_LIMIT } from '@shared/HyperBotPromptContext';
import { serializeComposerFileLink } from './HyperPromptTrigger';

export type HyperPromptFile = { name: string; text: string };

const languages = new Map(Object.entries({
  c: 'c', cpp: 'cpp', cs: 'csharp', css: 'css', html: 'html', js: 'javascript', jsx: 'jsx',
  json: 'json', md: 'markdown', ps1: 'powershell', py: 'python', rb: 'ruby', rs: 'rust',
  sh: 'bash', sql: 'sql', toml: 'toml', ts: 'typescript', tsx: 'tsx', xml: 'xml',
  yaml: 'yaml', yml: 'yaml',
}));

export async function readHyperPromptFile(file: File): Promise<HyperPromptFile> {
  if (file.size > HYPER_BOT_PROMPT_LIMIT * 4) throw new Error('File is too large for this message.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/\r\n?/g, '\n');
  if (/[\u0000-\u0008\u000e-\u001f]/u.test(text)) throw new Error('Choose a UTF-8 text file.');
  return { name: file.name.replace(/[\r\n]/g, ' '), text };
}

export function hyperPromptFileSource(file: HyperPromptFile): string {
  const link = serializeComposerFileLink(file.name);
  const language = languages.get(file.name.split('.').at(-1)?.toLowerCase() ?? '') ?? '';
  let length = 3;
  for (const match of file.text.matchAll(/`{3,}/g)) length = Math.max(length, match[0].length + 1);
  const fence = String.fromCharCode(96).repeat(length);
  return 'File: ' + link + '\n' + fence + language + '\n' + file.text + '\n' + fence;
}
