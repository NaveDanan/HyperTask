import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { hyperScreensApi as api } from './HyperScreensApi';
import { HyperConversationResult } from './HyperConversationResult';
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => request.mockReset());
describe('Hyper screens permission transport', () => {
  it('sends exact calling Bot and data function grants', async () => {
    request.mockResolvedValue({allowed: true});
    expect(await api.decision('custom_a', 'bot', ['read'])).toEqual({allowed: true});
    expect(request).toHaveBeenCalledWith('/api/components/custom_a/decision', 'POST', {agentId: 'bot', functions: ['read']});
  });
  it('fails closed for malformed decisions, network errors and missing identity', async () => {
    for (const value of [null, {}, {allowed: 'yes'}, {allowed: 1}]) {
      request.mockResolvedValue(value);
      expect((await api.decision('x', 'bot')).allowed).toBe(false);
    }
    request.mockRejectedValue(new Error('private backend detail'));
    expect(await api.decision('x', 'bot')).toEqual({allowed: false, reason: 'OpenBot could not check whether this component is allowed.'});
    request.mockClear();
    expect((await api.decision('x', '')).allowed).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('preserves mutation payloads and encodes names', async () => {
    await api.grant('a/b', 'bot/id', false);
    expect(request).toHaveBeenCalledWith('/api/components/a%2Fb/grants/bot%2Fid', 'DELETE');
    await api.functionGrant('chart', 'read', true);
    expect(request).toHaveBeenLastCalledWith('/api/components/chart/functions', 'POST', {function: 'read'});
  });
});
describe('Hyper conversation component seam', () => {
  const draw = (overrides = {}) => renderToStaticMarkup(createElement(HyperConversationResult, {tool: {id: 'call', label: 'custom_chart', arguments: '{}', status: 'complete', ...overrides}}));
  it('requires call provenance rather than borrowing channel identity', () => {
    expect(draw()).toContain('calling Bot is required');
    expect(request).not.toHaveBeenCalled();
  });
  it('preserves durable refusal and suppresses premature drawing', () => {
    expect(draw({result: 'Not shown: Chart. Withheld.'})).toContain('Withheld');
    expect(draw({result: 'Not drawn: you called this in the same step as other tools'})).toBe('');
    expect(draw({result: JSON.stringify('Not asked: too early')})).toBe('');
  });
  it('handles incomplete or invalid arguments without executing them', () => {
    expect(draw({arguments: '{', status: 'running'})).toContain('Drawing');
    expect(draw({arguments: '[]'})).toContain('unreadable arguments');
    expect(draw({arguments: '{"html":"<script>alert(1)</script>"}'})).not.toContain('<script>');
  });
});
