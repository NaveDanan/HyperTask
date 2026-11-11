import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HyperChatMessageContent } from './HyperChatMessageContent';

describe('Hyper chat message rendering', () => {
  it('renders markdown text and code without injecting HTML or loading remote images', () => {
    const html = renderToStaticMarkup(createElement(HyperChatMessageContent, { text: '# Title\n\n**bold** and `code`\n\n<script>alert(1)</script>\n\n![tracking](https://example.org/pixel.png)\n\n```js\nconst x = "<script>";\n```' }));
    expect(html).toContain('role="heading"'); expect(html).toContain('<strong'); expect(html).toContain('<pre');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  });
  it('rejects executable link URLs while preserving the label', () => {
    const html = renderToStaticMarkup(createElement(HyperChatMessageContent, { text: '[unsafe](javascript:alert) [safe](https://example.org)' }));
    expect(html).not.toContain('javascript:'); expect(html).toContain('unsafe'); expect(html).toContain('href="https://example.org"');
  });
});
