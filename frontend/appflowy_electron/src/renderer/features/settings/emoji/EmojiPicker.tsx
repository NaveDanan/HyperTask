import { useMemo, useState } from 'react';
import { useTr } from '@/i18n';
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
    <div style={{ width, height, display: 'flex', flexDirection: 'column', padding: '8px 12px', boxSizing: 'border-box' }}>
      <div className="af-textfield" data-size="m" style={{ marginBottom: 8 }}>
        <input autoFocus value={query} placeholder={tr('emoji.search')} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {empty && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--th-hint)', fontSize: 'calc(14px * var(--text-scale, 1))' }}>
            {tr('emoji.noEmojiFound')}
          </div>
        )}
        {groups.map((group) =>
          group.emojis.length === 0 ? null : (
            <div key={group.id || 'results'}>
              {group.id && (
                <div
                  style={{
                    padding: '8px 4px 4px',
                    fontSize: 'calc(12px * var(--text-scale, 1))',
                    color: 'var(--th-hint)',
                    textTransform: 'capitalize',
                  }}
                >
                  {tr(CATEGORY_KEYS[group.id] ?? group.id)}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 36px)' }}>
                {group.emojis.map(([native, name]) => (
                  <div
                    key={native + name}
                    title={name}
                    className="flowy-hover"
                    onClick={() => onSelected(native)}
                    style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, borderRadius: 8 }}
                  >
                    {native}
                  </div>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
