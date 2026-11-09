import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetView } from '@/backend/events';
import { useTr } from '@/i18n';
import { CalendarDays, Check, Copy, FileCode, FileText, Globe, Link, SquareArrowOutUpRight, SquareKanban, Table2, type LucideIcon } from 'lucide-react';
import { floatingSurfaceClass, MenuLabel } from '@/components/app/menu-row';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, showToast, type PopoverController } from '@/ui';
import { ShareAccessLevel } from '../page-access-level-store';
import { usePageAccessLevel } from '../view-scope';
import {
  buildNamespaceUrl,
  buildShareUrl,
  createShareStore,
  isDatabaseView,
  type ShareStore,
} from './share-store';
import { generatePublishName } from './publish-name';

type ShareMenuTab = 'share' | 'publish' | 'exportAs';

/** String.toFileName (util/string_extension.dart). */
const toFileName = (name: string) => name.replace(/[\\/:*?"<>| ]/g, '_');

/** ShareButton (plugins/shared/share/share_button.dart) + ShareMenuButton (_shared.dart). */
export function ShareButton({ view }: { view: ViewPB }) {
  const { tr } = useTr();
  const [store] = useState(() => createShareStore(view));
  useEffect(() => store.start(), [store]);
  const state = useStore(store);
  const controller = useRef<PopoverController>(null);
  const tabs: ShareMenuTab[] = [...(state.enablePublish ? (['share', 'publish'] as const) : []), 'exportAs'];

  return (
    <Popover
      controllerRef={controller}
      trigger="none"
      direction="bottomWithCenterAligned"
      offset={{ x: -176, y: 12 }}
      windowPadding={8}
      onOpen={() => void store.updatePublishStatus()}
      popup={() => <ShareMenu key={tabs.join()} tabs={tabs} store={store} />}
    >
      <Button size="sm" onClick={() => controller.current?.show()}>{tr('shareAction.buttonText')}</Button>
    </Popover>
  );
}

/** ShareMenu (plugins/shared/share/share_menu.dart). */
function ShareMenu({ tabs, store }: { tabs: ShareMenuTab[]; store: ShareStore }) {
  const { tr } = useTr();
  const [selected, setSelected] = useState<ShareMenuTab>(tabs[0]);
  const isPublished = useStore(store, (s) => s.isPublished);
  if (tabs.length === 0) return null;
  return (
    <Tabs className={`${floatingSurfaceClass} w-[25rem] gap-0 p-0`} value={selected} onValueChange={(value) => setSelected(value as ShareMenuTab)}>
      <TabsList variant="line" className="h-10 w-full justify-start gap-4 rounded-none border-b px-4">
        {tabs.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="flex-none" onMouseDown={() => setSelected(tab)}>
            {tab === 'publish' && isPublished && <Check className="size-4" />}
            {tab === 'share' ? tr('shareAction.shareTab') : tab === 'publish' ? tr('shareAction.publishTab') : tr('shareAction.exportAsTab')}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent key={selected} value={selected} className="p-4">
        {selected === 'publish' ? <PublishTab store={store} /> : selected === 'exportAs' ? <ExportTab store={store} /> : <ShareTab store={store} />}
      </TabsContent>
    </Tabs>
  );
}

// ---- Export tab (plugins/shared/share/export_tab.dart) ------------------------------------

function ExportButton({ title, icon: Icon, onTap }: { title: string; icon: LucideIcon; onTap: () => void }) {
  return (
    <Button variant="outline" className="h-auto w-full justify-start gap-3 px-3 py-2.5" onClick={onTap}>
      <span className="flex size-8 items-center justify-center rounded-md bg-muted"><Icon className="size-4 text-muted-foreground" /></span>
      <span className="text-sm font-medium">{title}</span>
    </Button>
  );
}

function ExportTab({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const view = store.view;

  // Document export needs the editor's document → HTML / Markdown encoders (document milestone).
  const unsupported = () => showToast({ message: `${tr('settings.files.exportFileFail')}: Unimplemented` });

  const exportCSV = async () => {
    const path = await window.appflowy.dialog.saveFile({ title: '', defaultPath: `${toFileName(store.getState().viewName)}.csv` });
    if (path) await store.exportCSV(path);
  };

  if (view.layout === ViewLayoutPB.Document) {
    return (
      <div className="grid gap-2">
        <ExportButton title={tr('shareAction.html')} icon={FileCode} onTap={unsupported} />
        <ExportButton title={tr('shareAction.markdown')} icon={FileText} onTap={unsupported} />
        <ExportButton title={tr('shareAction.clipboard')} icon={Copy} onTap={unsupported} />
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <ExportButton title={tr('shareAction.csv')} icon={Table2} onTap={() => void exportCSV()} />
    </div>
  );
}

// ---- Share tab (plugins/shared/share/share_tab.dart, FeatureFlag.sharedSection off) -------

function ShareTab({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const { workspaceId, viewId } = useStore(store);
  const [url, setUrl] = useState('');
  useEffect(() => {
    void buildShareUrl(workspaceId, viewId).then(setUrl);
  }, [workspaceId, viewId]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-sm font-medium"><Link className="size-4 text-muted-foreground" />{tr('shareAction.shareTabTitle')}</div>
      <p className="text-sm text-muted-foreground">{tr('shareAction.shareTabDescription')}</p>
      <InputGroup>
        <InputGroupInput value={url} readOnly spellCheck={false} className="font-mono text-xs" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton onClick={() => {
            window.appflowy.clipboard.writeText(url);
            showToast({ message: tr('message.copy.success') });
          }}><Copy className="size-4" />{tr('button.copyLink')}</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

// ---- Publish tab (plugins/shared/share/publish_tab.dart) ----------------------------------

function PublishTabHeader() {
  const { tr } = useTr();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-sm font-medium"><Globe className="size-4 text-muted-foreground" />{tr('shareAction.publishToTheWeb')}</div>
      <p className="text-sm text-muted-foreground">{tr('shareAction.publishToTheWebHint')}</p>
    </div>
  );
}

function PublishTab({ store }: { store: ShareStore }) {
  const state = useStore(store);
  return state.isPublished ? <PublishedWidget store={store} /> : <PublishWidget store={store} />;
}

function PublishedWidget({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const { namespace, pathName } = useStore(store);
  const [text, setText] = useState(pathName);
  const [focused, setFocused] = useState(false);
  const [prefix, setPrefix] = useState('');
  useEffect(() => setText(pathName), [pathName]);
  useEffect(() => {
    void buildNamespaceUrl(`${namespace}/`).then(setPrefix);
  }, [namespace]);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <PublishTabHeader />
        <Badge variant="success-light" size="sm"><Check className="size-3" />{tr('shareAction.publishTab')}</Badge>
      </div>
      <InputGroup>
        <InputGroupAddon className="max-w-56 border-r"><span className="truncate font-mono text-xs">{prefix}</span></InputGroupAddon>
        <InputGroupInput ref={inputRef} value={text} spellCheck={false} className="font-mono text-xs"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setTimeout(() => setFocused(true), 0)}
          onBlur={() => setTimeout(() => setFocused(false), 0)} />
        <InputGroupAddon align="inline-end">
          {focused ? (
            <span onMouseDown={(e) => e.preventDefault()}>
              <InputGroupButton onClick={() => {
                void store.updatePathName(text);
                inputRef.current?.blur();
              }}>{tr('button.save')}</InputGroupButton>
            </span>
          ) : (
            <InputGroupButton size="icon-xs" onClick={() => {
              window.appflowy.clipboard.writeText(store.getState().url);
              showToast({ message: tr('message.copy.success') });
            }}><Copy className="size-4" /></InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void store.unpublish()}>{tr('shareAction.unPublish')}</Button>
        <Button onClick={() => {
          // afLaunchUrlString: vendor domains are refused by the main process.
          void window.appflowy.shell.openExternal(store.getState().url).catch(() => {});
        }}>{tr('shareAction.visitSite')}<SquareArrowOutUpRight className="size-4" /></Button>
      </div>
    </div>
  );
}

function PublishWidget({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const access = usePageAccessLevel();
  const view = store.view;
  const selectedRef = useRef<ViewPB[]>([]);

  const onPublish = () => {
    if (isDatabaseView(view) && selectedRef.current.length === 0) {
      showToast({ message: tr('publish.noDatabaseSelected') });
      return;
    }
    const { pathName, viewName } = store.getState();
    const publishName = pathName || generatePublishName(view.id, viewName);
    void store.publish(publishName, selectedRef.current.map((v) => v.id));
  };

  let button: ReactNode = <Button className="w-full" onClick={onPublish}><Globe className="size-4" />{tr('shareAction.publish')}</Button>;
  if (access?.accessLevel === ShareAccessLevel.readOnly) {
    button = (
      <Tooltip>
        <TooltipTrigger render={<div />}><div className="pointer-events-none">{button}</div></TooltipTrigger>
        <TooltipContent>You are a readonly user, you can't publish a page.</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PublishTabHeader />
      {isDatabaseView(view) && <PublishDatabaseSelector view={view} onSelected={(views) => (selectedRef.current = views)} />}
      {button}
    </div>
  );
}

/** _PublishDatabaseSelector: the database and its linked views (DatabaseTabBarBloc tab bars). */
function PublishDatabaseSelector({ view, onSelected }: { view: ViewPB; onSelected: (views: ViewPB[]) => void }) {
  const { plural, tr } = useTr();
  const [status, setStatus] = useState<Array<[ViewPB, boolean]>>([]);
  useEffect(() => {
    void FolderEventGetView({ value: view.id }).then((result) => {
      const children = result.ok ? result.value.childViews.filter((c) => isDatabaseView(c)) : [];
      const next: Array<[ViewPB, boolean]> = [view, ...children].map((v) => [v, true]);
      setStatus(next);
      onSelected(next.map(([v]) => v));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const count = status.filter(([, s]) => s).length;
  return (
    <div className="flex flex-col rounded-lg border p-2">
      <MenuLabel className="mb-1 border-b pb-2">{plural('publish.database', count)}</MenuLabel>
      {status.map(([tab, selected]) => {
        const isPrimary = tab.id === view.id;
        const Icon = tab.layout === ViewLayoutPB.Board ? SquareKanban : tab.layout === ViewLayoutPB.Calendar ? CalendarDays : Table2;
        const item = (
          <label className="flex min-h-8 items-center gap-2 rounded-md px-1.5 text-sm transition-colors hover:bg-accent has-disabled:cursor-not-allowed">
            <Checkbox checked={selected} disabled={isPrimary} onCheckedChange={() => {
              const next = status.map(([v, s]): [ViewPB, boolean] => (v.id === tab.id ? [v, !s] : [v, s]));
              setStatus(next);
              onSelected(next.filter(([, s]) => s).map(([v]) => v));
            }} />
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{tab.name}</span>
          </label>
        );
        return isPrimary ? (
          <Tooltip key={tab.id}>
            <TooltipTrigger render={<div />}>{item}</TooltipTrigger>
            <TooltipContent>{tr('publish.mustSelectPrimaryDatabase')}</TooltipContent>
          </Tooltip>
        ) : <div key={tab.id}>{item}</div>;
      })}
    </div>
  );
}
