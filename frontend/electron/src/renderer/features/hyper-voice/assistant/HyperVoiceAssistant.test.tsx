import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HyperVoiceCommandPlan } from '@shared/HyperAssistant';
import type { HyperBotsApproval } from '@shared/HyperBots';
import { HyperVoiceSphere } from './HyperVoiceSphere';
import { buildStep1CommandPreview, HyperVoiceHud, type HyperVoiceHudProps } from './HyperVoiceHud';

const noop = vi.fn();

const baseHudProps = (patch: Partial<HyperVoiceHudProps> = {}): HyperVoiceHudProps => ({
  phase: 'idle',
  errorMessage: null,
  missingLocalModel: false,
  downloadingModel: false,
  downloadProgress: null,
  plan: null,
  commandText: '',
  commandChanged: false,
  onCommandTextChange: noop,
  selectedBot: null,
  onSelectBot: noop,
  peopleSlots: [],
  unresolvedCount: 0,
  missingTools: [],
  enableMissingTools: true,
  onEnableMissingToolsChange: noop,
  onSelectCandidate: noop,
  onRemovePerson: noop,
  onAddPerson: noop,
  onSearchPeople: async () => [],
  execution: null,
  decidingIds: [],
  onParseTypedCommand: noop,
  onConfirmDispatch: noop,
  onDecideApproval: noop,
  onReRecord: noop,
  onCancel: noop,
  onEnableLocalMultilingual: noop,
  onOpenVoiceSettings: noop,
  onOpenInHyperBot: noop,
  ...patch,
});

