import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { PublishInfoViewPB } from '@shared/protobuf/flowy-folder/publish_pb';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { AFRolePB, WorkspacePlanPB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FolderEventGetView } from '@/backend/events';
import { FlowySvg } from '@/icons/FlowySvg';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { tr as trNow, useI18nStore, useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { useBrightness } from '@/theme/appearance-store';
import {
  AppFlowyPopover,
  FlowyButton,
  FlowyDivider,
  FlowyHover,
  FlowyText,
  HSpace,
  MaterialDialog,
  Spinner,
  Tooltip,
  VSpace,
  showDialog,
  showToast,
  usePopoverContainer,
} from '@/ui';
import { layoutIcon } from '../../tabs/plugin';
import { tabsActions } from '../../tabs/tabs-store';
import type { SettingsPageProps } from '../page-props';
import { OutlinedRoundedButton, SettingsBody } from '../shared';
import { formatMonthDayYear } from './members-core';
import { buildNamespaceUrl, buildPublishUrl, namespaceErrorKey, publishNameErrorKey } from './sites-core';
import { createSettingsSitesStore, type SettingsSitesStore } from './sites-store';

// SettingsSitesPage (workspace/presentation/settings/pages/sites/**).

const THREE_DOTS_WIDTH = 26;
const ALIGN_PADDING = 6;

const baseWebDomain = () => useAppStore.getState().env?.appflowyCloudConfig.base_web_domain ?? '';
const openUrl = (url: string) => void window.appflowy.shell.openExternal(url).catch(() => {});
const viewIdOf = (view: PublishInfoViewPB) => view.info?.viewId ?? '';

/** SettingsPageSitesEvent.visitSite / copySiteLink. */
function visitSite(view: PublishInfoViewPB, nameSpace?: string) {
  openUrl(buildPublishUrl(baseWebDomain(), nameSpace ?? namespaceOf(view), view.info?.publishName ?? ''));
}
function copySiteLink(view: PublishInfoViewPB, nameSpace?: string) {
  window.appflowy.clipboard.writeText(buildPublishUrl(baseWebDomain(), nameSpace ?? namespaceOf(view), view.info?.publishName ?? ''));
  showToast({ message: trNow('message.copy.success') });
}
const namespaceOf = (view: PublishInfoViewPB) => (view.info?.oneOfNamespace.case === 'namespace' ? view.info.oneOfNamespace.value : '');

/** showToastNotification(message, description). */
function toastWithDescription(type: 'success' | 'error', message: string, description?: string | null) {
  showToast({
    type,
    message: (
      <>
        {message}
        {description && <div style={{ opacity: 0.7, fontSize: 'calc(12px * var(--text-scale, 1))' }}>{description}</div>}
      </>
    ),
  });
}

export function SitesPage({ workspace, role, closeDialog }: SettingsPageProps) {
  const { tr } = useTr();
  const workspaceId = workspace?.workspaceId ?? '';
  const [bloc] = useState<SettingsSitesStore>(() => createSettingsSitesStore(workspaceId));
  const state = useStore(bloc.store);
  const isOwner = role === AFRolePB.Owner;

  useEffect(() => {
    void bloc.actions.initial();
    return () => bloc.actions.close();
  }, [bloc]);

  return (
    <SettingsBody title={tr('settings.sites.title')} autoSeparate={false}>
      <SitesCategory title={tr('settings.sites.namespaceHeader')} description={tr('settings.sites.namespaceDescription')}>
        <FlowyDivider />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <DomainHeader />
          <FlowyDivider margin="12px 0" />
          <div style={{ minHeight: 36, display: 'flex', alignItems: 'center', transform: `translateX(-${ALIGN_PADDING}px)` }}>
            <DomainItem bloc={bloc} namespace={state.namespace} isOwner={isOwner} />
          </div>
        </div>
      </SitesCategory>
      <VSpace size={36} />
      <SitesCategory title={tr('settings.sites.publishedPage.title')} description={tr('settings.sites.publishedPage.description')}>
        <FlowyDivider />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <PublishViewItemHeader />
          {state.isLoading ? (
            <>
              <FlowyDivider margin="12px 0" />
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Spinner size={24} stroke={3} />
              </div>
            </>
          ) : state.publishedViews.length === 0 ? (
            <>
              <FlowyDivider margin="12px 0" />
              <FlowyText color="var(--th-hint)">{tr('settings.sites.publishedPage.emptyHinText')}</FlowyText>
            </>
          ) : (
            state.publishedViews.map((view) => (
              <div key={viewIdOf(view)}>
                <FlowyDivider margin="12px 0" />
                <div style={{ transform: `translateX(-${ALIGN_PADDING}px)` }}>
                  <PublishedViewItem bloc={bloc} view={view} closeDialog={closeDialog} />
                </div>
              </div>
            ))
          )}
        </div>
      </SitesCategory>
    </SettingsBody>
  );
}

/** SettingsCategory with descriptionColor: hintColor. */
function SitesCategory({ title, description, children }: { title: string; description: string; children: ReactNode[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          fontSize: 'calc(16px * var(--text-scale, 1))',
          lineHeight: '22px',
          fontWeight: 600,
          color: 'var(--af-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
      <VSpace size={16} />
      <FlowyText fontSize={12} maxLines={4} ellipsis color="var(--th-hint)">
        {description}
      </FlowyText>
      <VSpace size={8} />
      {children.map((child, index) => (
        <div key={index} style={{ marginTop: index > 0 ? 16 : 0 }}>
          {child}
        </div>
      ))}
    </div>
  );
}

function HeaderCell({ children, flex = 1 }: { children: string; flex?: number }) {
  return (
    <div style={{ flex, minWidth: 0 }}>
      <FlowyText fontWeight={500} textAlign="left">
        {children}
      </FlowyText>
    </div>
  );
}

function DomainHeader() {
  const { tr } = useTr();
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <HeaderCell>{tr('settings.sites.namespaceHeader')}</HeaderCell>
      <HeaderCell>{tr('settings.sites.homepageHeader')}</HeaderCell>
      <HSpace size={THREE_DOTS_WIDTH} />
    </div>
  );
}

function PublishViewItemHeader() {
  const { tr } = useTr();
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <HeaderCell>{tr('settings.sites.publishedPage.page')}</HeaderCell>
      <HeaderCell>{tr('settings.sites.publishedPage.pathName')}</HeaderCell>
      <HeaderCell>{tr('settings.sites.publishedPage.date')}</HeaderCell>
      <HSpace size={THREE_DOTS_WIDTH} />
    </div>
  );
}

