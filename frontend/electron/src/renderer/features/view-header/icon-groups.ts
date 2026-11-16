// kIconGroups (shared/icon_emoji_picker/icon_picker.dart): the bundled icon set, loaded lazily
// from resources/assets/icons/icons.json (1.5 MB, so fetched on first use).
import iconsJsonUrl from '@assets/icons/icons.json?url';
import { useEffect, useState } from 'react';

export interface IconEntry {
  name: string;
  keywords: string[];
  content: string;
}

export interface IconGroup {
  name: string;
  icons: IconEntry[];
}

let groups: IconGroup[] | null = null;
let loading: Promise<IconGroup[]> | null = null;
const listeners = new Set<() => void>();

export function loadIconGroups(): Promise<IconGroup[]> {
  if (groups) return Promise.resolve(groups);
  loading ??= fetch(iconsJsonUrl)
    .then((response) => response.json() as Promise<Record<string, IconEntry[]>>)
    .then((json) => {
      groups = Object.entries(json).map(([name, icons]) => ({ name, icons }));
      listeners.forEach((l) => l());
      return groups;
    })
    .catch((error) => {
      console.error('Failed to decode icons.json', error);
      loading = null;
      return [];
    });
  return loading;
}

/** The loaded groups (null until loaded); triggers the load. */
export function useIconGroups(): IconGroup[] | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (groups) return;
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    void loadIconGroups();
    return () => void listeners.delete(listener);
  }, []);
  return groups;
}

/** IconsData.svgString / findSvgContent('group/name'). */
export function findSvgContent(all: IconGroup[] | null, groupName: string, iconName: string): string | null {
  return all?.find((g) => g.name === groupName)?.icons.find((i) => i.name === iconName)?.content ?? null;
}

/** Dart int.tryParse(color) for "0xFFRRGGBB" / decimal ARGB values → CSS color. */
export function argbToCss(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value.startsWith('0x') || value.startsWith('0X') ? Number.parseInt(value.slice(2), 16) : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const argb = parsed >>> 0;
  const a = ((argb >>> 24) & 0xff) / 255;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}
