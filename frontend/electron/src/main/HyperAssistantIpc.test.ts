import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HyperAssistantPerson } from '@shared/HyperAssistant';
import { HyperAssistantChannel as A } from '@shared/HyperAssistant';
import { hyperBotsWithDirectRooms, type HyperBotsSettings } from '@shared/HyperBots';

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: any[]) => any) => ipc.handlers.set(name, fn),
    removeHandler: (name: string) => ipc.handlers.delete(name),
  },
}));

import { buildDispatchedAssistantText, registerHyperAssistantIpc } from './HyperAssistantIpc';
import { HyperBotsRuntime } from './HyperBotsRuntime';
import { HyperBotsStore } from './HyperBotsStore';
import { HyperBotsTools, hyperBotsOutlookTools } from './HyperBotsConnectors';
import type { HyperTrustedWindowRegistry } from './HyperTrustedWindows';

const AARON: HyperAssistantPerson = {
  name: 'Aaron Mitchell',
  email: 'aaron.mitchell@corp.example',
  title: 'Staff Engineer',
  department: 'Platform',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'ad',
};

const ISRAEL: HyperAssistantPerson = {
  name: 'ישראל ישראלי',
  email: 'israel.israeli@corp.example',
  title: 'מנהל מוצר',
  department: 'מוצר',
  phone: '',
  office: '',
  company: 'HyperTask',
  source: 'outlook',
};