function DomainItem({ bloc, namespace, isOwner }: { bloc: SettingsSitesStore; namespace: string; isOwner: boolean }) {
  const { tr } = useTr();
  const namespaceUrl = buildNamespaceUrl(baseWebDomain(), namespace);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 12, display: 'flex' }}>
        <Tooltip message={`${tr('shareAction.visitSite')}\n${namespaceUrl}`}>
          <FlowyButton
            useIntrinsicWidth
            style={{ maxWidth: '100%' }}
            text={<FlowyText ellipsis>{namespaceUrl}</FlowyText>}
            onTap={() => openUrl(buildNamespaceUrl(baseWebDomain(), namespace, true))}
          />
        </Tooltip>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <Homepage bloc={bloc} isOwner={isOwner} />
      </div>
      <DomainMoreAction bloc={bloc} namespace={namespace} isOwner={isOwner} />
    </div>
  );
}

function Homepage({ bloc, isOwner }: { bloc: SettingsSitesStore; isOwner: boolean }) {
  const plan = useStore(bloc.store, (s) => s.subscriptionInfo?.plan);
  if (plan === undefined) return null;
  if (plan === WorkspacePlanPB.FreePlan) {
    return (
      <div style={{ paddingLeft: ALIGN_PADDING, display: 'flex' }}>
        <FreePlanUpgradeButton bloc={bloc} isOwner={isOwner} />
      </div>
    );
  }
  return <HomePageButton bloc={bloc} isOwner={isOwner} />;
}

