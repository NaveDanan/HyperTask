// Copied from t3code (apps/web/src/speech/useEnvironmentSpeechInput.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: one transcription environment (the app's main process,
// HYPERTASK_SPEECH_ENVIRONMENT); no draft environment, project vocabulary or router; first-run setup opens
// Settings → Voice.
import {
  cancelEnvironmentSpeechModelDownload,
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getEnvironmentSpeechStatus,
  selectEnvironmentSpeechModel,
  voiceInputBlocksSubmission,
  type VoiceInputState,
} from "../runtime";
import { CLOUD_SPEECH_LABELS } from "@shared/hyper-voice/speech";
import type {
  EnvironmentSpeechModel,
  EnvironmentSpeechStatus,
  SpeechBenchmarkTier,
} from "@shared/hyper-voice/speech";
import { chooseSetupSpeechModel } from "@shared/hyper-voice/speechShared";
import { msg, useGT } from "../gt";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { toastManager } from "../ui/toast";
import { m } from "../gt";
import { useClientSettings, useClientSettingsHydrated } from "../settings";
import { openVoiceSettings } from "./openVoiceSettings";
import { preferredSpeechLanguages } from "./preferredSpeechLanguages";
import { runEnvironmentSpeech } from "../environment";
import { useAudioChoice } from "./voiceConsent";
import {
  IDLE_VOICE_STATE,
  presentVoiceOwner,
  useRetainedVoiceInputSession,
  useVoiceInputSessionActivity,
  useVoiceInputSessionSnapshot,
  type VoiceInputTarget,
} from "./voiceInputSession";

/**
 * HyperTask's one transcription environment: the app's own main process. t3code passes a prepared connection to
 * the chosen environment; here it is this constant while a destination is chosen, and null otherwise.
 */
export const HYPERTASK_SPEECH_ENVIRONMENT = { label: "this computer" } as const;
export type PreparedConnection = typeof HYPERTASK_SPEECH_ENVIRONMENT;

const WAITING_STATE: VoiceInputState = { phase: "preparing", error: null, errorAction: null };
const INITIAL_SETUP = {
  open: false,
  step: 0,
  model: null as EnvironmentSpeechModel | null,
  language: null as string | null,
  downloading: false,
  catalogFailed: false,
  error: null as string | null,
};

// Every mounted editor shares one status probe per destination; starting a recording refreshes it.
const statusProbes = new WeakMap<PreparedConnection, Promise<EnvironmentSpeechStatus>>();
function probeSpeechStatus(prepared: PreparedConnection, refresh = false) {
  const cached = refresh ? undefined : statusProbes.get(prepared);
  if (cached) return cached;
  const probe = runEnvironmentSpeech(getEnvironmentSpeechStatus());
  statusProbes.set(prepared, probe);
  probe.catch(() => {
    if (statusProbes.get(prepared) === probe) statusProbes.delete(prepared);
  });
  return probe;
}

type DraftInput = {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
};

type HookInput = {
  readonly ownerKey: string;
  readonly disabled?: boolean | undefined;
  /**
   * Until a destination is chosen, voice input is offered and its first gesture opens Voice
   * settings. False hides it instead, for editors whose draft would not survive the navigation.
   */
  readonly offerSetup?: boolean | undefined;
  /** False keeps the transcript off the cleanup provider even when cleanup is on; the model test uses it. */
  readonly cleanup?: boolean | undefined;
  readonly readDraft: () => DraftInput;
  readonly commitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => void;
  /** Names the draft in the indicator shown while a recording's editor is off screen. */
  readonly label?: string | null | undefined;
  /** False while the editor stays mounted out of sight, so the indicator still shows. */
  readonly presented?: boolean | undefined;
  /**
   * A draft that is stored outside its editor keeps recording when the editor shows another
   * owner or unmounts; the transcript lands in the stored draft instead.
   */
  readonly persistentDraft?:
    | {
        readonly readStoredText: () => string | null;
        readonly commitStoredText: (text: string) => void;
        readonly open: () => void;
      }
    | undefined;
};

/**
 * Microphone audio leaves this device only for the destination the person chose in
 * Voice settings, and the recording is abandoned the moment that choice changes.
 */
export function useVoiceTranscriptionDestination() {
  const gt = useGT();
  const hydrated = useClientSettingsHydrated();
  const choice = useAudioChoice();
  const grant = choice === "off" || !hydrated ? null : choice;
  const cloud = grant?.destination.kind === "cloud" ? grant.destination : undefined;
  const provider = cloud?.provider;
  const model = cloud?.provider === "openrouter" ? cloud.model : undefined;
  return {
    ...(hydrated && choice === null ? { offerFirstRunSetup: true } : {}),
    ...(provider ? { cloudProvider: provider } : {}),
    ...(model ? { cloudModel: model } : {}),
    grantId: grant?.id ?? null,
    label: provider
      ? gt("{provider} via HyperTask", { provider: CLOUD_SPEECH_LABELS[provider] })
      : grant
        ? gt("this computer")
        : null,
    prepared: grant ? HYPERTASK_SPEECH_ENVIRONMENT : null,
  };
}

