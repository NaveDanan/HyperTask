import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { CalendarDays, FileText, MessageSquareText, SquareKanban, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { nameOrDefault } from '../view/view-ext';
import { RawEmojiIcon, viewIcon } from '../view-header/ViewIcon';
import { useHyperAppearanceView } from './HyperViewAppearanceView';
export function HyperViewTabBarItem({ view, shortForm }: { view: ViewPB; shortForm: boolean }) {
  const current = useHyperAppearanceView(view), icon = current ? viewIcon(current) : undefined;
  const Icon = view.layout === ViewLayoutPB.Board ? SquareKanban : view.layout === ViewLayoutPB.Calendar ? CalendarDays : view.layout === ViewLayoutPB.Chat ? MessageSquareText : view.layout === ViewLayoutPB.Document ? FileText : Table2;
  return <div className={cn('flex min-w-0 items-center gap-1.5', shortForm && 'justify-center')}>
    {icon ? <RawEmojiIcon icon={icon} size={16} /> : <Icon className="size-4 text-muted-foreground" />}
    {!shortForm && <span className="min-w-0 truncate">{current ? nameOrDefault(current) : ''}</span>}
  </div>;
}
