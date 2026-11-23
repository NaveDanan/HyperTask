import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HyperAssistantBotCandidate,
  HyperAssistantConfirmedPerson,
  HyperAssistantIntent,
  HyperAssistantPerson,
  HyperAssistantPersonSlot,
  HyperVoiceCommandPlan,
} from '@shared/HyperAssistant';
import type {
  HyperBotsApproval,
  HyperBotsDelivery,
  HyperBotsRunStatus,
  HyperBotsSettings,
  HyperBotsToolName,
} from '@shared/HyperBots';
import type {
  CloudSpeechModelId,
  CloudSpeechProvider,
  EnvironmentSpeechStatus,
  SpeechStreamText,
  SpeechTranscriptionOptions,
} from '@shared/hyper-voice/speech';
import {
  cloudSpeechLanguages,
  effectiveSpeechLanguage,
  resolveSpeechVocabulary,
} from '@shared/hyper-voice/speechShared';
import { createBrowserPcmCapture } from '../speech/browserPcmCapture';
import { chooseRecordingMicrophone } from '../speech/browserMicrophones';
import { bindAudioGrant, chooseAudioDestination, readCleanupGrant, useAudioChoice } from '../speech/voiceConsent';
import { useClientSettings } from '../settings';
import {
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getEnvironmentSpeechStatus,
  openSpeechStream,
  postProcessEnvironmentTranscript,
  requireCloudSpeechKey,
  selectEnvironmentSpeechModel,
  throwIfVoiceTranscriptionAborted,
  transcribeCloudPcm,
  transcribeEnvironmentPcm,
  VOICE_RECORDING_LIMIT_SECONDS,
  type VoiceStreamingSession,
} from '../runtime';
import { runEnvironmentSpeech } from '../environment';
import type { HyperVoiceSpherePhase } from './HyperVoiceSphere';

export const MULTILINGUAL_RECOMMENDED_MODEL_ID = 'handy-computer/whisper-large-v3-turbo-gguf';

export const VOICE_VAD_SPEECH_THRESHOLD = 0.08;
export const VOICE_VAD_MIN_SPEECH_MS = 250;
export const VOICE_VAD_SILENCE_MS = 1_800;
export const VOICE_VAD_INITIAL_GRACE_MS = 6_000;

export const OVERLAY_SIZE_COMPACT = { width: 320, height: 300 } as const;
export const OVERLAY_SIZE_SETUP = { width: 440, height: 360 } as const;
export const OVERLAY_SIZE_EXPANDED = { width: 492, height: 590 } as const;

export type HyperVoiceAssistantPhase = HyperVoiceSpherePhase;

export type HyperVoiceVadAction = 'continue' | 'auto-stop' | 'grace-timeout';

export interface HyperVoiceVadConfig {
  readonly speechThreshold?: number;
  readonly minSpeechMs?: number;
  readonly silenceMs?: number;
  readonly initialGraceMs?: number;
}

/**
 * Pure end-of-utterance Voice Activity Detection tracker:
 * - Arms silence auto-stop once continuous voiced audio exceeds `minSpeechMs`.
 * - Fires `'auto-stop'` after `silenceMs` (~1.8s) of silence following speech.
 * - Fires `'grace-timeout'` if no speech is detected within `initialGraceMs` (~6s).
 */
export function createHyperVoiceVadTracker(startedAt: number, config: HyperVoiceVadConfig = {}) {
  const speechThreshold = config.speechThreshold ?? VOICE_VAD_SPEECH_THRESHOLD;
  const minSpeechMs = config.minSpeechMs ?? VOICE_VAD_MIN_SPEECH_MS;
  const silenceMs = config.silenceMs ?? VOICE_VAD_SILENCE_MS;
  const initialGraceMs = config.initialGraceMs ?? VOICE_VAD_INITIAL_GRACE_MS;

  let speechOnsetAt: number | null = null;
  let hasSpoken = false;
  let silenceStartedAt: number | null = null;

  return {
    get hasSpoken() {
      return hasSpoken;
    },
    update(level: number, now: number): HyperVoiceVadAction {
      if (level >= speechThreshold) {
        silenceStartedAt = null;
        if (speechOnsetAt === null) speechOnsetAt = now;
        if (!hasSpoken && now - speechOnsetAt >= minSpeechMs) {
          hasSpoken = true;
        }
        return 'continue';
      }
      if (hasSpoken) {
        if (silenceStartedAt === null) silenceStartedAt = now;
        if (now - silenceStartedAt >= silenceMs) return 'auto-stop';
        return 'continue';
      }
      speechOnsetAt = null;
      if (now - startedAt >= initialGraceMs) return 'grace-timeout';
      return 'continue';
    },
  };
}

