import { ViewLayoutPB, type ViewPB } from './protobuf/hyper-folder/view_pb';

export function hyperTaskViewExtra(view: Pick<ViewPB, 'oneOfExtra'>): Record<string, unknown> | null {
  if (view.oneOfExtra.case !== 'extra') return null;
  try {
    const parsed: unknown = JSON.parse(view.oneOfExtra.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export const hyperIsGeneralKanban = (view: Pick<ViewPB, 'oneOfExtra'>) => hyperTaskViewExtra(view)?.hyper_general_kanban === true;

export function hyperTaskViewKind(view: ViewPB) {
  if (view.layout === ViewLayoutPB.Board) return hyperIsGeneralKanban(view) ? 'general' : 'board';
  if (view.layout === ViewLayoutPB.Grid && hyperTaskViewExtra(view)?.hyper_layout === 'gantt') return 'gantt';
}
