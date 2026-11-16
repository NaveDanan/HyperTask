// Ported from t3code (apps/web/src/components/settings/ThemeSearchSection.tsx; GitHub, GitLab and Bitbucket marks from
// packages/source-control-*/src/shared/icon.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in
// this folder.
// Differences from t3code: the source link icon recognizes github.com, gitlab.com and bitbucket.org directly instead
// of through t3code's source-control client registry (other hosts get the external-link icon), The collection functions
// are in useHyperTheme.ts.

import { ExternalLinkIcon, PackagePlusIcon, PaletteIcon, SearchIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import {
  importOpenVsxThemeExtension,
  searchOpenVsxThemes,
  type OpenVsxThemeExtension,
  type OpenVsxThemeSort,
} from '@/theme/HyperOpenVsxThemes';
import type { ThemeDefinition } from '@/theme/HyperThemeLibrary';
import { getCustomThemes, getStoredCustomThemeCollection, replaceCustomThemeCollection } from './useHyperTheme';
import { Button, Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from './HyperSettingsControls';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  RefreshIcon,
  Spinner,
} from './HyperThemeImportControls';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 32 32" fill="none">
      <path
        d="m31.46 12.78-.04-.12-4.35-11.35A1.14 1.14 0 0 0 25.94.6c-.24 0-.47.1-.66.24-.19.15-.33.36-.39.6l-2.94 9h-11.9l-2.94-9A1.14 1.14 0 0 0 6.07.58a1.15 1.15 0 0 0-1.14.72L.58 12.68l-.05.11a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48 6.67-5h.02a8.09 8.09 0 0 0 2.7-9.36Z"
        fill="#E24329"
      />
      <path
        d="m31.46 12.78-.04-.12a14.75 14.75 0 0 0-5.86 2.64l-9.55 7.24 6.09 4.6 6.67-5h.02a8.09 8.09 0 0 0 2.67-9.36Z"
        fill="#FC6D26"
      />
      <path d="m9.9 27.14 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48-6.1-4.6-6.07 4.6Z" fill="#FCA326" />
      <path
        d="M6.44 15.3a14.71 14.71 0 0 0-5.86-2.63l-.05.12a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 6.1-4.6-9.56-7.24Z"
        fill="#FC6D26"
      />
    </svg>
  );
}

