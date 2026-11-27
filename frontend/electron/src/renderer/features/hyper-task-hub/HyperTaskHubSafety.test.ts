// M5 E1.11: Hub components render source content as text only. No raw HTML and no Markdown renderer may
// appear in any Task Hub file, so mail, Jira and Newsletter text can never become markup.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = [__dirname, join(__dirname, '..', 'hyper-home'), join(__dirname, '..', 'settings')];
const hubFile = (path: string) => /\.(tsx?|jsx?)$/.test(path) && !/\.test\.tsx?$/.test(path)
  && (path.startsWith(__dirname) || /Hyper(HomeFocusBar|TaskHubSettings)\.tsx$/.test(path));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : hubFile(path) ? [path] : [];
  });
}

describe('Task Hub renders source content as text', () => {
  const sources = roots.flatMap(files);

  it('covers the Hub, the HyperHome bar and the settings page', () => {
    expect(sources.some(path => path.endsWith('HyperWriteBackDialog.tsx'))).toBe(true);
    expect(sources.some(path => path.endsWith('HyperHomeFocusBar.tsx'))).toBe(true);
    expect(sources.some(path => path.endsWith('HyperTaskHubSettings.tsx'))).toBe(true);
  });

  it('never uses dangerouslySetInnerHTML, innerHTML or a Markdown renderer', () => {
    const offenders = sources.filter(path => /dangerouslySetInnerHTML|\.innerHTML\s*=|react-markdown|from ['"]marked['"]|markdown-it/.test(readFileSync(path, 'utf8')));
    expect(offenders.map(path => relative(__dirname, path))).toEqual([]);
  });
});
