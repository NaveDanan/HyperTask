// kIconGroups (shared/icon_emoji_picker/icon_picker.dart): the built-in icon set from
// appflowy_flutter/assets/icons/icons.json, loaded once on demand.
import { useEffect, useState } from 'react';

export interface IconItem {
  name: string;
  keywords: string[];
  /** SVG markup. */
  content: string;
}

export interface IconGroup {
  name: string;
  icons: IconItem[];
}

const urls = import.meta.glob('@flutter-assets/icons/icons.json', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

let cache: IconGroup[] | null = null;
let pending: Promise<IconGroup[]> | null = null;
const listeners = new Set<() => void>();

export function loadIconGroups(): Promise<IconGroup[]> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  const url = Object.values(urls)[0];
  if (!url) return Promise.resolve([]);
  pending = fetch(url)
    .then((response) => response.json() as Promise<Record<string, IconItem[]>>)
    .then((json) => {
      cache = Object.entries(json).map(([name, icons]) => ({ name, icons }));
      listeners.forEach((l) => l());
      return cache;
    })
    .catch(() => {
      pending = null;
      return [];
    });
  return pending;
}

/** The icon groups, or null until icons.json has loaded. */
export function useIconGroups(): IconGroup[] | null {
  const [groups, setGroups] = useState(cache);
  useEffect(() => {
    if (cache) {
      setGroups(cache);
      return;
    }
    const update = () => setGroups(cache);
    listeners.add(update);
    void loadIconGroups();
    return () => void listeners.delete(update);
  }, []);
  return groups;
}

/** findSvgContent("<group>/<icon>"). */
export function findSvgContent(key: string, groups: IconGroup[] | null = cache): string | null {
  const parts = key.split('/');
  if (parts.length !== 2 || !groups) return null;
  return groups.find((g) => g.name === parts[0])?.icons.find((i) => i.name === parts[1])?.content ?? null;
}

/** IconGroup.displayName / Icon.displayName. */
export const groupDisplayName = (name: string) => name.replace(/_/g, ' ');
export const iconDisplayName = (name: string) => name.replace(/-/g, ' ');

export const svgDataUrl = (content: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;

/** IconsData (icon_picker.dart): the JSON stored in a view icon of type `icon`. */
export interface IconsData {
  groupName: string;
  iconName: string;
  color?: string | null;
}

export function parseIconsData(value: string): IconsData | null {
  try {
    const json = JSON.parse(value);
    if (json && typeof json.groupName === 'string' && typeof json.iconName === 'string') return json as IconsData;
  } catch {
    // FormatException
  }
  return null;
}

export const iconsDataString = (data: IconsData) =>
  JSON.stringify({ groupName: data.groupName, iconName: data.iconName, ...(data.color != null ? { color: data.color } : null) });