function BitbucketIcon({ className }: { className?: string }) {
  const gradientId = `bitbucket-${useId().replace(/[^\w-]/gu, '')}`;
  return (
    <svg aria-hidden className={className} viewBox="8.4 14.39 2481.29 2231.21" fill="none">
      <defs>
        <linearGradient
          id={gradientId}
          x1={945.1094}
          y1={1524.8389}
          x2={944.4923}
          y2={1524.1893}
          gradientTransform="matrix(1996.6343 0 0 -1480.3047 -1884485.625 2258195)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset={0.18} stopColor="#0052CC" />
          <stop offset={1} stopColor="#2684FF" />
        </linearGradient>
      </defs>
      <path
        d="M88.92,14.4C45.02,13.83,8.97,48.96,8.41,92.86c-0.06,4.61,0.28,9.22,1.02,13.77l337.48,2048.72 c8.68,51.75,53.26,89.8,105.74,90.24h1619.03c39.38,0.5,73.19-27.9,79.49-66.78l337.49-2071.78c7.03-43.34-22.41-84.17-65.75-91.2 c-4.55-0.74-9.15-1.08-13.76-1.02L88.92,14.4z M1509.99,1495.09H993.24l-139.92-731h781.89L1509.99,1495.09z"
        fill="#2684FF"
      />
      <path
        d="M2379.27,763.06h-745.5l-125.12,730.42H992.31l-609.67,723.67c19.32,16.71,43.96,26,69.5,26.21h1618.13 c39.35,0.51,73.14-27.88,79.44-66.72L2379.27,763.06z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}

const SOURCE_HOST_ICONS: Readonly<Record<string, (props: { className?: string }) => ReactNode>> = {
  'github.com': GitHubIcon,
  'gitlab.com': GitLabIcon,
  'bitbucket.org': BitbucketIcon,
};
const DOWNLOAD_FORMAT = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const SUGGESTED_SEARCHES = ['Dracula', 'Catppuccin', 'Nord', 'Tokyo Night'];
const SORT_OPTIONS: ReadonlyArray<{ value: OpenVsxThemeSort; label: string }> = [
  { value: 'downloadCount', label: 'Most downloaded' },
  { value: 'rating', label: 'Best rated' },
  { value: 'timestamp', label: 'Newest' },
  { value: 'relevance', label: 'Most relevant' },
];
const SEARCH_DEBOUNCE_MS = 350;

function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sourceLinkIcon(url: string): ReactNode {
  const host = sourceHost(url);
  const Icon = (host === null ? undefined : SOURCE_HOST_ICONS[host]) ?? ExternalLinkIcon;
  return <Icon className="size-3.5" />;
}

function ThemeExtensionIcon({ extension }: { extension: OpenVsxThemeExtension }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      {extension.iconUrl && !failed ? (
        <img
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={extension.iconUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <PaletteIcon className="size-4" />
      )}
    </div>
  );
}

export interface ThemeSearchView {
  readonly setResults: (results: ReadonlyArray<OpenVsxThemeExtension> | null) => void;
  readonly setError: (error: string | null) => void;
  readonly setIsSearching: (isSearching: boolean) => void;
}

type SearchThemes = typeof searchOpenVsxThemes;

/**
 * Owns one dialog session's Open VSX traffic: the input debounce, the request in
 * flight, and which key the shown results belong to. Aborting `signal` (the
 * dialog closing) cancels all of it, including an install.
 */
export function createThemeSearch(
  view: ThemeSearchView,
  signal: AbortSignal,
  search: SearchThemes = searchOpenVsxThemes,
) {
  let query = '';
  let sortBy: OpenVsxThemeSort = 'downloadCount';
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let request: AbortController | null = null;
  let install: AbortController | null = null;
  // Record successful searches only; rerun after install only for changed query/sort to preserve install
  // errors.
  let shownKey: string | null = null;
  let handledKey: string | null = null;
  let interrupted = false;

  const keyOf = () => `${query}\u0000${sortBy}`;
  const abortRequest = () => {
    request?.abort();
    request = null;
  };
  const cancelDebounce = () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = null;
  };

  const fetchResults = () => {
    abortRequest();
    const controller = new AbortController();
    request = controller;
    const key = keyOf();
    void search(query, { signal: controller.signal, sortBy })
      .then(
        (results) => {
          if (controller.signal.aborted) return;
          view.setResults(results);
          shownKey = key;
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          view.setResults(null);
          shownKey = null;
          view.setError(cause instanceof Error ? cause.message : 'Open VSX search failed.');
        },
      )
      .then(() => {
        if (request !== controller) return;
        request = null;
        view.setIsSearching(false);
      });
  };

  const clear = () => {
    cancelDebounce();
    abortRequest();
    shownKey = null;
    handledKey = null;
    view.setResults(null);
    view.setError(null);
    view.setIsSearching(false);
  };

  const settle = () => {
    if (install !== null || signal.aborted || query === '') return;
    const key = keyOf();
    const keyChanged = handledKey !== key;
    if (!keyChanged && !interrupted) return;
    handledKey = key;
    interrupted = false;
    const shouldFetch = shownKey !== key;
    if (shouldFetch || keyChanged) view.setError(null);
    view.setIsSearching(shouldFetch);
    if (shouldFetch) fetchResults();
    else abortRequest();
  };

  signal.addEventListener(
    'abort',
    () => {
      cancelDebounce();
      abortRequest();
      install?.abort();
    },
    { once: true },
  );

  return {
    /** An unsettled query would hit Open VSX for text that is no longer visible, so typing waits. */
    setQuery(nextQuery: string) {
      const trimmed = nextQuery.trim();
      if (trimmed === query) return;
      query = trimmed;
      cancelDebounce();
      if (trimmed === '') {
        if (install === null) clear();
        return;
      }
      debounce = setTimeout(() => {
        debounce = null;
        settle();
      }, SEARCH_DEBOUNCE_MS);
    },
    setSortBy(nextSort: OpenVsxThemeSort) {
      sortBy = nextSort;
      if (debounce === null) settle();
    },
    /** Enter or re-picking the current suggestion searches again even for the shown key. */
    searchNow() {
      if (install !== null || signal.aborted || query === '') return;
      // A pending debounce for the same key would otherwise restart this search.
      cancelDebounce();
      handledKey = keyOf();
      interrupted = false;
      view.setError(null);
      view.setIsSearching(true);
      fetchResults();
    },
    beginInstall(): AbortSignal {
      abortRequest();
      install?.abort();
      install = new AbortController();
      interrupted = true;
      view.setIsSearching(false);
      return install.signal;
    },
    endInstall(installSignal: AbortSignal): boolean {
      if (install?.signal !== installSignal) return false;
      install = null;
      if (query === '') clear();
      else if (debounce === null) settle();
      return true;
    },
  };
}

export function ThemeSearchSection({
  signal,
  onInstalled,
}: {
  signal: AbortSignal;
  onInstalled: (themes: ReadonlyArray<ThemeDefinition>, context: { updated: boolean }) => void;
}) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<OpenVsxThemeSort>('downloadCount');
  const [results, setResults] = useState<ReadonlyArray<OpenVsxThemeExtension> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<OpenVsxThemeExtension | null>(null);
  const [themeSearch] = useState(() => createThemeSearch({ setResults, setError, setIsSearching }, signal));

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    themeSearch.setQuery(nextQuery);
  };

  const handleSortChange = (value: OpenVsxThemeSort | null) => {
    const nextSort = SORT_OPTIONS.find((option) => option.value === value)?.value;
    if (!nextSort) return;
    setSortBy(nextSort);
    themeSearch.setSortBy(nextSort);
  };

  const handleInstall = async (extension: OpenVsxThemeExtension, allowUpdate: boolean) => {
    setError(null);
    let installedCollection: ReadonlyArray<ThemeDefinition>;
    try {
      installedCollection = getStoredCustomThemeCollection(extension.collectionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Installed themes could not be read.');
      return;
    }
    const updated = installedCollection.length > 0;
    if (updated && !allowUpdate) {
      setPendingUpdate(extension);
      return;
    }

    const installSignal = themeSearch.beginInstall();
    setInstallingId(extension.id);
    try {
      const themes = await importOpenVsxThemeExtension(extension, installSignal);
      if (!installSignal.aborted) {
        const imported = replaceCustomThemeCollection(extension.collectionId, themes, {
          expectedCollection: installedCollection,
        });
        onInstalled(imported, { updated });
      }
    } catch (cause) {
      if (!installSignal.aborted) {
        setError(cause instanceof Error ? cause.message : 'That theme could not be added.');
      }
    }
    if (themeSearch.endInstall(installSignal)) setInstallingId(null);
  };

  return (
    <section className="space-y-3" aria-labelledby="theme-search-heading">
      <div>
        <h3 className="text-sm font-medium" id="theme-search-heading">
          Search community themes
        </h3>
        <p className="mt-0.5 text-muted-foreground text-xs">Find open-source themes from Open VSX.</p>
      </div>
      <InputGroup>
        <InputGroupAddon>{isSearching ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}</InputGroupAddon>
        <InputGroupInput
          aria-label="Search Open VSX themes"
          autoFocus
          onChange={(event) => changeQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' && !isSearching && installingId === null) themeSearch.searchNow();
          }}
          placeholder="Search themes..."
          size="lg"
          type="search"
          value={query}
        />
      </InputGroup>

      {!isSearching || results !== null ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="text-muted-foreground text-xs">Popular</p>
            {SUGGESTED_SEARCHES.map((suggestion) => (
              <Button
                key={suggestion}
                disabled={installingId !== null}
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (query.trim() === suggestion) {
                    themeSearch.searchNow();
                  } else {
                    changeQuery(suggestion);
                  }
                }}
              >
                {suggestion}
              </Button>
            ))}
          </div>
          {results && results.length > 0 ? (
            <div className="flex shrink-0 items-center justify-end gap-2">
              <p className="text-muted-foreground text-xs">Sort</p>
              <Select disabled={installingId !== null} value={sortBy} onValueChange={handleSortChange}>
                <SelectTrigger size="sm" className="w-40" aria-label="Sort themes">
                  <SelectValue>{SORT_OPTIONS.find((option) => option.value === sortBy)?.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sr-only" role="status">
        {isSearching
          ? 'Searching themes...'
          : results
            ? `${results.length} supported ${results.length === 1 ? 'theme' : 'themes'} found.`
            : ''}
      </div>

      {error ? (
        <Alert variant="error" role="status" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isSearching && results === null ? (
        <div className="flex min-h-20 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Spinner /> Searching themes...
        </div>
      ) : null}

      {results ? (
        results.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
            <p className="text-sm font-medium">No supported open-source themes found</p>
            <p className="mt-1 text-muted-foreground text-xs">Try a broader search.</p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {results.map((extension) => {
              const isInstalling = installingId === extension.id;
              const isInstalled = getCustomThemes().some((theme) => theme.collection?.id === extension.collectionId);
              const action = isInstalled ? 'Update' : 'Install';
              const progressAction = isInstalled ? 'Updating' : 'Installing';
              return (
                <article
                  className="group flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-3 transition-colors hover:bg-accent/20"
                  key={extension.id}
                >
                  <div className="flex min-w-0 gap-3">
                    <ThemeExtensionIcon key={extension.iconUrl} extension={extension} />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-medium">{extension.name}</h4>
                      <p className="truncate text-muted-foreground text-xs">
                        {extension.publisher} · {DOWNLOAD_FORMAT.format(extension.downloadCount)} downloads
                      </p>
                    </div>
                  </div>
                  <p className="line-clamp-2 min-h-8 text-muted-foreground text-xs leading-4">
                    {extension.description || 'A community color theme for your editor.'}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {extension.sourceUrl ? (
                        <Button
                          aria-label={`View source for ${extension.name}`}
                          render={<a href={extension.sourceUrl} rel="noreferrer" target="_blank" />}
                          size="icon-micro"
                          variant="ghost-muted"
                        >
                          {sourceLinkIcon(extension.sourceUrl)}
                        </Button>
                      ) : null}
                    </div>
                    <Button
                      aria-label={`${isInstalling ? progressAction : action} ${extension.name}`}
                      disabled={installingId !== null}
                      size="xs"
                      variant="outline"
                      onClick={() => void handleInstall(extension, false)}
                    >
                      {isInstalling ? <Spinner /> : isInstalled ? <RefreshIcon /> : <PackagePlusIcon />}
                      {isInstalling ? `${progressAction}...` : action}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : null}

      <AlertDialog
        open={pendingUpdate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingUpdate(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Update “{pendingUpdate?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces its installed variants, including any local edits. Variants no longer in the extension will
              be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                const extension = pendingUpdate;
                setPendingUpdate(null);
                if (extension) void handleInstall(extension, true);
              }}
            >
              Update theme
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}
