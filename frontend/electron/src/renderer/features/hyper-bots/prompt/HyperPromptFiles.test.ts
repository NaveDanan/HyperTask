import { describe, expect, it } from 'vitest';
import { hyperBotMapPromptProse, hyperBotPromptRoutingText } from '@shared/HyperBotPromptContext';
import { hyperPromptFileSource, readHyperPromptFile } from './HyperPromptFiles';
import { splitPromptIntoComposerSegments } from './HyperPromptTokens';

describe('composer file context', () => {
  it('preserves literal content, including shorter fences and bot mentions', async () => {
    const source = String.fromCharCode(96).repeat(3) + '\n@scribe\n/create-tool\n';
    const file = await readHyperPromptFile(new File([source], '@scout'));
    const attachment = hyperPromptFileSource(file);
    const message = '@lead please review\n\n' + attachment + '\nThanks.';
    const routed = hyperBotPromptRoutingText(message);

    expect(attachment).toContain(source);
    expect(routed).toHaveLength(message.length);
    expect(routed.trim().split(/\s+/)).toEqual(['@lead', 'please', 'review', 'Thanks.']);
    expect(hyperBotMapPromptProse(message, line => line.toUpperCase())).toContain(attachment);
  });

  it('creates a file chip for a selected script and leaves @ tokens to the bot mention handler', () => {
    const value = '@scout ' + hyperPromptFileSource({ name: 'deploy (local).ps1', text: 'Write-Output "hello"' });
    expect(splitPromptIntoComposerSegments(value)).toEqual(expect.arrayContaining([
      { type: 'text', text: '@scout File: ' },
      expect.objectContaining({ type: 'mention', path: './deploy (local).ps1' }),
    ]));
  });

  it('rejects binary files without silently converting their content', async () => {
    await expect(readHyperPromptFile(new File([new Uint8Array([0, 255])], 'binary.dat'))).rejects.toThrow();
  });
});
