// Dictation for HyperTask's textarea composers (Nod and Hyper-Bot), wired the way t3code's ChatComposer wires it
// (apps/web/src/components/chat/ChatComposer.tsx: useEnvironmentSpeechInput, useDictationShortcut,
// useDictationSubmissionShortcut, the live transcription box, and ComposerSpeechRecordingPill, ComposerSpeechButton
// and VoiceInputSetup before the send button). Copyright (c) 2026 T3 Tools Inc., MIT License.
// See src/shared/hyper-voice/NOTICE.md. Adapted for HyperTask by NaveDanan.
import { useEffect, useRef, useState, type RefObject } from "react";

import { useGT } from "../gt";
import { useDictationShortcut } from "../speech/useDictationShortcut";
import { useDictationSubmissionShortcut } from "../speech/useDictationSubmissionShortcut";
import { useEnvironmentSpeechInput } from "../speech/useEnvironmentSpeechInput";
import { ComposerSpeechButton, ComposerSpeechRecordingPill } from "./ComposerSpeechButton";
import { VoiceInputSetup } from "./VoiceInputSetup";

type Selection = { readonly start: number; readonly end: number };

/**
 * HyperTask keeps an inactive tab mounted under `display: none`, so a composer there is off screen while it still
 * exists. t3code's `presented` flag follows that here, which lets the global indicator show its recording.
 */
function useElementShown(ref: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => setShown(element.getClientRects().length > 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return shown;
}

export function useHyperComposerDictation(input: {
  /** One draft: `nod`, or `bot:<roomId>`. */
  readonly ownerKey: string;
  /** Names the draft in the indicator shown while its composer is off screen. */
  readonly label: string;
  readonly text: string;
  readonly textareaRef?: RefObject<HTMLTextAreaElement | null>;
  readonly editorRef?: RefObject<{
    readDraft: () => { text: string; selection: Selection };
    focusAt: (start: number, end?: number) => void;
  } | null>;
  readonly formRef: RefObject<HTMLFormElement | null>;
  readonly onTextChange: (text: string) => void;
  /** Sends `text`; called once dictation committed when Send was pressed while it ran. */
  readonly onSubmit: (text: string) => void;
  readonly disabled?: boolean | undefined;
  /** A draft kept outside the composer keeps recording after the composer unmounts. */
  readonly persistentDraft?: {
    readonly readStoredText: () => string | null;
    readonly commitStoredText: (text: string) => void;
    readonly open: () => void;
  };
}) {
  const latest = useRef(input);
  latest.current = input;
  const presented = useElementShown(input.formRef);
  const speech = useEnvironmentSpeechInput({
    ownerKey: input.ownerKey,
    disabled: input.disabled,
    label: input.label,
    presented,
    persistentDraft: input.persistentDraft,
    readDraft: () => {
      const editor = latest.current.editorRef?.current;
      if (editor) return editor.readDraft();
      const field = latest.current.textareaRef?.current;
      const text = field?.value ?? latest.current.text;
      const cursor = field?.selectionStart ?? text.length;
      return { text, selection: { start: cursor, end: field?.selectionEnd ?? cursor } };
    },
    commitDraft: (text: string, selection: Selection) => {
      latest.current.onTextChange(text);
      window.requestAnimationFrame(() => {
        const editor = latest.current.editorRef?.current;
        if (editor) { editor.focusAt(selection.start, selection.end); return; }
        const field = latest.current.textareaRef?.current;
        if (!field) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(selection.start, selection.end);
      });
    },
  });
  // Like ChatComposer's background threads, a composer in a hidden tab answers the chord only while it has focus.
  const shortcutLabel = useDictationShortcut({
    speech,
    disabled: input.disabled ?? false,
    ...(presented ? {} : { targetRef: input.formRef }),
  });
  // ChatComposer's submitComposer: Send while dictating finishes the recording, then sends its transcript.
  const submit = (text: string) => {
    if (speech.blocksSubmission) {
      speech.submitAfterDictation((committed) => latest.current.onSubmit(committed));
      return;
    }
    latest.current.onSubmit(text);
  };
  useDictationSubmissionShortcut({
    enabled: speech.blocksSubmission && !speech.preparing,
    formRef: input.formRef,
    onKeyDown: (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      submit(latest.current.text);
    },
  });
  return { speech, shortcutLabel, submit };
}

export type HyperComposerDictation = ReturnType<typeof useHyperComposerDictation>;

/** ChatComposer's live transcription box, shown under the editor while a recording streams text. */
export function HyperComposerDictationPreview({
  dictation,
  className,
}: {
  dictation: HyperComposerDictation;
  className?: string;
}) {
  const gt = useGT();
  const preview = dictation.speech.preview;
  if (!preview) return null;
  return (
    // column-reverse pins the scroll to the bottom; the single inner div keeps the text in normal order.
    <div
      aria-label={gt("Live transcription")}
      className={
        className ??
        "mb-2 flex max-h-32 flex-col-reverse overflow-y-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap"
      }
    >
      <div>
        <span>{preview.committed}</span>
        <span className="text-muted-foreground">{preview.tentative}</span>
      </div>
    </div>
  );
}

/** The capsule, mic button and first-run setup that ChatComposer renders before its send button. */
export function HyperComposerDictationControls({
  dictation,
  disabled = false,
}: {
  dictation: HyperComposerDictation;
  disabled?: boolean;
}) {
  const { speech, shortcutLabel } = dictation;
  return (
    <>
      {speech.available ? (
        <>
          <ComposerSpeechRecordingPill
            state={speech.state}
            progress={null}
            finishShortcutLabel={shortcutLabel}
            cancelShortcutLabel="Esc"
            level={speech.level}
            recordingStartedAt={speech.recordingStartedAt}
            disabled={disabled}
            onStart={() => void speech.start()}
            onStop={() => void speech.stop()}
            onCancel={() => speech.cancel()}
            onSkipPostProcessing={() => speech.skipPostProcessing()}
          />
          <ComposerSpeechButton
            state={speech.state}
            shortcutLabel={shortcutLabel}
            disabled={disabled}
            onStart={() => void speech.start()}
          />
        </>
      ) : null}
      <VoiceInputSetup
        environmentLabel={speech.transcriptionEnvironmentLabel}
        open={speech.setup.open}
        step={speech.setup.step}
        status={speech.status}
        model={speech.setup.model}
        language={speech.setup.language}
        downloading={speech.setup.downloading}
        error={speech.setup.error}
        onOpenChange={speech.setup.setOpen}
        onRetryCatalog={speech.setup.retryCatalog}
        onDownload={() => void speech.setup.download()}
        onCancelDownload={() => void speech.setup.cancelDownload()}
        onStartRecording={() => void speech.setup.startRecording()}
      />
    </>
  );
}
