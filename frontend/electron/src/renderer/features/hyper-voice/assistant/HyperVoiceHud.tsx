import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Mail,
  Mic,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sparkles,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  HyperAssistantBotCandidate,
  HyperAssistantIntent,
  HyperAssistantPerson,
  HyperAssistantPersonSlot,
  HyperVoiceCommandPlan,
} from '@shared/HyperAssistant';
import { HYPER_BOTS_TOOLS, type HyperBotsDelivery, type HyperBotsToolName } from '@shared/HyperBots';
import { useTr } from '@/i18n';
import type { TrOptions } from '@/i18n/translator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { HyperBotAvatar, hyperBotAvatarOf } from '@/features/hyper-bots/HyperBotAvatar';
import { HyperBotsApprovalCard } from '@/features/hyper-bots/HyperBotApproval';
import { HyperBotRichText } from '@/features/hyper-bots/HyperBotMentionPopover';
import { HyperMarkdown } from '@/features/hyper-openbot/transcript/HyperMarkdown';
import { hyperParseMentions, hyperSerializeMention } from '@/features/hyper-people/hyperMentions';
import { HyperPersonAvatar } from '@/features/hyper-people/HyperPersonCard';
import { cn } from '@/lib/utils';
import type { HyperVoiceAssistantPhase, HyperVoiceExecutionState } from './useHyperVoiceAssistant';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the live Step 1 command preview from the editable command text and current confirmed
 * people slots without duplicating the selected bot handle chip.
 */
export function buildStep1CommandPreview(
  commandText: string,
  peopleSlots: readonly HyperAssistantPersonSlot[],
  selectedBot: HyperAssistantBotCandidate | null,
): { readonly previewText: string; readonly hasLeadingBotChip: boolean } {
  let body = commandText.trim();
  const handle = selectedBot?.handle?.trim() ?? '';
  let hasLeadingBotChip = false;

  // Avoid duplicating @bot if user kept/typed the handle at the start of commandText.
  if (handle && body) {
    const escapedHandle = escapeRegExp(handle);
    const leadingHandleRe = new RegExp(`^${escapedHandle}(?:[\\s,:;-]+|$)`, 'iu');
    if (leadingHandleRe.test(body)) {
      hasLeadingBotChip = true;
    }
  }

  // Substitute live selected people into text segments (skipping already-serialized @[...](mailto:...)).
  const replaceOutsideMentions = (input: string, target: string, replacement: string): { text: string; matched: boolean } => {
    const trimmed = target.trim();
    if (!trimmed) return { text: input, matched: false };
    const re = new RegExp(`@?${escapeRegExp(trimmed)}`, 'iu');
    let matched = false;
    const rebuilt = hyperParseMentions(input)
      .map((part) => {
        if (part.kind === 'mention') return input.slice(part.start, part.end);
        if (matched) return part.text;
        const hit = re.exec(part.text);
        if (!hit) return part.text;
        matched = true;
        return part.text.slice(0, hit.index) + replacement + part.text.slice(hit.index + hit[0].length);
      })
      .join('');
    return { text: rebuilt, matched };
  };

  const extraTokens: string[] = [];
  for (const slot of peopleSlots) {
    if (!slot.selected) continue;
    const token = hyperSerializeMention({ name: slot.selected.name, email: slot.selected.email });
    if (body.toLowerCase().includes(`mailto:${slot.selected.email.toLowerCase()})`)) continue;
    const candidates = [...new Set([slot.rawName, slot.query, slot.selected.name].filter(Boolean))].sort(
      (a, b) => b.length - a.length,
    );
    let replaced = false;
    for (const candidate of candidates) {
      const attempt = replaceOutsideMentions(body, candidate, token);
      if (attempt.matched) {
        body = attempt.text;
        replaced = true;
        break;
      }
    }
    if (!replaced) extraTokens.push(token);
  }

  if (extraTokens.length > 0) {
    body = body ? `${body} · ${extraTokens.join(', ')}` : extraTokens.join(', ');
  }

  return { previewText: body, hasLeadingBotChip };
}

