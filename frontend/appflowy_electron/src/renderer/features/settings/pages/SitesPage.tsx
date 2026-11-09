import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { PublishInfoViewPB } from '@shared/protobuf/flowy-folder/publish_pb';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { AFRolePB, WorkspacePlanPB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FolderEventGetView } from '@/backend/events';
import { FlowySvg } from '@/icons/FlowySvg';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { Copy, Globe, Info, MoreHorizontal, PencilLine, Search, Settings, Trash2, X } from 'lucide-react';
import { tr as trNow, useI18nStore, useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { AppFlowyPopover, MaterialDialog, Tooltip, showDialog, showToast, usePopoverContainer } from '@/ui';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupButton } from '@/components/ui/input-group';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Empty, EmptyHeader, EmptyDescription } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { layoutIcon } from '../../tabs/plugin';
import { tabsActions } from '../../tabs/tabs-store';
import type { SettingsPageProps } from '../page-props';
import { formatMonthDayYear } from './members-core';
import { buildNamespaceUrl, buildPublishUrl, namespaceErrorKey, publishNameErrorKey } from './sites-core';
import { createSettingsSitesStore, type SettingsSitesStore } from './sites-store';

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

function toastWithDescription(type: 'success' | 'error', message: string, description?: string | null) {
  showToast({ type, message: <>{message}{description && <div className="text-xs text-muted-foreground">{description}</div>}</> });
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
    <>
      <SettingsPageHeader title={tr('settings.sites.title')} />
      <SettingsSection title={tr('settings.sites.namespaceHeader')} description={tr('settings.sites.namespaceDescription')}>
        <SettingsGroup><DomainItem bloc={bloc} namespace={state.namespace} isOwner={isOwner} /></SettingsGroup>
      </SettingsSection>
      <SettingsSection title={tr('settings.sites.publishedPage.title')} description={tr('settings.sites.publishedPage.description')}>
        <SettingsGroup>
          {state.isLoading ? <div className="flex justify-center py-4"><Spinner /></div> : state.publishedViews.length === 0 ? <Empty><EmptyHeader><EmptyDescription>{tr('settings.sites.publishedPage.emptyHinText')}</EmptyDescription></EmptyHeader></Empty> :
            <Table className="table-fixed"><TableHeader><TableRow>
              <TableHead className="px-4 text-xs font-medium text-muted-foreground">{tr('settings.sites.publishedPage.page')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">{tr('settings.sites.publishedPage.pathName')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">{tr('settings.sites.publishedPage.date')}</TableHead><TableHead className="w-12" />
            </TableRow></TableHeader><TableBody>{state.publishedViews.map((view) => <PublishedViewItem key={viewIdOf(view)} bloc={bloc} view={view} closeDialog={closeDialog} />)}</TableBody></Table>}
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function DomainItem({ bloc, namespace, isOwner }: { bloc: SettingsSitesStore; namespace: string; isOwner: boolean }) {
  const { tr } = useTr();
  const namespaceUrl = buildNamespaceUrl(baseWebDomain(), namespace);
  return <>
    <SettingsRow label={<span className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Globe className="size-4 text-muted-foreground" /></span>
      <Tooltip message={`${tr('shareAction.visitSite')}
${namespaceUrl}`}><Button variant="ghost" size="sm" className="min-w-0 justify-start px-0 font-mono text-xs" onClick={() => openUrl(buildNamespaceUrl(baseWebDomain(), namespace, true))}><span className="truncate">{namespaceUrl}</span></Button></Tooltip>
    </span>} control={<DomainMoreAction bloc={bloc} namespace={namespace} isOwner={isOwner} />} />
    <SettingsRow label={tr('settings.sites.homepageHeader')} control={<Homepage bloc={bloc} isOwner={isOwner} />} />
  </>;
}

function Homepage({ bloc, isOwner }: { bloc: SettingsSitesStore; isOwner: boolean }) {
  const plan = useStore(bloc.store, (s) => s.subscriptionInfo?.plan);
  if (plan === undefined) return null;
  if (plan === WorkspacePlanPB.FreePlan) return <FreePlanUpgradeButton bloc={bloc} isOwner={isOwner} />;
  return <HomePageButton bloc={bloc} isOwner={isOwner} />;
}

function HomePageButton({ bloc, isOwner }: { bloc: SettingsSitesStore; isOwner: boolean }) {
  const { tr } = useTr();
  const { isLoading, homePageView } = useStore(bloc.store);
  if (isLoading) return null;
  const child: ReactNode = homePageView === null ? <Button variant="outline" size="sm"><Search className="size-4" />{tr('settings.sites.selectHomePage')}</Button> : <PublishInfoViewItem view={homePageView} />;
  if (!isOwner) return <Tooltip message={tr('settings.sites.namespace.onlyWorkspaceOwnerCanSetHomePage')}><div className="pointer-events-none flex min-w-0">{child}</div></Tooltip>;
  return <div className="flex min-w-0 items-center gap-1">
    <AppFlowyPopover direction="bottomWithCenterAligned" constraints={{ maxWidth: 260, maxHeight: 345 }} margin="12px 14px" popup={() => <SelectHomePageMenu bloc={bloc} />}>{child}</AppFlowyPopover>
    {homePageView !== null && <Tooltip message={tr('settings.sites.clearHomePage')}><Button variant="ghost" size="icon-sm" aria-label={tr('settings.sites.clearHomePage')} onClick={() => void bloc.actions.removeHomePage()}><X className="size-4" /></Button></Tooltip>}
  </div>;
}

function FreePlanUpgradeButton({ bloc, isOwner }: { bloc: SettingsSitesStore; isOwner: boolean }) {
  const { tr } = useTr();
  return <Tooltip message={tr('settings.sites.homePage.upgradeToPro')}><Button size="sm" onClick={() => {
    if (isOwner) {
      showToast({ type: 'error', message: tr('settings.sites.namespace.redirectToPayment') });
      void bloc.actions.upgradeSubscription();
    } else showToast({ type: 'error', message: tr('settings.sites.namespace.pleaseAskOwnerToSetHomePage') });
  }}>Pro ↗</Button></Tooltip>;
}

function PublishInfoViewItem({ view, onTap, useIntrinsicWidth = true, extraTooltipMessage }: { view: PublishInfoViewPB; onTap?: () => void; useIntrinsicWidth?: boolean; extraTooltipMessage?: string }) {
  const { tr } = useTr();
  const name = view.view?.name || tr('menuAppHeader.defaultNewPageName');
  const tooltip = extraTooltipMessage !== undefined ? `${extraTooltipMessage}
${name}` : name;
  const icon = view.view?.oneOfIcon.case === 'icon' ? view.view.oneOfIcon.value : null;
  const leftIcon = icon && icon.ty === ViewIconTypePB.Emoji && icon.value ? <span className="text-base leading-none">{icon.value}</span> : <FlowySvg svg={layoutIcon(view.view?.layout ?? 0) as FlowySvgName} />;
  return <Tooltip message={tooltip}><Button variant="ghost" size="sm" className={`min-w-0 max-w-full justify-start ${useIntrinsicWidth ? '' : 'w-full'}`} onClick={onTap}>{leftIcon}<span className="truncate text-sm">{name}</span></Button></Tooltip>;
}

function SelectHomePageMenu({ bloc }: { bloc: SettingsSitesStore }) {
  const { tr } = useTr();
  const container = usePopoverContainer();
  const [source] = useState(() => bloc.store.getState().publishedViews);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  if (source.length === 0) return <p className="truncate text-sm text-muted-foreground">{tr('settings.sites.publishedPage.noPublishedPages')}</p>;
  const views = query === '' ? source : source.filter((view) => (view.view?.name ?? '').toLowerCase().includes(query.toLowerCase()));
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <InputGroup className="w-60 shrink-0"><InputGroupAddon><Search className="size-4" /></InputGroupAddon><InputGroupInput ref={inputRef} value={query} placeholder={tr('search.label')} spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
      {query !== '' && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={tr('button.clear')} onClick={() => setQuery('')}><X className="size-4" /></InputGroupButton></InputGroupAddon>}
    </InputGroup>
    <div className="min-h-0 overflow-y-auto">{views.map((view) => <div key={viewIdOf(view)} className="flex py-1"><PublishInfoViewItem view={view} useIntrinsicWidth={false} onTap={() => {
      void bloc.actions.setHomePage(viewIdOf(view));
      container?.close();
    }} /></div>)}</div>
  </div>;
}

function DomainMoreAction({ bloc, namespace, isOwner }: { bloc: SettingsSitesStore; namespace: string; isOwner: boolean }) {
  const { tr } = useTr();
  const plan = useStore(bloc.store, (state) => state.subscriptionInfo?.plan);
  const forbidden = plan !== WorkspacePlanPB.ProPlan ? tr('settings.sites.namespace.upgradeToPro') : !isOwner ? tr('settings.sites.error.onlyWorkspaceOwnerCanUpdateNamespace') : null;
  return <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tr('settings.sites.updateNamespace')} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56"><Tooltip message={forbidden ?? ''}><DropdownMenuItem disabled={forbidden !== null} onClick={() => showDomainSettingsDialog(bloc, namespace)}><PencilLine className="size-4" />{tr('settings.sites.updateNamespace')}</DropdownMenuItem></Tooltip></DropdownMenuContent>
  </DropdownMenu>;
}

function PublishedViewItem({ bloc, view, closeDialog }: { bloc: SettingsSitesStore; view: PublishInfoViewPB; closeDialog: () => void }) {
  const { tr } = useTr();
  const locale = useI18nStore((s) => s.locale);
  const publishName = view.info?.publishName ?? '';
  const date = formatMonthDayYear(new Date(Number(view.info?.publishTimestampSec ?? 0n) * 1000), locale);
  return <TableRow>
    <TableCell className="px-4 py-3"><PublishInfoViewItem view={view} extraTooltipMessage={tr('settings.sites.publishedPage.clickToOpenPageInApp')} onTap={async () => {
      closeDialog();
      const result = await FolderEventGetView({ value: view.view?.viewId ?? '' });
      if (result.ok) tabsActions.openView(result.value);
    }} /></TableCell>
    <TableCell><Tooltip message={`${tr('settings.sites.publishedPage.clickToOpenPageInBrowser')}
${publishName}`}><Button variant="ghost" size="sm" className="max-w-full font-mono text-xs" onClick={() => openUrl(buildPublishUrl(baseWebDomain(), namespaceOf(view), publishName))}><span className="truncate">{publishName}</span></Button></Tooltip></TableCell>
    <TableCell className="truncate text-xs tabular-nums text-muted-foreground">{date}</TableCell><TableCell><PublishedViewMoreAction bloc={bloc} view={view} /></TableCell>
  </TableRow>;
}

function PublishedViewMoreAction({ bloc, view }: { bloc: SettingsSitesStore; view: PublishInfoViewPB }) {
  const { tr } = useTr();
  const actions = [
    { icon: Globe, label: tr('shareAction.visitSite'), run: () => visitSite(view, bloc.store.getState().namespace) },
    { icon: Copy, label: tr('shareAction.copyLink'), run: () => copySiteLink(view, bloc.store.getState().namespace) },
    { icon: Trash2, label: tr('shareAction.unPublish'), run: () => void bloc.actions.unpublishView(viewIdOf(view)), destructive: true },
    { icon: PencilLine, label: tr('settings.sites.customUrl'), run: () => showPublishedViewSettingsDialog(bloc, view) },
    { icon: Settings, label: tr('settings.popupMenuItem.settings'), run: () => showPublishedViewSettingsDialog(bloc, view) },
  ];
  return <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tr('settings.popupMenuItem.settings')} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">{actions.map((action) => <DropdownMenuItem key={action.label} variant={action.destructive ? 'destructive' : 'default'} onClick={action.run}><action.icon className="size-4" />{action.label}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>;
}

