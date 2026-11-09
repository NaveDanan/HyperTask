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
import { runAppFlowy } from '@/startup/launcher';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DialogHost } from '@/ui/Dialog';
import { ToastHost } from '@/ui/toast';

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

  useEffect(() => {
    if (!started) {
      started = true;
      void runAppFlowy();
    }
    // The core process restarts after a crash; the app restarts with it.
    return window.appflowy.core.onExit(() => void runAppFlowy());
  }, []);

  return (
    <TooltipProvider delay={500}>
      <div key={launchId} className="h-full">
        <Routes />
        <DialogHost />
        <ToastHost />
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
