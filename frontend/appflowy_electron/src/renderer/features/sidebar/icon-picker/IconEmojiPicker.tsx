// FlowyIconEmojiPicker (shared/icon_emoji_picker/flowy_icon_emoji_picker.dart), simplified:
// the Emojis tab (emoji-mart catalog, search, random) and the Icons tab (icons.json, search,
// random, background color) are implemented; skin tones, recent icons and the Upload (custom
// image) tab are not.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTr } from '@/i18n';
import { AppFlowyPopover, FlowyButton, FlowyDivider, FlowySvg, FlowyText, Spinner, Tooltip } from '@/ui';
import { useBrightness } from '@/theme/appearance-store';
import { emptyEmojiIcon, type EmojiIconData, type FlowyIconType } from '@/features/view/view-ext';
import { builtInSpaceColors, dartColorToCss } from '../stores/types';
import { EMOJI_CATEGORIES } from './emoji-data';
import { groupDisplayName, iconDisplayName, iconsDataString, svgDataUrl, useIconGroups, type IconItem } from './icon-groups';

export type PickerTabType = 'emoji' | 'icon' | 'custom';

/** SelectedEmojiIconResult: `keepOpen` for random picks. */
export interface SelectedEmojiIconResult {
  data: EmojiIconData;
  keepOpen: boolean;
}

const TAB_LABEL: Record<PickerTabType, string> = { emoji: 'Emojis', icon: 'Icons', custom: 'Upload' };

interface EmojiEntry {
  emoji: string;
  name: string;
  search: string;
}

let parsedEmojis: Array<{ id: string; emojis: EmojiEntry[] }> | null = null;
function emojiCategories() {
  parsedEmojis ??= EMOJI_CATEGORIES.map(([id, lines]) => ({
    id,
    emojis: lines.split('\n').map((line) => {
      const [emoji, name, keywords] = line.split('\t');
      return { emoji, name, search: `${name} ${keywords ?? ''}`.toLowerCase() };
    }),
  }));
  return parsedEmojis;
}

/** Renders a long list a few groups per frame (the picker has ~1850 emojis and ~1000 icons). */
function useProgressiveCount(total: number, initial = 2): number {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    if (count >= total) return;
    const frame = requestAnimationFrame(() => setCount((c) => c + 2));
    return () => cancelAnimationFrame(frame);
  }, [count, total]);
  return count;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function toPickerTabType(type: FlowyIconType): PickerTabType {
  return type;
}

