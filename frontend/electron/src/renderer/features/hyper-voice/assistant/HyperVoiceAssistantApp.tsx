import { useEffect } from 'react';
import { Square, X } from 'lucide-react';
import { HYPER_DESKTOP_HOTKEY_LABEL } from '@shared/HyperDesktop';
import { useTr } from '@/i18n';
import type { TrOptions } from '@/i18n/translator';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HyperVoiceSphere } from './HyperVoiceSphere';
import { HyperVoiceHud } from './HyperVoiceHud';
import { useHyperVoiceAssistant } from './useHyperVoiceAssistant';
import './HyperVoiceAssistant.css';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function useT() {
  const { tr } = useTr();
  return (key: string, fallback: string, options?: TrOptions) => {
    const resolved = tr(key, options);
    return resolved === key ? fallback : resolved;
  };
}

/**
 * Floating personal voice assistant window mounted when `index.html?mode=voice-overlay` loads.
 * Hosts the live audio-reactive `HyperVoiceSphere` and two-step Confirmation + Outlook Approval HUD.
 */
export function HyperVoiceAssistantApp() {
  const t = useT();
  const assistant = useHyperVoiceAssistant();

  // Enable transparent overlay root styling and match system/app light-dark polarity.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.hyperVoiceOverlay = 'true';
    root.dataset.hyperOverlay = 'true';
    const applyThemePolarity = () => {
      try {
        const stored = window.localStorage.getItem('hypertask.theme.mode');
        if (stored === 'dark' || stored === 'light') {
          root.dataset.theme = stored;
          return;
        }
      } catch {
        // Ignore storage read issues.
      }
      const prefersDark =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = prefersDark ? 'dark' : 'light';
    };
    applyThemePolarity();
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    media?.addEventListener?.('change', applyThemePolarity);
    return () => {
      delete root.dataset.hyperVoiceOverlay;
      delete root.dataset.hyperOverlay;
      media?.removeEventListener?.('change', applyThemePolarity);
    };
  }, []);

  const compactPhase =
    assistant.phase === 'idle' ||
    assistant.phase === 'preparing' ||
    assistant.phase === 'listening' ||
    assistant.phase === 'transcribing' ||
    assistant.phase === 'parsing';

  const sphereSize = compactPhase ? 156 : 92;

  const statusText = (() => {
    switch (assistant.phase) {
      case 'idle':
        return t('hyperVoiceAssistant.status.idle', 'Click sphere or press {hotkey}', {
          namedArgs: { hotkey: HYPER_DESKTOP_HOTKEY_LABEL },
        });
      case 'preparing':
        return t('hyperVoiceAssistant.status.preparing', 'Starting microphone…');
      case 'listening':
        return t('hyperVoiceAssistant.status.listening', 'Listening…');
      case 'transcribing':
        return t('hyperVoiceAssistant.status.transcribing', 'Transcribing…');
      case 'parsing':
        return t('hyperVoiceAssistant.status.parsing', 'Finding bot & people…');
      default:
        return null;
    }
  })();

  const sphereAriaLabel =
    assistant.phase === 'listening'
      ? t('hyperVoiceAssistant.sphereStopLabel', 'Stop listening and process voice command')
      : t('hyperVoiceAssistant.sphereStartLabel', 'Start speaking to Hyper-Bot');

  return (
    <TooltipProvider delay={400}>
      <div
        className="hva-root"
        data-phase={assistant.phase}
        data-pinned={assistant.pinned ? 'true' : 'false'}
      >
        <div className="hva-top-bar">
          <button
            type="button"
            className="hva-close-corner"
            aria-label={t('hyperVoiceAssistant.closeOverlay', 'Close voice assistant')}
            onClick={assistant.cancelAndHide}
          >
            <X className="size-3.5" />
          </button>

          <HyperVoiceSphere
            phase={assistant.phase}
            analyserRef={assistant.analyserRef}
            levelRef={assistant.levelRef}
            size={sphereSize}
            onClick={assistant.handleSphereClick}
            ariaLabel={sphereAriaLabel}
          />
        </div>

        {compactPhase && (
          <div className="hva-pill" role="status" aria-live="polite">
            <div className="hva-pill__status">
              {assistant.phase === 'listening' && <span className="hva-dot-pulse" aria-hidden="true" />}
              <span>{statusText}</span>
              {assistant.phase === 'listening' && (
                <span className="tabular-nums text-[11px] text-muted-foreground">
                  {formatElapsed(assistant.elapsedSeconds)}
                </span>
              )}
            </div>

            {assistant.preview && (assistant.preview.committed || assistant.preview.tentative) && (
              <div className="hva-pill__transcript" dir="auto">
                <span>{assistant.preview.committed}</span>
                {assistant.preview.tentative && (
                  <span className="hva-pill__tentative">{assistant.preview.tentative}</span>
                )}
              </div>
            )}

            {assistant.statusNotice && (
              <p className="hva-pill__meta" dir="auto">
                {assistant.statusNotice}
              </p>
            )}

            {assistant.phase === 'listening' && (
              <>
                <p className="hva-pill__meta">
                  {t(
                    'hyperVoiceAssistant.stopHint',
                    'Pause to finish · Enter or {hotkey} to send · Esc to cancel',
                    { namedArgs: { hotkey: HYPER_DESKTOP_HOTKEY_LABEL } },
                  )}
                </p>
                {assistant.englishOnlyLocalModel && (
                  <p className="hva-pill__meta">
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={assistant.openVoiceSettings}
                    >
                      {t(
                        'hyperVoiceAssistant.hebrewModelTip',
                        'Tip: switch to Whisper Large v3 Turbo or Cloud STT for Hebrew.',
                      )}
                    </button>
                  </p>
                )}
                <div className="hva-pill__actions">
                  <Button type="button" size="sm" onClick={() => void assistant.stopAndProcess()}>
                    <Square className="size-3 fill-current" />
                    {t('hyperVoiceAssistant.finishSpeaking', 'Done')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={assistant.cancelAndHide}>
                    {t('hyperVoiceAssistant.cancel', 'Cancel')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <HyperVoiceHud
          phase={assistant.phase}
          errorMessage={assistant.errorMessage}
          missingLocalModel={assistant.missingLocalModel}
          downloadingModel={assistant.downloadingModel}
          downloadProgress={assistant.downloadProgress}
          plan={assistant.plan}
          commandText={assistant.commandText}
          onCommandTextChange={assistant.setCommandText}
          selectedBot={assistant.selectedBot}
          onSelectBot={assistant.selectBot}
          peopleSlots={assistant.peopleSlots}
          unresolvedCount={assistant.unresolvedCount}
          missingTools={assistant.missingTools}
          enableMissingTools={assistant.enableMissingTools}
          onEnableMissingToolsChange={assistant.setEnableMissingTools}
          onSelectCandidate={assistant.selectCandidateForSlot}
          onRemovePerson={assistant.removePersonSlot}
          onAddPerson={assistant.addPersonSlot}
          onSearchPeople={assistant.searchDirectoryPeople}
          execution={assistant.execution}
          decidingIds={assistant.decidingIds}
          onParseTypedCommand={(text) => void assistant.parseTranscript(text)}
          onConfirmDispatch={() => void assistant.confirmAndDispatch()}
          onDecideApproval={(id, approved, delivery) => void assistant.decideApproval(id, approved, delivery)}
          onReRecord={() => void assistant.startListening()}
          onCancel={assistant.cancelAndHide}
          onEnableLocalMultilingual={() => void assistant.enableLocalMultilingualVoice()}
          onOpenVoiceSettings={assistant.openVoiceSettings}
          onOpenInHyperBot={assistant.openInHyperBot}
        />
      </div>
    </TooltipProvider>
  );
}

export default HyperVoiceAssistantApp;