function DialogTextField({ value, onChange, autoFocus }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  return <Input value={value} autoFocus={autoFocus} spellCheck={false} onChange={(event) => onChange(event.target.value)} />;
}

function DialogTitle({ children, close, trailing }: { children: string; close: () => void; trailing?: ReactNode }) {
  return <div className="flex items-center gap-2"><h2 className="min-w-0 flex-1 truncate text-base font-medium">{children}</h2>{trailing}<Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}><X className="size-4" /></Button></div>;
}

function showDomainSettingsDialog(bloc: SettingsSitesStore, namespace: string) {
  showDialog((close) => <MaterialDialog radius={12} width={460}><DomainSettingsDialog bloc={bloc} namespace={namespace} close={close} /></MaterialDialog>);
}

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
  return <div className="flex flex-col gap-4 p-4">
    <DialogTitle close={close} trailing={<Tooltip message={tr('settings.sites.namespace.tooltip')}><span className="flex"><Info className="size-4 text-muted-foreground" /></span></Tooltip>}>{tr('settings.sites.namespace.updateExistingNamespace')}</DialogTitle>
    <Field><FieldDescription className="text-sm">{tr('settings.sites.namespace.description')}</FieldDescription><DialogTextField value={text} onChange={setText} />
      <Tooltip message={buildNamespaceUrl(baseWebDomain(), text)}><p className="truncate font-mono text-xs text-muted-foreground">{buildNamespaceUrl(baseWebDomain(), text)}</p></Tooltip>
      {errorHint && <FieldError className="text-xs">{errorHint}</FieldError>}
    </Field>
    <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4"><Button variant="outline" onClick={close}>{tr('button.cancel')}</Button><Button onClick={() => void save()}>{tr('button.save')}</Button></div>
  </div>;
}

function showPublishedViewSettingsDialog(bloc: SettingsSitesStore, view: PublishInfoViewPB) {
  showDialog((close) => <MaterialDialog radius={12} width={440}><PublishedViewSettingsDialog bloc={bloc} view={view} close={close} /></MaterialDialog>);
}

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
  return <div className="flex flex-col gap-4 p-4">
    <DialogTitle close={close}>{tr('settings.sites.publishedPage.settings')}</DialogTitle>
    <Field><FieldLabel>{tr('settings.sites.publishedPage.pathName')}</FieldLabel><div className="flex items-center gap-3"><DialogTextField value={text} onChange={setText} /><Button variant="outline" size="sm" onClick={() => void save()}>{tr('button.save')}</Button></div></Field>
    <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4"><Button variant="outline" onClick={() => {
      void bloc.actions.unpublishView(viewIdOf(view));
      close();
    }}>{tr('shareAction.unPublish')}</Button><Button onClick={() => visitSite(view, bloc.store.getState().namespace)}>{tr('shareAction.visitSite')}</Button></div>
  </div>;
}
