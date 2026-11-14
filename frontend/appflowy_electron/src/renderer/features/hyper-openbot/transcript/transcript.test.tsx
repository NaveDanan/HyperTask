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
  it('renders Markdown images inert, including remote, loopback, relative and data sources', () => {
    for (const source of ['https://tracker.example/pixel?private=context', 'http://127.0.0.1:3010/private', '//tracker.example/pixel', '/private-image', 'data:image/png;base64,aGVsbG8=']) {
      const html = renderToStaticMarkup(createElement(HyperMarkdown, { content: `![Untrusted image](${source})` }));
      expect(html).not.toMatch(/<(?:img|source|video|iframe)\b/i);
      expect(html).not.toContain('as="image"');
      expect(html).not.toContain(source);
      expect(html).toContain('Untrusted image');
    }
  });
  it('blocks passive raw HTML and images inside tool results while keeping explicit citations', () => {
    const content = '<img src="https://tracker.example/html" srcset="https://tracker.example/set 1x">\n\n<video poster="http://127.0.0.1/private"></video>\n\n![Tool image](https://tracker.example/tool)\n\n[Read source](https://example.com/source)';
    const html = renderToStaticMarkup(createElement(HyperToolMessage, { id: 't', label: 'Result', status: 'complete', result: content }));
    expect(html).not.toMatch(/<(?:img|source|video|iframe)\b/i);
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('href="https://example.com/source"');
    expect(html).toContain('Tool image');
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
