import { useEffect, useState } from 'react';
import { ChevronDown, FolderOpen, Globe, TriangleAlert } from 'lucide-react';
import { UserEventGetAnonUser, UserEventOpenAnonUser, UserEventSignOut } from '@/backend/events';
import { MenuRow } from '@/components/app/menu-row';
import { TitleBar } from '@/components/app/window-controls';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { HyperLogo } from '@/ui/HyperLogo';
import { languageName, supportedLocales, useI18nStore, useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { openWorkspaceOrHandleError, runHyperTask, signUpAsGuest } from '@/startup/HyperLauncher';
import { appearanceActions } from '@/theme/appearance-store';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';

const hyperAuthScreenClass =
  'flex h-full flex-col bg-background bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklch,var(--muted)_100%,transparent),transparent)]';
const hyperAuthColumnClass = 'mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6';

/** SplashScreen: the launch image. */
export function SplashScreen() {
  return (
    <div className={hyperAuthScreenClass}>
      <TitleBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <HyperLogo size={48} wordmark className="[&>span:last-child]:text-lg" />
      </div>
    </div>
  );
}

/** Shown while the core initializes. */
export function LaunchingScreen() {
  return (
    <div className={hyperAuthScreenClass}>
      <TitleBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <HyperLogo size={48} wordmark className="[&>span:last-child]:text-lg" />
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    </div>
  );
}

/** SkipLogInScreen: the local fallback when the guest account could not be created. */
export function SkipLogInScreen() {
  const { tr } = useTr();
  const dataDirectory = useAppStore((s) => s.dataDirectory);
  const [anonExists, setAnonExists] = useState(false);
  const [customized, setCustomized] = useState(false);
  const [path, setPath] = useState(dataDirectory);

  useEffect(() => {
    void UserEventGetAnonUser().then((r) => setAnonExists(r.ok));
  }, []);

  const go = async () => {
    if (anonExists) {
      if ((await UserEventOpenAnonUser()).ok) await runHyperTask();
    } else if (customized) {
      await runHyperTask({ isAnon: true });
    } else {
      const result = await signUpAsGuest();
      if (result.ok) await openWorkspaceOrHandleError();
      else console.error(result.error.msg);
    }
  };

  const pickFolder = async () => {
    const picked = await window.appflowy.dialog.pickDirectory();
    if (!picked) return;
    const sep = picked.includes('\\') ? '\\' : '/';
    const base = picked.replace(/[\\/]+$/, '');
    const target = base.endsWith('AppFlowyDataDoNotRename') ? base : `${base}${sep}AppFlowyDataDoNotRename`;
    await window.appflowy.fs.ensureDir(target);
    await KeyValueStorage.set(KVKeys.pathLocation, target);
    setPath(target);
    setCustomized(true);
  };

  return (
    <div className={hyperAuthScreenClass}>
      <TitleBar />
      <div className={hyperAuthColumnClass}>
        <div className="flex flex-col items-center gap-3">
          <HyperLogo size={40} />
          <h1 className="text-center text-2xl font-semibold tracking-tight">{tr('welcomeText')}</h1>
        </div>
        <Button size="lg" className="h-10 w-full" onClick={() => void go()}>
          {anonExists ? tr('signIn.continueAnonymousUser') : tr('letsGoButtonText')}
        </Button>
        <Item variant="outline" className="flex-nowrap">
          <ItemMedia variant="icon" className="text-muted-foreground"><FolderOpen className="size-4" /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>{tr('settings.files.defineWhereYourDataIsStored')}</ItemTitle>
            <ItemDescription className="truncate font-mono text-xs" title={path}>{path}</ItemDescription>
          </ItemContent>
          <ItemActions><Button variant="outline" size="sm" onClick={() => void pickFolder()}>{tr('settings.files.set')}</Button></ItemActions>
        </Item>
      </div>
      <SkipLoginFooter />
    </div>
  );
}

function SkipLoginFooter() {
  const { tr } = useTr();
  const locale = useI18nStore((s) => s.locale);
  const [open, setOpen] = useState(false);
  const link = (text: string, url: string) => (
    <button type="button" onClick={() => void window.appflowy.shell.openExternal(url).catch(() => {})} className="px-1 font-medium text-foreground underline-offset-4 hover:underline">
      {text}
    </button>
  );
  return (
    <footer className="flex shrink-0 items-center justify-between px-4 py-3 text-xs text-muted-foreground">
      <div className="w-44 shrink-0" />
      <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
        <span>{tr('youCanAlso')}</span>
        {link(tr('githubStarText'), 'https://github.com/NaveDanan/HyperTask')}
      </div>
      <div className="flex w-44 shrink-0 justify-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
            <Globe className="size-4" />{languageName(locale)}<ChevronDown className="size-4" />
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="max-h-100 w-60 overflow-y-auto p-1">
            {supportedLocales.map((value) => (
              <MenuRow key={value} label={languageName(value)} checked={value === locale} className="h-8" onClick={() => {
                void appearanceActions.setLocale(value);
                setOpen(false);
              }} />
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </footer>
  );
}

/** WorkspaceErrorScreen: shows the open-workspace error with a log-out button. */
export function WorkspaceErrorScreen({ error }: { error: FlowyError }) {
  const { tr } = useTr();
  return (
    <div className={hyperAuthScreenClass}>
      <TitleBar />
      <div className={hyperAuthColumnClass}>
        <Empty className="flex-none p-0">
          <EmptyHeader className="w-full">
            <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive"><TriangleAlert className="size-5" /></EmptyMedia>
            <EmptyTitle className="w-full rounded-md bg-muted p-3 text-left font-mono text-xs font-normal break-words">{error.msg}</EmptyTitle>
            <EmptyDescription className="w-full rounded-md bg-muted p-3 text-left font-mono text-xs">{`Error code: ${error.code}`}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" className="h-10 w-full" onClick={async () => {
              await UserEventSignOut();
              await runHyperTask();
            }}>{tr('settings.menu.logout')}</Button>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  );
}

/** WorkspaceFailedScreen (home/errors/workspace_failed_screen.dart). */
export function WorkspaceFailedScreen() {
  const { tr } = useTr();
  const version = useAppStore((s) => s.info?.version ?? '');
  const button = (text: string, url: string) => (
    <Button size="lg" className="h-10 w-full" onClick={() => void window.appflowy.shell.openExternal(url).catch(() => {})}>{text}</Button>
  );
  return (
    <div className={hyperAuthScreenClass}>
      <TitleBar />
      <div className={hyperAuthColumnClass}>
        <Empty className="flex-none p-0">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive"><TriangleAlert className="size-5" /></EmptyMedia>
            <EmptyTitle className="text-2xl font-semibold tracking-tight">{tr('workspace.failedToLoad')}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            {button(
              tr('workspace.errorActions.reportIssue'),
              `https://github.com/NaveDanan/HyperTask/issues/new?title=[Bug]%20Workspace%20failed%20to%20load&version=${version}&os=windows`,
            )}
            {button(tr('workspace.errorActions.reachOut'), 'https://discord.gg/JucBXeU2FE')}
          </EmptyContent>
        </Empty>
      </div>
    </div>
  );
}

/** Startup failure (the Flutter app aborts launch on these errors). */
export function FatalScreen({ message }: { message: string }) {
  return (
    <div className={hyperAuthScreenClass}>
      <TitleBar />
      <div className={hyperAuthColumnClass}>
        <Empty className="flex-none p-0">
          <EmptyHeader className="w-full">
            <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive"><TriangleAlert className="size-5" /></EmptyMedia>
            <EmptyTitle className="w-full rounded-md bg-muted p-3 text-left font-mono text-xs font-normal break-words">{message}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent><Button size="lg" className="h-10 w-full" onClick={() => void runHyperTask()}>Restart</Button></EmptyContent>
        </Empty>
      </div>
    </div>
  );
}
