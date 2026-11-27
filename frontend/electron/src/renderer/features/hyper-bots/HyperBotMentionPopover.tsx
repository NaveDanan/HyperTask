import { Fragment, useMemo, type ReactNode } from 'react';
import { Sparkles, Terminal } from 'lucide-react';
import type { HyperPerson } from '@shared/api';
import type { HyperBotConfig } from '@shared/HyperBots';
import {
  extractExplicitBotMentions,
  filterBotsByQuery,
  hyperBotDisplayHandle,
  type HyperBotLike,
} from '@shared/HyperBotResolver';
import { hyperParseMentions, hyperSerializeMention } from '@/features/hyper-people/hyperMentions';
import { HyperPersonAvatar, HyperPersonCard } from '@/features/hyper-people/HyperPersonCard';
import { cn } from '@/lib/utils';
import { HyperBotAvatar, hyperBotAvatarOf } from './HyperBotAvatar';

export type HyperBotMentionBot = HyperBotLike & Pick<Partial<HyperBotConfig>, 'avatar'>;

export interface HyperBotMentionQueryRange {
  readonly query: string;
  readonly start: number;
  readonly end: number;
}

export type HyperBotMentionOption =
  | { readonly kind: 'bot'; readonly bot: HyperBotMentionBot; readonly handle: string }
  | { readonly kind: 'person'; readonly person: HyperPerson };

export type HyperBotPromptOption = HyperBotMentionOption
  | { kind: 'skill' | 'command'; token: string; label: string; description: string };

/**
 * Detects an active `@...` token immediately before the caret in the Hyper-Bot composer.
 * Triggers on 0+ characters so typing `@` immediately suggests bots (English & Hebrew),
 * while `@` followed by 2+ characters also queries Outlook/AD employees.
 */
