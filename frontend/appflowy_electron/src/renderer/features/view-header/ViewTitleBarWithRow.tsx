import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetViewAncestors } from '@/backend/events';
import { FlowySvg, FlowyText, Tooltip } from '@/ui';
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
    <Tooltip key={v.id} message={v.name}>
      <ViewTitle view={v} editable={false} onUpdated={() => {}} />
    </Tooltip>
  );
  const divider = (key: string) => <FlowySvg key={key} svg="title_bar_divider_s" />;
  const items: ReactNode[] =
    ancestors.length > 2
      ? [
          button(ancestors[1]),
          divider('d1'),
          <FlowyText.regular key="e" style={{ whiteSpace: 'pre' }}>
            {' ... '}
          </FlowyText.regular>,
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
    <div style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', minWidth: 0 }}>
      <div style={{ height: 24, display: 'flex', alignItems: 'center', width: 'max-content' }}>{items}</div>
    </div>
  );
}