function HomePageButton({ bloc, isOwner }: { bloc: SettingsSitesStore; isOwner: boolean }) {
  const { tr } = useTr();
  const { isLoading, homePageView } = useStore(bloc.store);
  if (isLoading) return null;

  let child: ReactNode =
    homePageView === null ? (
      <FlowyButton
        useIntrinsicWidth
        leftIcon={<FlowySvg svg="search_s" size={14} />}
        leftIconSize={14}
        text={<FlowyText lineHeight={18}>{tr('settings.sites.selectHomePage')}</FlowyText>}
      />
    ) : (
      <PublishInfoViewItem view={homePageView} margin={isOwner ? undefined : 0} />
    );

  if (isOwner) {
    child = (
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <div style={{ minWidth: 0, display: 'flex' }}>
          <AppFlowyPopover
            direction="bottomWithCenterAligned"
            constraints={{ maxWidth: 260, maxHeight: 345 }}
            margin="12px 14px"
            popup={() => <SelectHomePageMenu bloc={bloc} />}
          >
            {child}
          </AppFlowyPopover>
        </div>
        {homePageView !== null && (
          <Tooltip message={tr('settings.sites.clearHomePage')}>
            <FlowyButton
              margin={4}
              useIntrinsicWidth
              text={<FlowySvg svg="close_m" size={19} />}
              onTap={() => void bloc.actions.removeHomePage()}
            />
          </Tooltip>
        )}
      </div>
    );
  } else {
    child = (
      <Tooltip message={tr('settings.sites.namespace.onlyWorkspaceOwnerCanSetHomePage')}>
        <div style={{ pointerEvents: 'none', display: 'flex', minWidth: 0 }}>{child}</div>
      </Tooltip>
    );
  }
  return <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>{child}</div>;
}

function FreePlanUpgradeButton({ bloc, isOwner }: { bloc: SettingsSitesStore; isOwner: boolean }) {
  const { tr } = useTr();
  const light = useBrightness() === 'light';
  const proPrimary = light ? '#653E8C' : '#E8E2EE';
  const proSecondary = light ? '#E8E2EE' : '#653E8C';
  return (
    <Tooltip message={tr('settings.sites.homePage.upgradeToPro')}>
      <PrimaryRoundedButton
        text="Pro ↗"
        fontSize={12}
        lineHeight={16}
        fontWeight={600}
        radius={8}
        textColor={proPrimary}
        backgroundColor={proSecondary}
        hoverColor={`color-mix(in srgb, ${proSecondary} 90%, transparent)`}
        margin="6px 8px"
        onTap={() => {
          if (isOwner) {
            showToast({ type: 'error', message: tr('settings.sites.namespace.redirectToPayment') });
            void bloc.actions.upgradeSubscription();
          } else {
            showToast({ type: 'error', message: tr('settings.sites.namespace.pleaseAskOwnerToSetHomePage') });
          }
        }}
      />
    </Tooltip>
  );
}

/** PrimaryRoundedButton (flowy_infra_ui style_widget/primary_rounded_button.dart). */
function PrimaryRoundedButton({
  text,
  onTap,
  fontSize = 14,
  fontWeight = 500,
  lineHeight,
  radius = 10,
  margin = '0 14px',
  textColor = 'var(--cs-on-primary)',
  backgroundColor = 'var(--cs-primary)',
  hoverColor = 'color-mix(in srgb, var(--cs-primary) 90%, transparent)',
}: {
  text: string;
  onTap?: () => void;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600;
  lineHeight?: number;
  radius?: number;
  margin?: CSSProperties['padding'];
  textColor?: string;
  backgroundColor?: string;
  hoverColor?: string;
}) {
  return (
    <FlowyHover
      backgroundColor={backgroundColor}
      hoverColor={hoverColor}
      borderRadius={radius}
      onClick={onTap}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: margin }}
    >
      <FlowyText fontSize={fontSize} fontWeight={fontWeight} lineHeight={lineHeight} color={textColor} textAlign="center" ellipsis>
        {text}
      </FlowyText>
    </FlowyHover>
  );
}

/** PublishInfoViewItem: the page icon and name (FlowyButton, tooltip with the name). */
function PublishInfoViewItem({
  view,
  onTap,
  useIntrinsicWidth = true,
  margin,
  extraTooltipMessage,
}: {
  view: PublishInfoViewPB;
  onTap?: () => void;
  useIntrinsicWidth?: boolean;
  margin?: CSSProperties['padding'];
  extraTooltipMessage?: string;
}) {
  const { tr } = useTr();
  const name = view.view?.name || tr('menuAppHeader.defaultNewPageName');
  const tooltip = extraTooltipMessage !== undefined ? `${extraTooltipMessage}\n${name}` : name;
  const icon = view.view?.oneOfIcon.case === 'icon' ? view.view.oneOfIcon.value : null;
  // Emoji icons render as text; icon-picker icons fall back to the layout icon (simplification).
  const leftIcon =
    icon && icon.ty === ViewIconTypePB.Emoji && icon.value ? (
      <span style={{ fontSize: 16, lineHeight: 1.1 }}>{icon.value}</span>
    ) : (
      <FlowySvg svg={layoutIcon(view.view?.layout ?? 0) as FlowySvgName} />
    );
  return (
    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: useIntrinsicWidth ? undefined : 1 }}>
      <FlowyButton
        margin={margin}
        useIntrinsicWidth={useIntrinsicWidth}
        leftIcon={leftIcon}
        style={{ maxWidth: '100%', minWidth: 0, flex: useIntrinsicWidth ? undefined : 1 }}
        text={
          <Tooltip message={tooltip}>
            <FlowyText fontSize={14} lineHeight={18} ellipsis>
              {name}
            </FlowyText>
          </Tooltip>
        }
        onTap={onTap}
      />
    </div>
  );
}

