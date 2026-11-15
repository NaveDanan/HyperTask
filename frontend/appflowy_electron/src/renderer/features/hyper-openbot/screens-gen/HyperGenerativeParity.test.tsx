import * as React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Run the production hooks, effects and API callers with deterministic responses, without a DOM or service.
const h = vi.hoisted(() => ({ current: undefined as HyperHooks | undefined }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useState: (initial: unknown) => h.current ? h.current.state(initial) : react.useState(initial),
    useSyncExternalStore: (...args: Parameters<typeof react.useSyncExternalStore>) => h.current ? args[1]() : react.useSyncExternalStore(...args),
    useMemo: (create: () => unknown, deps: readonly unknown[]) => h.current ? h.current.memo(create, deps) : react.useMemo(create, deps),
    useCallback: (callback: (...args: any[]) => unknown, deps: readonly unknown[]) => h.current ? h.current.memo(() => callback, deps) : react.useCallback(callback, deps),
    useRef: (initial: unknown) => h.current ? h.current.ref(initial) : react.useRef(initial),
    useEffect: (...args: Parameters<typeof react.useEffect>) => h.current ? h.current.effect(...args) : react.useEffect(...args),
    useLayoutEffect: (...args: Parameters<typeof react.useLayoutEffect>) => h.current ? h.current.effect(...args) : react.useLayoutEffect(...args),
  };
});
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('@copilotkit/react-core/v2', () => ({ OpenGenerativeUIActivityRenderer: vi.fn(() => null), useFrontendTool: vi.fn(), useCopilotKit: () => ({ copilotkit: { removeHookRenderToolCall: vi.fn() } }) }));
import { OpenGenerativeUIActivityRenderer } from '@copilotkit/react-core/v2';
import { partialJSONParse } from '@copilotkit/shared';
import { hyperOpenBotRequest } from '../transport';
import { HyperGenerativeActivity } from './HyperGenerativeActivity';
import { HyperInteractiveResult } from './HyperInteractiveResult';
import HyperGallerySection, { HyperAdminComponentsSection } from './HyperGallerySection';
import { hyperGalleryComponent } from './HyperGalleryRegistry';
import { HyperGalleryStreamingContext, HyperGalleryDecidedContext } from './streaming';
import { HyperAdminComponentPreview, HyperPublishedSamplePreview } from './HyperGalleryPreview';
import { HyperProgressiveGalleryResult, hyperReadGalleryArguments } from './HyperProgressiveGalleryResult';
import { hyperSettledGalleryArguments } from './HyperSettledGalleryArguments';
import { hyperExecuteGalleryCall, hyperAnswerGalleryCall, useHyperGalleryCall } from './HyperGalleryRuntime';
import type { SandboxedRecord, ComponentRecord } from './HyperScreensTypes';