function useT() {
  const { tr } = useTr();
  return (key: string, fallback: string, options?: TrOptions) => {
    const resolved = tr(key, options);
    return resolved === key ? fallback : resolved;
  };
}

function intentBadge(intent: HyperAssistantIntent, t: ReturnType<typeof useT>) {
  switch (intent) {
    case 'meeting':
      return {
        icon: <Calendar className="size-3.5" aria-hidden="true" />,
        label: t('hyperVoiceAssistant.intent.meeting', 'Meeting'),
      };
    case 'email':
      return {
        icon: <Mail className="size-3.5" aria-hidden="true" />,
        label: t('hyperVoiceAssistant.intent.email', 'Email'),
      };
    default:
      return {
        icon: <Sparkles className="size-3.5" aria-hidden="true" />,
        label: t('hyperVoiceAssistant.intent.general', 'Command'),
      };
  }
}

function slotStatusBadge(status: HyperAssistantPersonSlot['status'], t: ReturnType<typeof useT>) {
  switch (status) {
    case 'exact':
      return {
        label: t('hyperVoiceAssistant.personStatus.exact', 'Matched'),
        className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      };
    case 'fuzzy':
      return {
        label: t('hyperVoiceAssistant.personStatus.fuzzy', 'Closest match'),
        className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
      };
    case 'ambiguous':
      return {
        label: t('hyperVoiceAssistant.personStatus.ambiguous', 'Pick person'),
        className: 'bg-amber-500/20 text-amber-800 dark:text-amber-200',
      };
    case 'unresolved':
      return {
        label: t('hyperVoiceAssistant.personStatus.unresolved', 'Not found'),
        className: 'bg-destructive/15 text-destructive',
      };
  }
}