/** Computes Outlook tools missing on a chosen bot for the parsed intent & people slots. */
export function computeMissingToolsForBot(
  bot: HyperAssistantBotCandidate | null,
  intent: HyperAssistantIntent,
  hasPeople: boolean,
): HyperBotsToolName[] {
  if (!bot) return [];
  const missing: HyperBotsToolName[] = [];
  const has = (tool: HyperBotsToolName) => bot.tools.includes(tool);
  if (intent === 'meeting' && !has('outlook_create_event')) missing.push('outlook_create_event');
  if (intent === 'email' && !has('outlook_send_message')) missing.push('outlook_send_message');
  if ((intent === 'meeting' || intent === 'email' || hasPeople) && !has('outlook_search_people')) {
    missing.push('outlook_search_people');
  }
  return missing;
}

/** Determines whether the overlay should resist auto-dismiss on window blur. */
export function isVoiceAssistantPinned(phase: HyperVoiceAssistantPhase): boolean {
  return (
    phase === 'preparing' ||
    phase === 'listening' ||
    phase === 'transcribing' ||
    phase === 'parsing' ||
    phase === 'confirming' ||
    phase === 'executing'
  );
}

/** Computes the target floating overlay bounds for the current phase. */
export function overlayBoundsForPhase(phase: HyperVoiceAssistantPhase): { width: number; height: number } {
  if (phase === 'needs-setup') return { ...OVERLAY_SIZE_SETUP };
  if (phase === 'confirming' || phase === 'executing' || phase === 'done' || phase === 'error') {
    return { ...OVERLAY_SIZE_EXPANDED };
  }
  return { ...OVERLAY_SIZE_COMPACT };
}

export interface HyperVoiceExecutionState {
  readonly roomId: string;
  readonly runId: string | null;
  readonly messageId: string | null;
  readonly botId: string;
  readonly botName: string;
  readonly dispatchedText: string;
  readonly runStatus: HyperBotsRunStatus;
  readonly pendingApprovals: HyperBotsApproval[];
  readonly decidedApprovals: HyperBotsApproval[];
  readonly botSettings: HyperBotsSettings | null;
  readonly replyText: string | null;
  readonly error: string | null;
}

interface ActiveCapture {
  readonly abort: AbortController;
  readonly stopCapture: () => Promise<void>;
  readonly cancelCapture: () => void;
  readonly finishTranscription: () => Promise<string>;
  readonly cleanup: () => void;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Voice assistant encountered an unexpected error.';
}