function SelectHomePageMenu({ bloc }: { bloc: SettingsSitesStore }) {
  const { tr } = useTr();
  const container = usePopoverContainer();
  const [source] = useState(() => bloc.store.getState().publishedViews);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  if (source.length === 0) {
    return (
      <FlowyText color="var(--th-hint)" ellipsis>
        {tr('settings.sites.publishedPage.noPublishedPages')}
      </FlowyText>
    );
  }
  const views = query === '' ? source : source.filter((view) => (view.view?.name ?? '').toLowerCase().includes(query.toLowerCase()));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* SpaceSearchField(width: 240) */}
      <div
        style={{
          height: 30,
          width: 240,
          borderRadius: 8,
          boxShadow: '0 0 0 1.2px #00BCF0',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ display: 'flex', margin: '0 8px 0 12px' }}>
          <FlowySvg svg="magnifier_s" size={16} />
        </span>
        <input
          ref={inputRef}
          value={query}
          placeholder={tr('search.label')}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 'calc(14px * var(--text-scale, 1))',
            color: 'var(--text-color)',
          }}
        />
        {query !== '' && (
          <span style={{ display: 'flex', marginRight: 8, cursor: 'pointer' }} onClick={() => setQuery('')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--th-hint)">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </span>
        )}
      </div>
      <VSpace size={10} />
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {views.map((view) => (
          <div key={viewIdOf(view)} style={{ padding: '4px 0', display: 'flex' }}>
            <PublishInfoViewItem
              view={view}
              useIntrinsicWidth={false}
              onTap={() => {
                void bloc.actions.setHomePage(viewIdOf(view));
                container?.close();
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A 34px FlowyIconTextButton row of the more-action popovers. */
function MoreActionRow({ icon, label, onTap }: { icon: FlowySvgName; label: string; onTap: () => void }) {
  return (
    <div style={{ height: 34, padding: '2px 0' }}>
      <FlowyHover onClick={onTap} style={{ height: '100%', padding: '0 6px', display: 'flex', alignItems: 'center' }}>
        <FlowySvg svg={icon} />
        <HSpace size={10} />
        <FlowyText lineHeight={18} ellipsis>
          {label}
        </FlowyText>
      </FlowyHover>
    </div>
  );
}

function ThreeDotsButton() {
  return (
    <div style={{ width: THREE_DOTS_WIDTH, flexShrink: 0, display: 'flex' }}>
      <FlowyButton useIntrinsicWidth text={<FlowySvg svg="three_dots_s" />} />
    </div>
  );
}

/** DomainMoreAction: "Update namespace", disabled unless Pro plan and owner. */
function DomainMoreAction({ bloc, namespace, isOwner }: { bloc: SettingsSitesStore; namespace: string; isOwner: boolean }) {
  const { tr } = useTr();
  return (
    <AppFlowyPopover
      constraints={{ maxWidth: 188 }}
      offset={{ x: 6, y: 0 }}
      popup={(close) => {
        const row = (
          <MoreActionRow
            icon="view_item_rename_s"
            label={tr('settings.sites.updateNamespace')}
            onTap={() => {
              showDomainSettingsDialog(bloc, namespace);
              close();
            }}
          />
        );
        const plan = bloc.store.getState().subscriptionInfo?.plan;
        const forbidden =
          plan !== WorkspacePlanPB.ProPlan
            ? tr('settings.sites.namespace.upgradeToPro')
            : !isOwner
              ? tr('settings.sites.error.onlyWorkspaceOwnerCanUpdateNamespace')
              : null;
        if (forbidden === null) return row;
        return (
          <Tooltip message={forbidden}>
            <div style={{ opacity: 0.5, cursor: 'not-allowed' }}>
              <div style={{ pointerEvents: 'none' }}>{row}</div>
            </div>
          </Tooltip>
        );
      }}
    >
      <ThreeDotsButton />
    </AppFlowyPopover>
  );
}

function PublishedViewItem({ bloc, view, closeDialog }: { bloc: SettingsSitesStore; view: PublishInfoViewPB; closeDialog: () => void }) {
  const { tr } = useTr();
  const locale = useI18nStore((s) => s.locale);
  const publishName = view.info?.publishName ?? '';
  const date = formatMonthDayYear(new Date(Number(view.info?.publishTimestampSec ?? 0n) * 1000), locale);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <PublishInfoViewItem
          view={view}
          extraTooltipMessage={tr('settings.sites.publishedPage.clickToOpenPageInApp')}
          onTap={async () => {
            // context.popToHome() + ActionNavigationEvent.performAction(objectId)
            closeDialog();
            const result = await FolderEventGetView({ value: view.view?.viewId ?? '' });
            if (result.ok) tabsActions.openView(result.value);
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 48, display: 'flex' }}>
        <FlowyButton
          useIntrinsicWidth
          style={{ maxWidth: '100%' }}
          onTap={() => openUrl(buildPublishUrl(baseWebDomain(), namespaceOf(view), publishName))}
          text={
            <Tooltip message={`${tr('settings.sites.publishedPage.clickToOpenPageInBrowser')}\n${publishName}`}>
              <FlowyText lineHeight={18} ellipsis>
                {publishName}
              </FlowyText>
            </Tooltip>
          }
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingLeft: ALIGN_PADDING }}>
        <FlowyText ellipsis>{date}</FlowyText>
      </div>
      <PublishedViewMoreAction bloc={bloc} view={view} />
    </div>
  );
}

function PublishedViewMoreAction({ bloc, view }: { bloc: SettingsSitesStore; view: PublishInfoViewPB }) {
  const { tr } = useTr();
  const actions: Array<{ icon: FlowySvgName; label: string; run: () => void }> = [
    { icon: 'share_publish_s', label: tr('shareAction.visitSite'), run: () => visitSite(view, bloc.store.getState().namespace) },
    { icon: 'copy_s', label: tr('shareAction.copyLink'), run: () => copySiteLink(view, bloc.store.getState().namespace) },
    { icon: 'delete_s', label: tr('shareAction.unPublish'), run: () => void bloc.actions.unpublishView(viewIdOf(view)) },
    { icon: 'edit_s', label: tr('settings.sites.customUrl'), run: () => showPublishedViewSettingsDialog(bloc, view) },
    { icon: 'settings_s', label: tr('settings.popupMenuItem.settings'), run: () => showPublishedViewSettingsDialog(bloc, view) },
  ];
  return (
    <AppFlowyPopover
      constraints={{ maxWidth: 168 }}
      offset={{ x: 6, y: 0 }}
      popup={(close) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {actions.map((action) => (
            <MoreActionRow
              key={action.icon}
              icon={action.icon}
              label={action.label}
              onTap={() => {
                action.run();
                close();
              }}
            />
          ))}
        </div>
      )}
    >
      <ThreeDotsButton />
    </AppFlowyPopover>
  );
}

// ---- Dialogs ---------------------------------------------------------------------------

/** ShareMenuColors.borderColor. */
function useShareBorderColor() {
  return useBrightness() === 'light' ? '#14171B1E' : '#FFFFFF1A';
}

function DialogTextField({ value, onChange, autoFocus }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  const border = useShareBorderColor();
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      spellCheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => onChange(event.target.value)}
      style={{
        height: 36,
        width: '100%',
        borderRadius: 8,
        border: `1px solid ${focused ? 'var(--cs-primary)' : border}`,
        outline: 'none',
        background: 'transparent',
        padding: '0 12px',
        fontSize: 'calc(14px * var(--text-scale, 1))',
        lineHeight: 1.4,
        color: 'var(--text-color)',
      }}
    />
  );
}

