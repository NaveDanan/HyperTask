import { useEffect } from 'react';
import { SignInScreen } from '@/features/auth/SignInScreen';
import {
  FatalScreen,
  LaunchingScreen,
  SkipLogInScreen,
  SplashScreen,
  WorkspaceErrorScreen,
} from '@/features/auth/screens';
import { DesktopHomeScreen } from '@/features/home/DesktopHomeScreen';
import { useAppStore } from '@/startup/app-store';
import { runHypertask } from '@/startup/launcher';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DialogHost } from '@/ui/Dialog';
import { ToastHost } from '@/ui/toast';
import { ThemeEditorHost } from '@/features/settings/appearance/HyperThemeEditorHost';

function Routes() {
  const route = useAppStore((s) => s.route);
  switch (route.name) {
    case 'launching':
      return <LaunchingScreen />;
    case 'splash':
      return <SplashScreen />;
    case 'signIn':
      return <SignInScreen />;
    case 'skipLogin':
      return <SkipLogInScreen />;
    case 'home':
      return <DesktopHomeScreen />;
    case 'workspaceError':
      return <WorkspaceErrorScreen error={route.error} />;
    case 'fatal':
      return <FatalScreen message={route.message} />;
  }
}

let started = false;

/** ApplicationWidget: the routed screens plus the dialog and toast overlays. */
export function App() {
  const launchId = useAppStore((s) => s.launchId);
  const developmentJwt = useAppStore((s) => s.info?.developmentJwt);

  useEffect(() => {
    if (!started) {
      started = true;
      void runHypertask();
    }
    // The core process restarts after a crash; the app restarts with it.
    return window.hypertask.core.onExit(() => void runHypertask());
  }, []);

  return (
    <TooltipProvider delay={500}>
      <div key={launchId} className="h-full">
        <Routes />
        <DialogHost />
        {/* The Appearance theme editor (ported from t3code), above the settings dialog as at t3code's root. */}
        <ThemeEditorHost />
        <ToastHost />
      </div>
      {developmentJwt && <div role="status" className="pointer-events-none fixed left-1/2 top-1 z-[2000] -translate-x-1/2 rounded bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground">DEV JWT · identity is not verified</div>}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