class HyperHooks {
  values: any[] = [];
  index = 0;
  effects = new Map<number, { deps?: readonly unknown[]; cleanup?: () => void }>();
  pending: (() => void)[] = [];
  render<P>(component: (props: P) => ReactNode, props: P) {
    this.index = 0; h.current = this;
    try { return component(props); } finally { h.current = undefined; }
  }
  state(initial: any) {
    const index = this.index++;
    if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial;
    return [this.values[index], (next: any) => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }];
  }
  memo(create: () => unknown, deps: readonly unknown[]) {
    const index = this.index++, previous = this.values[index];
    if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) this.values[index] = {deps, value: create()};
    return this.values[index].value;
  }
  ref(initial: unknown) { const index = this.index++; return this.values[index] ??= { current: initial }; }
  effect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const index = this.index++, previous = this.effects.get(index);
    if (previous && deps && previous.deps?.length === deps.length && deps.every((value, i) => Object.is(value, previous.deps![i]))) return;
    this.effects.set(index, { deps, cleanup: previous?.cleanup });
    this.pending.push(() => { previous?.cleanup?.(); this.effects.set(index, { deps, cleanup: effect() || undefined }); });
  }
  flush() { for (const effect of this.pending.splice(0)) effect(); }
  unmount() { for (const effect of this.effects.values()) effect.cleanup?.(); this.effects.clear(); }
}
const mounts: HyperHooks[] = [];
function mount() { const hooks = new HyperHooks(); mounts.push(hooks); return hooks; }
function find(node: ReactNode, predicate: (node: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } }
  else if (node && typeof node === 'object' && 'props' in node) { const element = node as ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); }
}
const markup = (node: ReactNode) => renderToStaticMarkup(node);
const request = vi.mocked(hyperOpenBotRequest);
const drain = async () => { for (let n = 0; n < 16; n++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const record: SandboxedRecord = {
  name: 'custom_saved', title: 'Saved', draftDescription: 'draft', draftHtml: '<p>draft only</p>', draftCss: 'draft css', draftJsFunctions: 'draftOnly()', draftArgumentSchema: {},
  publishedHtml: '<p id="sample"></p>', publishedCss: 'p { color: inherit; }', publishedJsFunctions: 'document.getElementById("sample").textContent = window.__args.title;', publishedArgumentSchema: {},
  sampleArguments: { title: 'Saved sample' }, revision: 2, published: true, publishedAt: '2026-01-01', authoredBy: null, hasUnpublishedChanges: true,
};
const row: ComponentRecord = { name: record.name, title: record.title, kind: 'sandboxed', draftDescription: '', publishedDescription: 'Published', published: true, publishedAt: null, updatedBy: null, updatedAt: '', hasUnpublishedChanges: true, withheldFrom: [], functions: [] };
beforeEach(() => {
  vi.useFakeTimers(); request.mockReset(); vi.mocked(OpenGenerativeUIActivityRenderer).mockClear();
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { for (const hooks of mounts.splice(0)) hooks.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Hyper SDK activity content', () => {
  it('preserves expression updates and all pinned SDK activity metadata without remounting', () => {
    const first = { initialHeight: 340, generating: true, css: '', cssComplete: true, html: ['<div id="target"></div>'], htmlComplete: true, jsFunctions: 'function fill(x) {}', jsFunctionsComplete: true, jsExpressions: ['fill("first")'], jsExpressionsComplete: false };
    const node = HyperGenerativeActivity({ content: first });
    expect(node.type).toBe(OpenGenerativeUIActivityRenderer);
    expect(node.props.content).toEqual(first);
    const next = HyperGenerativeActivity({ content: { ...first, jsExpressions: [...first.jsExpressions, 'fill("next")'], jsExpressionsComplete: true, generating: false } });
    expect(next.type).toBe(node.type); expect(next.key).toBe(node.key);
    expect(next.props.content.jsExpressions).toEqual(['fill("first")', 'fill("next")']);
  });
  it.each([{ jsExpressions: [123] }, { jsExpressionsComplete: 'true' }, { initialHeight: 'tall' }])('rejects invalid SDK fields %j', content => {
    expect(markup(createElement(HyperGenerativeActivity, { content }))).toContain('could not be read');
  });
});

describe('Hyper compiled progressive rendering', () => {
  it('draws settled table rows with streaming and undecided contexts before a result', async () => {
    request.mockResolvedValue({ allowed: true });
    const hooks = mount(), args = partialJSONParse('{"title":"Progress","columns":["Name","Count"],"rows":[{"cells":["Done",5]},{"cells":["Arriving",12');
    const props = { name: 'showTable', agentId: 'calling-bot', args, complete: false };
    hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain();
    const tree = hooks.render(HyperInteractiveResult, props);
    expect(request).toHaveBeenCalledWith('/api/components/showTable/decision', 'POST', { agentId: 'calling-bot', functions: [] });
    expect(find(tree, element => element.type === HyperGalleryStreamingContext.Provider)?.props.value).toBe(true);
    expect(find(tree, element => element.type === HyperGalleryDecidedContext.Provider)?.props.value).toBe(false);
    const html = markup(tree); expect(html).toContain('Done'); expect(html).not.toContain('Arriving'); expect(html).not.toContain('unreadable');
  });
  it('never supplies a premature decision callback and sanitizes model callback props', async () => {
    request.mockResolvedValue({ allowed: true }); const respond = vi.fn(), injected = vi.fn(), hooks = mount();
    const props = { name: 'askChoice', agentId: 'bot', args: { title: 'Choose', options: [{ id: 'a', label: 'A' }], respond: injected, status: 'executing' }, complete: false, respond };
    hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain();
    expect(find(hooks.render(HyperInteractiveResult, props), element => element.type === hyperGalleryComponent('askChoice')!.Component)).toBeUndefined();
    expect(respond).not.toHaveBeenCalled(); expect(injected).not.toHaveBeenCalled();
  });
  it('invalidates cached decision callbacks immediately on changed identity and unmount', async () => {
    request.mockResolvedValue({ allowed: true }); const respond = vi.fn(), hooks = mount();
    const props = { name: 'askChoice', agentId: 'bot', args: { title: 'Choose', options: [{ id: 'a', label: 'A' }] }, respond };
    hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain();
    const callback = find(hooks.render(HyperInteractiveResult, props), element => element.type === hyperGalleryComponent('askChoice')!.Component)!.props.respond;
    hooks.render(HyperInteractiveResult, { ...props, agentId: 'other' }); await callback({ choice: 'a' }); expect(respond).not.toHaveBeenCalled();
    hooks.flush(); await drain(); const current = find(hooks.render(HyperInteractiveResult, { ...props, agentId: 'other' }), element => element.type === hyperGalleryComponent('askChoice')!.Component)!.props.respond;
    hooks.unmount(); await current({ choice: 'a' }); expect(respond).not.toHaveBeenCalled();
  });
});

describe('Hyper admin published samples', () => {
  it('loads admin saved samples and previews published source through the original sandbox', async () => {
    request.mockImplementation(async path => path === '/api/components' ? { components: [row] } : path === '/api/sandboxed' ? { components: [record] } : path === '/api/agents' ? { agents: [] } : path === '/api/components/functions' ? { functions: [] } : { edition: 'personal' });
    const section = HyperAdminComponentsSection({ initialName: row.name }); const gallery = mount();
    gallery.render(section.type, section.props); gallery.flush(); await drain();
    // Descend through production detail/preview components, running their real effects and responses.
    async function expand(node: ReactNode): Promise<void> {
      if (Array.isArray(node)) { for (const child of node) await expand(child); return; }
      if (!node || typeof node !== 'object' || !('props' in node)) return;
      const element = node as ReactElement<any>;
      if (element.type === OpenGenerativeUIActivityRenderer) { element.type(element.props); return; }
      if (typeof element.type === 'function' && element.type.name.startsWith('Hyper')) {
        const hooks = mount(); hooks.render(element.type as (props: any) => ReactNode, element.props); hooks.flush(); await drain(); await expand(hooks.render(element.type as (props: any) => ReactNode, element.props));
      } else await expand(element.props.children);
    }
    await expand(gallery.render(section.type, section.props));
    expect(request).toHaveBeenCalledWith('/api/sandboxed');
    const content = vi.mocked(OpenGenerativeUIActivityRenderer).mock.calls.at(-1)?.[0].content;
    expect(content).toMatchObject({ html: [record.publishedHtml], css: record.publishedCss, jsFunctions: `window.__args = ${JSON.stringify(record.sampleArguments)};\n${record.publishedJsFunctions}`, generating: false });
    expect(request.mock.calls.some(call => /\/decision$|\/call$/.test(call[0]))).toBe(false);
    expect(JSON.stringify(content)).not.toContain('draftOnly');
  });
});


describe('Hyper argument settlement', () => {
  it('uses the SDK parser for partial text and requires valid final objects', () => {
    const raw = '{"title":"Writing","fields":[{"label":"Name","value":"Hyp';
    expect(hyperReadGalleryArguments(raw, false)).toEqual({title: 'Writing', fields: [{label: 'Name', value: 'Hyp'}]});
    expect(hyperReadGalleryArguments(raw, true)).toBeNull();
    for (const raw of ['[]', 'null', '1', '"text"', '{broken']) expect(hyperReadGalleryArguments(raw, true)).toBeNull();
    expect(hyperReadGalleryArguments(undefined, true)).toEqual({});
  });
  it('holds only the last unfinished number/link/color, preserves text and shares settled containers', () => {
    const first = {value: 12}, args = {title: 'Text', metrics: [first, {value: 125}]};
    expect(hyperSettledGalleryArguments(args, true)).toBe(args);
    const held = hyperSettledGalleryArguments(args, false);
    expect(held).toEqual({title: 'Text', metrics: [first, {}]}); expect((held.metrics as unknown[])[0]).toBe(first); expect(args.metrics[1].value).toBe(125);
    for (const tail of [{href: 'mailto:part'}, {color: 're'}, {value: '#ab'}, {label: 'http'}]) expect(hyperSettledGalleryArguments(tail, false)).toEqual({});
    expect(hyperSettledGalleryArguments({label: 'Half text'}, false)).toEqual({label: 'Half text'});
  });
  it('exposes the typed progressive seam without executing source or completing the call', () => {
    const node = HyperProgressiveGalleryResult({name: 'showRecord', agentId: 'bot', callId: 'call', arguments: '{"title":"Half', argumentsComplete: false, decided: false});
    expect(node.type).toBe(HyperInteractiveResult); expect(node.props).toMatchObject({args: {title: 'Half'}, complete: false, decided: false, callId: 'call'});
    expect(markup(HyperProgressiveGalleryResult({name: 'showRecord', agentId: 'bot', arguments: '{', argumentsComplete: true, decided: true}))).toContain('unreadable arguments');
  });
});

describe('Hyper progressive authorization and lifecycle guards', () => {
  it('keeps reports undecided until their final call is settled, including function-specific grants', async () => {
    const hooks = mount(), props = {name: 'showActivityReport', agentId: 'bot', args: {report: 'activity', days: 7}, complete: true, decided: false};
    hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain(); expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue({allowed: true}); hooks.render(HyperInteractiveResult, {...props, decided: true}); hooks.flush(); await drain();
    const tree = hooks.render(HyperInteractiveResult, {...props, decided: true});
    expect(request).toHaveBeenCalledWith('/api/components/showActivityReport/decision', 'POST', {agentId: 'bot', functions: ['botActivity']});
    expect(find(tree, element => element.type === HyperGalleryDecidedContext.Provider)?.props.value).toBe(true);
  });
  it('retains record status data and partial text while stripping model callbacks', async () => {
    request.mockResolvedValue({allowed: true}); const hooks = mount(), injected = vi.fn();
    const props = {name: 'showRecord', agentId: 'bot', args: {title: 'Record', status: 'Approved', fields: [{label: 'Name', value: 'Hyp'}], respond: injected, ask: injected}, complete: false};
    hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain();
    const tree = hooks.render(HyperInteractiveResult, props), component = find(tree, element => element.type === hyperGalleryComponent('showRecord')!.Component)!;
    expect(component.props.respond).toBeUndefined(); expect(component.props.ask).toBeUndefined();
    expect(markup(tree)).toContain('Approved'); expect(markup(tree)).toContain('Hyp'); expect(injected).not.toHaveBeenCalled();
  });
  it.each(['', '   '])('does not ask permission for unknown identity %j', async agentId => {
    const hooks = mount(), props = {name: 'showRecord', agentId, args: {}, complete: false};
    expect(markup(hooks.render(HyperInteractiveResult, props))).toContain('calling Bot'); hooks.flush(); await drain(); expect(request).not.toHaveBeenCalled();
  });
  it('denies unreadable/unavailable permission and never mounts the compiled component', async () => {
    for (const answer of [{allowed: false, reason: 'Withheld'}, {allowed: 'yes'}, new Error('offline')]) {
      request.mockImplementation(async () => {if (answer instanceof Error) throw answer; return answer;});
      const hooks = mount(), props = {name: 'showRecord', agentId: 'bot', args: {title: 'Hidden'}, complete: false};
      hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain(); const tree = hooks.render(HyperInteractiveResult, props);
      expect(find(tree, element => element.type === hyperGalleryComponent('showRecord')!.Component)).toBeUndefined(); expect(markup(tree)).toContain('role="alert"');
    }
  });
  it('rejects late permissions after navigation and late published-source responses after unmount', async () => {
    const gate = deferred<unknown>(); request.mockReturnValue(gate.promise);
    const hooks = mount(), props = {name: 'showRecord', agentId: 'old', args: {title: 'Old'}};
    hooks.render(HyperInteractiveResult, props); hooks.flush();
    hooks.render(HyperInteractiveResult, {...props, agentId: 'new'}); gate.resolve({allowed: true}); await drain();
    expect(markup(hooks.render(HyperInteractiveResult, {...props, agentId: 'new'}))).toContain('Drawing');
    const source = deferred<unknown>(); request.mockImplementation(async path => path.endsWith('/decision') ? {allowed: true} : source.promise);
    const sandbox = mount(), custom = {name: 'custom_saved', agentId: 'bot', args: {}};
    sandbox.render(HyperInteractiveResult, custom); sandbox.flush(); await drain(); sandbox.unmount(); const before = sandbox.values[0];
    source.resolve({components: [{name: 'custom_saved', html: '<p>late</p>', css: '', jsFunctions: '', argumentSchema: {}}]}); await drain(); expect(sandbox.values[0]).toBe(before);
  });
  it('requires final sandbox arguments and keeps completed decisions inert', async () => {
    request.mockResolvedValue({allowed: true}); const hooks = mount();
    hooks.render(HyperInteractiveResult, {name: 'custom_saved', agentId: 'bot', args: {}, complete: false}); hooks.flush(); await drain(); expect(request).not.toHaveBeenCalled();
    const decision = mount(), respond = vi.fn(), props = {name: 'askChoice', agentId: 'bot', args: {title: 'Choose', options: [{id: 'a', label: 'A'}]}, result: '{"choice":"a"}', respond};
    decision.render(HyperInteractiveResult, props); decision.flush(); await drain();
    const tree = decision.render(HyperInteractiveResult, props), widget = find(tree, element => element.type === hyperGalleryComponent('askChoice')!.Component)!;
    expect(widget.props.respond).toBeUndefined(); expect(widget.props.status).toBe('complete'); expect(respond).not.toHaveBeenCalled();
  });
  it('stops cached answers at revocation before another render and resolves a refused decision safely', async () => {
    request.mockResolvedValue({allowed: true}); const hooks = mount(), respond = vi.fn().mockResolvedValue(undefined), props = {name: 'askChoice', agentId: 'bot', args: {}, respond};
    hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain();
    const answer = find(hooks.render(HyperInteractiveResult, props), element => element.type === hyperGalleryComponent('askChoice')!.Component)!.props.respond;
    request.mockResolvedValue({allowed: false, reason: 'Revoked'}); await vi.advanceTimersByTimeAsync(5000); await answer({choice: 'a'}); expect(respond).not.toHaveBeenCalled();
    hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain(); expect(respond).toHaveBeenCalledExactlyOnceWith('Revoked');
  });
});

describe('Hyper published preview boundaries', () => {
  it.each(['team', 'personal'])('never reads administrator samples in the %s ordinary gallery', async edition => {
    request.mockImplementation(async path => path === '/api/components' ? {components: [row]} : {edition});
    const section = HyperGallerySection({}), hooks = mount(); hooks.render(section.type, section.props); hooks.flush(); await drain();
    const tree = hooks.render(section.type, section.props);
    expect(find(tree, element => element.type === HyperAdminComponentPreview)).toBeUndefined(); expect(request.mock.calls.map(call => call[0])).not.toContain('/api/sandboxed');
  });
  it('renders no draft for unpublished or missing published HTML and makes saved samples inert', () => {
    for (const changed of [{published: false}, {publishedHtml: null}]) expect(markup(createElement(HyperPublishedSamplePreview, {record: {...record, ...changed}}))).toContain('Publish in the playground');
    const node = HyperPublishedSamplePreview({record}); expect(node.props.inert).toBe(true); expect(node.props['aria-hidden']).toBe('true'); expect(node.props.title).toBe('Published component with saved sample arguments');
    expect(request).not.toHaveBeenCalled();
  });
  it('shows denied admin read failures without falling back to a draft or guessing a Bot', async () => {
    request.mockRejectedValue(new Error('403')); const hooks = mount(), props = {name: record.name, published: true, version: 'one'};
    hooks.render(HyperAdminComponentPreview, props); hooks.flush(); await drain();
    expect(markup(hooks.render(HyperAdminComponentPreview, props))).toContain('Preview could not be loaded');
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/sandboxed']);
  });
  it('discards older focus reads, name changes, publication changes and unmounted reads', async () => {
    const old = deferred<unknown>(), fresh = deferred<unknown>(); request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const hooks = mount(), props = {name: record.name, published: true, version: 'one'};
    hooks.render(HyperAdminComponentPreview, props); hooks.flush();
    const focus = vi.mocked(window.addEventListener).mock.calls.find(call => call[0] === 'focus')![1] as () => void;
    focus(); fresh.resolve({components: [record]}); await drain(); old.resolve({components: [{...record, publishedHtml: '<p>stale</p>'}]}); await drain();
    expect((hooks.render(HyperAdminComponentPreview, props) as ReactElement<any>).props.record.publishedHtml).toBe(record.publishedHtml);
    expect(markup(hooks.render(HyperAdminComponentPreview, {...props, name: 'other'}))).toContain('Loading preview');
    expect(markup(hooks.render(HyperAdminComponentPreview, {...props, published: false}))).toContain('Publish in the playground');
    const late = deferred<unknown>(); request.mockReturnValue(late.promise); hooks.render(HyperAdminComponentPreview, props); hooks.flush(); hooks.unmount(); const before = [...hooks.values]; late.resolve({components: [record]}); await drain(); expect(hooks.values).toEqual(before);
  });
});

describe('Hyper runtime cancellation', () => {
  it('does not confirm a drawing after its grant request outlives the run', async () => {
    const grant = deferred<unknown>(); request.mockReturnValue(grant.promise); const controller = new AbortController();
    const result = hyperExecuteGalleryCall({name: 'showRecord', title: 'Record', kind: 'card'}, {}, {agent: {runtimeAgentId: 'bot'}, signal: controller.signal});
    controller.abort(); grant.resolve({allowed: true}); await expect(result).rejects.toThrow('aborted');
  });
  it('does not make a permission request for an already aborted call', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(hyperExecuteGalleryCall({name: 'showRecord', title: 'Record', kind: 'card'}, {}, {agent: {runtimeAgentId: 'bot'}, signal: controller.signal})).rejects.toThrow('aborted'); expect(request).not.toHaveBeenCalled();
  });
});


it('keeps decision waits per call and rejects cached answers from an aborted call with a reused id', async () => {
  request.mockResolvedValue({allowed: true}); const spec = {name: 'askChoice', title: 'Choice', kind: 'decision' as const};
  const controller = new AbortController(), first = hyperExecuteGalleryCall(spec, {}, {agent: {runtimeAgentId: 'first'}, toolCall: {id: 'reused'}, signal: controller.signal});
  await drain(); const hooks = mount(); let pending: ReturnType<typeof useHyperGalleryCall>;
  hooks.render(() => {pending = useHyperGalleryCall('reused'); return null;}, {});
  const cached = (value: unknown) => hyperAnswerGalleryCall('reused', value, pending);
  const failed = expect(first).rejects.toThrow('aborted'); controller.abort(); await failed;
  const second = hyperExecuteGalleryCall(spec, {}, {agent: {runtimeAgentId: 'second'}, toolCall: {id: 'reused'}}); await drain();
  cached({choice: 'stale'}); let answered = false; void second.then(() => {answered = true;}); await drain(); expect(answered).toBe(false);
  await expect(hyperExecuteGalleryCall(spec, {}, {agent: {runtimeAgentId: 'other'}, toolCall: {id: 'reused'}})).rejects.toThrow('already waiting');
  const other = hyperExecuteGalleryCall(spec, {}, {agent: {runtimeAgentId: 'other'}, toolCall: {id: 'other'}}); await drain();
  hyperAnswerGalleryCall('other', {choice: 'other'}); expect(await other).toEqual({choice: 'other'}); expect(answered).toBe(false);
  hyperAnswerGalleryCall('reused', {choice: 'current'}); expect(await second).toEqual({choice: 'current'});
});


// Run the installed SDK's compiled renderer and HTML helpers. Only its dynamic sandbox import is
// substituted. The sandbox records requests without evaluating generated markup or JavaScript.
function hyperSdkRendererFixture() {
  const require = createRequire(import.meta.url), dist = join(dirname(require.resolve('@copilotkit/react-core/package.json')), 'dist');
  expect(require('@copilotkit/react-core/package.json').version).toBe('1.85.0');
  const bundle = readdirSync(dist).filter(name => name.endsWith('.mjs')).map(name => readFileSync(join(dist, name), 'utf8')).find(source => source.includes('//#region src/v2/components/OpenGenerativeUIRenderer.tsx'));
  if (!bundle) throw new Error('Installed SDK renderer missing');
  const region = (name: string) => {
    const start = bundle.indexOf(`//#region ${name}`);
    if (start < 0) throw new Error(`Installed SDK region missing: ${name}`);
    return bundle.slice(start, bundle.indexOf('//#endregion', start));
  };
  const sandbox = {run: vi.fn().mockResolvedValue(undefined), destroy: vi.fn(), iframe: {style: {}, contentWindow: {}}, promise: Promise.resolve()};
  const create = vi.fn(() => sandbox), functions: unknown[] = [];
  const renderer = region('src/v2/components/OpenGenerativeUIRenderer.tsx').replaceAll('import("@jetbrains/websandbox")', 'sandboxModule()');
  const code = `${region('src/v2/lib/processPartialHtml.ts')}\n${renderer}\n({OpenGenerativeUIActivityRenderer, OpenGenerativeUIContentSchema})`;
  const sdk = runInNewContext(code, {...React, React, ...require('react/jsx-runtime'), z: require('zod').z, console, window, setTimeout, clearTimeout, useSandboxFunctions: () => functions, sandboxModule: async () => ({default: {create}})});
  return {sdk, sandbox, create};
}
it('the real installed SDK queues functions before expressions, appends updates once, and destroys only on release', async () => {
  const {sdk, sandbox, create} = hyperSdkRendererFixture(), outer = mount(), inner = mount();
  const source = {initialHeight: 340, css: '', cssComplete: true, html: ['<div id="target"></div>'], htmlComplete: true, jsFunctions: 'function fill(x) {}', jsFunctionsComplete: true, jsExpressions: ['fill("first")'], jsExpressionsComplete: false, generating: true};
  const content = HyperGenerativeActivity({content: source}).props.content;
  expect(sdk.OpenGenerativeUIContentSchema.parse(content)).toEqual(source);
  const node = outer.render(sdk.OpenGenerativeUIActivityRenderer, {content}) as ReactElement<any>;
  outer.flush(); const Component = (node.type as any).type;
  const tree = inner.render(Component, node.props) as ReactElement<any>; tree.props.ref.current = {};
  inner.flush(); await drain();
  expect(create).toHaveBeenCalledOnce(); expect(create.mock.calls[0]).toEqual([{}, expect.objectContaining({allowAdditionalAttributes: '', frameContent: '<head></head><div id="target"></div>'})]);
  const codes = sandbox.run.mock.calls.map(call => call[0]); expect(codes.indexOf(source.jsFunctions)).toBeLessThan(codes.indexOf('fill("first")'));
  const next = HyperGenerativeActivity({content: {...source, jsExpressions: [...source.jsExpressions, 'fill("next")'], jsExpressionsComplete: true, generating: false}}).props.content;
  outer.render(sdk.OpenGenerativeUIActivityRenderer, {content: next});
  const updated = outer.render(sdk.OpenGenerativeUIActivityRenderer, {content: next}) as ReactElement<any>; outer.flush();
  inner.render(Component, updated.props); inner.flush(); await drain();
  inner.render(Component, updated.props); inner.flush(); await drain();
  expect(sandbox.run.mock.calls.filter(call => call[0] === 'fill("first")')).toHaveLength(1);
  expect(sandbox.run.mock.calls.filter(call => call[0] === 'fill("next")')).toHaveLength(1);
  expect(create).toHaveBeenCalledOnce(); expect(sandbox.destroy).not.toHaveBeenCalled();
  inner.unmount(); outer.unmount(); expect(sandbox.destroy).toHaveBeenCalledOnce();
});
it('the real SDK cancels deferred sandbox creation when its activity unmounts', async () => {
  const {sdk, create} = hyperSdkRendererFixture(), outer = mount(), inner = mount();
  const content = HyperGenerativeActivity({content: {html: ['<p>Final</p>'], htmlComplete: true, generating: false}}).props.content;
  const node = outer.render(sdk.OpenGenerativeUIActivityRenderer, {content}) as ReactElement<any>;
  const tree = inner.render((node.type as any).type, node.props) as ReactElement<any>; tree.props.ref.current = {};
  inner.flush(); inner.unmount(); await drain(); expect(create).not.toHaveBeenCalled();
});


it('keeps the compiled renderer mounted and reuses the same grant through successive argument deltas', async () => {
  request.mockResolvedValue({allowed: true}); const hooks = mount();
  const props = {name: 'showRecord', agentId: 'bot', callId: 'one', args: {title: 'Record', fields: [{label: 'Name', value: 'Hyp'}]}, complete: false, decided: false};
  hooks.render(HyperInteractiveResult, props); hooks.flush(); await drain();
  const first = hooks.render(HyperInteractiveResult, props);
  const next = {...props, args: {...props.args, fields: [{label: 'Name', value: 'HyperTask'}]}};
  const update = hooks.render(HyperInteractiveResult, next); hooks.flush(); await drain();
  expect(find(update, element => element.type === hyperGalleryComponent('showRecord')!.Component)?.type).toBe(find(first, element => element.type === hyperGalleryComponent('showRecord')!.Component)?.type);
  expect(markup(update)).toContain('HyperTask'); expect(request).toHaveBeenCalledTimes(1);
  const final = hooks.render(HyperInteractiveResult, {...next, complete: true, decided: true}); hooks.flush(); await drain();
  expect(markup(final)).toContain('HyperTask'); expect(find(final, element => element.type === HyperGalleryStreamingContext.Provider)?.props.value).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});