export function IconEmojiPicker({
  tabs = ['emoji', 'icon'],
  initialType,
  onSelected,
  width = 364,
  height = 356,
}: {
  tabs?: PickerTabType[];
  initialType?: PickerTabType;
  onSelected: (result: SelectedEmojiIconResult) => void;
  width?: number;
  height?: number;
}) {
  const { tr } = useTr();
  // The Upload tab (custom images) is not ported.
  const visibleTabs: PickerTabType[] = tabs.filter((t) => t !== 'custom');
  const [current, setCurrent] = useState<PickerTabType>(
    initialType && visibleTabs.includes(initialType) ? initialType : (visibleTabs[0] ?? 'emoji'),
  );
  return (
    <div style={{ width, height, maxWidth: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 46, padding: '0 12px 0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ flex: 1, display: 'flex', height: '100%' }}>
          {visibleTabs.map((tab) => (
            <div key={tab} className="sb-tab" style={{ padding: '0 12px' }} onClick={() => setCurrent(tab)}>
              <FlowyText fontWeight={500} lineHeight={16} color={tab === current ? undefined : 'var(--th-hint)'}>
                {TAB_LABEL[tab]}
              </FlowyText>
              {tab === current && <div className="sb-tab-indicator" style={{ width: 34, background: 'var(--cs-primary)' }} />}
            </div>
          ))}
        </div>
        <FlowyButton
          useIntrinsicWidth
          height={32}
          text={
            <FlowyText fontWeight={500} lineHeight={16} color="var(--th-hint)">
              {tr('button.remove')}
            </FlowyText>
          }
          onTap={() => onSelected({ data: emptyEmojiIcon(), keepOpen: false })}
        />
      </div>
      <FlowyDivider />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {current === 'emoji' ? <EmojiTab onSelected={onSelected} /> : <IconTab onSelected={onSelected} />}
      </div>
    </div>
  );
}

function SearchRow({ onChanged, onRandom }: { onChanged: (value: string) => void; onRandom: () => void }) {
  const { tr } = useTr();
  const light = useBrightness() === 'light';
  const border = light ? '#1717171E' : 'rgba(255,255,255,0.12)';
  const [value, setValue] = useState('');
  return (
    <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <div style={{ flex: 1, height: 36, display: 'flex', alignItems: 'center', border: `1px solid ${border}`, borderRadius: 8 }}>
        <div style={{ padding: '0 8px 0 14px', display: 'flex' }}>
          <FlowySvg svg="search_s" />
        </div>
        <input
          autoFocus
          value={value}
          placeholder={tr('search.label')}
          onChange={(event) => {
            setValue(event.target.value);
            onChanged(event.target.value);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 'calc(14px * var(--text-scale, 1))',
            color: 'var(--text-color)',
          }}
        />
        {value && (
          <div style={{ padding: 4, display: 'flex', cursor: 'pointer' }} onClick={() => (setValue(''), onChanged(''))}>
            <FlowySvg svg="m_app_bar_close_s" />
          </div>
        )}
      </div>
      <Tooltip message={tr('emoji.random')}>
        <div
          className="flowy-hover"
          onClick={onRandom}
          style={{ width: 36, height: 36, border: `1px solid ${border}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <FlowySvg svg="icon_shuffle_s" />
        </div>
      </Tooltip>
    </div>
  );
}

function EmojiTab({ onSelected }: { onSelected: (result: SelectedEmojiIconResult) => void }) {
  const [keyword, setKeyword] = useState('');
  const categories = emojiCategories();
  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return categories;
    return categories.map((c) => ({ ...c, emojis: c.emojis.filter((e) => e.search.includes(k)) })).filter((c) => c.emojis.length > 0);
  }, [categories, keyword]);
  const visible = useProgressiveCount(filtered.length);
  const pick = (emoji: string, keepOpen = false) => onSelected({ data: { type: 'emoji', emoji }, keepOpen });
  return (
    <>
      <SearchRow
        onChanged={setKeyword}
        onRandom={() => {
          const all = categories.flatMap((c) => c.emojis);
          pick(all[Math.floor(Math.random() * all.length)].emoji, true);
        }}
      />
      <div className="sb-scroll" style={{ flex: 1, padding: '0 16px' }}>
        {filtered.slice(0, visible).map((category) => (
          <div key={category.id}>
            <div style={{ height: 22, paddingBottom: 4, background: 'var(--th-card)', position: 'sticky', top: 0 }}>
              <FlowyText color="var(--th-hint)">{capitalize(category.id)}</FlowyText>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 36px)', contentVisibility: 'auto' } as CSSProperties}>
              {category.emojis.map((e) => (
                <Tooltip key={e.emoji + e.name} message={e.name} preferBelow={false}>
                  <div
                    className="flowy-hover"
                    onClick={() => pick(e.emoji)}
                    style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <span className="sb-emoji" style={{ fontSize: 24 * 0.9 }}>
                      {e.emoji}
                    </span>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function IconTab({ onSelected }: { onSelected: (result: SelectedEmojiIconResult) => void }) {
  const groups = useIconGroups();
  const [keyword, setKeyword] = useState('');
  const light = useBrightness() === 'light';
  const filtered = useMemo(() => {
    if (!groups) return null;
    const k = keyword.toLowerCase();
    if (!k) return groups;
    return groups
      .map((g) => ({
        ...g,
        icons: g.icons.filter((i) => i.keywords.some((w) => w.toLowerCase().includes(k)) || i.name.toLowerCase().includes(k)),
      }))
      .filter((g) => g.icons.length > 0);
  }, [groups, keyword]);
  const visible = useProgressiveCount(filtered?.length ?? 0);
  const select = (groupName: string, icon: IconItem, color: string | null, keepOpen = false) =>
    onSelected({ data: { type: 'icon', emoji: iconsDataString({ groupName, iconName: icon.name, color }) }, keepOpen });
  return (
    <>
      <SearchRow
        onChanged={setKeyword}
        onRandom={() => {
          if (!groups || groups.length === 0) return;
          const group = groups[Math.floor(Math.random() * groups.length)];
          const icon = group.icons[Math.floor(Math.random() * group.icons.length)];
          select(group.name, icon, builtInSpaceColors[Math.floor(Math.random() * builtInSpaceColors.length)], true);
        }}
      />
      {!filtered ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={24} stroke={2} />
        </div>
      ) : (
        <div className="sb-scroll" style={{ flex: 1, padding: '0 16px' }}>
          {filtered.slice(0, visible).map((group) => (
            <div key={group.name} style={{ marginBottom: 12 }}>
              <FlowyText fontSize={12} lineHeight={18} color={light ? '#17171780' : 'rgba(255,255,255,0.5)'}>
                {capitalize(groupDisplayName(group.name))}
              </FlowyText>
              <div style={{ height: 4 }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', contentVisibility: 'auto' } as CSSProperties}>
                {group.icons.map((icon) => (
                  <PickerIcon
                    key={icon.name}
                    icon={icon}
                    iconColor={light ? '#171717' : '#FFFFFF'}
                    onColor={(color) => select(group.name, icon, color)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** _Icon: tapping an icon opens the background color picker (IconColorPicker). */
function PickerIcon({ icon, iconColor, onColor }: { icon: IconItem; iconColor: string; onColor: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AppFlowyPopover
      direction="bottomWithCenterAligned"
      offset={{ x: 0, y: 6 }}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      popup={(close) => (
        <div style={{ width: 228, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', rowGap: 4 }}>
          {builtInSpaceColors.map((color) => (
            <div
              key={color}
              className="flowy-hover"
              onClick={() => {
                onColor(color);
                close();
              }}
              style={{ width: 34, height: 34, padding: 5, borderRadius: 8 }}
            >
              <div style={{ width: '100%', height: '100%', borderRadius: 8, background: dartColorToCss(color) ?? undefined, border: '1px solid #3333332D' }} />
            </div>
          ))}
        </div>
      )}
    >
      <Tooltip message={iconDisplayName(icon.name)} preferBelow={false}>
        <div
          className="flowy-hover"
          data-selected={open ? 'true' : undefined}
          style={{ aspectRatio: '1', padding: 8, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              opacity: 0.7,
              background: iconColor,
              WebkitMaskImage: `url("${svgDataUrl(icon.content)}")`,
              WebkitMaskSize: '100% 100%',
              WebkitMaskRepeat: 'no-repeat',
            }}
          />
        </div>
      </Tooltip>
    </AppFlowyPopover>
  );
}