function setup(opts: { signedIn?: boolean; modelReply?: 'create-meeting' | 'hand-off' | 'text'; defaultModel?: string | null | (() => Promise<string | null>) } = {}) {
  const signedIn = opts.signedIn ?? true;
  const outlookRequests: Array<{ op: string; args: unknown }> = [];
  const cached = new Map<string, HyperAssistantPerson>();
  const outlookBridge = {
    cachedPerson: (email: string) => cached.get(email) ?? null,
    request: vi.fn(async (op: string, args: any) => {
      outlookRequests.push({ op, args });
      if (op === 'people.search') {
        const q = String(args.query).toLowerCase();
        const found = [AARON, ISRAEL].filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q.split(' ')[0]!));
        for (const person of found) cached.set(person.email, person);
        return found;
      }
      if (op === 'people.lookup') {
        return [AARON, ISRAEL].find((p) => p.email.toLowerCase() === String(args.email).toLowerCase()) ?? null;
      }
      if (op === 'mail.account') return { address: 'owner@corp.example', name: 'Owner' };
      if (op === 'create') {
        return {
          id: 'EV1', subject: args.subject, start: args.start, end: args.end, allDay: false, location: '', body: '',
          organizer: 'Owner', isOrganizer: true, responseStatus: 1, attendees: [], attendeeCount: args.attendees.length,
          busyStatus: 2, isRecurring: false, recurrenceState: 0, isCancelled: false, isPrivate: false, joinUrl: null,
          categories: [], lastModified: '2026-11-22T00:00:00.000Z',
        };
      }
      return [];
    }),
  };

  let engineStep = 0;
  let delegatedMeeting = false;
  const engine = {
    complete: vi.fn(async ({ model }: { model: string }) => {
      engineStep++;
      if (opts.modelReply === 'hand-off' && engineStep === 1) {
        return {
          message: {
            role: 'assistant' as const,
            content: null,
            tool_calls: [{
              id: 'delegate-meeting',
              type: 'function' as const,
              function: { name: 'hand_off', arguments: JSON.stringify({ botId: 'bot', request: 'Create the meeting' }) },
            }],
          },
          finishReason: 'tool_calls',
        };
      }
      if ((opts.modelReply === 'create-meeting' && engineStep === 1) || (opts.modelReply === 'hand-off' && model === 'gpt-delegate' && !delegatedMeeting)) {
        delegatedMeeting = true;
        return {
          message: {
            role: 'assistant' as const,
            content: null,
            tool_calls: [{
              id: 'call_meet_1',
              type: 'function' as const,
              function: {
                name: 'outlook_create_event',
                arguments: JSON.stringify({
                  subject: 'Sync with Aaron',
                  start: '2026-11-23T18:00:00Z',
                  end: '2026-11-23T18:30:00Z',
                  attendees: ['aaron.mitchell@corp.example'],
                }),
              },
            }],
          },
          finishReason: 'tool_calls',
        };
      }
      return { message: { role: 'assistant' as const, content: 'Done!' }, finishReason: 'stop' };
    }),
  };

  const store = new HyperBotsStore(null);
  const runtime = new HyperBotsRuntime({
    store,
    engine,
    tools: new HyperBotsTools(hyperBotsOutlookTools(outlookBridge as never)),
    defaultModel: async () => typeof opts.defaultModel === 'function' ? opts.defaultModel() : opts.defaultModel === undefined ? 'gpt-test' : opts.defaultModel,
  });
  const initialSettings: HyperBotsSettings = hyperBotsWithDirectRooms({
    version: 1,
    bots: [
      { id: 'abby', name: 'Abby', mode: 'personal', instructions: 'You are Abby.', model: '', tools: ['outlook_list_events'] },
      { id: 'bot', name: 'משה', mode: 'personal', instructions: 'אתה משה.', model: 'gpt-delegate', tools: ['outlook_list_events', 'outlook_create_event', 'outlook_search_people'] },
    ],
    rooms: [{ id: 'ops', name: 'Ops', kind: 'group', botIds: ['abby', 'bot'] }],
    policy: { outlook_list_events: 'ask', outlook_get_event: 'ask', outlook_list_messages: 'ask', outlook_read_message: 'ask', outlook_search_people: 'allow' },
  });
  runtime.saveSettings(initialSettings);

  const botsHub = {
    current: vi.fn(async () => {
      if (!signedIn) throw new Error('Sign in to HyperTask to use Bots.');
      return { user: { key: 'u'.repeat(64), userId: '1' }, runtime };
    }),
  };

  const trustedSender = { mainFrame: {} };
  const trustedEvent = { sender: trustedSender, senderFrame: trustedSender.mainFrame };
  const untrustedEvent = { sender: { mainFrame: {} }, senderFrame: {} };
  const trustedWindows: HyperTrustedWindowRegistry = {
    isTrustedSender: (event) => event.sender === trustedSender && event.senderFrame === trustedSender.mainFrame,
    broadcast: vi.fn(),
    webContents: () => [],
  };

  const unregister = registerHyperAssistantIpc({
    trustedWindows,
    botsHub,
    outlookBridge: outlookBridge as never,
  });

  const invoke = (channel: string, args?: unknown, ev: unknown = trustedEvent) => ipc.handlers.get(channel)!(ev, args);
  return { invoke, runtime, store, outlookRequests, trustedEvent, untrustedEvent, unregister, botsHub };
}

beforeEach(() => {
  ipc.handlers.clear();
});

describe('buildDispatchedAssistantText', () => {
  it('substitutes confirmed people with @[Name](mailto:email) and ensures Hebrew or English @bot handle', () => {
    expect(
      buildDispatchedAssistantText(
        '@abby set meeting with @Aaron Mitchel tomorrow at 6 PM',
        { id: 'abby', name: 'Abby' },
        [{ rawName: 'Aaron Mitchel', name: 'Aaron Mitchell', email: 'aaron.mitchell@corp.example' }],
      ),
    ).toBe('@abby set meeting with @[Aaron Mitchell](mailto:aaron.mitchell@corp.example) tomorrow at 6 PM');

    expect(
      buildDispatchedAssistantText(
        'לקבוע פגישה עם @ישראל ישראלי מחר',
        { id: 'bot', name: 'משה' },
        [{ rawName: 'ישראל ישראלי', name: 'ישראל ישראלי', email: 'israel.israeli@corp.example' }],
      ),
    ).toBe('@משה לקבוע פגישה עם @[ישראל ישראלי](mailto:israel.israeli@corp.example) מחר');
  });
});

