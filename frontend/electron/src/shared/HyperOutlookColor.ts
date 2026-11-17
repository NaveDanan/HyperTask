// Outlook colours an event through its categories: a category's colour is the colour the event shows.
// HyperTask owns one category per colour ("HyperTask Blue" etc.), so colours never touch the user's own categories.
// `outlook` is the OlCategoryColor value (https://learn.microsoft.com/office/vba/api/outlook.olcategorycolor).
export const HyperOutlookColors = [
  { id: 'red', label: 'Red', outlook: 1 },
  { id: 'orange', label: 'Orange', outlook: 2 },
  { id: 'yellow', label: 'Yellow', outlook: 4 },
  { id: 'green', label: 'Green', outlook: 5 },
  { id: 'teal', label: 'Teal', outlook: 6 },
  { id: 'blue', label: 'Blue', outlook: 8 },
  { id: 'purple', label: 'Purple', outlook: 9 },
  { id: 'gray', label: 'Gray', outlook: 13 },
] as const;

export type HyperOutlookColorId = (typeof HyperOutlookColors)[number]['id'];
export const HyperOutlookColorIds = HyperOutlookColors.map(color => color.id) as [HyperOutlookColorId, ...HyperOutlookColorId[]];

export function hyperOutlookCategoryName(color: HyperOutlookColorId) {
  return `HyperTask ${HyperOutlookColors.find(option => option.id === color)!.label}`;
}

const owned = new Set(HyperOutlookColors.map(color => `HyperTask ${color.label}`.toLowerCase()));
const isOwned = (name: string) => owned.has(name.toLowerCase());

/** The colour of the first HyperTask colour category, matching Outlook's own rule that the first category sets the colour. */
export function hyperOutlookColorOf(categories: readonly string[]): HyperOutlookColorId | null {
  for (const name of categories) {
    const color = HyperOutlookColors.find(option => hyperOutlookCategoryName(option.id).toLowerCase() === name.toLowerCase());
    if (color) return color.id;
  }
  return null;
}

/** Categories after choosing `color`: the chosen one first, every other HyperTask colour removed, the user's own categories kept. */
export function hyperOutlookCategoriesWith(categories: readonly string[], color: HyperOutlookColorId | null) {
  const kept = categories.filter(name => !isOwned(name));
  return color ? [hyperOutlookCategoryName(color), ...kept] : kept;
}

/** The host-side write for a colour: the category to ensure (or null to clear), its Outlook colour, and every HyperTask colour category to strip. */
export function hyperOutlookColorWire(color: HyperOutlookColorId | null) {
  const selected = HyperOutlookColors.find(option => option.id === color);
  return { name: selected ? hyperOutlookCategoryName(selected.id) : null, outlook: selected?.outlook ?? 0, owned: HyperOutlookColors.map(option => hyperOutlookCategoryName(option.id)) };
}
