import { useRef } from 'react';
import { Bug, CircleHelp, FileText, Keyboard, MessageCircle, Star, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MenuFootnote, MenuRow, MenuSeparator } from '@/components/app/menu-row';
import { useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { AppFlowyPopover, Tooltip, showToast, type PopoverController } from '@/ui';

interface BubbleAction {
  label: string;
  icon: LucideIcon;
  run: () => void;
}

const open = (url: string) => void window.appflowy.shell.openExternal(url).catch(() => {});

/** QuestionBubble (workspace/presentation/widgets/float_bubble/question_bubble.dart). */
export function QuestionBubble() {
  const { tr } = useTr();
  const controller = useRef<PopoverController>(null);
  const info = useAppStore((s) => s.info);
  const dataDirectory = useAppStore((s) => s.dataDirectory);
  const deviceId = useAppStore((s) => s.deviceId);

  const actions: BubbleAction[] = [
    { label: tr('questionBubble.whatsNew'), icon: Star, run: () => open('https://github.com/NaveDanan/HyperTask') },
    { label: tr('questionBubble.helpAndDocumentation'), icon: CircleHelp, run: () => open('https://github.com/NaveDanan/HyperTask#readme') },
    { label: tr('questionBubble.getSupport'), icon: MessageCircle, run: () => open('https://github.com/NaveDanan/HyperTask/issues') },
    {
      label: tr('questionBubble.debug.name'),
      icon: Bug,
      run: () => {
        const lines = [
          `Version: ${info?.version ?? ''}`,
          `Platform: ${info?.platform ?? ''}`,
          `Device id: ${deviceId}`,
          `Document: ${dataDirectory}`,
        ];
        window.appflowy.clipboard.writeText(lines.join('\n'));
        showToast({ message: tr('questionBubble.debug.success') });
      },
    },
    { label: tr('questionBubble.shortcuts'), icon: Keyboard, run: () => open('https://github.com/NaveDanan/HyperTask#development') },
    { label: tr('questionBubble.markdown'), icon: FileText, run: () => open('https://github.com/NaveDanan/HyperTask#development') },
    { label: tr('questionBubble.feedback'), icon: MessageCircle, run: () => open('https://github.com/NaveDanan/HyperTask/issues') },
  ];

  return (
    <div className="absolute right-6 bottom-6 z-1">
      <AppFlowyPopover
        controllerRef={controller}
        direction="topWithRightAligned"
        offset={{ x: 0, y: -8 }}
        constraints={{ minWidth: 224, maxWidth: 224, maxHeight: 400 }}
        popup={(close) => (
          <div className="flex flex-col">
            {actions.map((action, index) => (
              <MenuRow key={index} label={action.label} icon={<action.icon className="size-4" />}
                onClick={() => { action.run(); close(); }} />
            ))}
            <MenuSeparator />
            <MenuFootnote>{`HyperTask ${info?.version ?? ''}`}</MenuFootnote>
          </div>
        )}
      >
        <Tooltip message={tr('questionBubble.getSupport')}>
          <Button variant="outline" size="icon-sm" className="rounded-full bg-background shadow-sm" aria-label={tr('questionBubble.getSupport')}>
            <CircleHelp className="size-4" />
          </Button>
        </Tooltip>
      </AppFlowyPopover>
    </div>
  );
}