describe('registerHyperAssistantIpc', () => {
  it('refuses untrusted callers on every channel', async () => {
    const h = setup();
    try {
      for (const ch of [A.ParseCommand, A.SearchPeople, A.Dispatch, A.Execution, A.DecideApproval, A.ListBots]) {
        await expect(h.invoke(ch, {}, h.untrustedEvent)).rejects.toThrow(/Untrusted HyperAssistant/);
      }
    } finally {
      h.unregister();
    }
  });

  it('lists bots with EN and HE display handles and searches people cleanly', async () => {
    const h = setup();
    try {
      const bots = await h.invoke(A.ListBots);
      expect(bots.map((b: any) => [b.id, b.handle, b.roomId])).toEqual([
        ['abby', '@abby', 'dm-abby'],
        ['bot', '@משה', 'dm-bot'],
      ]);
      const found = await h.invoke(A.SearchPeople, { query: 'לישראל ישראלי' });
      expect(found).toEqual([ISRAEL]);
    } finally {
      h.unregister();
    }
  });

  it('parses, enables missing Outlook tools on dispatch, runs bot, and approves enriched Outlook meeting card', async () => {
    const h = setup({ modelReply: 'create-meeting' });
    try {
      const plan = await h.invoke(A.ParseCommand, { text: 'Tell Abby to set meeting with Aaron Mitchel tomorrow at six PM' });
      expect(plan.resolvedBot?.id).toBe('abby');
      expect(plan.missingTools).toEqual(['outlook_create_event', 'outlook_search_people']);

      const dispatched = await h.invoke(A.Dispatch, {
        botId: 'abby',
        targetRoomId: null,
        text: plan.normalizedText,
        confirmedPeople: [{ rawName: 'Aaron Mitchel', name: AARON.name, email: AARON.email }],
        enableMissingTools: plan.missingTools,
      });
      expect(dispatched).toMatchObject({
        ok: true,
        roomId: 'dm-abby',
        botId: 'abby',
        botName: 'Abby',
      });
      expect(dispatched.dispatchedText).toContain('@[Aaron Mitchell](mailto:aaron.mitchell@corp.example)');

      // Missing tools were persisted on Abby before the run started
      expect(h.runtime.settings().bots.find((b) => b.id === 'abby')!.tools).toEqual(
        expect.arrayContaining(['outlook_create_event', 'outlook_search_people']),
      );

      await h.runtime.idle();
      // The Outlook meeting write MUST stop at pending approval with enriched Display Name <email> card
      const pending = h.store.listApprovals({ status: ['pending'] });
      expect(pending).toHaveLength(1);
      expect(pending[0]!.tool).toBe('outlook_create_event');
      expect(pending[0]!.card?.find((r) => r.label === 'Invites')?.value).toContain('Aaron Mitchell');
      expect(h.outlookRequests.some((r) => r.op === 'create')).toBe(false);

      // Approving via assistant:decideApproval sends the meeting invite
      const decided = await h.invoke(A.DecideApproval, { approvalId: pending[0]!.id, approved: true });
      expect(decided).toEqual({ ok: true });
      await h.runtime.idle();
      expect(h.outlookRequests.some((r) => r.op === 'create')).toBe(true);
    } finally {
      h.unregister();
    }
  });

  it('handles unsigned-in botsHub gracefully across listBots, parseCommand, dispatch, and decideApproval', async () => {
    const h = setup({ signedIn: false });
    try {
      expect(await h.invoke(A.ListBots)).toEqual([]);
      const plan = await h.invoke(A.ParseCommand, { text: 'Set meeting with Aaron Mitchel' });
      expect(plan.signedIn).toBe(false);
      expect(plan.warnings[0]).toMatch(/Sign in/i);
      const disp = await h.invoke(A.Dispatch, { botId: 'abby', text: 'hi', confirmedPeople: [] });
      expect(disp).toMatchObject({ ok: false, error: expect.stringMatching(/Sign in/i) });
      const dec = await h.invoke(A.DecideApproval, { approvalId: '11111111-1111-4111-8111-111111111111', approved: true });
      expect(dec).toMatchObject({ ok: false, error: expect.stringMatching(/Sign in/i) });
    } finally {
      h.unregister();
    }
  });
});