function DialogTitle({ children, close, trailing }: { children: string; close: () => void; trailing?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: trailing ? undefined : 1, minWidth: 0 }}>
        <FlowyText fontSize={16} lineHeight={22} fontWeight={500} ellipsis>
          {children}
        </FlowyText>
      </div>
      {trailing}
      <HSpace size={6} />
      {trailing && <div style={{ flex: 1 }} />}
      <FlowyButton margin={3} useIntrinsicWidth text={<FlowySvg svg="upgrade_close_s" size={18} />} onTap={close} />
    </div>
  );
}

function showDomainSettingsDialog(bloc: SettingsSitesStore, namespace: string) {
  showDialog((close) => (
    <MaterialDialog radius={12} width={460}>
      <DomainSettingsDialog bloc={bloc} namespace={namespace} close={close} />
    </MaterialDialog>
  ));
}

/** DomainSettingsDialog (domain/domain_settings_dialog.dart). */
function DomainSettingsDialog({ bloc, namespace, close }: { bloc: SettingsSitesStore; namespace: string; close: () => void }) {
  const { tr } = useTr();
  const [text, setText] = useState(namespace);
  const [errorHint, setErrorHint] = useState('');
  const save = async () => {
    const result = await bloc.actions.updateNamespace(text);
    if (result.ok) {
      showToast({ message: tr('settings.sites.success.namespaceUpdated') });
      close();
      return;
    }
    const basic = tr('settings.sites.error.failedToUpdateNamespace');
    const key = namespaceErrorKey(result.error.code);
    const message = key ? tr(key) : null;
    setErrorHint(message || basic);
    toastWithDescription('error', basic, message);
  };
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
      <DialogTitle
        close={close}
        trailing={
          <>
            <HSpace size={6} />
            <Tooltip message={tr('settings.sites.namespace.tooltip')}>
              <span style={{ display: 'flex' }}>
                <FlowySvg svg="information_s" />
              </span>
            </Tooltip>
          </>
        }
      >
        {tr('settings.sites.namespace.updateExistingNamespace')}
      </DialogTitle>
      <VSpace size={12} />
      <FlowyText fontSize={14} lineHeight={16} maxLines={3} color="var(--th-hint)">
        {tr('settings.sites.namespace.description')}
      </FlowyText>
      <VSpace size={20} />
      <DialogTextField value={text} onChange={setText} />
      <div style={{ padding: '4px 0 0 2px', opacity: 0.8 }}>
        <FlowyText fontSize={14} lineHeight={18} ellipsis withTooltip>
          {buildNamespaceUrl(baseWebDomain(), text)}
        </FlowyText>
      </div>
      {errorHint && (
        <div style={{ padding: '4px 0 0 2px' }}>
          <FlowyText fontSize={12} lineHeight={18} color="var(--cs-error)">
            {errorHint}
          </FlowyText>
        </div>
      )}
      <VSpace size={20} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <OutlinedRoundedButton text={tr('button.cancel')} onTap={close} />
        <HSpace size={12} />
        <PrimaryRoundedButton text={tr('button.save')} radius={8} margin="9px 16px" onTap={() => void save()} />
      </div>
    </div>
  );
}