describe('HyperVoiceSphere & HyperVoiceHud', () => {
  it('renders the audio-reactive sphere button and canvas with phase metadata', () => {
    const html = renderToStaticMarkup(
      <HyperVoiceSphere phase="listening" size={156} ariaLabel="Stop listening" />,
    );
    expect(html).toContain('data-testid="hyper-voice-sphere"');
    expect(html).toContain('data-phase="listening"');
    expect(html).toContain('<canvas');
    expect(html).toContain('aria-label="Stop listening"');
  });

  it('renders Step 1 Bot & People Confirmation card for English commands with candidate disambiguation & missing tools', () => {
    const aaron1 = {
      name: 'Aaron Mitchel',
      email: 'aaron.mitchel@company.com',
      title: 'Staff Engineer',
      department: 'Platform',
      phone: '',
      office: '',
      company: 'HyperTask',
      source: 'ad' as const,
    };
    const aaron2 = {
      ...aaron1,
      email: 'aaron.mitchel.ext@company.com',
      title: 'Product Manager',
      source: 'outlook' as const,
    };
    const abby = {
      id: 'abby',
      name: 'Abby',
      handle: '@abby',
      roomId: 'dm-abby',
      mode: 'personal' as const,
      tools: ['outlook_list_events' as const],
    };
    const plan: HyperVoiceCommandPlan = {
      rawText: 'Tell Abby to set meeting with Aaron Mitchel tomorrow at six PM',
      cleanedCommand: 'set meeting with Aaron Mitchel tomorrow at six PM',
      normalizedText: '@abby set meeting with @Aaron Mitchel tomorrow at six PM',
      canonicalText: '@abby set meeting with @[Aaron Mitchel](mailto:aaron.mitchel@company.com) tomorrow at six PM',
      language: 'en',
      intent: 'meeting',
      resolvedBot: abby,
      targetRoomId: 'dm-abby',
      availableBots: [abby],
      people: [
        {
          id: 'slot-1',
          rawName: 'Aaron Mitchel',
          query: 'Aaron Mitchel',
          role: 'attendee',
          status: 'ambiguous',
          selected: aaron1,
          candidates: [aaron1, aaron2],
        },
      ],
      missingTools: ['outlook_create_event'],
      requiresConfirmation: true,
      warnings: [],
      signedIn: true,
    };

    const html = renderToStaticMarkup(
      <HyperVoiceHud
        {...baseHudProps({
          phase: 'confirming',
          plan,
          commandText: plan.cleanedCommand,
          selectedBot: abby,
          peopleSlots: plan.people,
          missingTools: ['outlook_create_event'],
        })}
      />,
    );

    expect(html).toContain('data-testid="hyper-voice-confirm-hud"');
    expect(html).toContain('@abby');
    expect(html).toContain('Aaron Mitchel');
    expect(html).toContain('aaron.mitchel@company.com');
    expect(html).toContain('Staff Engineer · Platform');
    expect(html).toContain('aaron.mitchel.ext@company.com');
    expect(html).toContain('Create events and meetings');
    expect(html).toContain('Confirm &amp; Send to @abby');

    // Regression: Step 1 preview renders @abby ONCE (no duplicate "@abby @abby") and reflects live edits/swaps.
    const previewMatch = /data-testid="hyper-voice-step1-preview"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    expect(previewMatch?.[1]).toBeDefined();
    expect((previewMatch![1]!.match(/@abby/g) ?? []).length).toBe(1);
    expect(previewMatch![1]).toContain('@Aaron Mitchel');

    // Switching bot, editing commandText, or swapping selected person updates live preview immediately.
    const moshe = {
      id: 'bot',
      name: 'משה',
      handle: '@משה',
      roomId: 'dm-bot',
      mode: 'personal' as const,
      tools: ['outlook_create_event' as const],
    };
    const updatedHtml = renderToStaticMarkup(
      <HyperVoiceHud
        {...baseHudProps({
          phase: 'confirming',
          plan: { ...plan, availableBots: [abby, moshe] },
          commandText: 'set coffee chat with Aaron Mitchel at 5 PM',
          selectedBot: moshe,
          peopleSlots: [{ ...plan.people[0]!, selected: aaron2 }],
          missingTools: [],
        })}
      />,
    );
    const updatedPreview = /data-testid="hyper-voice-step1-preview"[^>]*>([\s\S]*?)<\/div>/.exec(updatedHtml)?.[1] ?? '';
    expect((updatedPreview.match(/@משה/g) ?? []).length).toBe(1);
    expect(updatedPreview).not.toContain('@abby');
    expect(updatedPreview).toContain('set coffee chat with');
    expect(updatedPreview).toContain('@Aaron Mitchel');

    // Pure helper regression: if user keeps leading "@abby" in commandText, hasLeadingBotChip prevents double chip.
    const leading = buildStep1CommandPreview('@abby set meeting with Aaron Mitchel', plan.people, abby);
    expect(leading.hasLeadingBotChip).toBe(true);
    expect(leading.previewText).toContain('@[Aaron Mitchel](mailto:aaron.mitchel@company.com)');
  });

  it('renders Step 1 confirmation with Hebrew bot handle, Hebrew employee, and RTL bidi attributes', () => {
    const israel = {
      name: 'ישראל ישראלי',
      email: 'israel@company.co.il',
      title: 'מנהל מוצר',
      department: 'פיתוח',
      phone: '',
      office: '',
      company: '',
      source: 'ad' as const,
    };
    const moshe = {
      id: 'bot',
      name: 'משה',
      handle: '@משה',
      roomId: 'dm-bot',
      mode: 'personal' as const,
      tools: ['outlook_create_event' as const, 'outlook_send_message' as const],
    };
    const plan: HyperVoiceCommandPlan = {
      rawText: 'תגיד למשה לקבוע פגישה עם ישראל ישראלי מחר בשש בערב',
      cleanedCommand: 'לקבוע פגישה עם ישראל ישראלי מחר בשש בערב',
      normalizedText: '@משה לקבוע פגישה עם @ישראל ישראלי מחר בשש בערב',
      canonicalText: '@משה לקבוע פגישה עם @[ישראל ישראלי](mailto:israel@company.co.il) מחר בשש בערב',
      language: 'he',
      intent: 'meeting',
      resolvedBot: moshe,
      targetRoomId: 'dm-bot',
      availableBots: [moshe],
      people: [
        {
          id: 'slot-he',
          rawName: 'ישראל ישראלי',
          query: 'ישראל ישראלי',
          role: 'attendee',
          status: 'exact',
          selected: israel,
          candidates: [israel],
        },
      ],
      missingTools: [],
      requiresConfirmation: true,
      warnings: [],
      signedIn: true,
    };

    const html = renderToStaticMarkup(
      <HyperVoiceHud
        {...baseHudProps({
          phase: 'confirming',
          plan,
          commandText: plan.cleanedCommand,
          selectedBot: moshe,
          peopleSlots: plan.people,
        })}
      />,
    );

    expect(html).toContain('@משה');
    expect(html).toContain('ישראל ישראלי');
    expect(html).toContain('israel@company.co.il');
    expect(html).toContain('dir="auto"');
    expect(html).toContain('[unicode-bidi:plaintext]');
  });

  it('renders Step 2 inline Outlook Write Approval card inside the floating overlay', () => {
    const approval: HyperBotsApproval = {
      id: '00000000-0000-4000-8000-000000000099',
      runId: '00000000-0000-4000-8000-000000000050',
      roomId: 'dm-abby',
      botId: 'abby',
      toolCallId: 'call_1',
      tool: 'outlook_send_message',
      access: 'write',
      args: { to: ['aaron.mitchel@company.com'], subject: 'Quick sync', body: 'Hi Aaron!' },
      summary: 'Send email "Quick sync" to Aaron Mitchel',
      destination: 'Outlook mail on this PC',
      card: [
        { label: 'To', value: 'Aaron Mitchel <aaron.mitchel@company.com>' },
        { label: 'Subject', value: 'Quick sync' },
      ],
      delivery: null,
      status: 'pending',
      decidedBy: null,
      result: null,
      error: null,
      createdAt: '2026-11-23T06:00:00.000Z',
      updatedAt: '2026-11-23T06:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <HyperVoiceHud
        {...baseHudProps({
          phase: 'executing',
          execution: {
            roomId: 'dm-abby',
            runId: approval.runId,
            messageId: 'msg-1',
            botId: 'abby',
            botName: 'Abby',
            dispatchedText: '@abby send email to @[Aaron Mitchel](mailto:aaron.mitchel@company.com)',
            runStatus: 'waiting_approval',
            pendingApprovals: [approval],
            decidedApprovals: [],
            botSettings: null,
            reply: null,
            error: null,
          },
        })}
      />,
    );

    expect(html).toContain('data-testid="hyper-voice-execution-hud"');
    expect(html).toContain('Aaron Mitchel &lt;aaron.mitchel@company.com&gt;');
    expect(html).toContain('Save to Drafts');
    expect(html).toContain('>Send</button>');
    expect(html).toContain('>Deny</button>');
    expect(html).toContain('Open in Hyper-Bot');
  });

  it('renders first-run setup card with local Whisper EN+HE and typed command fallback', () => {
    const html = renderToStaticMarkup(<HyperVoiceHud {...baseHudProps({ phase: 'needs-setup' })} />);
    expect(html).toContain('Enable local Whisper (English + Hebrew)');
    expect(html).toContain('Open Voice Settings');
    expect(html).toContain('Or type a command');
  });
});