it('replaces complete recipient spans and updates only the selected serialized address', () => {
  const bot = { id: 'abby', name: 'Abby' };
  expect(buildDispatchedAssistantText('schedule a meeting tomorrow with Tom', bot, [
    { rawName: 'Tom', name: 'Tom Smith', email: 'tom@corp.example' },
  ])).toBe('@abby schedule a meeting tomorrow with @[Tom Smith](mailto:tom@corp.example)');
  expect(buildDispatchedAssistantText('Email Joanne and Ann', bot, [
    { rawName: 'Ann', name: 'Ann Smith', email: 'ann@corp.example' },
  ])).toBe('@abby Email Joanne and @[Ann Smith](mailto:ann@corp.example)');

  const old = '@[Dana Cohen](mailto:old@corp.example)';
  const other = '@[Dana Cohen](mailto:other@corp.example)';
  const text = 'Email ' + other + ' and ' + old;
  const start = text.lastIndexOf(old);
  expect(buildDispatchedAssistantText(text, bot, [
    { rawName: 'Dana Cohen', name: 'Dana Cohen', email: 'new@corp.example', sourceSpan: { start, end: start + old.length, text: old } },
  ])).toBe('@abby Email ' + other + ' and @[Dana Cohen](mailto:new@corp.example)');
});

it('requires a complete email and rejects oversized commands before any directory request', async () => {
  const h = setup();
  const emails = Array.from({ length: 21 }, (_, index) => 'person' + index + '@corp.example');
  await expect(h.invoke(A.ParseCommand, { text: 'Email ' + emails.join(', ') })).rejects.toThrow(/at most 20/);
  expect(h.outlookRequests).toEqual([]);
  const plan = await h.invoke(A.ParseCommand, { text: 'Send an email to ' + AARON.email + '.' });
  expect(plan.people).toHaveLength(1);
  expect(plan.people[0]).toMatchObject({ query: AARON.email, selected: AARON });
  expect(h.outlookRequests).toEqual([{ op: 'people.lookup', args: { email: AARON.email } }]);
});

it('rejects stale recipient offsets instead of dispatching a previously selected address', async () => {
  const h = setup();
  const result = await h.invoke(A.Dispatch, {
    botId: 'abby', text: 'Email Lee',
    confirmedPeople: [{ name: AARON.name, email: AARON.email, sourceSpan: { start: 6, end: 11, text: 'Aaron' } }],
  });
  expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/command changed/i) });
  expect(h.store.listRuns({})).toEqual([]);
});

it('validates the model before enabling tools and reports any tool persisted before a later post failure', async () => {
  const input = { botId: 'abby', text: 'Email Aaron', enableMissingTools: ['outlook_send_message'] };
  const noModel = setup({ defaultModel: null });
  expect(await noModel.invoke(A.Dispatch, input)).toMatchObject({ ok: false, error: expect.stringMatching(/model/i) });
  expect(noModel.runtime.settings().bots.find((bot) => bot.id === 'abby')?.tools).toEqual(['outlook_list_events']);
  noModel.unregister();
  const h = setup();
  vi.spyOn(h.store, 'addMessageWithRuns').mockImplementationOnce(() => { throw new Error('Could not save message.'); });
  expect(await h.invoke(A.Dispatch, input)).toMatchObject({
    ok: false, error: 'Could not save message. Enabled tools: outlook_send_message.',
  });
  expect(h.runtime.settings().bots.find((bot) => bot.id === 'abby')?.tools).toContain('outlook_send_message');
});

