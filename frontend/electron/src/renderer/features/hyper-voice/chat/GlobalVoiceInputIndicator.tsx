// Copied from t3code (apps/web/src/components/chat/GlobalVoiceInputIndicator.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: sessions key on the audio grant alone.
import { useGT } from "../gt";
import { useVoiceTranscriptionDestination } from "../speech/useEnvironmentSpeechInput";
import {
  useRetainedVoiceInputSession,
  useVoiceInputSessionActivity,
  useVoiceInputSessionSnapshot,
  useVoiceOwnerPresented,
} from "../speech/voiceInputSession";
import { Button } from "../ui/button";
import { ComposerSpeechRecordingPill } from "./ComposerSpeechButton";

/**
 * Keeps the chosen destination's dictation alive across navigation and, while the draft it
 * records into is off screen, shows it so it can be finished, cancelled, or returned to.
 */
export function GlobalVoiceInputIndicator({ hidden = false }: { hidden?: boolean }) {
  const gt = useGT();
  const { grantId, cloudProvider, cloudModel } = useVoiceTranscriptionDestination();
  const session = useRetainedVoiceInputSession({ grantId, cloudProvider, cloudModel });
  const { state, target, recordingStartedAt } = useVoiceInputSessionSnapshot(session);
  const presented = useVoiceOwnerPresented(target?.ownerKey ?? null);
  const { level } = useVoiceInputSessionActivity(
    hidden || presented ? null : session,
    target?.ownerKey ?? null,
  );
  if (hidden || !session || !target || state.phase === "idle" || presented) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-100 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-popover p-0.5 shadow-lg/5">
        <Button
          type="button"
          size="sm-pill"
          variant="ghost"
          disabled={!target.open}
          onClick={() => target.open?.()}
          className="min-w-0 shrink"
        >
          <span className="truncate">{target.label ?? gt("Untitled draft")}</span>
        </Button>
        <ComposerSpeechRecordingPill
          state={state}
          progress={null}
          level={level}
          recordingStartedAt={recordingStartedAt}
          onStart={() => void session.start(target)}
          onStop={() => void session.stop()}
          onCancel={() => session.cancel()}
          onSkipPostProcessing={() => session.skipPostProcessing()}
        />
      </div>
    </div>
  );
}
