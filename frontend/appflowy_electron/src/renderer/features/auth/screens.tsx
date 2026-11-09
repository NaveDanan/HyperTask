import { useEffect, useState } from 'react';
import { UserEventGetAnonUser, UserEventOpenAnonUser, UserEventSignOut } from '@/backend/events';
import { FlowySvg } from '@/icons/FlowySvg';
import { HyperLogo } from '@/ui/HyperLogo';
import { languageName, supportedLocales, useI18nStore, useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { openWorkspaceOrHandleError, runAppFlowy, signUpAsGuest } from '@/startup/launcher';
import { appearanceActions } from '@/theme/appearance-store';
import { AppFlowyPopover, FlowyButton, FlowyText, Spinner, VSpace } from '@/ui';
import { WindowTitleBar } from '@/ui/WindowTitleBar';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';

/** SplashScreen: the launch image with a spinner. */
export function SplashScreen() {
  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <WindowTitleBar style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1, background: 'transparent' }} />
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', justifyContent: 'center', background: 'var(--cs-surface)' }}>
        <HyperLogo size={48} wordmark />
        <Spinner />
      </div>
    </div>
  );
}

/** Shown while the core initializes: the router background, blank. */
export function LaunchingScreen() {
  return <div style={{ height: '100%', background: 'var(--cs-surface)' }} />;
}

/** FlowyLogoTitle with a 40px logo (SkipLogInScreen). */
function LogoTitle({ title, size }: { title: string; size: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <HyperLogo size={size} />
      <VSpace size={20} />
      <div style={{ fontSize: 'calc(20px * var(--text-scale, 1))', lineHeight: '28px', fontWeight: 600, color: 'var(--af-text-primary)' }}>
        {title}
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
      if ((await UserEventOpenAnonUser()).ok) await runAppFlowy();
    } else if (customized) {
      await runAppFlowy({ isAnon: true });
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cs-surface)' }}>
      <WindowTitleBar style={{ height: 55, background: 'transparent' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ flex: 1 }} />
        <LogoTitle title={tr('welcomeText')} size={40} />
        <VSpace size={32} />
        <FlowyButton
          isSelected
          radius={6}
          onTap={() => void go()}
          style={{ width: 340, height: 48, justifyContent: 'center' }}
          text={
            <FlowyText fontWeight={500} textAlign="center" style={{ width: '100%' }}>
              {anonExists ? tr('signIn.continueAnonymousUser') : tr('letsGoButtonText')}
            </FlowyText>
          }
        />
        <VSpace size={32} />
        <div
          style={{
            width: '70%',
            padding: 16,
            borderRadius: 4,
            background: 'var(--cs-surface)',
            boxShadow: '0 2px 1px -1px #00000033, 0 1px 1px #00000024, 0 1px 3px #0000001F',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <FlowySvg svg="archive_m" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <FlowyText fontWeight={500} ellipsis>
              {tr('settings.files.defineWhereYourDataIsStored')}
            </FlowyText>
            <VSpace size={4} />
            <FlowyText fontSize={12} fontWeight={400} ellipsis style={{ opacity: 0.8 }}>
              {path}
            </FlowyText>
          </div>
          <div
            onClick={() => void pickFolder()}
            style={{
              minWidth: 100,
              height: 30,
              borderRadius: 6,
              border: '1.5px solid var(--cs-primary)',
              color: 'var(--cs-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {tr('settings.files.set')}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <SkipLoginFooter />
        <VSpace size={20} />
      </div>
    </div>
  );
}

function SkipLoginFooter() {
  const { tr } = useTr();
  const locale = useI18nStore((s) => s.locale);
  const link = (text: string, url: string) => (
    <span
      onClick={() => void window.appflowy.shell.openExternal(url).catch(() => {})}
      style={{ color: 'var(--cs-primary)', fontWeight: 500, padding: '0 4px', cursor: 'pointer', fontSize: 'calc(12px * var(--text-scale, 1))' }}
    >
      {text}
    </span>
  );
  const small = { fontSize: 'calc(12px * var(--text-scale, 1))' };
  return (
    <div style={{ width: '100%', padding: '0 16px', display: 'flex', alignItems: 'center' }}>
      <div style={{ width: 180 }} />
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
        <span style={small}>{tr('youCanAlso')}</span>
        {link(tr('githubStarText'), 'https://github.com/NaveDanan/HyperTask')}
      </div>
      <div style={{ width: 180, display: 'flex', justifyContent: 'flex-end' }}>
        <AppFlowyPopover
          direction="topWithRightAligned"
          constraints={{ maxHeight: 400, maxWidth: 240 }}
          popup={(close) => (
            <div style={{ overflowY: 'auto' }}>
              {supportedLocales.map((value) => (
                <FlowyButton
                  key={value}
                  height={32}
                  text={<FlowyText fontWeight={500}>{languageName(value)}</FlowyText>}
                  rightIcon={value === locale ? <FlowySvg svg="check_s" /> : undefined}
                  onTap={() => {
                    void appearanceActions.setLocale(value);
                    close();
                  }}
                />
              ))}
            </div>
          )}
        >
          <FlowyButton
            useIntrinsicWidth
            leftIcon={<FlowySvg svg="ethernet_m" size={20} />}
            leftIconSize={20}
            iconPadding={4}
            text={languageName(locale)}
            rightIcon={<FlowySvg svg="drop_menu_hide_m" size={20} />}
          />
        </AppFlowyPopover>
      </div>
    </div>
  );
}

/** WorkspaceErrorScreen: shows the open-workspace error with a log-out button. */
export function WorkspaceErrorScreen({ error }: { error: FlowyError }) {
  const { tr } = useTr();
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cs-surface)' }}>
      <WindowTitleBar style={{ background: 'transparent' }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 500, display: 'flex', flexDirection: 'column' }}>
          <FlowyText fontWeight={500} maxLines={10}>
            {error.msg}
          </FlowyText>
          <FlowyText fontWeight={500} fontSize={12}>
            {`Error code: ${error.code}`}
          </FlowyText>
          <VSpace size={50} />
          <FlowyButton
            style={{ width: 200, height: 40, justifyContent: 'center' }}
            text={
              <FlowyText fontWeight={500} textAlign="center" style={{ width: '100%' }}>
                {tr('settings.menu.logout')}
              </FlowyText>
            }
            onTap={async () => {
              await UserEventSignOut();
              await runAppFlowy();
            }}
          />
          <VSpace size={20} />
        </div>
      </div>
    </div>
  );
}