it('launches only the confirmed bot, then tracks its hand-off approval as part of that request', async () => {
  const h = setup({ modelReply: 'hand-off' });
  const dispatched = await h.invoke(A.Dispatch, { botId: 'abby', targetRoomId: 'ops', text: '@bot please create the meeting' });
  expect(dispatched).toMatchObject({ ok: true, botId: 'abby', runId: expect.any(String) });
  expect(h.store.runsForMessage(dispatched.messageId).map(({ id, botId }) => ({ id, botId }))).toEqual([
    { id: dispatched.runId, botId: 'abby' },
  ]);
  await h.runtime.idle();
  const input = { roomId: 'ops', runId: dispatched.runId, messageId: dispatched.messageId };
  const unknown = await h.invoke(A.Execution, { ...input, messageId: '11111111-1111-4111-8111-111111111111' });
  expect(unknown).toBeNull();
  h.botsHub.current.mockRejectedValueOnce(new Error('Temporary core failure.'));
  await expect(h.invoke(A.Execution, input)).rejects.toThrow('Temporary core failure.');
  const state = await h.invoke(A.Execution, input);
  expect(state.runs.map((run: { botId: string; status: string }) => [run.botId, run.status])).toEqual([
    ['abby', 'done'], ['bot', 'waiting_approval'],
  ]);
  expect(state.approvals).toMatchObject([{ runId: state.runs[1].id, status: 'pending' }]);
  expect(await h.invoke(A.DecideApproval, { approvalId: state.approvals[0].id, approved: false })).toEqual({ ok: true });
  await h.runtime.idle();
  const finished = await h.invoke(A.Execution, input);
  expect(finished.runs.map((run: { status: string }) => run.status)).toEqual(['done', 'done']);
  expect(finished.reply).toEqual({ text: 'Done!', botId: 'bot' });
});

it('never writes a voice post or tool grant into a runtime stopped during model discovery', async () => {
  let discoveryStarted!: () => void;
  let finishDiscovery!: (model: string) => void;
  const started = new Promise<void>((resolve) => { discoveryStarted = resolve; });
  const model = new Promise<string>((resolve) => { finishDiscovery = resolve; });
  const h = setup({ defaultModel: () => {
    discoveryStarted();
    return model;
  } });
  const pending = h.invoke(A.Dispatch, { botId: 'abby', text: 'Email Aaron', enableMissingTools: ['outlook_send_message'] });
  await started;
  await h.runtime.stop();
  finishDiscovery('gpt-test');
  expect(await pending).toMatchObject({ ok: false, error: expect.stringMatching(/session changed/i) });
  expect(h.runtime.settings().bots.find((bot) => bot.id === 'abby')?.tools).toEqual(['outlook_list_events']);
  expect(h.store.listMessages('dm-abby')).toEqual([]);
});

it('keeps a second same-named contact and separates serialized mentions from glued Hebrew prefixes', () => {
  const command = 'מייל לדנה כהן';
  const name = 'דנה כהן';
  const start = command.indexOf(name);
  expect(buildDispatchedAssistantText(command, { id: 'abby', name: 'Abby' }, [
    { rawName: name, name, email: 'dana@corp.example', sourceSpan: { start, end: start + name.length, text: name } },
    { rawName: name, name, email: 'other-dana@corp.example' },
  ])).toBe('@abby מייל ל @[דנה כהן](mailto:dana@corp.example) (@[דנה כהן](mailto:other-dana@corp.example))');
});

it('keeps the old address when it is added as a separate contact after changing a serialized recipient', () => {
  const name = 'Dana Cohen';
  const mention = '@[Dana Cohen](mailto:old@corp.example)';
  const command = 'Email ' + mention;
  expect(buildDispatchedAssistantText(command, { id: 'abby', name: 'Abby' }, [
    { rawName: name, name, email: 'new@corp.example', sourceSpan: { start: 6, end: command.length, text: mention } },
    { rawName: name, name, email: 'old@corp.example' },
  ])).toBe('@abby Email @[Dana Cohen](mailto:new@corp.example) (' + mention + ')');
});
