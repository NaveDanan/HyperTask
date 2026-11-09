import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetViewAncestors } from '@/backend/events';
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/ui';
import { tabsActions } from '../tabs/tabs-store';
import { ViewTitle } from './ViewTitleBar';

/**
 * ViewTitleBarWithRow (plugins/database_document/presentation/database_document_title.dart):
 * `database › row name`, every crumb uneditable. The row name cell needs the database
 * controller (database milestone) and renders nothing until then, as while it loads.
 */
export function ViewTitleBarWithRow({ view }: { view: ViewPB }) {
  const [ancestors, setAncestors] = useState<ViewPB[]>([]);
  useEffect(() => {
    let active = true;
    void FolderEventGetViewAncestors({ value: view.id }).then((result) => {
      if (active) setAncestors(result.ok ? result.value.items : []);
    });
    return () => {
      active = false;
    };
  }, [view.id]);

  if (ancestors.length === 0) return null;
  const button = (v: ViewPB) => (
    <BreadcrumbItem key={v.id}><Tooltip message={v.name}>
      <ViewTitle view={v} editable={false} onUpdated={() => {}} />
    </Tooltip></BreadcrumbItem>
  );
  const divider = (key: string) => <BreadcrumbSeparator key={key} className="text-muted-foreground/60" />;
  const items: ReactNode[] =
    ancestors.length > 2
      ? [
          button(ancestors[1]),
          divider('d1'),
          <BreadcrumbItem key="e">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 px-1.5" />}><BreadcrumbEllipsis /></DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {ancestors.slice(2, -1).map((ancestor) => <DropdownMenuItem key={ancestor.id} onMouseDown={() => tabsActions.openView(ancestor)}>{ancestor.name}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </BreadcrumbItem>,
          divider('d2'),
          button(ancestors[ancestors.length - 1]),
          divider('d3'),
        ]
      : ancestors.map((a) => (
          <Fragment key={a.id}>
            {button(a)}
            {divider(`d-${a.id}`)}
          </Fragment>
        ));
  return (
    <Breadcrumb className="min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
      <BreadcrumbList className="w-max flex-nowrap gap-0.5 text-sm">{items}</BreadcrumbList>
    </Breadcrumb>
  );
}