export function useEnvironmentSpeechInput(input: HookInput) {
  const destination = useVoiceTranscriptionDestination();
  const prepared = destination.prepared;
  const grantId = destination.grantId;
  const cloudProvider = destination.cloudProvider;
  const cloudModel = destination.cloudModel;
  const clientSettings = useClientSettings();
  const [status, setStatus] = useState<{
    readonly prepared: PreparedConnection;
    readonly value: EnvironmentSpeechStatus | null;
  } | null>(null);
  const [queuedStart, setQueuedStart] = useState<PreparedConnection | null>(null);
  const [setup, setSetup] = useState(INITIAL_SETUP);
  const [previousDestination, setPreviousDestination] = useState({ prepared, grantId });
  const [previousOwner, setPreviousOwner] = useState({
    key: input.ownerKey,
    disabled: input.disabled,
  });
  if (previousDestination.prepared !== prepared || previousDestination.grantId !== grantId) {
    setPreviousDestination({ prepared, grantId });
    setSetup(INITIAL_SETUP);
    setQueuedStart(null);
  }
  if (previousOwner.key !== input.ownerKey || previousOwner.disabled !== input.disabled) {
    setPreviousOwner({ key: input.ownerKey, disabled: input.disabled });
    setQueuedStart(null);
    setSetup(INITIAL_SETUP);
  }

  const session = useRetainedVoiceInputSession({ grantId, cloudProvider, cloudModel });
  const snapshot = useVoiceInputSessionSnapshot(session);
  const owns = snapshot.target?.ownerKey === input.ownerKey;
  const activity = useVoiceInputSessionActivity(session, input.ownerKey);
  const state: VoiceInputState =
    queuedStart === prepared && prepared ? WAITING_STATE : owns ? snapshot.state : IDLE_VOICE_STATE;
  // One microphone: another draft's recording leaves this editor without voice input until it ends.
  const busyElsewhere = !owns && voiceInputBlocksSubmission(snapshot.state);

  const startRequestRef = useRef(0);
  const pendingSubmissionRef = useRef<{
    ownerKey: string;
    submit: (text: string) => void;
    text?: string;
  } | null>(null);
  const latestRef = useRef({ input, clientSettings, session });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes committed props before an async completion can read them through the session
  useLayoutEffect(() => {
    latestRef.current = { input, clientSettings, session };
  });
  const mountedRef = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- abandons this editor's pending work, and a recording that cannot outlive it, on unmount or a destination change
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingSubmissionRef.current = null;
      startRequestRef.current += 1;
      session?.ownerChanged(latestRef.current.input.ownerKey);
    };
  }, [session]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the global indicator this draft is on screen
  useEffect(
    () => (input.presented === false ? undefined : presentVoiceOwner(input.ownerKey)),
    [input.ownerKey, input.presented],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- probes the chosen environment's speech status once its connection is available
  useEffect(() => {
    if (!prepared || cloudProvider) return;
    let disposed = false;
    void probeSpeechStatus(prepared)
      .then((value) => {
        if (!disposed) setStatus({ prepared, value });
      })
      .catch(() => {
        if (!disposed) setStatus({ prepared, value: null });
      });
    return () => {
      disposed = true;
    };
  }, [prepared, cloudProvider]);
  const currentStatus = !cloudProvider && status?.prepared === prepared ? status.value : null;
  const setupModelId = setup.model?.id;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls download progress while the setup dialog owns an active model download
  useEffect(() => {
    if (!setup.open || !setup.downloading || !prepared || !setupModelId) return;
    let disposed = false;
    let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      void runEnvironmentSpeech(getEnvironmentSpeechModels())
        .then((result) => {
          if (disposed) return;
          const model = result.models.find((candidate) => candidate.id === setupModelId) ?? null;
          if (model)
            setSetup((current) => ({
              ...current,
              model: { ...model, recommended: current.model?.recommended ?? false },
            }));
        })
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
        });
    }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [prepared, setup.downloading, setup.open, setupModelId]);

  const previousOwnerRef = useRef(input.ownerKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- abandons any queued submission, and a recording that cannot outlive its editor, when the draft's owner changes
  useEffect(() => {
    const previous = previousOwnerRef.current;
    if (previous === input.ownerKey && !input.disabled) return;
    previousOwnerRef.current = input.ownerKey;
    pendingSubmissionRef.current = null;
    startRequestRef.current += 1;
    if (previous !== input.ownerKey) session?.ownerChanged(previous);
    else if (session?.ownerKey === input.ownerKey) session.cancel();
  }, [input.ownerKey, input.disabled, session]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- delivers a queued submission only after the transcript has committed to the draft
  useEffect(() => {
    const pending = pendingSubmissionRef.current;
    if (state.phase === "error") pendingSubmissionRef.current = null;
    if (state.phase !== "idle" || !pending) return;
    pendingSubmissionRef.current = null;
    if (!input.disabled && pending.ownerKey === input.ownerKey && pending.text !== undefined)
      pending.submit(pending.text);
  }, [state, input.ownerKey, input.disabled]);

  const submitAfterDictation = useStableCallback((submit: (text: string) => void) => {
    if (latestRef.current.input.disabled || state.phase === "preparing") return;
    if (!session || !voiceInputBlocksSubmission(state)) {
      submit(latestRef.current.input.readDraft().text);
      return;
    }
    if (pendingSubmissionRef.current) return;
    pendingSubmissionRef.current = { ownerKey: latestRef.current.input.ownerKey, submit };
    if (session.state.phase === "recording") void session.stop();
  });

  const createTarget = useStableCallback((): VoiceInputTarget => {
    const owner = latestRef.current.input.ownerKey;
    const readContext = () => {
      const current = latestRef.current;
      return {
        clientSettings: current.clientSettings,
        cleanup: current.input.cleanup !== false,
      };
    };
    // Once this editor shows another draft, its cleanup must not see this one.
    const startContext = readContext();
    const persistent = latestRef.current.input.persistentDraft ?? null;
    // While this editor shows the owner, the live editor is the draft; otherwise the stored one.
    const live = () => mountedRef.current && latestRef.current.input.ownerKey === owner;
    return {
      ownerKey: owner,
      label: latestRef.current.input.label ?? null,
      persistent: persistent !== null,
      open: persistent?.open ?? null,
      readDraft: () => {
        if (live()) return latestRef.current.input.readDraft();
        const text = persistent?.readStoredText();
        return text == null ? null : { text, selection: { start: text.length, end: text.length } };
      },
      commitDraft: (text, selection) => {
        if (!live()) {
          persistent?.commitStoredText(text);
          return;
        }
        if (latestRef.current.input.disabled) return;
        latestRef.current.input.commitDraft(text, selection);
        if (pendingSubmissionRef.current?.ownerKey === owner)
          pendingSubmissionRef.current.text = text;
      },
      readContext: () => (live() ? readContext() : startContext),
    };
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a remounted editor takes over its draft's running recording so a queued Send still sees the transcript
  useEffect(() => {
    if (session?.ownerKey === input.ownerKey && voiceInputBlocksSubmission(session.state))
      session.adopt(createTarget());
  }, [session, input.ownerKey, createTarget]);
  const loadSetupCatalog = useStableCallback(
    async (
      _connection: PreparedConnection,
      selectedModelId: string,
      benchmarkTier: SpeechBenchmarkTier,
      request: number,
    ) => {
      setSetup({ ...INITIAL_SETUP, open: true });
      const catalog = await runEnvironmentSpeech(getEnvironmentSpeechModels(true)).catch(
        () => null,
      );
      if (request !== startRequestRef.current) return;
      const choice = chooseSetupSpeechModel(catalog?.models ?? [], {
        selectedModelId,
        intent: latestRef.current.clientSettings.speechLanguage,
        preferred: preferredSpeechLanguages(),
        benchmarkTier,
      });
      setSetup((current) => ({
        ...current,
        model: choice ? { ...choice.model, recommended: choice.recommended } : null,
        language: choice?.language ?? null,
        catalogFailed: catalog === null,
        error: choice
          ? null
          : catalog
            ? m(
                msg(
                  "No model matches your language. Choose a model or change the language in Voice settings.",
                ),
              )
            : m(msg("Could not load transcription models. Check the connection and try again.")),
      }));
    },
  );

  const start = useStableCallback(async () => {
    if (latestRef.current.input.disabled || (setup.open && setup.downloading)) return;
    if (!grantId) {
      if (destination.offerFirstRunSetup && latestRef.current.input.offerSetup !== false)
        openVoiceSettings();
      return;
    }
    const request = ++startRequestRef.current;
    const owner = latestRef.current.input.ownerKey;
    if (!session || !prepared || busyElsewhere) return;
    if (cloudProvider) {
      await session.start(createTarget());
      return;
    }
    const stillCurrent = () =>
      request === startRequestRef.current &&
      latestRef.current.session === session &&
      latestRef.current.input.ownerKey === owner &&
      !latestRef.current.input.disabled;
    setSetup(INITIAL_SETUP);
    setQueuedStart(prepared);
    let latestStatus: EnvironmentSpeechStatus;
    try {
      latestStatus = await probeSpeechStatus(prepared, true);
    } catch (error) {
      if (!stillCurrent()) return;
      setQueuedStart(null);
      toastManager.add({
        type: "error",
        title: m(msg("Could not start voice input")),
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!stillCurrent()) return;
    setStatus({ prepared, value: latestStatus });
    setQueuedStart(null);
    if (latestStatus.supported && latestStatus.state === "missing-model") {
      return loadSetupCatalog(prepared, latestStatus.modelId, latestStatus.benchmarkTier, request);
    }
    if (!latestStatus.supported) {
      toastManager.add({
        type: "error",
        title: m(msg("Voice input is not available")),
        description: latestStatus.reason,
      });
      return;
    }
    await session.start(createTarget());
  });

  const downloadSetupModel = useStableCallback(async () => {
    if (!prepared || !currentStatus?.supported || !setupModelId || setup.downloading) return;
    const modelId = setupModelId;
    const request = ++startRequestRef.current;
    setSetup((current) => ({ ...current, downloading: true, error: null }));
    try {
      const { models } = await runEnvironmentSpeech(
        downloadEnvironmentSpeechModel(modelId),
      );
      if (request !== startRequestRef.current) return;
      // A download cancelled from elsewhere still resolves, so select the model only once it landed.
      const installed = models.some(({ id, state }) => id === modelId && state === "installed");
      if (installed && modelId !== currentStatus.modelId) {
        try {
          await runEnvironmentSpeech(selectEnvironmentSpeechModel(modelId));
        } catch {
          if (request !== startRequestRef.current) return;
          setSetup((current) => ({
            ...current,
            downloading: false,
            error: m(
              msg("The model downloaded, but HyperTask could not select it. Try again."),
            ),
          }));
          return;
        }
      }
      if (request !== startRequestRef.current) return;
      const next = await probeSpeechStatus(prepared, true);
      if (request !== startRequestRef.current) return;
      setStatus({ prepared, value: next });
      const ready =
        installed && next.supported && next.modelId === modelId && next.state !== "missing-model";
      setSetup((current) => ({
        ...current,
        downloading: false,
        step: ready ? 1 : current.step,
        error: ready ? null : m(msg("The model is not ready. Try downloading it again.")),
      }));
    } catch {
      if (request !== startRequestRef.current) return;
      setSetup((current) => ({
        ...current,
        downloading: false,
        error: m(
          msg("Could not download the model. Check your connection and try again."),
        ),
      }));
    }
  });

  const cancelSetupDownload = useStableCallback(async () => {
    if (!prepared || !setupModelId) return;
    startRequestRef.current += 1;
    setSetup((current) => ({ ...current, open: false, downloading: false }));
    try {
      await runEnvironmentSpeech(cancelEnvironmentSpeechModelDownload(setupModelId));
    } catch (error) {
      setSetup((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  const destinationReady =
    grantId === null
      ? Boolean(destination.offerFirstRunSetup) && input.offerSetup !== false
      : prepared !== null &&
        (cloudProvider !== undefined ||
          (status?.prepared === prepared && status.value?.supported !== false));
  return {
    available:
      destinationReady &&
      !busyElsewhere &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof AudioWorkletNode !== "undefined",
    status: currentStatus,
    transcriptionEnvironmentLabel: destination.label,
    setup: {
      ...setup,
      setOpen: (open: boolean) => setSetup((current) => ({ ...current, open })),
      retryCatalog:
        setup.open && setup.catalogFailed && prepared && currentStatus?.supported
          ? () =>
              loadSetupCatalog(
                prepared,
                currentStatus.modelId,
                currentStatus.benchmarkTier,
                ++startRequestRef.current,
              )
          : null,
      download: downloadSetupModel,
      cancelDownload: cancelSetupDownload,
      startRecording: async () => {
        setSetup((current) => ({ ...current, open: false }));
        await start();
      },
    },
    state,
    preview:
      state.phase === "recording" || state.phase === "transcribing" ? activity.preview : null,
    level: activity.level,
    recordingStartedAt: owns ? snapshot.recordingStartedAt : null,
    preparing: state.phase === "preparing",
    blocksSubmission: voiceInputBlocksSubmission(state),
    freezesEditor: voiceInputBlocksSubmission(state),
    start,
    submitAfterDictation,
    stop: useStableCallback(() => (owns && session ? session.stop() : Promise.resolve())),
    cancel: useStableCallback(() => {
      pendingSubmissionRef.current = null;
      startRequestRef.current += 1;
      setQueuedStart(null);
      setSetup(INITIAL_SETUP);
      if (owns) session?.cancel();
    }),
    skipPostProcessing: useStableCallback(() => {
      if (owns) session?.skipPostProcessing();
    }),
  };
}