export function hyperBotComposerMentionQuery(
  value: string,
  caret: number,
): HyperBotMentionQueryRange | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const before = value.slice(0, safeCaret);
  // Skip if caret is right after a completed employee token `@[Name](mailto:...)`
  const match = /(?:^|[\s([{,;:׳״"'])@([^@\n\r[\]()]{0,128})$/u.exec(before);
  if (!match) return null;
  const rawQuery = match[1] ?? '';
  // Avoid triggering across multiple trailing spaces once user moved on
  if (/^\s/.test(rawQuery) || /\s{2,}/.test(rawQuery)) return null;
  return {
    query: rawQuery.trim(),
    start: before.length - rawQuery.length - 1,
    end: safeCaret,
  };
}

/**
 * Inserts a chosen bot (`@handle `) or employee (`@[Display Name](mailto:email) `)
 * replacing the active `@query` span.
 */
export function insertHyperBotMention(
  value: string,
  range: HyperBotMentionQueryRange,
  option: HyperBotMentionOption,
): { readonly nextValue: string; readonly nextCaret: number } {
  const token =
    option.kind === 'bot'
      ? option.handle + ' '
      : hyperSerializeMention({ name: option.person.name, email: option.person.email }) + ' ';
  const nextValue = value.slice(0, range.start) + token + value.slice(range.end);
  return { nextValue, nextCaret: range.start + token.length };
}

/** Builds the unified flat list of keyboard-selectable mention options (Bots first, then People). */
export function buildHyperBotMentionOptions(
  query: string,
  bots: readonly HyperBotMentionBot[],
  people: readonly HyperPerson[],
): HyperBotMentionOption[] {
  const botMatches = filterBotsByQuery(query, bots).map(({ bot, handle }) => ({
    kind: 'bot' as const,
    bot,
    handle,
  }));
  const personMatches = people.map((person) => ({
    kind: 'person' as const,
    person,
  }));
  return [...botMatches, ...personMatches];
}

export interface HyperBotMentionPopoverProps {
  readonly id: string;
  readonly query: string;
  readonly options: readonly HyperBotPromptOption[];
  readonly kind?: 'path' | 'skill' | 'slash-command';
  readonly peopleLoading: boolean;
  readonly peopleError: string | null;
  readonly activeIndex: number;
  readonly onActiveChange: (index: number) => void;
  readonly onSelect: (option: HyperBotPromptOption) => void;
}

/**
 * Unified `@` mention autocomplete popover for Hyper-Bot Composer.
 * Searches both configured Bots (EN & HE via HyperBotResolver) and Outlook/AD employees.
 */
export function HyperBotMentionPopover({
  id,
  query,
  options,
  kind = 'path',
  peopleLoading,
  peopleError,
  activeIndex,
  onActiveChange,
  onSelect,
}: HyperBotMentionPopoverProps) {
  const botOptions = options.filter((o): o is Extract<HyperBotMentionOption, { kind: 'bot' }> => o.kind === 'bot');
  const personOptions = options.filter(
    (o): o is Extract<HyperBotMentionOption, { kind: 'person' }> => o.kind === 'person',
  );
  const showPeopleSection = query.trim().length >= 2 || personOptions.length > 0;
  const pathMenu = kind === 'path';
  const suggestions = options.filter(row => 'token' in row);
  const suggestion = (item: (typeof suggestions)[number]) => {
    const idx = options.indexOf(item);
    const selected = idx === activeIndex;
    const Icon = item.kind === 'skill' ? Sparkles : Terminal;
    return <div key={item.token}
      id={id + '-' + idx} role="option" aria-selected={selected}
      className={cn('hb-mention-item', selected && 'is-active')}
      onMouseMove={() => onActiveChange(idx)} onClick={() => onSelect(item)}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="hb-mention-item__text">
        <span dir="auto" className="hb-mention-item__name">{item.label}</span>
        <span dir="auto" className="hb-mention-item__sub">{item.description}</span>
      </div>
    </div>;
  };

  const menuRef = (element: HTMLDivElement | null) => {
    if (!element || activeIndex < 0) return;
    const row = element.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row) return;
    const menu = element.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    if (rect.top < menu.top) element.scrollTop += rect.top - menu.top;
    if (rect.bottom > menu.bottom) element.scrollTop += rect.bottom - menu.bottom;
  };

  return (
    <div
      id={id}
      ref={menuRef}
      role="listbox"
      aria-label={kind === 'skill' ? 'Skills' : kind === 'slash-command' ? 'Commands' : 'Mention bots or people'}
      className="hb-mention-popover"
      onMouseDown={(event) => event.preventDefault()}
    >
      {suggestions.length > 0 && <div className="hb-mention-section">
        {suggestions.map(suggestion)}
      </div>}
      {!pathMenu && !suggestions.length && <p role="status" className="hb-mention-empty">{kind === 'skill' ? 'No matching skills.' : 'No matching commands.'}</p>}
      {botOptions.length > 0 && (
        <div className="hb-mention-section">
          <div className="hb-mention-section__label">Bots</div>
          {botOptions.map((item) => {
            const idx = options.indexOf(item);
            const avatar = hyperBotAvatarOf(item.bot);
            const selected = idx === activeIndex;
            return (
              <div
                key={`bot:${item.bot.id}`}
                id={`${id}-${idx}`}
                role="option"
                aria-selected={selected}
                className={cn('hb-mention-item', selected && 'is-active')}
                onMouseMove={() => onActiveChange(idx)}
                onClick={() => onSelect(item)}
              >
                <HyperBotAvatar shape={avatar.shape} color={avatar.color} size={24} />
                <div className="hb-mention-item__text">
                  <span dir="auto" className="hb-mention-item__name">
                    {item.bot.name}
                  </span>
                  <span dir="auto" className="hb-mention-item__sub">
                    {item.handle}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pathMenu && showPeopleSection && (
        <div className="hb-mention-section">
          <div className="hb-mention-section__label">People (Outlook)</div>
          {personOptions.length > 0 ? (
            personOptions.map((item) => {
              const globalIdx = options.indexOf(item);
              const selected = globalIdx === activeIndex;
              return (
                <div
                  key={`person:${item.person.email}`}
                  id={`${id}-${globalIdx}`}
                  role="option"
                  aria-selected={selected}
                  className={cn('hb-mention-item', selected && 'is-active')}
                  onMouseMove={() => onActiveChange(globalIdx)}
                  onClick={() => onSelect(item)}
                >
                  <HyperPersonAvatar person={item.person} className="size-6 text-[11px]" />
                  <div className="hb-mention-item__text">
                    <span dir="auto" className="hb-mention-item__name">
                      {item.person.name}
                    </span>
                    <span dir="auto" className="hb-mention-item__sub">
                      {[item.person.title, item.person.department, item.person.email]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p role="status" className="hb-mention-empty">
              {peopleLoading
                ? 'Searching Outlook directory…'
                : peopleError || 'No matching people found.'}
            </p>
          )}
        </div>
      )}

      {pathMenu && !botOptions.length && !showPeopleSection && (
        <p role="status" className="hb-mention-empty">
          Type at least 2 characters after @ to search people in Outlook.
        </p>
      )}
    </div>
  );
}

/**
 * Renders user messages & command previews with rich interactive `@` chips for both:
 * - Verified employees (`@[Display Name](mailto:email)` -> interactive `HyperPersonCard` chip)
 * - Configured bots (`@abby`, `@scout`, `@משה`, `@אבי` -> styled bot chip)
 * Leaves plain text untouched when no mentions are present.
 */
export function HyperBotRichText({
  text,
  bots,
  botChipClass = 'hb-mention-chip hb-mention-chip--bot',
  personChipClass = 'hb-mention-chip hb-mention-chip--person',
}: {
  readonly text: string;
  readonly bots: readonly HyperBotMentionBot[];
  readonly botChipClass?: string;
  readonly personChipClass?: string;
}) {
  const parts = useMemo(() => hyperParseMentions(text), [text]);

  return (
    <>
      {parts.map((part, partIndex) => {
        if (part.kind === 'mention') {
          return (
            <HyperPersonCard key={`p-${partIndex}`} person={part.person}>
              <span dir="auto" className={personChipClass}>
                @{part.person.name}
              </span>
            </HyperPersonCard>
          );
        }

        const botMentions = bots.length ? extractExplicitBotMentions(part.text, bots) : [];
        if (!botMentions.length) {
          return <Fragment key={`t-${partIndex}`}>{part.text}</Fragment>;
        }

        const nodes: ReactNode[] = [];
        let cursor = 0;
        botMentions.forEach((mention, mIdx) => {
          if (mention.start > cursor) {
            nodes.push(part.text.slice(cursor, mention.start));
          }
          const handle = hyperBotDisplayHandle(mention.bot);
          nodes.push(
            <span
              key={`b-${partIndex}-${mIdx}`}
              dir="auto"
              title={`${mention.bot.name} (${handle})`}
              className={botChipClass}
            >
              {mention.matchedText}
            </span>,
          );
          cursor = mention.end;
        });
        if (cursor < part.text.length) {
          nodes.push(part.text.slice(cursor));
        }
        return <Fragment key={`tb-${partIndex}`}>{nodes}</Fragment>;
      })}
    </>
  );
}
