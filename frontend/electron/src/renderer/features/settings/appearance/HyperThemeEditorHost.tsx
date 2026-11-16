// Ported from t3code (apps/web/src/components/settings/ThemeEditorHost.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// Differences from t3code: theme lookups re-run when the custom library in appearance-store changes (useCustomThemes)
// instead of subscribing to localStorage, and the save-failure toast is HyperTask's showToast.

import { lazy, Suspense } from 'react';
import { getThemeDefinition, type ThemeAppearance, type ThemeDefinition } from '@/theme/HyperThemeLibrary';
import { showToast } from '@/ui';
import { useThemeEditorStore } from './themeEditorStore';
import { useCustomThemes, useTheme } from './useHyperTheme';

const ThemeEditorPanel = lazy(() =>
  import('./HyperThemeEditorPanel').then((module) => ({ default: module.ThemeEditorPanel })),
);

function useThemeDefinition(id: string | null | undefined) {
  // getThemeDefinition reads the library useCustomThemes subscribes to.
  useCustomThemes();
  return id ? (getThemeDefinition(id) ?? null) : null;
}

function showSaveFailedToast() {
  showToast({
    type: 'error',
    message: (
      <>
        <div className="font-medium">Could not save your theme</div>
        <div>Browser storage is unavailable, so the change was not kept.</div>
      </>
    ),
  });
}

export function ThemeEditorHost() {
  const session = useThemeEditorStore((store) => store.session);
  const closeThemeEditor = useThemeEditorStore((store) => store.closeThemeEditor);
  const { theme, setTheme, themeHalves, refreshTheme } = useTheme();
  const editingTheme = useThemeDefinition(session?.editingThemeId);
  const seedTheme = useThemeDefinition(session?.seedThemeId);

  const handleSaved = (
    savedTheme: ThemeDefinition,
    { created, mergedAppearance }: { created: boolean; mergedAppearance?: ThemeAppearance },
  ) => {
    if (mergedAppearance) {
      if (!setTheme(savedTheme.id)) {
        showSaveFailedToast();
        return false;
      }
      return true;
    }
    if (!created) {
      // Reapply the palette without setTheme, which would clear a mix containing the edited theme.
      const wasActive =
        getThemeDefinition(theme)?.id === savedTheme.id ||
        themeHalves?.light === savedTheme.id ||
        themeHalves?.dark === savedTheme.id;
      if (wasActive) refreshTheme();
      return true;
    }

    if (!setTheme(savedTheme.id)) {
      showSaveFailedToast();
      return false;
    }
    return true;
  };

  if (!session) return null;

  return (
    <Suspense fallback={null}>
      <ThemeEditorPanel
        editingTheme={editingTheme}
        initialAppearance={session.initialAppearance}
        key={session.id}
        onOpenChange={(open) => {
          if (!open) closeThemeEditor();
        }}
        onSaved={handleSaved}
        open
        restoreTheme={refreshTheme}
        seedName={session.seedName ?? undefined}
        seedTheme={seedTheme}
      />
    </Suspense>
  );
}
