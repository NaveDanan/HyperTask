import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HyperHandlerHarness, hyperButton, hyperFind, hyperFormSubmit } from './HyperComposerHandlerHarness';
import { HyperDictationControl } from './HyperDictationControl';
import { HyperComposer, type HyperComposerProps } from './hyper-composer';
import type { Recognition } from '../computer-browser/HyperNarration';
const io = vi.hoisted(() => ({ request: vi.fn(), record: vi.fn(), transcribe: vi.fn() }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: io.request }));
vi.mock('./HyperDictationRecording', () => ({ recordingSupported: () => true, startRecording: io.record, transcribeRecording: io.transcribe }));
const harnesses: HyperHandlerHarness[] = [];
function harness() { const h = new HyperHandlerHarness(); harnesses.push(h); return h; }
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); io.request.mockReset(); io.record.mockReset(); io.transcribe.mockReset(); });
afterEach(() => { harnesses.forEach(h => h.unmount()); harnesses.length = 0; vi.unstubAllGlobals(); });

it('offers supported recognition after a capability failure without starting it automatically', async () => {
  const start = vi.fn(); class FakeRecognition { start = start; }
  vi.stubGlobal('SpeechRecognition', FakeRecognition); io.request.mockRejectedValue(new Error('offline'));
  const h = harness(), props = { disabled: false, onText: vi.fn() };
  h.render(HyperDictationControl, props); h.flush(); await tick();
  const tree = h.render(HyperDictationControl, props); h.flush();
  expect(hyperButton(tree, 'Dictate')).toBeDefined(); expect(start).not.toHaveBeenCalled();
});

it('offers a scoped capability retry when recognition is unsupported', async () => {
  vi.stubGlobal('SpeechRecognition', undefined); vi.stubGlobal('webkitSpeechRecognition', undefined);
  io.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ transcription: true });
  const h = harness(), props = { disabled: false, onText: vi.fn() };
  h.render(HyperDictationControl, props); h.flush(); await tick();
  const failed = h.render(HyperDictationControl, props); h.flush();
  const retry = hyperButton(failed, 'Retry dictation availability'); expect(retry).toBeDefined();
  retry!.props.onClick(); await tick();
  h.render(HyperDictationControl, props); h.flush(); await tick();
  expect(hyperButton(h.render(HyperDictationControl, props), 'Dictate')).toBeDefined();
  expect(io.request).toHaveBeenCalledTimes(2); expect(io.record).not.toHaveBeenCalled();
});

it('registers a synchronous guard during permission and transcription and cancels stale completion', async () => {
  io.request.mockResolvedValue({ transcription: true }); let permission!: (recording: any) => void, transcript!: (text: string) => void;
  const cancel = vi.fn(), onText = vi.fn(); io.record.mockImplementation(() => new Promise(resolve => { permission = resolve; }));
  io.transcribe.mockImplementation(() => new Promise(resolve => { transcript = resolve; }));
  let stop: ((cancel?: boolean) => boolean) | undefined;
  const h = harness(), props = { disabled: false, onText, registerStop: (handler: typeof stop) => { stop = handler; } };
  h.render(HyperDictationControl, props); h.flush(); await tick();
  hyperButton(h.render(HyperDictationControl, props), 'Dictate')!.props.onClick();
  expect(stop?.()).toBe(true);
  permission({ finish: async () => new Blob(['audio']), cancel }); await tick();
  hyperButton(h.render(HyperDictationControl, props), 'Use recording')!.props.onClick(); await tick();
  expect(stop?.()).toBe(true);
  stop?.(true); transcript('late transcript'); await tick(); expect(onText).not.toHaveBeenCalled();
});

it('rejects cached live starts and results after disable and unmount', async () => {
  let recognition!: Recognition; const starts = vi.fn();
  class FakeRecognition {
    onresult: Recognition['onresult'] = null; onend: Recognition['onend'] = null; onerror: Recognition['onerror'] = null;
    start = starts; stop = vi.fn(); abort = vi.fn();
    constructor() { recognition = this as unknown as Recognition; }
  }
  vi.stubGlobal('SpeechRecognition', FakeRecognition); io.request.mockResolvedValue({ transcription: false });
  const h = harness(), onLiveText = vi.fn(), props = { disabled: false, onText: vi.fn(), onLiveText };
  h.render(HyperDictationControl, props); h.flush(); await tick();
  const old = hyperButton(h.render(HyperDictationControl, props), 'Dictate')!; old.props.onClick(); await tick();
  const late = recognition.onresult!;
  h.render(HyperDictationControl, { ...props, disabled: true }); h.flush();
  old.props.onClick(); late({ results: [{ 0: { transcript: 'late' }, length: 1, isFinal: true }], resultIndex: 0 });
  expect(onLiveText).not.toHaveBeenCalled(); expect(starts).toHaveBeenCalledOnce();
  h.unmount(); old.props.onClick();
  expect(starts).toHaveBeenCalledOnce();
  const reopened = harness(); reopened.render(HyperDictationControl, props); reopened.flush(); await tick();
  expect(hyperButton(reopened.render(HyperDictationControl, props), 'Dictate')).toBeDefined();
});

