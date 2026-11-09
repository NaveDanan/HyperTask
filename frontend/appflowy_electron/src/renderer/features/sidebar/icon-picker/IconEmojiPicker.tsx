// FlowyIconEmojiPicker (shared/icon_emoji_picker/flowy_icon_emoji_picker.dart), simplified:
// the Emojis tab (emoji-mart catalog, search, random) and the Icons tab (icons.json, search,
// random, background color) are implemented; skin tones, recent icons and the Upload (custom
// image) tab are not.
import { useEffect, useMemo, useState } from 'react';
import { useTr } from '@/i18n';
import { AppFlowyPopover, Spinner, Tooltip } from '@/ui';
import { Search, Shuffle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { floatingSurfaceClass, MenuLabel } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
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
  width: _width = 352,
  height = 356,
}: {
  tabs?: PickerTabType[];
  initialType?: PickerTabType;
  onSelected: (result: SelectedEmojiIconResult) => void;
  width?: number;
  height?: number;
}) {
  // The Upload tab (custom images) is not ported.
  const visibleTabs: PickerTabType[] = tabs.filter((t) => t !== 'custom');
  const [current, setCurrent] = useState<PickerTabType>(
    initialType && visibleTabs.includes(initialType) ? initialType : (visibleTabs[0] ?? 'emoji'),
  );
  return (
    <Tabs value={current} onValueChange={(value) => setCurrent(value as PickerTabType)} className={cn(floatingSurfaceClass, 'flex w-[22rem] max-w-full flex-col gap-0 p-0')} style={{ height }}>
      <TabsList variant="line" className="h-9 w-full shrink-0 justify-start rounded-none border-b px-2">
        {visibleTabs.map((tab) => <TabsTrigger key={tab} value={tab} className="flex-none">{TAB_LABEL[tab]}</TabsTrigger>)}
      </TabsList>
      <div className="flex min-h-0 flex-1 flex-col">
        {current === 'emoji' ? <EmojiTab onSelected={onSelected} onRemove={() => onSelected({ data: emptyEmojiIcon(), keepOpen: false })} /> : <IconTab onSelected={onSelected} onRemove={() => onSelected({ data: emptyEmojiIcon(), keepOpen: false })} />}
      </div>
    </Tabs>
  );
}

function SearchRow({ onChanged, onRandom, onRemove }: { onChanged: (value: string) => void; onRandom: () => void; onRemove: () => void }) {
  const { tr } = useTr();
  const [value, setValue] = useState('');
  return (
    <div className="flex shrink-0 items-center gap-1 p-2">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
        <InputGroupInput autoFocus value={value} placeholder={tr('search.label')}
          onChange={(event) => { setValue(event.target.value); onChanged(event.target.value); }} />
        {value && <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon-xs" aria-label={tr('button.remove')} onClick={() => (setValue(''), onChanged(''))}><X className="size-4" /></Button></InputGroupAddon>}
      </InputGroup>
      <Tooltip message={tr('emoji.random')}><Button variant="ghost" size="icon-sm" aria-label={tr('emoji.random')} onClick={onRandom}><Shuffle className="size-4" /></Button></Tooltip>
      <Button variant="ghost" size="sm" onClick={onRemove}>{tr('button.remove')}</Button>
    </div>
  );
}

function EmojiTab({ onSelected, onRemove }: { onSelected: (result: SelectedEmojiIconResult) => void; onRemove: () => void }) {
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
        onRemove={onRemove}
        onChanged={setKeyword}
        onRandom={() => {
          const all = categories.flatMap((c) => c.emojis);
          pick(all[Math.floor(Math.random() * all.length)].emoji, true);
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.slice(0, visible).map((category) => (
          <div key={category.id}>
            <MenuLabel className="sticky top-0 z-10 bg-popover">{capitalize(category.id)}</MenuLabel>
            <div className="grid grid-cols-9 gap-0.5 p-2 [content-visibility:auto]">
              {category.emojis.map((e) => (
                <Tooltip key={e.emoji + e.name} message={e.name} preferBelow={false}>
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md text-xl transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => pick(e.emoji)}
                  >
                    <span className="leading-none">
                      {e.emoji}
                    </span>
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function IconTab({ onSelected, onRemove }: { onSelected: (result: SelectedEmojiIconResult) => void; onRemove: () => void }) {
  const groups = useIconGroups();
  const [keyword, setKeyword] = useState('');
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
        onRemove={onRemove}
        onChanged={setKeyword}
        onRandom={() => {
          if (!groups || groups.length === 0) return;
          const group = groups[Math.floor(Math.random() * groups.length)];
          const icon = group.icons[Math.floor(Math.random() * group.icons.length)];
          select(group.name, icon, builtInSpaceColors[Math.floor(Math.random() * builtInSpaceColors.length)], true);
        }}
      />
      {!filtered ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={24} stroke={2} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.slice(0, visible).map((group) => (
            <div key={group.name} className="mb-3">
              <MenuLabel className="sticky top-0 z-10 bg-popover">{capitalize(groupDisplayName(group.name))}</MenuLabel>
              <div className="grid grid-cols-9 gap-0.5 p-2 [content-visibility:auto]">
                {group.icons.map((icon) => (
                  <PickerIcon
                    key={icon.name}
                    icon={icon}
                    iconColor="currentColor"
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
function PickerIcon({ icon, iconColor: _iconColor, onColor }: { icon: IconItem; iconColor: string; onColor: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AppFlowyPopover
      direction="bottomWithCenterAligned"
      offset={{ x: 0, y: 6 }}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      popup={(close) => (
        <div className="grid w-56 grid-cols-6 gap-1 p-1">
          {builtInSpaceColors.map((color) => (
            <button
              type="button"
              key={color}
              aria-label={color}
              className="size-8 rounded-md p-1 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                onColor(color);
                close();
              }}
            >
              <span className="block size-full rounded-md ring-1 ring-foreground/10" style={{ background: dartColorToCss(color) ?? undefined }} />
            </button>
          ))}
        </div>
      )}
    >
      <Tooltip message={iconDisplayName(icon.name)} preferBelow={false}>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-md text-xl transition-colors hover:bg-accent data-[selected=true]:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          data-selected={open ? 'true' : undefined}
        >
          <span
            className="size-5 bg-current opacity-70 [mask-size:100%_100%] [mask-repeat:no-repeat]"
            style={{
              WebkitMaskImage: `url("${svgDataUrl(icon.content)}")`,
            }}
          />
        </button>
      </Tooltip>
    </AppFlowyPopover>
  );
}
