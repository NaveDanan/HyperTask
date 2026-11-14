import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@copilotkit/react-core/v2', () => ({ useCopilotKit: vi.fn(), useFrontendTool: vi.fn(), OpenGenerativeUIActivityRenderer: () => null }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { hyperScreensApi as api } from './HyperScreensApi';
import { HyperConversationResult } from './HyperConversationResult';
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => {request.mockReset();});
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
    request.mockImplementation(async () => {throw new Error('private backend detail');});
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

import { GALLERY_COMPONENTS } from './HyperGalleryRegistry';
import { hyperAnswerGalleryCall, hyperExecuteGalleryCall, HYPER_NOT_ASKED } from './HyperGalleryRuntime';
import { FormCardArgs } from './form';
import { validatePlaygroundDraft, parseJsonObject } from './HyperPlaygroundSection';
describe('Hyper original gallery registration and lifecycle', () => {
  it('loads every compiled gallery including decisions and server reports', () => {
    expect(GALLERY_COMPONENTS.map(spec => spec.name)).toEqual(expect.arrayContaining(['askApproval', 'askChoice', 'askForm', 'showActivityReport']));
  });
  it('checks the calling runtime Bot even when the channel has a local identity', async () => {
    request.mockResolvedValue({allowed: true});
    const answer = await hyperExecuteGalleryCall({name: 'custom_chart', title: 'Chart', kind: 'card'}, {}, {agent: {agentId: 'channel:other', runtimeAgentId: 'real-bot'}});
    expect(answer).toBe('It is now on screen for the person.');
    expect(request).toHaveBeenCalledWith('/api/components/custom_chart/decision', 'POST', {agentId: 'real-bot', functions: []});
  });
  it('waits independently per call and aborts the exact decision', async () => {
    request.mockResolvedValue({allowed: true});
    const spec = {name: 'askChoice', title: 'Choice', kind: 'decision' as const};
    const a = hyperExecuteGalleryCall(spec, {}, {agent: {runtimeAgentId: 'a'}, toolCall: {id: 'a'}});
    const b = hyperExecuteGalleryCall(spec, {}, {agent: {runtimeAgentId: 'b'}, toolCall: {id: 'b'}});
    await Promise.resolve(); await Promise.resolve();
    hyperAnswerGalleryCall('b', {choice: 'two'});
    expect(await b).toEqual({choice: 'two'});
    hyperAnswerGalleryCall('a', {answer: 'one'});
    expect(await a).toEqual({answer: 'one'});
    const controller = new AbortController();
    const c = hyperExecuteGalleryCall(spec, {}, {agent: {runtimeAgentId: 'c'}, toolCall: {id: 'c'}, signal: controller.signal});
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await expect(c).rejects.toThrow('aborted');
  });
  it('does not ask decisions mixed with data-reading tools', async () => {
    const result = await hyperExecuteGalleryCall({name: 'askForm', title: 'Form', kind: 'decision'}, {}, {toolCall: {id: 'form'}, agent: {messages: [{role: 'assistant', toolCalls: [{id: 'form', function: {name: 'askForm'}}, {id: 'search', function: {name: 'search'}}]}]}});
    expect(result).toBe(HYPER_NOT_ASKED);
    expect(request).not.toHaveBeenCalled();
  });
  it('preserves form validation for IDs, options and numeric limits', () => {
    expect(FormCardArgs.safeParse({title: 'Form', fields: [{id: 'a', label: 'A', type: 'select'}]}).success).toBe(false);
    expect(FormCardArgs.safeParse({title: 'Form', fields: [{id: 'a', label: 'A', type: 'number', min: 9, max: 2}]}).success).toBe(false);
    expect(FormCardArgs.safeParse({title: 'Form', fields: [{id: 'a', label: 'A', type: 'text'}]}).success).toBe(true);
  });
  it('validates author JSON before saving or previewing and saves before publishing', async () => {
    expect(parseJsonObject('[]', 'Schema').ok).toBe(false);
    const input = {slug: 'demo', title: 'Demo', description: '', html: '<p>Demo</p>', css: '', jsFunctions: '', argumentSchema: '{}', sampleArguments: '{}'};
    expect(validatePlaygroundDraft({...input, sampleArguments: '{'}).ok).toBe(false);
    const validated = validatePlaygroundDraft(input);
    expect(validated.ok).toBe(true);
    request.mockResolvedValue({});
    if (validated.ok) await api.publish(validated.input);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/sandboxed', '/api/sandboxed/custom_demo/publish']);
    request.mockClear(); request.mockImplementation(async () => {throw new Error('refused');});
    if (validated.ok) await expect(api.publish(validated.input)).rejects.toThrow('refused');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

import { hyperParseScreenDestination } from './HyperScreensDestination';
describe('Hyper canonical screens destination', () => {
  it('keeps nested gallery and admin detail names and playground', () => {
    expect(hyperParseScreenDestination('/settings/components-gallery/askChoice')).toEqual({kind: 'gallery', name: 'askChoice'});
    expect(hyperParseScreenDestination('/admin/components/showTable')).toEqual({kind: 'admin', name: 'showTable'});
    expect(hyperParseScreenDestination('/admin/playground')).toEqual({kind: 'playground'});
  });
  it('keeps screen arguments and requires an explicit server-checked Bot', () => {
    expect(hyperParseScreenDestination('/s/custom_card?agentId=bot&args=%7B%22title%22%3A%22Hi%22%7D')).toEqual({kind: 'screen', name: 'custom_card', agentId: 'bot', args: {title: 'Hi'}});
    for (const path of ['//evil/path', 'https://evil/path', '/s/x?args=[]', '/s/%2fsecret', '/unknown']) expect(hyperParseScreenDestination(path)).toEqual({kind: 'missing'});
  });
});
