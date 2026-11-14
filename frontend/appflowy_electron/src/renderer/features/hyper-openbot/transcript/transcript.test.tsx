import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HyperMarkdown, HyperToolMessage, hyperDocumentChipKind, hyperSafeHref } from './index';
import { nextReveal } from './paced-reveal';

describe('Hyper transcript', () => {
  it('recognises only exact document hosts over HTTPS', () => {
    expect(hyperDocumentChipKind('https://docs.google.com/document/d/123')?.label).toBe('Doc');
    expect(hyperDocumentChipKind('https://docs.google.com.evil.test/document/d/123')).toBeNull();
    expect(hyperDocumentChipKind('http://docs.google.com/document/d/123')).toBeNull();
    expect(hyperSafeHref('javascript:alert(1)')).toBeUndefined();
    expect(hyperSafeHref('/relative')).toBeUndefined();
  });
  it('escapes remote HTML and makes recognised links into document citations', () => {
    const html = renderToStaticMarkup(createElement(HyperMarkdown, { content: '<script>alert(1)</script>\n\n[Spec](https://docs.google.com/document/d/123)\n\n[Bad](javascript:alert)' }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('Doc');
    expect(html).toContain('noreferrer noopener');
  });
  it('renders code, tables, tasks and incomplete streaming fences', () => {
    const html = renderToStaticMarkup(createElement(HyperMarkdown, { content: '| Name | Value |\n| --- | --- |\n| a | b |\n\n- [x] Done\n\n```ts\nconst x = 1;' }));
    expect(html).toContain('<table');
    expect(html).toContain('checked');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('<pre');
  });
  it('keeps refused attempts distinct from completed actions and exposes tool details', () => {
    const html = renderToStaticMarkup(createElement(HyperToolMessage, { id: 'tool-1', label: 'Saved file', attempted: 'Save file', status: 'refused', arguments: '{"path":"a"}', result: 'Access denied' }));
    expect(html).toContain('Blocked: Save file');
    expect(html).toContain('<details');
    expect(html).toContain('Access denied');
    expect(html).toContain('data-tool-call-id="tool-1"');
  });
  it('holds a partial trailing word and finishes the complete response', () => {
    expect(nextReveal({ text: 'Hello wor', shown: 0, elapsedMs: 100, streaming: true, finishInMs: 300 })).toBe(5);
    expect(nextReveal({ text: 'Hello world', shown: 5, elapsedMs: 100, streaming: false, finishInMs: 1 })).toBe(11);
    expect(nextReveal({ text: 'short', shown: 100, elapsedMs: 16, streaming: false, finishInMs: 1 })).toBe(5);
  });
});