function showPublishedViewSettingsDialog(bloc: SettingsSitesStore, view: PublishInfoViewPB) {
  showDialog((close) => (
    <MaterialDialog radius={12} width={440}>
      <PublishedViewSettingsDialog bloc={bloc} view={view} close={close} />
    </MaterialDialog>
  ));
}

/** PublishedViewSettingsDialog (published_page/published_view_settings_dialog.dart). */
function PublishedViewSettingsDialog({ bloc, view, close }: { bloc: SettingsSitesStore; view: PublishInfoViewPB; close: () => void }) {
  const { tr } = useTr();
  const [text, setText] = useState(view.info?.publishName ?? '');
  const save = async () => {
    const result = await bloc.actions.updatePublishName(viewIdOf(view), text);
    if (result.ok) {
      showToast({ message: tr('settings.sites.success.updatePathNameSuccess') });
      close();
      return;
    }
    const key = publishNameErrorKey(result.error.code);
    toastWithDescription('error', tr('settings.sites.error.updatePathNameFailed'), key ? tr(key) : null);
  };
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
      <DialogTitle close={close}>{tr('settings.sites.publishedPage.settings')}</DialogTitle>
      <VSpace size={20} />
      <FlowyText color="var(--th-hint)">{tr('settings.sites.publishedPage.pathName')}</FlowyText>
      <VSpace size={8} />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <DialogTextField value={text} onChange={setText} />
        </div>
        <HSpace size={12} />
        <OutlinedRoundedButton text={tr('button.save')} onTap={() => void save()} />
      </div>
      <VSpace size={20} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <OutlinedRoundedButton
          text={tr('shareAction.unPublish')}
          onTap={() => {
            void bloc.actions.unpublishView(viewIdOf(view));
            close();
          }}
        />
        <HSpace size={12} />
        <PrimaryRoundedButton text={tr('shareAction.visitSite')} radius={8} margin="9px 16px" onTap={() => visitSite(view, bloc.store.getState().namespace)} />
      </div>
    </div>
  );
}
