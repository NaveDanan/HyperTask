import { useMemo, useState } from 'react';
import { useTr } from '@/i18n';
import { Search } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { emojiCategories } from './emoji-data';

/** emoji-mart category id → `emoji.categories.*` key. */
const CATEGORY_KEYS: Record<string, string> = {
  people: 'emoji.categories.people',
  nature: 'emoji.categories.nature',
  foods: 'emoji.categories.food',
  activity: 'emoji.categories.activities',
  places: 'emoji.categories.places',
  objects: 'emoji.categories.objects',
  symbols: 'emoji.categories.symbols',
  flags: 'emoji.categories.flags',
};

/**
 * FlowyIconEmojiPicker(tabs: [emoji]) as used by the account avatar and the workspace icon:
 * a search bar and the emoji-mart grid by category. Simplified: no recent emojis, random
 * button or skin-tone selector.
 */
export function EmojiPicker({ onSelected, width = 360, height = 380 }: { onSelected: (emoji: string) => void; width?: number; height?: number }) {
  const { tr } = useTr();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return emojiCategories;
    const matches = emojiCategories.flatMap((c) => c.emojis.filter(([, name, keywords]) => name.toLowerCase().includes(q) || keywords.includes(q)));
    return [{ id: '', emojis: matches }];
  }, [query]);
  const empty = groups.every((g) => g.emojis.length === 0);

  return (
    <div style={{ width, height }} className="box-border flex flex-col gap-2 px-3 py-2">
      <InputGroup data-size="m"><InputGroupAddon><Search className="size-4" /></InputGroupAddon>
        <InputGroupInput autoFocus value={query} placeholder={tr('emoji.search')} onChange={(event) => setQuery(event.target.value)} />
      </InputGroup>
      <ScrollArea className="min-h-0 flex-1">
        {empty && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {tr('emoji.noEmojiFound')}
          </div>
        )}
        {groups.map((group) =>
          group.emojis.length === 0 ? null : (
            <div key={group.id || 'results'}>
              {group.id && (
                <div
                  className="px-1 pt-2 pb-1 text-xs capitalize text-muted-foreground"
                >
                  {tr(CATEGORY_KEYS[group.id] ?? group.id)}
                </div>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,2.25rem)]">
                {group.emojis.map(([native, name]) => (
                  <button
                    type="button"
                    key={native + name}
                    title={name}
                    className="flex size-9 items-center justify-center rounded-lg text-2xl transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelected(native)}
                  >
                    {native}
                  </button>
                ))}
              </div>
            </div>
          ),
        )}
      </ScrollArea>
    </div>
  );
}