export function useHyperVoiceAssistant() {
  const audioChoice = useAudioChoice();
  const clientSettings = useClientSettings();
  const grant = audioChoice === 'off' ? null : audioChoice;
  const cloudDest = grant?.destination.kind === 'cloud' ? grant.destination : undefined;
  const cloudProvider: CloudSpeechProvider | undefined = cloudDest?.provider;
  const cloudModel: CloudSpeechModelId | undefined =
    cloudDest?.provider === 'openrouter' ? cloudDest.model : undefined;

  const [phase, setPhase] = useState<HyperVoiceAssistantPhase>('idle');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SpeechStreamText | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [englishOnlyLocalModel, setEnglishOnlyLocalModel] = useState(false);
  const [missingLocalModel, setMissingLocalModel] = useState(false);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  // Step 1 confirmation state
  const [plan, setPlan] = useState<HyperVoiceCommandPlan | null>(null);
  const [commandText, setCommandText] = useState('');
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [peopleSlots, setPeopleSlots] = useState<HyperAssistantPersonSlot[]>([]);
  const [enableMissingTools, setEnableMissingTools] = useState(true);

  // Step 2 execution & inline Outlook approval state
  const [execution, setExecution] = useState<HyperVoiceExecutionState | null>(null);
  const [decidingIds, setDecidingIds] = useState<string[]>([]);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRef = useRef<number>(0);
  const phaseRef = useRef<HyperVoiceAssistantPhase>(phase);
  phaseRef.current = phase;
  const botsCacheRef = useRef<HyperAssistantBotCandidate[]>([]);
  const captureRef = useRef<ActiveCapture | null>(null);
  const stoppingRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settingsRef = useRef(clientSettings);
  settingsRef.current = clientSettings;
  const grantRef = useRef(grant);
  grantRef.current = grant;
  const cloudRef = useRef({ provider: cloudProvider, model: cloudModel });
  cloudRef.current = { provider: cloudProvider, model: cloudModel };
  const generationRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const disposeCapture = useCallback(() => {
    clearTimers();
    const active = captureRef.current;
    captureRef.current = null;
    stoppingRef.current = false;
    if (active) {
      active.abort.abort();
      active.cancelCapture();
      active.cleanup();
    }
    analyserRef.current = null;
    levelRef.current = 0;
  }, [clearTimers]);

  // Keep overlay window sized cleanly for each phase.
  useEffect(() => {
    const bounds = overlayBoundsForPhase(phase);
    void window.hypertask?.desktop?.resizeOverlay(bounds).catch(() => undefined);
  }, [phase]);

  // Preload active bots for STT vocabulary hints (EN + HE names).
  const refreshBotsCache = useCallback(async (): Promise<HyperAssistantBotCandidate[]> => {
    try {
      const bots = await window.hypertask?.assistant?.listBots();
      if (Array.isArray(bots)) {
        botsCacheRef.current = bots;
        return bots;
      }
    } catch {
      // Signed out or assistant IPC unavailable yet.
    }
    return botsCacheRef.current;
  }, []);

  useEffect(() => {
    void refreshBotsCache();
    const off = window.hypertask?.hyperBots?.onEvent?.((event) => {
      if (event.type === 'settings') void refreshBotsCache();
    });
    return () => {
      off?.();
    };
  }, [refreshBotsCache]);

  // Probe local speech model status for Hebrew-capability hint.
  const probeLocalSpeech = useCallback(async (): Promise<EnvironmentSpeechStatus | null> => {
    if (cloudRef.current.provider) {
      setEnglishOnlyLocalModel(false);
      setMissingLocalModel(false);
      return null;
    }
    try {
      const status = await runEnvironmentSpeech(getEnvironmentSpeechStatus());
      if (status.supported) {
        setMissingLocalModel(status.state === 'missing-model');
        setEnglishOnlyLocalModel(Boolean(status.languages && !status.languages.includes('he')));
      } else {
        setMissingLocalModel(false);
        setEnglishOnlyLocalModel(false);
      }
      return status;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (grant && !cloudProvider) {
      void probeLocalSpeech();
    } else {
      setEnglishOnlyLocalModel(false);
      setMissingLocalModel(false);
    }
  }, [grant, cloudProvider, probeLocalSpeech]);

  const parseTranscript = useCallback(async (transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed) {
      setPhase('idle');
      setStatusNotice('No speech detected. Click the sphere or press Ctrl+Alt+Space to try again.');
      return;
    }
    const gen = ++generationRef.current;
    setPhase('parsing');
    setErrorMessage(null);
    setStatusNotice(null);
    try {
      const api = window.hypertask?.assistant;
      if (!api) throw new Error('Hyper-Bot assistant service is not ready.');
      const parsed = await api.parseCommand({ text: trimmed });
      if (gen !== generationRef.current) return;
      setPlan(parsed);
      setCommandText(parsed.cleanedCommand || parsed.rawText);
      const chosenBotId = parsed.resolvedBot?.id ?? parsed.availableBots[0]?.id ?? null;
      setSelectedBotId(chosenBotId);
      setPeopleSlots(parsed.people.map((slot) => ({ ...slot })));
      setEnableMissingTools(true);
      setExecution(null);
      setPhase('confirming');
    } catch (error) {
      if (gen !== generationRef.current) return;
      setErrorMessage(normalizeError(error));
      setPhase('error');
    }
  }, []);

  const stopAndProcess = useCallback(async () => {
    const active = captureRef.current;
    if (!active || stoppingRef.current) return;
    stoppingRef.current = true;
    clearTimers();
    const gen = generationRef.current;
    setPhase('transcribing');
    setStatusNotice(null);

    try {
      await active.stopCapture();
      const rawTranscript = (await active.finishTranscription()).trim();
      if (gen !== generationRef.current) return;
      captureRef.current = null;
      active.cleanup();
      analyserRef.current = null;
      levelRef.current = 0;
      stoppingRef.current = false;

      if (!rawTranscript) {
        setPreview(null);
        setPhase('idle');
        setStatusNotice('Didn’t catch that. Click the sphere or press Ctrl+Alt+Space to try again.');
        return;
      }

      // Optional LLM transcript cleanup when user enabled it in Settings → Voice.
      let finalTranscript = rawTranscript;
      const cleanupGrant = readCleanupGrant();
      const currentGrant = grantRef.current;
      if (cleanupGrant && currentGrant) {
        const hasAudioConsent = bindAudioGrant(currentGrant.id);
        const settings = settingsRef.current;
        const cue = settings.speechCorrectionWord.trim();
        const botHints = botsCacheRef.current.flatMap((b) => [b.name, b.id]);
        const speechCustomWords = resolveSpeechVocabulary({
          personal: settings.speechCustomWords,
          project: [],
          hints: [...botHints, cue],
        });
        try {
          const cleaned = await runEnvironmentSpeech(
            postProcessEnvironmentTranscript(
              rawTranscript,
              { text: '', selection: { start: 0, end: 0 } },
              {
                speechCustomWords,
                speechPostProcessingPrompt: settings.speechPostProcessingPrompt,
                ...(cue ? { speechCorrectionWord: cue } : {}),
              },
              () => hasAudioConsent() && readCleanupGrant() === cleanupGrant,
            ),
          );
          if (cleaned.text.trim()) finalTranscript = cleaned.text.trim();
        } catch {
          // Graceful fallback to raw transcript.
        }
      }
      if (gen !== generationRef.current) return;
      setPreview({ committed: finalTranscript, tentative: '' });
      await parseTranscript(finalTranscript);
    } catch (error) {
      if (gen !== generationRef.current) return;
      captureRef.current = null;
      active.cleanup();
      analyserRef.current = null;
      levelRef.current = 0;
      stoppingRef.current = false;
      setErrorMessage(normalizeError(error));
      setPhase('error');
    }
  }, [clearTimers, parseTranscript]);

  const startListening = useCallback(async () => {
    disposeCapture();
    const gen = ++generationRef.current;
    setErrorMessage(null);
    setStatusNotice(null);
    setPreview(null);
    setPlan(null);
    setExecution(null);
    setElapsedSeconds(0);

    const currentGrant = grantRef.current;
    if (!currentGrant) {
      setPhase('needs-setup');
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioWorkletNode === 'undefined'
    ) {
      setErrorMessage('Microphone capture is unavailable in this window.');
      setPhase('error');
      return;
    }

    setPhase('preparing');
    const bots = await refreshBotsCache();
    if (gen !== generationRef.current) return;

    const { provider, model } = cloudRef.current;
    const settings = settingsRef.current;
    const hasAudioConsent = bindAudioGrant(currentGrant.id);
    const cleanupGrant = readCleanupGrant();
    const cue = cleanupGrant ? settings.speechCorrectionWord : '';
    const botHints = bots.flatMap((bot) => [bot.name, bot.handle.replace(/^@/, '')]);
    const speechCustomWords = resolveSpeechVocabulary({
      personal: settings.speechCustomWords,
      project: [],
      hints: [...botHints, cue],
    });
    const recordingOptions: SpeechTranscriptionOptions = {
      speechLanguage: settings.speechLanguage,
      speechTranslateToEnglish: settings.speechTranslateToEnglish,
      speechCustomWords,
      speechRemoveFillerWords: settings.speechRemoveFillerWords,
      ...(cue.trim() ? { speechCorrectionWord: cue } : {}),
      speechSilenceFiltering: settings.speechSilenceFiltering,
    };

    const abort = new AbortController();
    let streamingSession: (VoiceStreamingSession & { readonly feed: (pcm: Float32Array) => void }) | undefined;
    let recordingUriToDelete: string | null = null;
    let vadTracker: ReturnType<typeof createHyperVoiceVadTracker> | null = null;

    const capture = createBrowserPcmCapture(
      {
        getMicrophoneId: chooseRecordingMicrophone,
        onLevel: (level) => {
          levelRef.current = level;
          if (!vadTracker || phaseRef.current !== 'listening' || stoppingRef.current) return;
          const action = vadTracker.update(level, Date.now());
          if (action === 'auto-stop') {
            void stopAndProcess();
          } else if (action === 'grace-timeout') {
            disposeCapture();
            setPhase('idle');
            setStatusNotice('No speech detected. Click the sphere or press Ctrl+Alt+Space to speak.');
          }
        },
        onAnalyser: (analyser) => {
          analyserRef.current = analyser;
        },
        onDurationLimit: () => {
          void stopAndProcess();
        },
        onError: (message) => {
          if (gen !== generationRef.current) return;
          disposeCapture();
          setErrorMessage(message);
          setPhase('error');
        },
      },
      async (options) => {
        const transcribeRecording = async (
          uri: string,
          { signal }: { readonly signal: AbortSignal },
        ) => {
          const response = await fetch(uri, { signal });
          const pcm = new Uint8Array(await response.arrayBuffer());
          const result = await runEnvironmentSpeech(
            provider
              ? transcribeCloudPcm(provider, pcm, recordingOptions, hasAudioConsent, model)
              : transcribeEnvironmentPcm(pcm, recordingOptions, hasAudioConsent),
            { signal },
          );
          throwIfVoiceTranscriptionAborted(signal);
          return result.text;
        };

        if (provider) {
          if (provider === 'openrouter' && !model) {
            throw new Error('Choose an OpenRouter model in Settings → Voice.');
          }
          await runEnvironmentSpeech(requireCloudSpeechKey(provider), options);
          throwIfVoiceTranscriptionAborted(options.signal);
          return {
            locale: effectiveSpeechLanguage(cloudSpeechLanguages, recordingOptions.speechLanguage),
            transcribe: transcribeRecording,
          };
        }

        const status = await probeLocalSpeech();
        throwIfVoiceTranscriptionAborted(options.signal);
        if (!status || !status.supported) {
          throw new Error(status?.supported === false ? status.reason : 'Local speech transcription is unavailable.');
        }
        if (status.state === 'missing-model') {
          setMissingLocalModel(true);
          throw new Error('MISSING_LOCAL_MODEL');
        }

        const language = status.languages
          ? effectiveSpeechLanguage(
              {
                languages: status.languages,
                supportsLanguageDetection: status.supportsLanguageDetection ?? false,
              },
              recordingOptions.speechLanguage,
            )
          : 'auto';
        const nativeStreaming = status.supportsStreaming && settings.speechStreaming;
        const locale =
          !nativeStreaming && status.supportsTranslation && recordingOptions.speechTranslateToEnglish
            ? 'en'
            : language;

        if (status.supportsStreaming ? !nativeStreaming : !status.supportsBufferedStreaming) {
          return { locale, transcribe: transcribeRecording };
        }

        const stream = openSpeechStream({
          canSend: hasAudioConsent,
          options: recordingOptions,
          signal: options.signal,
          onText: (text) => {
            if (gen === generationRef.current) setPreview(text);
          },
          onError: (err) => {
            if (gen === generationRef.current) {
              disposeCapture();
              setErrorMessage(err.message);
              setPhase('error');
            }
          },
        });
        streamingSession = stream;
        return {
          locale,
          transcribe: transcribeRecording,
          streaming: stream,
        };
      },
    );

    try {
      const prepared = await capture.transcriber.prepare({ signal: abort.signal });
      if (gen !== generationRef.current || abort.signal.aborted) {
        abort.abort();
        capture.cancelRecording();
        return;
      }
      await capture.recorder.prepareToRecordAsync(abort.signal);
      if (gen !== generationRef.current || abort.signal.aborted) {
        abort.abort();
        capture.cancelRecording();
        return;
      }

      const startedAt = Date.now();
      vadTracker = createHyperVoiceVadTracker(startedAt);
      captureRef.current = {
        abort,
        stopCapture: () => capture.recorder.stop(),
        cancelCapture: () => {
          abort.abort();
          capture.cancelRecording();
        },
        finishTranscription: async () => {
          if (streamingSession) {
            return streamingSession.finish({ signal: abort.signal });
          }
          const uri = capture.recorder.uri;
          if (!uri) return '';
          recordingUriToDelete = uri;
          return prepared.transcribe(uri, { signal: abort.signal });
        },
        cleanup: () => {
          if (recordingUriToDelete) {
            capture.deleteRecording(recordingUriToDelete);
            recordingUriToDelete = null;
          }
        },
      };

      capture.recorder.record({ forDuration: VOICE_RECORDING_LIMIT_SECONDS });
      setPhase('listening');
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 250);
    } catch (error) {
      abort.abort();
      capture.cancelRecording();
      if (gen !== generationRef.current) return;
      if (error instanceof Error && error.message === 'MISSING_LOCAL_MODEL') {
        setPhase('needs-setup');
        return;
      }
      setErrorMessage(normalizeError(error));
      setPhase('error');
    }
  }, [disposeCapture, probeLocalSpeech, refreshBotsCache, stopAndProcess]);

  const cancelAndHide = useCallback(() => {
    generationRef.current += 1;
    disposeCapture();
    setPhase('idle');
    setPreview(null);
    setStatusNotice(null);
    setErrorMessage(null);
    void window.hypertask?.desktop?.hideOverlay().catch(() => undefined);
  }, [disposeCapture]);

  // Quick-enable local multilingual Whisper Large v3 Turbo from the setup card.
  const enableLocalMultilingualVoice = useCallback(async () => {
    setDownloadingModel(true);
    setDownloadProgress(0);
    setErrorMessage(null);
    try {
      chooseAudioDestination({ kind: 'environment' });
      const catalog = await runEnvironmentSpeech(getEnvironmentSpeechModels(false));
      const target =
        catalog.models.find((m) => m.id === MULTILINGUAL_RECOMMENDED_MODEL_ID) ??
        catalog.models.find((m) => m.languages.includes('he') && m.languages.includes('en')) ??
        catalog.models[0];
      if (!target) {
        throw new Error('No local speech model was found in the catalog.');
      }
      if (target.state !== 'installed') {
        const poll = setInterval(() => {
          void runEnvironmentSpeech(getEnvironmentSpeechModels(false))
            .then((next) => {
              const entry = next.models.find((m) => m.id === target.id);
              if (entry?.downloaded && entry.size > 0) {
                setDownloadProgress(Math.min(99, Math.round((entry.downloaded / entry.size) * 100)));
              }
            })
            .catch(() => undefined);
        }, 700);
        try {
          await runEnvironmentSpeech(downloadEnvironmentSpeechModel(target.id));
        } finally {
          clearInterval(poll);
        }
      }
      await runEnvironmentSpeech(selectEnvironmentSpeechModel(target.id));
      setDownloadProgress(100);
      setMissingLocalModel(false);
      setEnglishOnlyLocalModel(false);
      setDownloadingModel(false);
      setPhase('idle');
      setStatusNotice('Multilingual voice model ready (English + Hebrew).');
    } catch (error) {
      setDownloadingModel(false);
      setDownloadProgress(null);
      setErrorMessage(normalizeError(error));
    }
  }, []);

  // Step 1 mutation helpers
  const selectBot = useCallback((botId: string) => {
    setSelectedBotId(botId);
    setEnableMissingTools(true);
  }, []);

  const selectCandidateForSlot = useCallback((slotId: string, person: HyperAssistantPerson) => {
    setPeopleSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== slotId) return slot;
        const exists = slot.candidates.some(
          (c) => c.email.toLowerCase() === person.email.toLowerCase(),
        );
        return {
          ...slot,
          status: 'exact',
          selected: person,
          error: undefined,
          candidates: exists ? slot.candidates : [person, ...slot.candidates],
        };
      }),
    );
  }, []);

  const removePersonSlot = useCallback((slotId: string) => {
    setPeopleSlots((prev) => prev.filter((slot) => slot.id !== slotId));
  }, []);

  const addPersonSlot = useCallback((person: HyperAssistantPerson) => {
    setPeopleSlots((prev) => {
      if (prev.some((slot) => slot.selected?.email.toLowerCase() === person.email.toLowerCase())) {
        return prev;
      }
      const next: HyperAssistantPersonSlot = {
        id: `added-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        rawName: person.name,
        query: person.name,
        role: 'person',
        status: 'exact',
        selected: person,
        candidates: [person],
      };
      return [...prev, next];
    });
  }, []);

  const searchDirectoryPeople = useCallback(async (query: string): Promise<HyperAssistantPerson[]> => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const api = window.hypertask?.assistant;
    if (api) {
      return api.searchPeople({ query: trimmed, limit: 10 });
    }
    const fallback = await window.hypertask?.outlook?.people?.search({ query: trimmed, limit: 10 });
    return fallback?.ok ? fallback.value : [];
  }, []);

  // Derived Step 1 state
  const selectedBot: HyperAssistantBotCandidate | null =
    plan?.availableBots.find((b) => b.id === selectedBotId) ??
    plan?.resolvedBot ??
    plan?.availableBots[0] ??
    null;

  const missingTools: HyperBotsToolName[] = plan
    ? computeMissingToolsForBot(selectedBot, plan.intent, peopleSlots.length > 0)
    : [];

  const unresolvedCount = peopleSlots.filter((slot) => !slot.selected).length;

  // Step 2: dispatch confirmed plan to Hyper-Bot and track live run & Outlook approvals
  const syncExecutionSnapshot = useCallback(
    async (roomId: string, runId: string | null, messageId: string | null, gen: number) => {
      const botsApi = window.hypertask?.hyperBots;
      if (!botsApi) return;
      const result = await botsApi.snapshot({ roomId });
      if (!result.ok || gen !== generationRef.current) return;
      const snap = result.value;
      const matchedRun =
        (runId ? snap.runs.find((r) => r.id === runId) : undefined) ??
        (messageId ? snap.runs.find((r) => r.triggerMessageId === messageId) : undefined) ??
        snap.runs.at(-1);
      const effectiveRunId = matchedRun?.id ?? runId;
      const runApprovals = effectiveRunId
        ? snap.approvals.filter((a) => a.runId === effectiveRunId)
        : snap.approvals.filter((a) => a.status === 'pending');
      const pendingApprovals = runApprovals.filter((a) => a.status === 'pending');
      const decidedApprovals = runApprovals.filter((a) => a.status !== 'pending');
      const botReply = effectiveRunId
        ? [...snap.messages]
            .reverse()
            .find((m) => m.runId === effectiveRunId && m.author.kind === 'bot')?.text ?? null
        : null;
      const status: HyperBotsRunStatus = matchedRun?.status ?? (pendingApprovals.length ? 'waiting_approval' : 'running');

      setExecution((prev) =>
        prev && prev.roomId === roomId
          ? {
              ...prev,
              runId: effectiveRunId,
              runStatus: status,
              pendingApprovals,
              decidedApprovals,
              botSettings: snap.settings,
              replyText: botReply ?? prev.replyText,
              error: matchedRun?.error ?? prev.error,
            }
          : prev,
      );

      if (status === 'done' && pendingApprovals.length === 0) {
        setPhase('done');
      } else if (status === 'failed') {
        setErrorMessage(matchedRun?.error ?? 'The bot could not finish this request.');
        setPhase('error');
      }
    },
    [],
  );

  const confirmAndDispatch = useCallback(async () => {
    if (!plan || !selectedBot || unresolvedCount > 0) return;
    const api = window.hypertask?.assistant;
    if (!api) {
      setErrorMessage('Hyper-Bot assistant service is unavailable.');
      setPhase('error');
      return;
    }
    const gen = ++generationRef.current;
    setPhase('executing');
    setErrorMessage(null);

    const confirmedPeople: HyperAssistantConfirmedPerson[] = peopleSlots.flatMap((slot) =>
      slot.selected
        ? [
            {
              slotId: slot.id,
              rawName: slot.rawName,
              name: slot.selected.name,
              email: slot.selected.email,
            },
          ]
        : [],
    );

    try {
      const result = await api.dispatch({
        botId: selectedBot.id,
        targetRoomId: selectedBot.roomId ?? plan.targetRoomId,
        text: commandText.trim() || plan.cleanedCommand || plan.rawText,
        confirmedPeople,
        enableMissingTools: enableMissingTools && missingTools.length > 0 ? missingTools : undefined,
        clientMessageId:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : undefined,
      });
      if (gen !== generationRef.current) return;
      if (!result.ok || !result.roomId) {
        setErrorMessage(result.error ?? 'Could not send command to Hyper-Bot.');
        setPhase('error');
        return;
      }

      setExecution({
        roomId: result.roomId,
        runId: result.runId ?? null,
        messageId: result.messageId ?? null,
        botId: result.botId ?? selectedBot.id,
        botName: result.botName ?? selectedBot.name,
        dispatchedText: result.dispatchedText ?? commandText,
        runStatus: 'running',
        pendingApprovals: [],
        decidedApprovals: [],
        botSettings: null,
        replyText: null,
        error: null,
      });

      await syncExecutionSnapshot(result.roomId, result.runId ?? null, result.messageId ?? null, gen);
    } catch (error) {
      if (gen !== generationRef.current) return;
      setErrorMessage(normalizeError(error));
      setPhase('error');
    }
  }, [
    commandText,
    enableMissingTools,
    missingTools,
    peopleSlots,
    plan,
    selectedBot,
    syncExecutionSnapshot,
    unresolvedCount,
  ]);

  // Subscribe to HyperBots real-time events while executing so Outlook approvals appear inline immediately.
  useEffect(() => {
    if (phase !== 'executing' || !execution) return;
    const { roomId, runId, messageId } = execution;
    const gen = generationRef.current;

    const refresh = () => {
      void syncExecutionSnapshot(roomId, runId, messageId, gen);
    };
    const off = window.hypertask?.hyperBots?.onEvent?.((event) => {
      if ('roomId' in event && event.roomId === roomId) refresh();
    });
    const fallbackPoll = setInterval(refresh, 1_500);
    return () => {
      off?.();
      clearInterval(fallbackPoll);
    };
  }, [phase, execution?.roomId, execution?.runId, execution?.messageId, syncExecutionSnapshot]);

  const decideApproval = useCallback(
    async (approvalId: string, approved: boolean, delivery?: HyperBotsDelivery) => {
      if (decidingIds.includes(approvalId)) return;
      setDecidingIds((prev) => [...prev, approvalId]);
      const gen = generationRef.current;
      try {
        const res = await window.hypertask?.assistant?.decideApproval({
          approvalId,
          approved,
          ...(delivery ? { delivery } : {}),
        });
        if (res && !res.ok && res.error) {
          setErrorMessage(res.error);
        }
        if (execution) {
          await syncExecutionSnapshot(execution.roomId, execution.runId, execution.messageId, gen);
        }
      } catch (error) {
        setErrorMessage(normalizeError(error));
      } finally {
        setDecidingIds((prev) => prev.filter((id) => id !== approvalId));
      }
    },
    [decidingIds, execution, syncExecutionSnapshot],
  );

  const openVoiceSettings = useCallback(() => {
    void window.hypertask?.desktop
      ?.openMain({ route: 'settings', settingsPage: 'voice' })
      .catch(() => undefined);
  }, []);

  const openInHyperBot = useCallback(() => {
    const roomId = execution?.roomId ?? selectedBot?.roomId ?? plan?.targetRoomId ?? undefined;
    void window.hypertask?.desktop
      ?.openMain({ route: 'hyper-bots', ...(roomId ? { roomId } : {}) })
      .catch(() => undefined);
  }, [execution?.roomId, plan?.targetRoomId, selectedBot?.roomId]);

  const handleSphereClick = useCallback(() => {
    if (phaseRef.current === 'listening') {
      void stopAndProcess();
    } else if (
      phaseRef.current === 'idle' ||
      phaseRef.current === 'done' ||
      phaseRef.current === 'error'
    ) {
      void startListening();
    }
  }, [startListening, stopAndProcess]);

  // Listen to global hotkey / tray triggers and overlay hidden notifications from main.
  useEffect(() => {
    const off = window.hypertask?.desktop?.onOverlayEvent?.((event) => {
      if (event.type === 'trigger') {
        if (phaseRef.current === 'listening') {
          void stopAndProcess();
        } else if (
          phaseRef.current === 'idle' ||
          phaseRef.current === 'done' ||
          phaseRef.current === 'error' ||
          phaseRef.current === 'needs-setup'
        ) {
          void startListening();
        }
      } else if (event.type === 'hidden') {
        if (phaseRef.current === 'preparing' || phaseRef.current === 'listening') {
          disposeCapture();
          setPhase('idle');
        } else if (phaseRef.current === 'done' || phaseRef.current === 'error') {
          setPhase('idle');
          setErrorMessage(null);
          setStatusNotice(null);
        }
      }
    });
    return () => {
      off?.();
    };
  }, [disposeCapture, startListening, stopAndProcess]);

  // Global keyboard shortcuts inside the overlay window: Esc cancels/hides, Enter finishes listening.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelAndHide();
        return;
      }
      if (event.key === 'Enter' && phaseRef.current === 'listening') {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag !== 'TEXTAREA' && tag !== 'INPUT') {
          event.preventDefault();
          void stopAndProcess();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelAndHide, stopAndProcess]);

  useEffect(() => () => disposeCapture(), [disposeCapture]);

  return {
    phase,
    pinned: isVoiceAssistantPinned(phase),
    statusNotice,
    errorMessage,
    preview,
    elapsedSeconds,
    englishOnlyLocalModel,
    missingLocalModel,
    downloadingModel,
    downloadProgress,
    analyserRef,
    levelRef,
    // Step 1
    plan,
    commandText,
    setCommandText,
    selectedBot,
    selectBot,
    peopleSlots,
    unresolvedCount,
    missingTools,
    enableMissingTools,
    setEnableMissingTools,
    selectCandidateForSlot,
    removePersonSlot,
    addPersonSlot,
    searchDirectoryPeople,
    // Step 2
    execution,
    decidingIds,
    // Actions
    startListening,
    stopAndProcess,
    cancelAndHide,
    parseTranscript,
    confirmAndDispatch,
    decideApproval,
    enableLocalMultilingualVoice,
    openVoiceSettings,
    openInHyperBot,
    handleSphereClick,
  };
}