/** WorkspaceFailedScreen (home/errors/workspace_failed_screen.dart). */
export function WorkspaceFailedScreen() {
  const { tr } = useTr();
  const version = useAppStore((s) => s.info?.version ?? '');
  const button = (text: string, url: string) => (
    <div
      onClick={() => void window.appflowy.shell.openExternal(url).catch(() => {})}
      style={{
        flex: 1,
        height: 40,
        borderRadius: 6,
        background: 'var(--cs-primary)',
        color: 'var(--cs-on-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontWeight: 500,
      }}
    >
      {text}
    </div>
  );
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cs-surface)' }}>
      <WindowTitleBar style={{ background: 'transparent' }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div>{tr('workspace.failedToLoad')}</div>
          <VSpace size={20} />
          <div style={{ display: 'flex', gap: 20, width: '100%' }}>
            {button(
              tr('workspace.errorActions.reportIssue'),
              `https://github.com/NaveDanan/HyperTask/issues/new?title=[Bug]%20Workspace%20failed%20to%20load&version=${version}&os=windows`,
            )}
            {button(tr('workspace.errorActions.reachOut'), 'https://discord.gg/JucBXeU2FE')}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Startup failure (the Flutter app aborts launch on these errors). */
export function FatalScreen({ message }: { message: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cs-surface)' }}>
      <WindowTitleBar style={{ background: 'transparent' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <FlowyText fontWeight={500} maxLines={6}>
          {message}
        </FlowyText>
        <FlowyButton useIntrinsicWidth text="Restart" onTap={() => void runAppFlowy()} />
      </div>
    </div>
  );
}