function PeopleSearchInline({
  initialQuery,
  placeholder,
  searchPeople,
  onPick,
  onClose,
}: {
  readonly initialQuery: string;
  readonly placeholder: string;
  readonly searchPeople: (query: string) => Promise<HyperAssistantPerson[]>;
  readonly onPick: (person: HyperAssistantPerson) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<HyperAssistantPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void searchPeople(trimmed)
        .then((list) => {
          if (!alive) return;
          setResults(list);
          setLoading(false);
        })
        .catch(() => {
          if (!alive) return;
          setError(t('hyperVoiceAssistant.searchUnavailable', 'Directory search is unavailable.'));
          setLoading(false);
        });
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, searchPeople]);

  return (
    <div className="mt-1 space-y-1.5 rounded-lg border border-border bg-background/80 p-2">
      <div className="flex items-center gap-1.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          dir="auto"
          className="h-7 text-xs [unicode-bidi:plaintext] text-start"
          autoFocus
        />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close search" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="max-h-36 space-y-1 overflow-y-auto" role="listbox">
        {loading ? (
          <p className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" />
            {t('hyperVoiceAssistant.searchingDirectory', 'Searching Outlook directory…')}
          </p>
        ) : error ? (
          <p className="px-1 py-1 text-xs text-destructive">{error}</p>
        ) : results.length > 0 ? (
          results.map((person) => (
            <button
              key={person.email}
              type="button"
              role="option"
              onClick={() => onPick(person)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs hover:bg-accent"
            >
              <HyperPersonAvatar person={person} className="size-6 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-medium text-foreground">
                  {person.name}
                </p>
                <p dir="auto" className="truncate text-[11px] text-muted-foreground">
                  {[person.title, person.department, person.email].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {person.source === 'ad' ? 'AD' : 'Outlook'}
              </span>
            </button>
          ))
        ) : query.trim().length >= 2 ? (
          <p className="px-1 py-1 text-xs text-muted-foreground">
            {t('hyperVoiceAssistant.noPeopleFound', 'No matching people found.')}
          </p>
        ) : (
          <p className="px-1 py-1 text-xs text-muted-foreground">
            {t('hyperVoiceAssistant.typeToSearchPeople', 'Type at least 2 characters (English or Hebrew).')}
          </p>
        )}
      </div>
    </div>
  );
}

function PersonConfirmationSlot({
  slot,
  searchPeople,
  onSelectCandidate,
  onRemove,
}: {
  readonly slot: HyperAssistantPersonSlot;
  readonly searchPeople: (query: string) => Promise<HyperAssistantPerson[]>;
  readonly onSelectCandidate: (slotId: string, person: HyperAssistantPerson) => void;
  readonly onRemove: (slotId: string) => void;
}) {
  const t = useT();
  const [searching, setSearching] = useState(slot.status === 'unresolved');
  const badge = slotStatusBadge(slot.status, t);

  return (
    <div className="hva-person-card" data-status={slot.status} data-testid={`person-slot-${slot.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <UserCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span dir="auto" className="truncate text-xs font-medium text-muted-foreground">
            “{slot.rawName}”
          </span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', badge.className)}>
            {badge.label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
            onClick={() => setSearching((v) => !v)}
          >
            {searching
              ? t('hyperVoiceAssistant.closeSearch', 'Close')
              : t('hyperVoiceAssistant.changeOrSearch', 'Change / Search')}
          </button>
          <button
            type="button"
            aria-label={t('hyperVoiceAssistant.removePerson', 'Remove person')}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onRemove(slot.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {slot.selected ? (
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
          <HyperPersonAvatar person={slot.selected} className="size-7 text-[11px]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p dir="auto" className="truncate text-xs font-semibold text-foreground">
                {slot.selected.name}
              </p>
              <span className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {slot.selected.source === 'ad' ? 'AD' : 'Outlook'}
              </span>
            </div>
            {(slot.selected.title || slot.selected.department) && (
              <p dir="auto" className="truncate text-[11px] text-muted-foreground">
                {[slot.selected.title, slot.selected.department].filter(Boolean).join(' · ')}
              </p>
            )}
            <p dir="auto" className="truncate text-[11px] text-muted-foreground">
              {slot.selected.email}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-destructive">
          {slot.error ||
            t(
              'hyperVoiceAssistant.personUnresolvedHint',
              'Could not match this person automatically. Search Outlook below or remove.',
            )}
        </p>
      )}

      {slot.candidates.length > 1 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t('hyperVoiceAssistant.possibleMatches', 'Possible matches:')}
          </p>
          <div className="flex flex-col gap-1">
            {slot.candidates.slice(0, 5).map((candidate) => {
              const isSelected =
                slot.selected?.email.toLowerCase() === candidate.email.toLowerCase();
              return (
                <button
                  key={candidate.email}
                  type="button"
                  onClick={() => onSelectCandidate(slot.id, candidate)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2 py-1 text-start text-xs transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/70 bg-background/50 hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}
                  >
                    {isSelected && <Check className="size-2.5" />}
                  </span>
                  <span dir="auto" className="truncate font-medium">
                    {candidate.name}
                  </span>
                  <span dir="auto" className="truncate text-[11px] text-muted-foreground">
                    {candidate.title ? `${candidate.title} · ` : ''}
                    {candidate.email}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {searching && (
        <PeopleSearchInline
          initialQuery={slot.query || slot.rawName}
          placeholder={t('hyperVoiceAssistant.searchPeoplePlaceholder', 'Search by name or email…')}
          searchPeople={searchPeople}
          onPick={(person) => {
            onSelectCandidate(slot.id, person);
            setSearching(false);
          }}
          onClose={() => setSearching(false)}
        />
      )}
    </div>
  );
}

export interface HyperVoiceHudProps {
  readonly phase: HyperVoiceAssistantPhase;
  readonly errorMessage: string | null;
  readonly missingLocalModel: boolean;
  readonly downloadingModel: boolean;
  readonly downloadProgress: number | null;
  readonly plan: HyperVoiceCommandPlan | null;
  readonly commandText: string;
  readonly onCommandTextChange: (text: string) => void;
  readonly selectedBot: HyperAssistantBotCandidate | null;
  readonly onSelectBot: (botId: string) => void;
  readonly peopleSlots: readonly HyperAssistantPersonSlot[];
  readonly unresolvedCount: number;
  readonly missingTools: readonly HyperBotsToolName[];
  readonly enableMissingTools: boolean;
  readonly onEnableMissingToolsChange: (enabled: boolean) => void;
  readonly onSelectCandidate: (slotId: string, person: HyperAssistantPerson) => void;
  readonly onRemovePerson: (slotId: string) => void;
  readonly onAddPerson: (person: HyperAssistantPerson) => void;
  readonly onSearchPeople: (query: string) => Promise<HyperAssistantPerson[]>;
  readonly execution: HyperVoiceExecutionState | null;
  readonly decidingIds: readonly string[];
  readonly onParseTypedCommand: (text: string) => void;
  readonly onConfirmDispatch: () => void;
  readonly onDecideApproval: (approvalId: string, approved: boolean, delivery?: HyperBotsDelivery) => void;
  readonly onReRecord: () => void;
  readonly onCancel: () => void;
  readonly onEnableLocalMultilingual: () => void;
  readonly onOpenVoiceSettings: () => void;
  readonly onOpenInHyperBot: () => void;
}

/**
 * Glass HUD card beneath the HyperVoiceSphere:
 * - Voice first-run setup (with typed fallback & 1-click Whisper Large v3 Turbo setup)
 * - Step 1: Bot & People Confirmation Card (EN + HE bidi, candidate disambiguation, Outlook live search, missing-tools toggle)
 * - Step 2: Live Bot Execution & Inline Outlook Write Approval (`HyperBotsApprovalCard`)
 */
export function HyperVoiceHud(props: HyperVoiceHudProps) {
  const t = useT();
  const [addingPerson, setAddingPerson] = useState(false);
  const [typedDraft, setTypedDraft] = useState('');

  if (props.phase === 'needs-setup') {
    return (
      <section className="hva-hud" aria-label={t('hyperVoiceAssistant.setupTitle', 'Set up voice input')}>
        <header className="hva-hud__header">
          <div className="flex items-center gap-2">
            <Mic className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">
              {props.missingLocalModel
                ? t('hyperVoiceAssistant.downloadModelTitle', 'Download speech model')
                : t('hyperVoiceAssistant.setupTitle', 'Enable Hyper-Bot Voice')}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={props.onCancel} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        <div className="hva-hud__body">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              'hyperVoiceAssistant.setupDescription',
              'Choose local Whisper (English & Hebrew, runs offline on this PC) or configure Cloud STT in Settings → Voice.',
            )}
          </p>
          {props.errorMessage && (
            <p role="alert" className="rounded-md bg-destructive/12 px-2.5 py-1.5 text-xs text-destructive">
              {props.errorMessage}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              disabled={props.downloadingModel}
              onClick={props.onEnableLocalMultilingual}
            >
              {props.downloadingModel ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  {props.downloadProgress !== null
                    ? t('hyperVoiceAssistant.downloadingProgress', 'Downloading Whisper ({percent}%)…', {
                        namedArgs: { percent: props.downloadProgress },
                      })
                    : t('hyperVoiceAssistant.downloadingModel', 'Preparing Whisper (EN + HE)…')}
                </>
              ) : (
                t('hyperVoiceAssistant.enableLocalWhisper', 'Enable local Whisper (English + Hebrew)')
              )}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={props.onOpenVoiceSettings}>
              <Settings className="size-3.5" />
              {t('hyperVoiceAssistant.openVoiceSettings', 'Open Voice Settings')}
            </Button>
          </div>
          <form
            className="mt-1 flex items-center gap-1.5 border-t border-border/60 pt-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (typedDraft.trim()) props.onParseTypedCommand(typedDraft.trim());
            }}
          >
            <Input
              value={typedDraft}
              onChange={(e) => setTypedDraft(e.target.value)}
              dir="auto"
              placeholder={t(
                'hyperVoiceAssistant.typeFallbackPlaceholder',
                'Or type a command (e.g. Tell Abby to set meeting…)',
              )}
              className="h-8 text-xs [unicode-bidi:plaintext] text-start"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!typedDraft.trim()}>
              <Send className="size-3.5" />
            </Button>
          </form>
        </div>
      </section>
    );
  }

  if (props.phase === 'confirming' && props.plan) {
    const { plan, selectedBot, peopleSlots, missingTools } = props;
    const intent = intentBadge(plan.intent, t);
    const botAvatar = selectedBot ? hyperBotAvatarOf(selectedBot) : null;
    const canDispatch = Boolean(selectedBot && plan.signedIn && props.unresolvedCount === 0 && props.commandText.trim());
    const livePreview = buildStep1CommandPreview(props.commandText, peopleSlots, selectedBot);

    return (
      <section
        className="hva-hud"
        data-testid="hyper-voice-confirm-hud"
        aria-label={t('hyperVoiceAssistant.confirmTitle', 'Confirm voice command')}
      >
        <header className="hva-hud__header">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
              {intent.icon}
              {intent.label}
            </span>
            <h2 className="truncate text-xs font-semibold text-foreground">
              {t('hyperVoiceAssistant.step1Title', 'Confirm bot & people')}
            </h2>
          </div>
          {plan.availableBots.length > 0 && (
            <div className="flex items-center gap-1.5">
              {botAvatar && (
                <HyperBotAvatar shape={botAvatar.shape} color={botAvatar.color} size={20} />
              )}
              <select
                aria-label={t('hyperVoiceAssistant.targetBot', 'Target bot')}
                value={selectedBot?.id ?? ''}
                onChange={(e) => props.onSelectBot(e.target.value)}
                dir="auto"
                className="h-7 max-w-[155px] rounded-md border border-border bg-background/80 px-2 text-xs font-medium text-foreground outline-none focus:border-primary"
              >
                {plan.availableBots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.handle} ({bot.name})
                  </option>
                ))}
              </select>
            </div>
          )}
        </header>

        <div className="hva-hud__body">
          {!plan.signedIn && (
            <p role="alert" className="flex items-center gap-1.5 rounded-md bg-destructive/12 px-2.5 py-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />
              {t('hyperVoiceAssistant.signInRequired', 'Sign in to HyperTask to send commands to Hyper-Bot.')}
            </p>
          )}

          {plan.warnings.map((warning, i) => (
            <p key={i} className="flex items-start gap-1.5 rounded-md bg-amber-500/12 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span dir="auto">{warning}</span>
            </p>
          ))}

          <div>
            <div className="hva-section-label">
              {t('hyperVoiceAssistant.recognizedCommand', 'Command')}
            </div>
            <div
              dir="auto"
              data-testid="hyper-voice-step1-preview"
              className="mb-1.5 rounded-lg bg-muted/45 px-2.5 py-1.5 text-xs leading-relaxed text-foreground [unicode-bidi:plaintext] text-start"
            >
              {selectedBot && !livePreview.hasLeadingBotChip && (
                <span dir="auto" className="hva-chip-bot me-1.5">
                  {selectedBot.handle}
                </span>
              )}
              <HyperBotRichText
                text={livePreview.previewText}
                bots={plan.availableBots}
                botChipClass="hva-chip-bot"
                personChipClass="hva-chip-person"
              />
            </div>
            <Textarea
              aria-label={t('hyperVoiceAssistant.editCommand', 'Edit recognized command')}
              value={props.commandText}
              onChange={(e) => props.onCommandTextChange(e.target.value)}
              rows={2}
              dir="auto"
              className="min-h-[54px] resize-none text-xs [unicode-bidi:plaintext] text-start"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="hva-section-label">
                {t('hyperVoiceAssistant.matchedPeople', 'Matched people ({count})', {
                  namedArgs: { count: peopleSlots.length },
                })}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                onClick={() => setAddingPerson((v) => !v)}
              >
                <UserPlus className="size-3" />
                {t('hyperVoiceAssistant.addPerson', 'Add person')}
              </button>
            </div>

            {peopleSlots.length > 0 ? (
              <div className="space-y-2">
                {peopleSlots.map((slot) => (
                  <PersonConfirmationSlot
                    key={slot.id}
                    slot={slot}
                    searchPeople={props.onSearchPeople}
                    onSelectCandidate={props.onSelectCandidate}
                    onRemove={props.onRemovePerson}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border/80 px-2.5 py-2 text-xs text-muted-foreground">
                {t(
                  'hyperVoiceAssistant.noPeopleDetected',
                  'No specific co-workers detected. You can add someone from Outlook or continue.',
                )}
              </p>
            )}

            {addingPerson && (
              <PeopleSearchInline
                initialQuery=""
                placeholder={t('hyperVoiceAssistant.searchPeoplePlaceholder', 'Search by name or email…')}
                searchPeople={props.onSearchPeople}
                onPick={(person) => {
                  props.onAddPerson(person);
                  setAddingPerson(false);
                }}
                onClose={() => setAddingPerson(false)}
              />
            )}
          </div>

          {missingTools.length > 0 && selectedBot && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={props.enableMissingTools}
                onChange={(e) => props.onEnableMissingToolsChange(e.target.checked)}
              />
              <span className="leading-snug text-foreground">
                {t(
                  'hyperVoiceAssistant.enableMissingTools',
                  'Enable Outlook tool(s) ({tools}) for {bot} and run. Every email or invite still asks for your approval.',
                  {
                    namedArgs: {
                      bot: selectedBot.handle,
                      tools: missingTools
                        .map((tool) => HYPER_BOTS_TOOLS[tool]?.label ?? tool)
                        .join(', '),
                    },
                  },
                )}
              </span>
            </label>
          )}
        </div>

        <footer className="hva-hud__footer">
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
              {t('hyperVoiceAssistant.cancel', 'Cancel')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={props.onReRecord}>
              <RotateCcw className="size-3.5" />
              {t('hyperVoiceAssistant.rerecord', 'Re-record')}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!canDispatch}
            onClick={props.onConfirmDispatch}
            data-testid="hyper-voice-confirm-send"
          >
            <Send className="size-3.5" />
            {selectedBot
              ? t('hyperVoiceAssistant.confirmAndSendTo', 'Confirm & Send to {bot}', {
                  namedArgs: { bot: selectedBot.handle },
                })
              : t('hyperVoiceAssistant.confirmAndSend', 'Confirm & Send')}
          </Button>
        </footer>
      </section>
    );
  }

  if ((props.phase === 'executing' || props.phase === 'done') && props.execution) {
    const { execution } = props;
    const isDone = props.phase === 'done';
    const waitingApproval = execution.pendingApprovals.length > 0;

    return (
      <section
        className="hva-hud"
        data-hyper-bot
        data-testid="hyper-voice-execution-hud"
        aria-label={t('hyperVoiceAssistant.executionTitle', 'Hyper-Bot progress')}
      >
        <header className="hva-hud__header">
          <div className="flex min-w-0 items-center gap-2">
            {isDone ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            )}
            <span dir="auto" className="truncate text-xs font-semibold text-foreground">
              {waitingApproval
                ? t('hyperVoiceAssistant.waitingApproval', '{bot} needs your approval before sending', {
                    namedArgs: { bot: execution.botName },
                  })
                : isDone
                  ? t('hyperVoiceAssistant.completedBy', '{bot} finished', {
                      namedArgs: { bot: execution.botName },
                    })
                  : t('hyperVoiceAssistant.working', '{bot} is working…', {
                      namedArgs: { bot: execution.botName },
                    })}
            </span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={props.onOpenInHyperBot}>
            <ExternalLink className="size-3.5" />
            {t('hyperVoiceAssistant.openInHyperBot', 'Open in Hyper-Bot')}
          </Button>
        </header>

        <div className="hva-hud__body">
          {props.errorMessage && (
            <p role="alert" className="rounded-md bg-destructive/12 px-2.5 py-1.5 text-xs text-destructive">
              {props.errorMessage}
            </p>
          )}

          {execution.pendingApprovals.map((approval) => (
            <HyperBotsApprovalCard
              key={approval.id}
              approval={approval}
              botName={
                execution.botSettings?.bots.find((b) => b.id === approval.botId)?.name ??
                execution.botName
              }
              busy={props.decidingIds.includes(approval.id)}
              onDecide={props.onDecideApproval}
            />
          ))}

          {execution.decidedApprovals.length > 0 && (
            <div className="space-y-1">
              {execution.decidedApprovals.map((approval) => (
                <div
                  key={approval.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/35 px-2.5 py-1.5 text-xs"
                >
                  <span dir="auto" className="truncate font-medium">
                    {HYPER_BOTS_TOOLS[approval.tool as HyperBotsToolName]?.label ?? approval.tool}
                  </span>
                  <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                    {approval.status === 'done' && approval.delivery
                      ? approval.delivery === 'draft'
                        ? t('hyperVoiceAssistant.savedToDrafts', 'Saved to Drafts')
                        : t('hyperVoiceAssistant.sent', 'Sent')
                      : approval.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {execution.replyText ? (
            <div className="rounded-xl border border-border/70 bg-card/90 p-3 text-xs">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Bot className="size-3.5" aria-hidden="true" />
                <span dir="auto">{execution.botName}</span>
              </div>
              <HyperMarkdown
                content={execution.replyText}
                className="[&_li]:[unicode-bidi:plaintext] [&_p]:[unicode-bidi:plaintext] [&_li]:text-start [&_p]:text-start"
              />
            </div>
          ) : !waitingApproval ? (
            <p dir="auto" className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground [unicode-bidi:plaintext] text-start">
              {t('hyperVoiceAssistant.preparingAction', 'Preparing Outlook action and checking details…')}
            </p>
          ) : null}
        </div>

        <footer className="hva-hud__footer">
          <Button type="button" variant="outline" size="sm" onClick={props.onReRecord}>
            <Plus className="size-3.5" />
            {t('hyperVoiceAssistant.newCommand', 'New command')}
          </Button>
          <Button type="button" variant={isDone ? 'default' : 'ghost'} size="sm" onClick={props.onCancel}>
            {isDone ? t('hyperVoiceAssistant.done', 'Done') : t('hyperVoiceAssistant.hide', 'Hide')}
          </Button>
        </footer>
      </section>
    );
  }

  if (props.phase === 'error') {
    return (
      <section className="hva-hud" role="alert" aria-label={t('hyperVoiceAssistant.errorTitle', 'Voice assistant error')}>
        <header className="hva-hud__header">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <h2 className="text-xs font-semibold">
              {t('hyperVoiceAssistant.errorTitle', 'Something went wrong')}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={props.onCancel} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        <div className="hva-hud__body">
          <p dir="auto" className="text-xs leading-relaxed text-foreground [unicode-bidi:plaintext] text-start">
            {props.errorMessage || t('hyperVoiceAssistant.genericError', 'Could not complete the voice command.')}
          </p>
        </div>
        <footer className="hva-hud__footer">
          <Button type="button" variant="outline" size="sm" onClick={props.onOpenVoiceSettings}>
            <Settings className="size-3.5" />
            {t('hyperVoiceAssistant.openVoiceSettings', 'Voice Settings')}
          </Button>
          <div className="flex items-center gap-1.5">
            {props.execution && (
              <Button type="button" variant="ghost" size="sm" onClick={props.onOpenInHyperBot}>
                {t('hyperVoiceAssistant.openInHyperBot', 'Open in Hyper-Bot')}
              </Button>
            )}
            <Button type="button" size="sm" onClick={props.onReRecord}>
              <RotateCcw className="size-3.5" />
              {t('hyperVoiceAssistant.tryAgain', 'Try again')}
            </Button>
          </div>
        </footer>
      </section>
    );
  }

  return null;
}
