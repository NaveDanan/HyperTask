// Ported from t3code (apps/web/src/components/settings/FontFamilyPicker.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// Lists installed fonts from window.queryLocalFonts. When that is unavailable or not granted, the
// Typography row shows a plain text field instead (see TypographySettings.tsx).

import { CheckIcon } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';
import { displayFontFamily, isMonospaceFamily } from './font-families';
import { SelectButton } from './HyperSettingsControls';

const DEFAULT_FONT_VALUE = '__default__';

function supportsFontEnumeration(): boolean {
  return (
    typeof window !== 'undefined' && typeof (window as { queryLocalFonts?: unknown }).queryLocalFonts === 'function'
  );
}

type FontEnumerationState =
  | { readonly status: 'unknown' }
  | { readonly status: 'granted'; readonly families: readonly string[] }
  | { readonly status: 'unavailable' };

let enumerationState: FontEnumerationState = supportsFontEnumeration()
  ? { status: 'unknown' }
  : { status: 'unavailable' };
const enumerationListeners = new Set<() => void>();

function subscribeToEnumeration(listener: () => void): () => void {
  probeAlreadyGrantedPermission();
  enumerationListeners.add(listener);
  return () => {
    enumerationListeners.delete(listener);
  };
}

function readEnumerationState(): FontEnumerationState {
  return enumerationState;
}

let enumerationLoad: Promise<void> | null = null;

/** Queries installed fonts; call from a user gesture, because the permission prompt needs one. */
export function discoverInstalledFonts(): void {
  if (enumerationState.status !== 'unknown' || enumerationLoad !== null) return;
  enumerationLoad = queryInstalledFontFamilies().then((result) => {
    enumerationState =
      result.status === 'granted' ? { status: 'granted', families: result.families } : { status: 'unavailable' };
    enumerationLoad = null;
    for (const listener of enumerationListeners) listener();
  });
}

let grantedProbeStarted = false;

/** Electron and previously granted browsers need no user gesture to enumerate fonts. */
function probeAlreadyGrantedPermission(): void {
  if (grantedProbeStarted || enumerationState.status !== 'unknown') return;
  grantedProbeStarted = true;
  const permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
  if (typeof permissions?.query !== 'function') return;
  permissions.query({ name: 'local-fonts' } as unknown as PermissionDescriptor).then(
    (status) => {
      if (status.state === 'granted') discoverInstalledFonts();
    },
    () => {},
  );
}

export function useFontEnumeration(): FontEnumerationState {
  return useSyncExternalStore(subscribeToEnumeration, readEnumerationState, readEnumerationState);
}

interface InstalledFontFamiliesResult {
  readonly families: readonly string[];
  readonly status: 'granted' | 'denied' | 'unsupported';
}

let installedFamiliesCache: InstalledFontFamiliesResult | null = null;

/** Lists the installed font families. The first call prompts for local-fonts permission. */
async function queryInstalledFontFamilies(): Promise<InstalledFontFamiliesResult> {
  if (installedFamiliesCache !== null) return installedFamiliesCache;
  const query = (
    window as Window & {
      queryLocalFonts?: () => Promise<ReadonlyArray<{ readonly family: string }>>;
    }
  ).queryLocalFonts;
  if (typeof query !== 'function') {
    installedFamiliesCache = { families: [], status: 'unsupported' };
    return installedFamiliesCache;
  }
  try {
    const fonts = await query.call(window);
    const families = [...new Set(fonts.map((font) => font.family))]
      // Dot-prefixed macOS UI faces often refuse to render in web content.
      .filter((family) => !family.startsWith('.'))
      .sort((left, right) => left.localeCompare(right));
    // Denied access can return an empty list instead of throwing.
    if (families.length === 0) return { families: [], status: 'denied' };
    installedFamiliesCache = { families, status: 'granted' };
    return installedFamiliesCache;
  } catch {
    return { families: [], status: 'denied' };
  }
}

export function HyperFontFamilyPicker({
  ariaLabel,
  defaultFamily,
  selectedFamily,
  requireMonospace = false,
  initialOpen = false,
  onSelect,
}: {
  ariaLabel: string;
  defaultFamily: string;
  selectedFamily: string;
  requireMonospace?: boolean;
  initialOpen?: boolean;
  onSelect: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Base UI needs an initial closed commit; mounting open loses exit transitionend and leaves the popup
  // stuck.
  const [openAfterMount] = useState(initialOpen);
  useEffect(() => {
    if (openAfterMount) setOpen(true);
  }, [openAfterMount]);
  const enumeration = useFontEnumeration();

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setQuery('');
  };

  const families = enumeration.status === 'granted' ? enumeration.families : [];
  const trimmedQuery = query.trim().toLowerCase();
  const items = [
    ...(trimmedQuery.length === 0 ? [DEFAULT_FONT_VALUE] : []),
    ...families.filter((family) => trimmedQuery.length === 0 || family.toLowerCase().includes(trimmedQuery)),
  ];

  const selectedValue = selectedFamily.length === 0 ? DEFAULT_FONT_VALUE : selectedFamily;

  const handlePick = (value: string) => {
    setOpen(false);
    if (value !== DEFAULT_FONT_VALUE && requireMonospace && !isMonospaceFamily(value)) {
      toast.error(`"${value}" isn't monospace`, {
        description: 'Code and terminal need a fixed-width font, so the current font was kept.',
      });
      return;
    }
    onSelect(value === DEFAULT_FONT_VALUE ? '' : value);
  };

  const renderItem = (item: string) => {
    const isDefault = item === DEFAULT_FONT_VALUE;
    const family = isDefault ? defaultFamily : item;
    return (
      <ComboboxItem key={item} value={item} className="pr-2 [&>span]:hidden">
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate" style={{ fontFamily: displayFontFamily(family) }}>
            {family}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {isDefault ? <span className="text-[0.625rem] text-muted-foreground/60">default</span> : null}
            {item === selectedValue ? <CheckIcon className="size-3.5 text-muted-foreground" /> : null}
          </span>
        </div>
      </ComboboxItem>
    );
  };

  return (
    <Combobox
      items={items}
      filter={null}
      autoHighlight
      open={open}
      onOpenChange={handleOpenChange}
      inputValue={query}
      onInputValueChange={(value, details) => {
        if (details.reason === 'input-change') setQuery(value);
      }}
      value={selectedValue}
      onValueChange={(next) => {
        if (typeof next === 'string') handlePick(next);
      }}
    >
      <ComboboxTrigger aria-label={ariaLabel} render={<SelectButton size="sm" />}>
        {selectedFamily.length === 0 ? defaultFamily : selectedFamily}
      </ComboboxTrigger>
      <ComboboxContent align="end" className="flex w-72 flex-col">
        <ComboboxInput placeholder="Search fonts…" showTrigger={false} />
        <ComboboxEmpty>No fonts found.</ComboboxEmpty>
        <ComboboxList className="max-h-72">{items.map((item) => renderItem(item))}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