it('the real composer and recognizer retain final words, disable Send and reject post-send results', async () => {
  let recognition!: Recognition;
  class FakeRecognition {
    onresult: Recognition['onresult'] = null; onend: Recognition['onend'] = null; onerror: Recognition['onerror'] = null;
    start = vi.fn(); stop = vi.fn(); abort = vi.fn();
    constructor() { recognition = this as unknown as Recognition; }
  }
  vi.stubGlobal('SpeechRecognition', FakeRecognition); io.request.mockResolvedValue({ transcription: false });
  const composer = harness(), control = harness(), sent = vi.fn().mockResolvedValue(undefined);
  const props = { initialValue: 'prefix', onSubmit: sent };
  const render = () => {
    const tree = composer.render(HyperComposer, props); composer.flush();
    const child = control.render(HyperDictationControl, hyperFind(tree, element => element.type === HyperDictationControl)!.props); control.flush();
    return { tree, child };
  };
  render(); await tick(); hyperButton(render().child, 'Dictate')!.props.onClick();
  const late = recognition.onresult!;
  late({ results: [{ 0: { transcript: 'first' }, length: 1, isFinal: false }], resultIndex: 0 });
  let current = render();
  expect(hyperFind(current.tree, element => element.props['aria-label'] === 'Send message')!.props.disabled).toBe(true);
  hyperFormSubmit(current.tree); expect(recognition.stop).toHaveBeenCalledOnce(); expect(sent).not.toHaveBeenCalled();
  late({ results: [{ 0: { transcript: 'final words' }, length: 1, isFinal: true }], resultIndex: 0 }); recognition.onend!();
  current = render();
  expect(hyperFind(current.tree, element => element.props['data-slot'] === 'composer-input')!.props.value).toBe('prefix final words');
  expect(hyperFind(current.tree, element => element.props['aria-label'] === 'Send message')!.props.disabled).toBe(false);
  hyperFormSubmit(current.tree); await tick(); late({ results: [{ 0: { transcript: 'after send' }, length: 1, isFinal: true }], resultIndex: 0 });
  expect(sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'prefix final words' }));
  expect(hyperFind(render().tree, element => element.props['data-slot'] === 'composer-input')!.props.value).toBe('');
});

it('the real recording path blocks cached forms through transcription failure and permits reviewed retry text', async () => {
  io.request.mockResolvedValue({ transcription: true }); io.record.mockResolvedValue({ finish: async () => new Blob(['audio']), cancel: vi.fn() });
  io.transcribe.mockRejectedValueOnce(new Error('temporary transcription failure')).mockResolvedValueOnce('reviewed transcript');
  const composer = harness(), control = harness(), sent = vi.fn().mockResolvedValue(undefined);
  const props = { initialValue: 'prefix', onSubmit: sent };
  const render = () => {
    const tree = composer.render(HyperComposer, props); composer.flush();
    const child = control.render(HyperDictationControl, hyperFind(tree, element => element.type === HyperDictationControl)!.props); control.flush();
    return { tree, child };
  };
  const cached = render().tree; await tick(); hyperButton(render().child, 'Dictate')!.props.onClick(); await tick();
  let current = render(); expect(hyperFind(current.tree, element => element.props['aria-label'] === 'Send message')!.props.disabled).toBe(true);
  hyperFormSubmit(cached); await tick(); expect(sent).not.toHaveBeenCalled();
  current = render(); expect(hyperFind(current.tree, element => element.props['aria-label'] === 'Send message')!.props.disabled).toBe(true);
  hyperFormSubmit(current.tree); expect(sent).not.toHaveBeenCalled();
  hyperButton(current.child, 'Retry transcription')!.props.onClick(); await tick();
  current = render(); expect(hyperFind(current.tree, element => element.props['aria-label'] === 'Send message')!.props.disabled).toBe(false);
  hyperFormSubmit(current.tree); await tick(); expect(sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'prefix reviewed transcript' }));
});

it.each(['clear', 'disable', 'unmount'] as const)('rejects real deferred transcription after draft %s', async mode => {
  io.request.mockResolvedValue({ transcription: true }); io.record.mockResolvedValue({ finish: async () => new Blob(['audio']), cancel: vi.fn() });
  let complete!: (text: string) => void; io.transcribe.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const composer = harness(), control = harness(), onTextChange = vi.fn();
  let props: HyperComposerProps = { value: 'prefix', onTextChange, onSubmit: vi.fn() };
  const render = () => {
    const tree = composer.render(HyperComposer, props); composer.flush();
    const child = control.render(HyperDictationControl, hyperFind(tree, element => element.type === HyperDictationControl)!.props); control.flush(); return child;
  };
  render(); await tick(); hyperButton(render(), 'Dictate')!.props.onClick(); await tick();
  hyperButton(render(), 'Use recording')!.props.onClick(); await tick();
  if (mode === 'unmount') { composer.unmount(); control.unmount(); }
  else { props = mode === 'clear' ? { ...props, value: '' } : { ...props, disabled: true }; render(); }
  complete('outdated words'); await tick(); expect(onTextChange).not.toHaveBeenCalled();
});

it('a disabled or unmounted capability read cannot replace the newer recovery result', async () => {
  const reads: ((value: { transcription: boolean }) => void)[] = [];
  io.request.mockImplementation(() => new Promise(resolve => { reads.push(resolve); }));
  const h = harness(), props = { disabled: false, onText: vi.fn() };
  h.render(HyperDictationControl, props); h.flush();
  h.render(HyperDictationControl, { ...props, disabled: true }); h.flush();
  h.render(HyperDictationControl, props); h.flush();
  reads[1]({ transcription: true }); await tick(); reads[0]({ transcription: false }); await tick();
  expect(hyperButton(h.render(HyperDictationControl, props), 'Dictate')).toBeDefined();
  h.unmount(); const reopened = harness(); reopened.render(HyperDictationControl, props); reopened.flush();
  reads[2]({ transcription: true }); await tick();
  expect(hyperButton(reopened.render(HyperDictationControl, props), 'Dictate')).toBeDefined(); expect(io.record).not.toHaveBeenCalled();
});
