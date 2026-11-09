import { useEffect, useState, type ReactNode } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { CalendarDays, FileText, LayoutTemplate, MessageSquareText, SquareCheckBig, SquareKanban, Table2 } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { nameOrDefault } from '../view/view-ext';
import { RawEmojiIcon, viewIcon } from '../view-header/ViewIcon';
import { useViewPluginNotifier, useViewScope } from '../view-header/view-scope';
import { DocumentBanner, deletePermanently, restorePage } from './DocumentBanner';
import type { PluginContext } from './registry';

export const PLACEHOLDER_LINE = 'This page type opens in a later milestone of the Electron port.';

/** A centered "later milestone" message with the page's icon and name. */
export function PlaceholderMessage({ icon, name }: { icon: ReactNode; name: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader className="max-w-md">
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{name}</EmptyTitle>
        <EmptyDescription>{PLACEHOLDER_LINE}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Default page chrome; user-content icons retain their existing renderer. */
export function HyperLayoutIcon({ layout, className }: { layout: ViewLayoutPB; className?: string }) {
  const Icon = layout === ViewLayoutPB.Grid ? Table2 : layout === ViewLayoutPB.Board ? SquareKanban : layout === ViewLayoutPB.Calendar ? CalendarDays : layout === ViewLayoutPB.Chat ? MessageSquareText : FileText;
  return <Icon className={cn('size-4 text-muted-foreground', className)} />;
}

/**
 * Body of the Document / Grid / Board / Calendar / Chat plugins until their pages land. It keeps
 * the plugins' delete handling: documents show the "in Trash" banner (restore / delete
 * permanently → onDeleted), databases close as soon as a trash notification carries an index.
 */
export function ViewPlaceholderPage({ view, context }: { view: ViewPB; context: PluginContext }) {
  const notifier = useViewPluginNotifier();
  const scope = useViewScope();
  const current = notifier?.view ?? view;
  const deleted = notifier?.isDeleted ?? null;
  const [bannerHidden, setBannerHidden] = useState(false);
  const isDatabase = view.layout === ViewLayoutPB.Grid || view.layout === ViewLayoutPB.Board || view.layout === ViewLayoutPB.Calendar;

  // DocumentBloc.moveToTrash: a new trash notification shows the banner again.
  useEffect(() => setBannerHidden(false), [deleted]);

  // DatabaseTabBarViewPlugin: closes immediately when the deleted view has an index.
  useEffect(() => {
    if (isDatabase && deleted && deleted.oneOfIndex.case === 'index') context.onDeleted?.(current, deleted.oneOfIndex.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleted, isDatabase]);

  // AIChatPage renders nothing without a user profile (e.g. in the secondary view).
  if (view.layout === ViewLayoutPB.Chat && !context.userProfile) return null;

  const icon = viewIcon(current);
  const showBanner = view.layout === ViewLayoutPB.Document && deleted !== null && !bannerHidden;
  const deletedIndex = deleted?.oneOfIndex.case === 'index' ? deleted.oneOfIndex.value : undefined;
  return (
    <div className="flex h-full flex-col">
      {showBanner && (
        <DocumentBanner
          viewName={nameOrDefault(view)}
          onRestore={() =>
            void restorePage(view).then((ok) => {
              if (ok) {
                setBannerHidden(true);
                scope?.notifier.setState({ isDeleted: null });
              }
            })
          }
          onDelete={() =>
            void deletePermanently(view).then((ok) => {
              if (ok) context.onDeleted?.(current, deletedIndex);
            })
          }
        />
      )}
      <div className="min-h-0 flex-1">
        <PlaceholderMessage
          icon={icon ? <span className="text-2xl"><RawEmojiIcon icon={icon} size={24} /></span> : <HyperLayoutIcon layout={current.layout} className="size-5" />}
          name={nameOrDefault(current)}
        />
      </div>
    </div>
  );
}

/** BlankPage (plugins/blank/blank.dart): an empty surface. */
export function BlankPage() {
  return <div className="h-full bg-background" />;
}

/** The Jira / Templates local tools until their pages land. */
export function LocalToolPlaceholder({ title }: { title: string }) {
  return <PlaceholderMessage icon={title === 'Jira' ? <SquareCheckBig className="size-5 text-muted-foreground" /> : <LayoutTemplate className="size-5 text-muted-foreground" />} name={title} />;
}
