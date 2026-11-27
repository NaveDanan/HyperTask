// Copied from t3code (apps/web/src/components/settings/VoiceSettingsPanel.tsx), Copyright (c) 2026 T3 Tools Inc.,
// MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: HyperTask is the only environment, so the destination picker offers this
// computer's local model and the cloud providers HyperTask forwards to, without environment groups, scopes, managed
// policies, permissions or project overrides. The project/shared dictionary row is gone (one person, one device).
// The cleanup model is a model of the Settings → Connections → AI endpoint endpoint instead of a provider/model picker. Existing model files
// can also be linked with a native file or folder picker. Settings search targets are plain element ids.
import {
  ArrowDownUpIcon,
  AudioLinesIcon,
  CheckIcon,
  DownloadIcon,
  FileIcon,
  FolderOpenIcon,
  LanguagesIcon,
  KeyRoundIcon,
  MonitorIcon,
  MicOffIcon,
  MicIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  UnlinkIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CLOUD_SPEECH_LABELS,
  CloudSpeechProvider,
  DEFAULT_SPEECH_POST_PROCESSING_PROMPT,
  type EnvironmentSpeechModel,
  type EnvironmentSpeechStatus,
  type SpeechAcceleration,
  type SpeechBenchmarkTier,
  type SpeechCustomWords,
  type SpeechModelUnloadTimeout,
} from "@shared/hyper-voice/speech";
import type { HyperVoiceCleanupModels } from "@shared/hyper-voice/api";
import type { VoiceShortcutMode } from "@shared/hyper-voice/settings";
import {
  cloudSpeechLanguages,
  recommendSpeechModels,
  type SpeechRecommendationRole,
} from "@shared/hyper-voice/speechShared";
import {
  AdvancedSettings,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/appearance/appearance-layout";

import { msg, T, useGT, useLocale, useMessages, Var } from "../gt";
import { thrownErrorMessage } from "../translatable";
import {
  cancelEnvironmentSpeechModelDownload,
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getEnvironmentSpeechStatus,
  getSpeechCleanupModels,
  linkEnvironmentSpeechModels,
  pickEnvironmentSpeechModelPath,
  removeEnvironmentSpeechModel,
  runEnvironmentSpeech,
  selectEnvironmentSpeechModel,
  setSpeechCleanupModel,
  updateEnvironmentSpeechAcceleration,
  updateEnvironmentSpeechModelUnloadTimeout,
} from "../environment";
import { updateClientSettings, useClientSettings } from "../settings";
import {
  listAudioInputs,
  updateMicrophoneOrder,
  type BrowserMicrophone,
} from "../speech/browserMicrophones";
import {
  microphoneOrder,
  preferredMicrophoneId,
  rememberMicrophones,
} from "../speech/microphoneOrder";
import { preferredSpeechLanguages } from "../speech/preferredSpeechLanguages";
import {
  chooseAudioDestination,
  chooseTranscriptCleanup,
  useAudioChoice,
  useCleanupGrant,
} from "../speech/voiceConsent";
import { useEnvironmentSpeechInput } from "../speech/useEnvironmentSpeechInput";
import { ComposerSpeechRecordingPill } from "../chat/ComposerSpeechButton";
import { VoiceInputSetup } from "../chat/VoiceInputSetup";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { cn } from "../ui/lib";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSearchInput,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { CloudSpeechLogo } from "./CloudSpeechLogo";
import { CloudVoiceConfiguration } from "./CloudVoiceConfiguration";
import { MicrophoneOrderList } from "./MicrophoneOrderList";
import { MicrophoneTest } from "./MicrophoneTest";
import { ModelBenchmarks, orderSpeechLanguages } from "./SpeechModelComparison";
import { languageLabel, SpeechLanguageSelect } from "./SpeechLanguageSelect";
import { filterSpeechModels, type SpeechModelSort } from "./speechModelBrowser";
import { useStableCallback } from "./useStableCallback";

const OFF = "off";
const LOCAL = "environment";
/** The local destination, where t3code lists environments by their labels. */
const LOCAL_LABEL = msg("Local model");
/** t3code's searchable-setting ids, kept as element ids. */
const setting = (id: string) => ({ id });
const formatSize = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
const SHORTCUT_MODES: Record<VoiceShortcutMode, { label: string; hint: string }> = {
  auto: {
    label: msg("Auto", { $context: "dictation shortcut mode" }),
    hint: msg("Tap to toggle, hold to talk"),
  },
  hold: {
    label: msg("Hold", { $context: "dictation shortcut mode: record while the key is held" }),
    hint: msg("Record while held"),
  },
  toggle: {
    label: msg("Toggle", { $context: "dictation shortcut mode: tap to start and stop" }),
    hint: msg("Tap to start, tap to stop"),
  },
};
const UNLOAD_LABELS: Record<SpeechModelUnloadTimeout, string> = {
  never: msg("Never", { $context: "unload the speech model" }),
  immediately: msg("Immediately"),
  min_2: msg("After 2 minutes"),
  min_5: msg("After 5 minutes"),
  min_10: msg("After 10 minutes"),
  min_15: msg("After 15 minutes"),
  hour_1: msg("After 1 hour"),
};
const normalizeTerm = (value: string) => value.replace(/\s+/g, " ").trim().normalize("NFC");
const spellingsOf = (words: SpeechCustomWords) =>
  new Set(
    words.flatMap(({ term, aliases }) =>
      [term, ...aliases].map((spelling) => spelling.toLocaleLowerCase()),
    ),
  );
const errorText = (error: unknown) =>
  error instanceof Error ? (thrownErrorMessage(error) ?? error.message) : String(error);

type ModelCardProps = {
  readonly model: EnvironmentSpeechModel;
  readonly comparisonLanguages: readonly string[];
  readonly recommendation: SpeechRecommendationRole | undefined;
  readonly benchmarkTier: SpeechBenchmarkTier | undefined;
  readonly busy: boolean;
  readonly canCancel: boolean;
  readonly onDownload: () => void;
  readonly onSelect: () => void;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
  readonly testControls?: ReactNode;
  /** Keeps the controls under the text, so a live test never squeezes the model's details. */
  readonly stacked?: boolean;
  readonly children?: ReactNode;
};

function ModelBadge(props: { icon: ReactNode; label: string; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" />}>
        {props.icon}
        {props.label}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function ModelCard(props: ModelCardProps) {
  const gt = useGT();
  const locale = useLocale();
  const { model } = props;
  const downloading = model.state === "downloading" || model.state === "verifying";
  const progress = model.downloaded === undefined ? 0 : (model.downloaded / model.size) * 100;
  return (
    <div className="@container/model px-3 py-3">
      <div
        className={cn(
          "flex flex-col gap-2.5",
          !props.stacked &&
            "@min-[28rem]/model:flex-row @min-[28rem]/model:items-start @min-[28rem]/model:gap-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium leading-5">{model.name}</span>
            {props.recommendation ? (
              <ModelBadge
                icon={<StarIcon className="mr-1 size-3" />}
                label={
                  props.recommendation === "recommended"
                    ? gt("Recommended")
                    : props.recommendation === "faster"
                      ? gt("Faster", { $context: "speech model badge, quicker than Recommended" })
                      : gt("More accurate")
                }
                tooltip={
                  props.recommendation === "recommended"
                    ? gt(
                        "Balanced accuracy and speed for your selected languages on Handy’s reference benchmarks.",
                      )
                    : props.recommendation === "faster"
                      ? gt("Quicker than Recommended on this reference tier, with useful accuracy.")
                      : gt(
                          "Higher accuracy with a longer reference processing budget for your selected languages.",
                        )
                }
              />
            ) : null}
            {model.supportsStreaming ? (
              <ModelBadge
                icon={<AudioLinesIcon className="mr-1 size-3" />}
                label={gt("Live preview")}
                tooltip={gt(
                  "Shows words in your draft as you speak, before the recording finishes.",
                )}
              />
            ) : null}
            {model.supportsTranslation ? (
              <ModelBadge
                icon={<LanguagesIcon className="mr-1 size-3" />}
                label={gt("Translate")}
                tooltip={gt(
                  "Can write English text from speech in another language. Turn on Translate to English to use it.",
                )}
              />
            ) : null}
          </div>
          {model.description ? (
            <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
              {model.description}
            </p>
          ) : null}
          {model.linkedFrom ? (
            <p className="mt-0.5 break-all text-2xs text-muted-foreground">
              <T>
                Using your file at <Var>{model.linkedFrom}</Var>
              </T>
            </p>
          ) : null}
          <ModelBenchmarks
            model={model}
            languages={props.comparisonLanguages}
            tier={props.benchmarkTier}
            facts={[
              ...(model.languages.length > 1
                ? [
                    gt("{count, plural, one {{count} language} other {{count} languages}}", {
                      count: model.languages.length,
                    }),
                  ]
                : model.benchmark
                  ? []
                  : [languageLabel(model.languages[0] ?? "", locale)]),
              formatSize(model.size),
            ]}
          />
          {downloading ? (
            <div className="mt-2">
              <div
                role="progressbar"
                aria-label={gt("{name} download progress", { name: model.name })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                className="h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-2xs text-muted-foreground">
                {model.state === "verifying"
                  ? gt("Verifying download…")
                  : gt("{percent}% downloaded", { percent: Math.round(progress) })}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
          {props.testControls}
          {downloading ? (
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={gt("Cancel {name} download", { name: model.name })}
              disabled={!props.canCancel}
              onClick={props.onCancel}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : model.state === "downloadable" ? (
            <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onDownload}>
              <DownloadIcon />
              <T>Download</T>
            </Button>
          ) : model.active ? (
            <Button size="sm" variant="secondary" disabled>
              <CheckIcon />
              <T>Selected</T>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onSelect}>
              <T>Use model</T>
            </Button>
          )}
          {model.state === "installed" && !model.bundled ? (
            <Button
              size="icon-sm"
              variant="outline"
              disabled={props.busy}
              aria-label={
                model.linkedFrom
                  ? gt("Stop using your {name} file; the file stays on disk", { name: model.name })
                  : gt("Delete {name}", { name: model.name })
              }
              onClick={props.onDelete}
            >
              {model.linkedFrom ? <UnlinkIcon /> : <Trash2Icon />}
            </Button>
          ) : null}
        </div>
      </div>
      {props.children}
    </div>
  );
}

function DictionaryEditor(props: {
  readonly label: string;
  readonly words: SpeechCustomWords;
  readonly disabled?: boolean;
  readonly onChange: (words: SpeechCustomWords) => void;
}) {
  const gt = useGT();
  const { words, label, disabled = false, onChange } = props;
  const [termDraft, setTermDraft] = useState("");
  const [aliasDraft, setAliasDraft] = useState<{ term: string; value: string } | null>(null);
  const spellings = spellingsOf(words);
  const seen = new Set(spellings);
  const newTerms = termDraft
    .split(/[,\n]/)
    .map(normalizeTerm)
    .filter((term) => {
      const key = term.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const canAddTerm =
    !disabled &&
    newTerms.length > 0 &&
    newTerms.every((term) => term.length <= 50) &&
    words.length + newTerms.length <= 100;
  const addTerm = () => {
    if (!canAddTerm) return;
    onChange([...words, ...newTerms.map((term) => ({ term, aliases: [] }))]);
    setTermDraft("");
  };
  const addAlias = () => {
    if (!aliasDraft) return;
    const value = normalizeTerm(aliasDraft.value);
    if (!value || value.length > 50 || spellings.has(value.toLocaleLowerCase())) return;
    onChange(
      words.map((entry) =>
        entry.term === aliasDraft.term && entry.aliases.length < 8
          ? { term: entry.term, aliases: [...entry.aliases, value] }
          : entry,
      ),
    );
    setAliasDraft(null);
  };
  return (
    <>
      <div className="flex items-start gap-2">
        {/* One line while empty, so a wrapped placeholder never makes the field taller than Add. */}
        <div className="min-w-0 flex-1 [&_textarea]:placeholder-shown:whitespace-nowrap">
          <Textarea
            value={termDraft}
            rows={1}
            maxLength={5_100}
            disabled={disabled}
            placeholder={gt("Add words, separated by commas")}
            aria-label={gt("Add a word or phrase to the {label}", { label })}
            onChange={(event) => setTermDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              addTerm();
            }}
          />
        </div>
        <Button type="button" variant="outline" disabled={!canAddTerm} onClick={addTerm}>
          <PlusIcon />
          <T>Add</T>
        </Button>
      </div>
      {words.length > 0 ? (
        <ul
          aria-label={`${label} entries`}
          className="mt-2.5 flex flex-col gap-1.5 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:flex-wrap"
        >
          {words.map(({ term, aliases }) => (
            <li
              key={term}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 py-0.5 pl-2 pr-0.5 text-xs"
            >
              <span className="font-medium">{term}</span>
              {aliases.length > 0 ? (
                <span className="text-muted-foreground">← {aliases.join(", ")}</span>
              ) : null}
              {aliasDraft?.term === term ? (
                <Input
                  autoFocus
                  value={aliasDraft.value}
                  maxLength={50}
                  aria-label={gt("Alias for {term}", { term })}
                  placeholder={gt("Misspelling")}
                  className="ms-auto w-32"
                  onChange={(event) => setAliasDraft({ term, value: event.target.value })}
                  onBlur={() => setAliasDraft(null)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === "Escape") setAliasDraft(null);
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    addAlias();
                  }}
                />
              ) : (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  className="ms-auto"
                  disabled={disabled || aliases.length >= 8}
                  aria-label={gt("Add an alias for {term}", { term })}
                  onClick={() => setAliasDraft({ term, value: "" })}
                >
                  <T>Alias</T>
                </Button>
              )}
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                disabled={disabled}
                aria-label={gt("Remove {term}", { term })}
                onClick={() => onChange(words.filter((entry) => entry.term !== term))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * Cleanup runs through the Settings → Connections → AI endpoint endpoint. Off follows the endpoint's own model; on pins a cheaper or faster
 * model of the same endpoint (t3code's dedicated cleanup model selection).
 */
function CleanupModelRow() {
  const gt = useGT();
  const [cleanup, setCleanup] = useState<HyperVoiceCleanupModels | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    runEnvironmentSpeech(getSpeechCleanupModels()).then(
      (value) => current && setCleanup(value),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, []);
  const setModel = async (model: string | null) => {
    setBusy(true);
    try {
      setCleanup(await runEnvironmentSpeech(setSpeechCleanupModel(model)));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: gt("Cleanup model not saved"),
        description: errorText(error),
      });
    }
    setBusy(false);
  };
  const dedicated = cleanup?.selected != null;
  const selected = cleanup?.selected ?? "";
  const models =
    cleanup && selected && !cleanup.models.includes(selected)
      ? [selected, ...cleanup.models]
      : (cleanup?.models ?? []);
  return (
    <SettingsRow
      {...setting("speech-post-processing-model")}
      title={gt("Cleanup model")}
      description={gt(
        "Model for transcript cleanup, such as a cheaper or faster one. When disabled, use the model configured in Settings → Connections → AI endpoint.",
      )}
      control={
        failed ? (
          <span className="text-sm text-muted-foreground">
            <T>Couldn’t read the Settings → Connections → AI endpoint endpoint.</T>
          </span>
        ) : !cleanup ? null : !cleanup.configured ? (
          <span className="text-sm text-muted-foreground">
            <T>Set up an endpoint in Settings → Connections → AI endpoint first.</T>
          </span>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2 @min-[32rem]/settings-row:justify-end">
            {dedicated ? (
              models.length > 0 ? (
                <Select
                  value={selected}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value && value !== selected) void setModel(value);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={gt("Cleanup model")} className="max-w-72">
                    <SelectValue>{selected}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {models.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : (
                <Input
                  key={selected}
                  size="sm"
                  defaultValue={selected}
                  disabled={busy}
                  aria-label={gt("Cleanup model")}
                  className="@min-[32rem]/settings-row:w-48"
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== selected) void setModel(next);
                  }}
                />
              )
            ) : null}
            <Switch
              checked={dedicated}
              disabled={busy}
              onCheckedChange={(checked) =>
                void setModel(checked ? cleanup.defaultModel || cleanup.models[0] || "" : null)
              }
              aria-label={gt("Use a separate cleanup model")}
            />
          </div>
        )
      }
    />
  );
}

function useVoiceModels(enabled: boolean) {
  const gt = useGT();
  const [models, setModels] = useState<readonly EnvironmentSpeechModel[]>([]);
  const [status, setStatus] = useState<EnvironmentSpeechStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestedDownload, setRequestedDownload] = useState<string | null>(null);
  const [actionEnabled, setActionEnabled] = useState(enabled);
  if (actionEnabled !== enabled) {
    setActionEnabled(enabled);
    setBusy(false);
    setRequestedDownload(null);
    setModels([]);
    setStatus(null);
  }
  const epoch = useRef(0);
  const refreshRevision = useRef(0);
  const refresh = useStableCallback(async (mode: "foreground" | "progress") => {
    const current = epoch.current;
    const revision = ++refreshRevision.current;
    try {
      const [nextStatus, nextModels] = await Promise.all([
        runEnvironmentSpeech(getEnvironmentSpeechStatus()),
        runEnvironmentSpeech(getEnvironmentSpeechModels(mode === "foreground")),
      ]);
      if (current !== epoch.current || revision !== refreshRevision.current) return;
      setStatus(nextStatus);
      setModels((previous) => {
        if (mode === "foreground") return nextModels.models;
        const benchmarks = new Map(previous.map((model) => [model.id, model.benchmark]));
        return nextModels.models.map((model) => {
          const benchmark = benchmarks.get(model.id);
          return benchmark ? { ...model, benchmark } : model;
        });
      });
    } catch (error) {
      if (mode === "progress") return;
      if (current !== epoch.current || revision !== refreshRevision.current) return;
      toastManager.add({
        type: "error",
        title: gt("Could not load transcription models"),
        description: errorText(error),
      });
    }
  });
  useEffect(() => {
    epoch.current += 1;
    if (enabled) void refresh("foreground");
    return () => {
      epoch.current += 1;
    };
  }, [enabled, refresh]);
  const downloading =
    requestedDownload !== null ||
    models.some((model) => model.state === "downloading" || model.state === "verifying");
  // Polls progress while a local request or main reports an active download.
  useEffect(() => {
    if (!enabled || !downloading) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh("progress");
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1_000);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [downloading, enabled, refresh]);

  const run = async (label: string, work: () => Promise<unknown>, downloadId?: string) => {
    if (!enabled) return;
    const current = epoch.current;
    if (downloadId) setRequestedDownload(downloadId);
    else setBusy(true);
    try {
      await work();
    } catch (error) {
      if (current === epoch.current)
        toastManager.add({
          type: "error",
          title: label,
          description: errorText(error),
        });
    }
    if (current === epoch.current) {
      if (downloadId) setRequestedDownload(null);
      else setBusy(false);
      await refresh("foreground");
    }
  };
  return {
    models,
    status,
    run,
    controlsDisabled: busy || downloading,
    canCancel: !busy,
    requestedDownload,
  };
}

type VoiceModels = ReturnType<typeof useVoiceModels>;

function AdvancedSpeechSettings({ catalog }: { catalog: VoiceModels }) {
  const messages = useMessages();
  const gt = useGT();
  const settings = useClientSettings();
  const { run, controlsDisabled, status } = catalog;
  if (!status?.supported) return null;
  const supported = status;
  return (
    <AdvancedSettings>
      <SettingsRow
        {...setting("speech-streaming")}
        title={gt("Streaming transcription")}
        description={
          supported.supportsStreaming
            ? gt(
                "Transcribe while recording. Turn off to transcribe after stopping, which may help when live transcription falls behind.",
              )
            : gt("This model doesn’t support native streaming.")
        }
        control={
          <Switch
            aria-label={gt("Streaming transcription")}
            disabled={!supported.supportsStreaming}
            checked={settings.speechStreaming}
            onCheckedChange={(checked) => void updateClientSettings({ speechStreaming: checked })}
          />
        }
      />
      <SettingsRow
        {...setting("speech-hardware")}
        title={gt("Hardware")}
        description={gt("Auto uses this computer’s GPU when it has one.")}
        control={
          <Select
            value={supported.acceleration}
            disabled={controlsDisabled}
            onValueChange={(value) => {
              if (value)
                void run(gt("Could not change transcription hardware"), () =>
                  runEnvironmentSpeech(
                    updateEnvironmentSpeechAcceleration(value as SpeechAcceleration),
                  ),
                );
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("Transcription hardware")} className="max-w-72">
              <SelectValue>
                {supported.acceleration === "auto"
                  ? gt("Auto")
                  : supported.acceleration === "cpu"
                    ? gt("CPU")
                    : (supported.gpuDevices.find(
                        (device) => `gpu:${device.id}` === supported.acceleration,
                      )?.name ?? gt("Selected GPU"))}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="auto">
                <T>Auto</T>
              </SelectItem>
              <SelectItem value="cpu">
                <T>CPU</T>
              </SelectItem>
              {supported.gpuDevices.map((device) => (
                <SelectItem key={device.id} value={`gpu:${device.id}`}>
                  {device.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title={gt("Unload model")}
        description={gt("Release the model’s memory after it sits idle.")}
        control={
          <Select
            value={supported.modelUnloadTimeout}
            disabled={controlsDisabled}
            onValueChange={(value) => {
              if (value)
                void run(gt("Could not change when the model unloads"), () =>
                  runEnvironmentSpeech(
                    updateEnvironmentSpeechModelUnloadTimeout(value as SpeechModelUnloadTimeout),
                  ),
                );
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("Unload model")} className="max-w-72">
              <SelectValue>{messages(UNLOAD_LABELS[supported.modelUnloadTimeout])}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(UNLOAD_LABELS) as SpeechModelUnloadTimeout[]).map((timeout) => (
                <SelectItem key={timeout} value={timeout}>
                  {messages(UNLOAD_LABELS[timeout])}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </AdvancedSettings>
  );
}

function SpeechModelBrowser(props: { catalog: VoiceModels }) {
  const gt = useGT();
  const locale = useLocale();
  const {
    catalog: { status, models, run, controlsDisabled, canCancel, requestedDownload },
  } = props;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SpeechModelSort>("recommended");
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [existingPath, setExistingPath] = useState("");
  const [languageSearch, setLanguageSearch] = useState("");
  const [selection, setSelection] = useState<string[] | null>(null);
  const [preferred] = useState(preferredSpeechLanguages);
  const supportedLanguages = [...new Set(models.flatMap((model) => model.languages))];
  const defaultLanguage = preferred.find((code) => supportedLanguages.includes(code));
  const selectedLanguages = selection ?? (defaultLanguage ? [defaultLanguage] : []);
  const languages = orderSpeechLanguages(supportedLanguages, preferred, locale);
  const needle = languageSearch.trim().toLocaleLowerCase();
  const visibleLanguages = languages.filter(
    (code) =>
      !needle ||
      code.includes(needle) ||
      languageLabel(code, locale).toLocaleLowerCase().includes(needle),
  );
  const accuracyLanguage = selectedLanguages[0] ?? "en";
  const sortLabels: Record<SpeechModelSort, string> = {
    recommended: gt("Recommended"),
    size: gt("Smallest"),
    accuracy: gt("Most accurate"),
    speed: gt("Fastest"),
  };
  const languagesLabel =
    selectedLanguages.length === 0
      ? gt("All languages")
      : selectedLanguages.map((code) => languageLabel(code, locale)).join(", ");
  const benchmarkTier = status?.supported ? status.benchmarkTier : undefined;
  const recommendations = recommendSpeechModels(models, selectedLanguages, benchmarkTier);
  const sortedModels = filterSpeechModels(
    models,
    {
      search,
      languages: selectedLanguages,
      downloadedOnly,
      sort,
      accuracyLanguage,
      benchmarkTier,
    },
    recommendations,
  );
  const activeModel = models.find((model) => model.active);
  const renderedModels =
    activeModel && !sortedModels.includes(activeModel)
      ? [activeModel, ...sortedModels]
      : sortedModels;
  const linkPath = (path: string) =>
    run(gt("Could not use a model from that path"), async () => {
      await runEnvironmentSpeech(linkEnvironmentSpeechModels(path));
      setExistingPath("");
    });
  const browse = (kind: "file" | "folder") =>
    void run(gt("Could not use a model from that path"), async () => {
      const path = await runEnvironmentSpeech(pickEnvironmentSpeechModelPath(kind));
      if (path) {
        await runEnvironmentSpeech(linkEnvironmentSpeechModels(path));
        setExistingPath("");
      }
    });

  if (!status) return null;
  if (!status.supported)
    return (
      <SettingsRow
        {...setting("speech-models")}
        title={gt("Models")}
        description={gt("This computer can’t transcribe audio: {reason}.", {
          reason: status.reason,
        })}
      />
    );
  return (
    <SettingsRow
      {...setting("speech-models")}
      title={gt("Models")}
      description={gt(
        "Grades and seconds per 30 s use Handy’s reference {tier}, not your hardware. Select languages for balanced recommendations.",
        { tier: status.benchmarkTier === "cpu" ? "CPU" : "GPU" },
      )}
      className="@container/voice-models"
    >
      <div className="mt-3 flex min-w-0 gap-2">
        <InputGroup className="min-w-0 flex-1 **:[input]:h-9 sm:**:[input]:h-8">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={gt("Search transcription models")}
            placeholder={gt("Search models")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <Menu>
          <MenuTrigger
            render={<Button variant="outline" className="max-w-56" />}
            aria-label={gt("Filter by language: {languagesLabel}", { languagesLabel })}
          >
            <LanguagesIcon />
            <span className="hidden truncate @min-[34rem]/voice-models:inline">
              {languagesLabel}
            </span>
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuSearchInput
              autoFocus
              aria-label={gt("Search languages")}
              placeholder={gt("Search languages")}
              value={languageSearch}
              onChange={(e) => setLanguageSearch(e.target.value)}
            />
            <div
              role="group"
              aria-label={gt("Browse models by language")}
              className="max-h-72 overflow-y-auto"
            >
              {needle ? null : (
                <MenuCheckboxItem
                  checked={selectedLanguages.length === 0}
                  onCheckedChange={() => setSelection([])}
                >
                  <T>All languages</T>
                </MenuCheckboxItem>
              )}
              {visibleLanguages.map((code) => (
                <MenuCheckboxItem
                  key={code}
                  checked={selectedLanguages.includes(code)}
                  onCheckedChange={() =>
                    setSelection(
                      selectedLanguages.includes(code)
                        ? selectedLanguages.filter((language) => language !== code)
                        : [...selectedLanguages, code],
                    )
                  }
                >
                  {languageLabel(code, locale)}
                </MenuCheckboxItem>
              ))}
              {visibleLanguages.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  <T>No languages match.</T>
                </p>
              )}
            </div>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger
            render={<Button variant="outline" />}
            aria-label={
              downloadedOnly
                ? gt("Sort and filter models: {sort}, downloaded only", { sort: sortLabels[sort] })
                : gt("Sort and filter models: {sort}", { sort: sortLabels[sort] })
            }
          >
            <ArrowDownUpIcon />
            <span className="hidden @min-[34rem]/voice-models:inline">{sortLabels[sort]}</span>
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>
                <T>Sort by</T>
              </MenuGroupLabel>
              <MenuRadioGroup
                value={sort}
                onValueChange={(value) => setSort(value as SpeechModelSort)}
              >
                {(Object.keys(sortLabels) as SpeechModelSort[]).map((value) => (
                  <MenuRadioItem key={value} value={value} closeOnClick>
                    <span className="flex items-center justify-between gap-3">
                      {value === "accuracy"
                        ? gt("Most accurate in {language}", {
                            language: languageLabel(accuracyLanguage, locale),
                          })
                        : sortLabels[value]}
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuCheckboxItem checked={downloadedOnly} onCheckedChange={setDownloadedOnly}>
              <T>Downloaded only</T>
            </MenuCheckboxItem>
          </MenuPopup>
        </Menu>
      </div>
      <div
        className="mt-2 mb-2 max-h-96 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/60"
        role="region"
        aria-label={gt("Transcription models")}
        tabIndex={0}
      >
        {sortedModels.length === 0 && (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            <T>No models match.</T>
          </p>
        )}
        {renderedModels.map((model) => {
          const card: ModelCardProps = {
            model:
              model.id === requestedDownload && model.state === "downloadable"
                ? { ...model, state: "downloading" }
                : model,
            busy: controlsDisabled,
            canCancel,
            comparisonLanguages: selectedLanguages,
            recommendation: recommendations.get(model.id),
            benchmarkTier: status.benchmarkTier,
            onDownload: () =>
              void run(
                gt("Could not download the model"),
                () => runEnvironmentSpeech(downloadEnvironmentSpeechModel(model.id)),
                model.id,
              ),
            onSelect: () =>
              void run(gt("Could not select the model"), () =>
                runEnvironmentSpeech(selectEnvironmentSpeechModel(model.id)),
              ),
            onCancel: () =>
              void run(gt("Could not cancel the download"), () =>
                runEnvironmentSpeech(cancelEnvironmentSpeechModelDownload(model.id)),
              ),
            onDelete: () =>
              void run(gt("Could not delete the model"), () =>
                runEnvironmentSpeech(removeEnvironmentSpeechModel(model.id)),
              ),
          };
          return model.active ? (
            <TranscriptionTest key={model.id} card={card} hidden={!sortedModels.includes(model)} />
          ) : (
            <ModelCard key={model.id} {...card} />
          );
        })}
      </div>
      {status.supportsModelLinking !== false ? (
        <form
          className="mb-2 flex flex-col items-start gap-2 @min-[28rem]/voice-models:flex-row @min-[28rem]/voice-models:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void linkPath(existingPath);
          }}
        >
          <div className="w-full min-w-0 flex-1">
            <Input
              size="compact"
              aria-label={gt("Path to a model file or folder already on this computer")}
              placeholder={gt("Already downloaded elsewhere? Paste the model file or folder path")}
              value={existingPath}
              onChange={(e) => setExistingPath(e.target.value)}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Menu>
              <MenuTrigger
                render={<Button type="button" size="sm" variant="outline" />}
                disabled={controlsDisabled}
              >
                <FolderOpenIcon />
                <T>Browse…</T>
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => browse("file")}>
                  <FileIcon />
                  <T>Model file…</T>
                </MenuItem>
                <MenuItem onClick={() => browse("folder")}>
                  <FolderOpenIcon />
                  <T>Folder of models…</T>
                </MenuItem>
              </MenuPopup>
            </Menu>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={controlsDisabled || !existingPath.trim()}
            >
              <T>Use existing</T>
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsRow>
  );
}

function TranscriptionTest(props: { readonly card: ModelCardProps; readonly hidden: boolean }) {
  const gt = useGT();
  const [transcript, setTranscript] = useState<string | null>(null);
  const draft = transcript ?? "";
  const [showTranscript, setShowTranscript] = useState(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const speech = useEnvironmentSpeechInput({
    ownerKey: "hyper-voice-settings-test",
    cleanup: false,
    readDraft: () => ({
      text: draftRef.current,
      selection: { start: draftRef.current.length, end: draftRef.current.length },
    }),
    commitDraft: (text) => setTranscript(text),
  });
  return (
    <div {...setting("transcription-test")} hidden={props.hidden}>
      <ModelCard
        {...props.card}
        stacked={showTranscript}
        testControls={
          <div className="order-last flex min-w-0 max-w-full basis-full items-center gap-1 @min-[28rem]/model:order-none @min-[28rem]/model:basis-auto">
            <ComposerSpeechRecordingPill
              state={speech.state}
              progress={null}
              level={speech.level}
              onStart={() => void speech.start()}
              onStop={() => void speech.stop()}
              onCancel={() => speech.cancel()}
              onSkipPostProcessing={() => speech.skipPostProcessing()}
            />
            {speech.available ? (
              speech.state.phase === "idle" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowTranscript(true);
                    void speech.start();
                  }}
                >
                  <MicIcon />
                  <T>Test model</T>
                </Button>
              ) : null
            ) : (
              <span className="text-xs text-muted-foreground">
                {speech.status?.supported === false
                  ? speech.status.reason
                  : gt("Waiting for transcription to start")}
              </span>
            )}
          </div>
        }
      >
        {showTranscript ? (
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 py-1 ps-3 pe-1">
            <div className="min-w-0 flex-1 py-1.5">
              {speech.preview || transcript !== null ? null : (
                <p className="text-xs text-muted-foreground">
                  <T>
                    Say a sentence. Cleanup is skipped, so you see exactly what the model heard.
                  </T>
                </p>
              )}
              {speech.preview || transcript !== null ? (
                <p
                  role="status"
                  aria-label={gt("Test transcript")}
                  className="select-text whitespace-pre-wrap break-words text-sm leading-relaxed"
                >
                  {speech.preview ? (
                    <>
                      {speech.preview.committed}
                      <span className="text-muted-foreground">{speech.preview.tentative}</span>
                    </>
                  ) : (
                    transcript || gt("No speech recognized. Try again.")
                  )}
                </p>
              ) : null}
            </div>
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label={gt("Close model test")}
              onClick={() => {
                speech.cancel();
                setShowTranscript(false);
              }}
            >
              <XIcon />
            </Button>
          </div>
        ) : null}
      </ModelCard>
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
    </div>
  );
}

export function VoiceSettingsPanel({ connectionsOnly = false }: { connectionsOnly?: boolean } = {}) {
  const messages = useMessages();
  const gt = useGT();
  const cleanupEnabled = useCleanupGrant() !== null;
  const settings = useClientSettings();
  const choice = useAudioChoice();
  const grant = choice === "off" ? null : choice;
  const cloudProvider =
    grant?.destination.kind === "cloud" ? grant.destination.provider : undefined;
  const local = grant?.destination.kind === "environment";
  const [pendingCloud, setPendingCloud] = useState<CloudSpeechProvider | null>(null);
  const [microphones, setMicrophones] = useState<BrowserMicrophone[]>([]);
  const catalog = useVoiceModels(local && !connectionsOnly);

  const refreshMicrophones = useStableCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await listAudioInputs();
      setMicrophones(devices);
      updateMicrophoneOrder((order) => rememberMicrophones(order, devices));
    } catch {
      setMicrophones([]);
    }
  });
  // Follows microphone device changes while settings are open.
  useEffect(() => {
    if (connectionsOnly) return;
    queueMicrotask(() => void refreshMicrophones());
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const onChange = () => void refreshMicrophones();
    mediaDevices.addEventListener("devicechange", onChange);
    return () => mediaDevices.removeEventListener("devicechange", onChange);
  }, [connectionsOnly, refreshMicrophones]);
  const modelStatus = catalog.status;

  const order = microphoneOrder(settings);
  const selectedMicrophone = preferredMicrophoneId(order, microphones);
  const localLabel = messages(LOCAL_LABEL);
  const cloudChoices = CloudSpeechProvider.literals.map((provider) => ({
    provider,
    value: JSON.stringify(["cloud", provider]),
  }));
  const destinationValue = cloudProvider
    ? JSON.stringify(["cloud", cloudProvider])
    : local
      ? LOCAL
      : OFF;
  // OpenRouter users still manage their own model choice.
  const manageLabel = cloudProvider === "openrouter" ? gt("Manage OpenRouter") : gt("Manage key");
  const chosenUnsupported = local && modelStatus?.supported === false;
  const model = local && modelStatus?.supported ? modelStatus : null;

  return (
    <SettingsPageContainer>
      {!connectionsOnly && <SettingsSection id="voice-input" title={gt("Input")}>
        <SettingsRow
          {...setting("voice-microphone")}
          title={gt("Microphone")}
          description={gt("Voice input uses the first connected microphone in this list.")}
          control={
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={gt("Refresh microphones")}
                    onClick={() => void refreshMicrophones()}
                  >
                    <RefreshCwIcon />
                  </Button>
                }
              />
              <TooltipPopup>
                <T>Refresh microphones</T>
              </TooltipPopup>
            </Tooltip>
          }
        >
          <div className="mt-3 pb-2">
            <MicrophoneOrderList order={order} devices={microphones} />
          </div>
        </SettingsRow>
        <MicrophoneTest
          key={selectedMicrophone}
          microphoneId={selectedMicrophone}
          onMicrophoneAccess={() => void refreshMicrophones()}
        />
        <SettingsRow
          {...setting("hyper-bot-voice-hotkey")}
          title={gt("Global Hyper-Bot voice assistant")}
          description={gt(
            "Press Ctrl+Alt+Space from anywhere—even when HyperTask is in the system tray—to open the floating voice sphere for English and Hebrew commands. For offline Hebrew + English, choose Whisper Large v3 Turbo below (or a cloud provider).",
          )}
          control={
            <Badge variant="outline" className="font-mono text-xs">
              Ctrl+Alt+Space
            </Badge>
          }
        />
        <SettingsRow
          {...setting("dictation-shortcut-mode")}
          title={gt("Dictation shortcut")}
          description={`${messages(SHORTCUT_MODES[settings.voiceShortcutMode].hint)}.`}
          control={
            <Select
              value={settings.voiceShortcutMode}
              onValueChange={(value) => {
                if (value)
                  void updateClientSettings({ voiceShortcutMode: value as VoiceShortcutMode });
              }}
            >
              <SelectTrigger size="sm" aria-label={gt("Dictation shortcut mode")}>
                <SelectValue>
                  {messages(SHORTCUT_MODES[settings.voiceShortcutMode].label)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(Object.keys(SHORTCUT_MODES) as VoiceShortcutMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    <span className="flex flex-col">
                      {messages(SHORTCUT_MODES[mode].label)}
                      <span className="text-xs text-muted-foreground">
                        {messages(SHORTCUT_MODES[mode].hint)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>}

      <SettingsSection id="voice-transcription" title={gt("Transcription")}>
        <SettingsRow
          {...setting("voice-transcription-destination")}
          title={gt("Transcribe with")}
          description={
            chosenUnsupported
              ? gt("This computer can’t transcribe audio locally. Choose another destination.")
              : gt("Where your speech is turned into text.")
          }
          control={
            <div className="flex w-full min-w-0 items-center gap-1.5 @min-[32rem]/settings-row:w-auto">
              <Select
                value={destinationValue}
                onValueChange={(value) => {
                  if (!value) return;
                  const cloud = cloudChoices.find((option) => option.value === value);
                  if (cloud) {
                    setPendingCloud(cloud.provider);
                    return;
                  }
                  setPendingCloud(null);
                  if (value === OFF) chooseAudioDestination(null);
                  else if (value === LOCAL) chooseAudioDestination({ kind: "environment" });
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={gt("Transcribe with")}
                  className="min-w-0 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:max-w-72"
                >
                  <SelectValue>
                    <span className="flex min-w-0 items-center gap-2">
                      {cloudProvider ? (
                        <CloudSpeechLogo provider={cloudProvider} />
                      ) : local ? (
                        <MonitorIcon aria-hidden className="size-4" />
                      ) : (
                        <MicOffIcon aria-hidden className="size-4" />
                      )}
                      <span className="truncate">
                        {cloudProvider
                          ? CLOUD_SPEECH_LABELS[cloudProvider]
                          : local
                            ? localLabel
                            : gt("Off")}
                      </span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value={OFF}>
                    <span className="flex items-center gap-2">
                      <MicOffIcon aria-hidden className="size-4" />
                      <T>Off</T>
                    </span>
                  </SelectItem>
                  <SelectGroup>
                    <SelectGroupLabel>
                      <T>On this computer</T>
                    </SelectGroupLabel>
                    <SelectItem value={LOCAL}>
                      <span className="flex items-center gap-2">
                        <MonitorIcon aria-hidden className="size-4" />
                        {localLabel}
                      </span>
                    </SelectItem>
                  </SelectGroup>
                  <SelectGroup>
                    <SelectGroupLabel>
                      <T>Cloud</T>
                    </SelectGroupLabel>
                    {cloudChoices.map(({ value, provider }) => (
                      <SelectItem
                        key={value}
                        value={value}
                      >
                        <span className="flex items-center gap-2">
                          <CloudSpeechLogo provider={provider} />
                          {CLOUD_SPEECH_LABELS[provider]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectPopup>
              </Select>
              {cloudProvider && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                        aria-label={manageLabel}
                        onClick={() => setPendingCloud(cloudProvider)}
                      >
                        <KeyRoundIcon aria-hidden className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipPopup>{manageLabel}</TooltipPopup>
                </Tooltip>
              )}
            </div>
          }
        />
        {pendingCloud && (
          <CloudVoiceConfiguration
            key={pendingCloud}
            provider={pendingCloud}
            active={cloudProvider === pendingCloud}
            close={() => setPendingCloud(null)}
          />
        )}
        {!connectionsOnly && <>
        {(model || cloudProvider) && (
          <SettingsRow
            {...setting("speech-language")}
            title={gt("Language")}
            description={
              cloudProvider
                ? gt("The provider detects your language automatically.")
                : model?.supportsLanguageDetection
                  ? gt("{model} detects the language automatically.", { model: model.model })
                  : model
                    ? gt("{model} uses one fixed language.", { model: model.model })
                    : gt("This model uses one fixed language.")
            }
            control={<SpeechLanguageSelect model={cloudProvider ? cloudSpeechLanguages : model} />}
          />
        )}
        {model?.supportsTranslation ? (
          <SettingsRow
            title={gt("Translate to English")}
            description={gt("Speak any language and get English text.")}
            control={
              <Switch
                aria-label={gt("Translate to English")}
                checked={settings.speechTranslateToEnglish}
                onCheckedChange={(checked) =>
                  void updateClientSettings({ speechTranslateToEnglish: checked })
                }
              />
            }
          />
        ) : null}
        <SettingsRow
          {...setting("speech-silence-filtering")}
          title={gt("Silence filtering")}
          description={
            cloudProvider === "openai"
              ? gt("OpenAI handles silence itself.")
              : gt("Skip silence and background noise before transcribing.")
          }
          control={
            <Switch
              aria-label={gt("Silence filtering")}
              disabled={cloudProvider === "openai"}
              checked={settings.speechSilenceFiltering}
              onCheckedChange={(checked) =>
                void updateClientSettings({ speechSilenceFiltering: checked })
              }
            />
          }
        />
        <SettingsRow
          {...setting("remove-filler-words")}
          title={gt("Remove filler words")}
          description={gt("Drop “um” and “uh” from transcripts.")}
          control={
            <Switch
              aria-label={gt("Remove filler words")}
              checked={settings.speechRemoveFillerWords}
              onCheckedChange={(checked) =>
                void updateClientSettings({ speechRemoveFillerWords: checked })
              }
            />
          }
        />
        {local ? <SpeechModelBrowser catalog={catalog} /> : null}
        {local && <AdvancedSpeechSettings catalog={catalog} />}
        </>}
      </SettingsSection>

      {!connectionsOnly && <>
      <SettingsSection id="voice-dictionary" title={gt("Dictionary")}>
        <SettingsRow
          {...setting("speech-dictionary")}
          title={gt("Your dictionary")}
          description={gt("Names and terms to spell your way, saved on this device.")}
        >
          <div className="mt-3 pb-2">
            <DictionaryEditor
              label="dictionary"
              words={settings.speechCustomWords}
              onChange={(words) => void updateClientSettings({ speechCustomWords: words })}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="speech-post-processing" title={gt("Cleanup")}>
        <SettingsRow
          title={gt("Clean up transcripts")}
          description={gt(
            "Off by default. Sends the transcript and nearby draft text, never audio, to the cleanup model.",
          )}
          control={
            <Switch
              aria-label={gt("Clean up transcripts")}
              checked={cleanupEnabled}
              onCheckedChange={chooseTranscriptCleanup}
            />
          }
        />
        {cleanupEnabled ? (
          <SettingsRow
            title={gt("Instructions")}
            description={
              settings.speechPostProcessingPrompt.mode === "custom"
                ? gt("Your own instructions for cleanup.")
                : gt("Fix punctuation, numbers, lists, and spoken corrections.")
            }
            control={
              <Select
                value={settings.speechPostProcessingPrompt.mode}
                onValueChange={(value) => {
                  if (value === "default" || value === "custom")
                    void updateClientSettings({
                      speechPostProcessingPrompt: {
                        mode: value,
                        customInstructions:
                          value === "custom" &&
                          !settings.speechPostProcessingPrompt.customInstructions.trim()
                            ? DEFAULT_SPEECH_POST_PROCESSING_PROMPT
                            : settings.speechPostProcessingPrompt.customInstructions,
                      },
                    });
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Cleanup instructions")}>
                  <SelectValue>
                    {settings.speechPostProcessingPrompt.mode === "custom"
                      ? gt("Custom")
                      : gt("Built-in")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="default">
                    <T>Built-in</T>
                  </SelectItem>
                  <SelectItem value="custom">
                    <T>Custom</T>
                  </SelectItem>
                </SelectPopup>
              </Select>
            }
          >
            {settings.speechPostProcessingPrompt.mode === "custom" ? (
              <div className="mt-3 pb-2">
                <Textarea
                  aria-label={gt("Custom cleanup instructions")}
                  maxLength={10_000}
                  value={settings.speechPostProcessingPrompt.customInstructions}
                  onChange={(event) =>
                    void updateClientSettings({
                      speechPostProcessingPrompt: {
                        mode: "custom",
                        customInstructions: event.target.value,
                      },
                    })
                  }
                />
              </div>
            ) : null}
          </SettingsRow>
        ) : null}
        {cleanupEnabled ? <CleanupModelRow /> : null}
        {cleanupEnabled ? (
          <SettingsRow
            {...setting("speech-correction-word")}
            title={gt("Correction cue")}
            description={gt("The phrase you say to fix a mistake, like “scratch that”.")}
            control={
              <Input
                key={settings.speechCorrectionWord}
                defaultValue={settings.speechCorrectionWord}
                maxLength={50}
                placeholder="sorry"
                aria-label={gt("Correction cue")}
                className="@min-[32rem]/settings-row:w-40"
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== settings.speechCorrectionWord)
                    void updateClientSettings({ speechCorrectionWord: next });
                }}
              />
            }
          />
        ) : null}
      </SettingsSection>
      </>}
    </SettingsPageContainer>
  );
}
