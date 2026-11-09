import { useRef } from 'react';
import { FlowySvg } from '@/icons/FlowySvg';
import { useTr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { useBrightness } from '@/theme/appearance-store';
import { ActionRow, AppFlowyPopover, FlowyText, Tooltip, showToast, type PopoverController } from '@/ui';
import type { FlowySvgName } from '@/icons/flowy-svgs';

interface BubbleAction {
  label: string;
  icon: FlowySvgName;
  run: () => void;
}

const open = (url: string) => void window.appflowy.shell.openExternal(url).catch(() => {});

/** QuestionBubble (workspace/presentation/widgets/float_bubble/question_bubble.dart). */
export function QuestionBubble() {
  const { tr } = useTr();
  const light = useBrightness() === 'light';
  const controller = useRef<PopoverController>(null);
  const info = useAppStore((s) => s.info);
  const dataDirectory = useAppStore((s) => s.dataDirectory);
  const deviceId = useAppStore((s) => s.deviceId);

  const actions: BubbleAction[] = [
    { label: tr('questionBubble.whatsNew'), icon: 'star_s', run: () => open('https://github.com/NaveDanan/HyperTask') },
    { label: tr('questionBubble.helpAndDocumentation'), icon: 'help_and_documentation_s', run: () => open('https://github.com/NaveDanan/HyperTask#readme') },
    { label: tr('questionBubble.getSupport'), icon: 'message_support_s', run: () => open('https://github.com/NaveDanan/HyperTask/issues') },
    {
      label: tr('questionBubble.debug.name'),
      icon: 'debug_s',
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
    { label: tr('questionBubble.shortcuts'), icon: 'keyboard_s', run: () => open('https://github.com/NaveDanan/HyperTask#development') },
    { label: tr('questionBubble.markdown'), icon: 'number_s', run: () => open('https://github.com/NaveDanan/HyperTask#development') },
    { label: tr('questionBubble.feedback'), icon: 'share_feedback_s', run: () => open('https://github.com/NaveDanan/HyperTask/issues') },
  ];

  return (
    <div style={{ position: 'absolute', right: 20, bottom: 16, zIndex: 1 }}>
      <AppFlowyPopover
        controllerRef={controller}
        direction="topWithRightAligned"
        offset={{ x: 0, y: -8 }}
        constraints={{ minWidth: 200, maxWidth: 460, maxHeight: 400 }}
        popup={(close) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {actions.map((action) => (
              <ActionRow
                key={action.icon}
                name={action.label}
                leftIcon={<FlowySvg svg={action.icon} />}
                onTap={() => {
                  action.run();
                  close();
                }}
              />
            ))}
            <div style={{ height: 30 }}>
              <div style={{ height: 1, background: 'var(--th-divider)' }} />
              <div style={{ height: 6 }} />
              <FlowyText fontSize={12} color="var(--th-hint)" style={{ padding: '0 10px' }}>
                {`HyperTask ${info?.version ?? ''}`}
              </FlowyText>
            </div>
          </div>
        )}
      >
        <Tooltip message={tr('questionBubble.getSupport')}>
          <div
            style={{
              width: 32,
              height: 32,
              padding: 8,
              borderRadius: 18,
              cursor: 'pointer',
              background: light ? '#FFFFFF' : '#242B37',
              border: `0.5px solid ${light ? '#4548492D' : '#FFFFFF2D'}`,
              boxShadow: light ? '0 8px 20px #00000014' : undefined,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FlowySvg svg="help_center_s" color={light ? '#000000' : '#FFFFFF'} />
          </div>
        </Tooltip>
      </AppFlowyPopover>
    </div>
  );
}
