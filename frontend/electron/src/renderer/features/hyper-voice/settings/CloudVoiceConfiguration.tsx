// Copied from t3code (apps/web/src/components/settings/CloudVoiceConfiguration.tsx), Copyright (c) 2026 T3 Tools Inc.,
// MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: HyperTask is the only environment and the person using it manages its keys,
// so connection, permission and administrator branches are gone. Keys are typed in (no secret-provider references),
// saved by the main process with the OS credential protection, and never shown again. Reads use React state
// instead of Effect atoms.
import { useCallback, useEffect, useId, useState } from "react";
import * as Schema from "effect/Schema";
import { cloudSpeechDisclosure } from "@shared/hyper-voice/speechCopy";
import {
  CloudSpeechApiKey,
  CloudSpeechModelId,
  CLOUD_SPEECH_LABELS,
  CLOUD_SPEECH_PROVIDER_NAMES,
  type CloudSpeechKeys,
  type CloudSpeechModel,
  type CloudSpeechModels,
  type CloudSpeechProvider,
} from "@shared/hyper-voice/speech";
import type { VoiceTranscriptionDestination } from "@shared/hyper-voice/settings";
import { T, useGT, Var } from "../gt";
import {
  getCloudSpeechKeys,
  getCloudSpeechModels,
  runEnvironmentSpeech,
  setCloudSpeechKey,
} from "../environment";
import { chooseAudioDestination, pendingCloudAudioChoice, useAudioChoice } from "../speech/voiceConsent";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  useComboboxFilter,
} from "../ui/combobox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { SecretInput } from "./SecretInput";

/** The environment's name in t3code's sentences; here it is always this app. */
const ENVIRONMENT_LABEL = "HyperTask";

type CloudRead<A> =
  | { readonly _tag: "Initial" }
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure" };

// Per dialog instance: key presence must be read fresh each time it opens.
function useCloudRead<A>(enabled: boolean, read: () => Promise<A>) {
  const [result, setResult] = useState<CloudRead<A>>({ _tag: "Initial" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setResult({ _tag: "Initial" });
    read().then(
      (value) => current && setResult({ _tag: "Success", value }),
      () => current && setResult({ _tag: "Failure" }),
    );
    return () => {
      current = false;
    };
    // `read` is a module-level request; the revision re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return [result, refresh] as const;
}
const readKeys = (): Promise<CloudSpeechKeys> => runEnvironmentSpeech(getCloudSpeechKeys());
const readModels = (): Promise<CloudSpeechModels> => runEnvironmentSpeech(getCloudSpeechModels());
const isApiKey = Schema.is(CloudSpeechApiKey);
const isModelId = Schema.is(CloudSpeechModelId);
type CloudDestination = Extract<VoiceTranscriptionDestination, { kind: "cloud" }>;

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  current,
}: {
  models: ReadonlyArray<CloudSpeechModel>;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  /** The grant's model, flagged when the catalog no longer lists it. */
  current: string | undefined;
}) {
  const gt = useGT();
  const { contains } = useComboboxFilter();
  const selected = models.find((model) => model.id === value) ?? null;
  const delisted = current !== undefined && !models.some((model) => model.id === current);
  return (
    <div className="grid gap-1">
      <Combobox
        items={models}
        itemToStringLabel={(model: CloudSpeechModel) => model.name}
        itemToStringValue={(model: CloudSpeechModel) => model.id}
        filter={(model: CloudSpeechModel, query) =>
          contains(model.name, query) || contains(model.id, query)
        }
        value={selected}
        onValueChange={(model) => onChange(model?.id ?? "")}
        autoHighlight
        disabled={disabled}
      >
        <ComboboxInput
          id="voice-cloud-model"
          aria-label={gt("OpenRouter model")}
          placeholder={gt("Search transcription models")}
          autoFocus
          size="sm"
        />
        <ComboboxPopup>
          <ComboboxEmpty>
            <T>No transcription model matches.</T>
          </ComboboxEmpty>
          <ComboboxList className="max-h-64">
            {(model: CloudSpeechModel) => (
              <ComboboxItem key={model.id} value={model}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{model.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{model.id}</span>
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
      {delisted ? (
        <p className="text-sm text-destructive" role="alert">
          <T>
            OpenRouter no longer lists <Var>{current}</Var>. Dictation stays off until you choose
            another model.
          </T>
        </p>
      ) : selected ? (
        <p className="truncate text-xs text-muted-foreground">{selected.id}</p>
      ) : null}
    </div>
  );
}

export function CloudVoiceConfiguration({
  provider,
  active,
  close,
}: {
  provider: CloudSpeechProvider;
  active: boolean;
  close: () => void;
}) {
  const gt = useGT();
  const name = CLOUD_SPEECH_LABELS[provider];
  const company = CLOUD_SPEECH_PROVIDER_NAMES[provider];
  const routed = provider === "openrouter";
  const formId = useId();
  const [presence, refresh] = useCloudRead(true, readKeys);
  const [models, refreshModels] = useCloudRead(routed, readModels);
  const choice = useAudioChoice();
  const grant = choice === "off" ? null : choice;
  const currentModel =
    active && grant?.destination.kind === "cloud" && grant.destination.provider === "openrouter"
      ? grant.destination.model
      : undefined;
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState(currentModel ?? "");
  const saved = presence._tag === "Success" ? (presence.value[provider] ?? false) : undefined;
  const [draft, setDraft] = useState("");
  const credential = isApiKey(draft.trim()) ? draft.trim() : undefined;
  const keyChanged = credential !== undefined;
  // Fixed providers edit the key only when nothing is saved or the device already uses them.
  const editingKey = saved !== undefined && (routed || active || !saved);
  const listedModels = models._tag === "Success" ? models.value.models : null;
  const modelChosen = isModelId(model) && (listedModels?.some((m) => m.id === model) ?? false);
  const keyReady = draft.trim() ? credential !== undefined : Boolean(saved);
  const modelChanged = model !== (currentModel ?? "");
  const destination = (): CloudDestination =>
    routed && isModelId(model)
      ? { kind: "cloud", provider: "openrouter", model }
      : { kind: "cloud", provider: provider as "openai" | "xai" };
  const enable = () => chooseAudioDestination(destination());
  const canSubmit = routed
    ? modelChosen && keyReady && (!active || modelChanged || keyChanged)
    : credential !== undefined;

  const saveKey = async (value: string | null, thenEnable: boolean) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const commit = thenEnable ? pendingCloudAudioChoice(destination()) : null;
      await runEnvironmentSpeech(setCloudSpeechKey(provider, value));
      refresh();
      commit?.();
      close();
    } catch {
      setError(gt("Couldn’t save this change. Try again."));
    }
    setBusy(false);
  };
  const submit = () => {
    if (!canSubmit || busy) return;
    const grantChanges = !active || modelChanged;
    if (credential !== undefined && (!routed || keyChanged))
      return void saveKey(credential, grantChanges);
    // Model-only changes never write the key.
    if (grantChanges) enable();
    close();
  };

  const keyField = (
    <>
      <Label htmlFor="voice-cloud-key">
        {routed && saved ? gt("Replace API key") : gt("API key")}
      </Label>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <SecretInput
            id="voice-cloud-key"
            name="key"
            aria-label={gt("{company} API key", { company })}
            autoFocus={!routed}
            placeholder={gt("Enter API key")}
            value={draft}
            configured={saved === true}
            disabled={busy}
            maxLength={4096}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {draft.trim() && !credential
          ? gt("Enter an API key, not a URL or secret reference.")
          : active && !routed
            ? gt("Updating the key keeps dictation enabled.")
            : routed && saved
              ? gt("Leave blank to keep the saved key.")
              : gt("HyperTask keeps the key protected on this computer and never shows it again.")}
      </p>
    </>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {remove
              ? gt("Remove the {company} key?", { company })
              : active
                ? routed
                  ? gt("Manage OpenRouter dictation")
                  : gt("Manage {company} key", { company })
                : gt("Use {name} for dictation?", { name })}
          </DialogTitle>
          <DialogDescription>
            {remove
              ? gt("Dictation with {name} stops until you add a key again.", { name })
              : active && !routed
                ? gt("HyperTask sends your recordings to {company} with this API key.", {
                    company,
                  })
                : cloudSpeechDisclosure(provider, ENVIRONMENT_LABEL)}
          </DialogDescription>
        </DialogHeader>
        {!remove && (
          <DialogPanel>
            {presence._tag === "Failure" && saved === undefined ? (
              <Button size="sm" variant="outline" onClick={refresh}>
                <T>Retry loading API key</T>
              </Button>
            ) : saved === undefined ? (
              <p role="status">
                <T>Checking for an API key…</T>
              </p>
            ) : routed ? (
              <form
                id={formId}
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="voice-cloud-model">
                    <T>Model</T>
                  </Label>
                  {listedModels ? (
                    <ModelPicker
                      models={listedModels}
                      value={model}
                      onChange={setModel}
                      disabled={busy}
                      current={currentModel}
                    />
                  ) : models._tag === "Failure" ? (
                    <Button size="sm" variant="outline" type="button" onClick={refreshModels}>
                      <T>Retry loading models</T>
                    </Button>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      <T>Loading transcription models…</T>
                    </p>
                  )}
                </div>
                <div className="grid gap-2">{keyField}</div>
              </form>
            ) : editingKey ? (
              <form
                id={formId}
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                {keyField}
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                <T>Uses the API key already saved in HyperTask. Choose Off to stop using it.</T>
              </p>
            )}
          </DialogPanel>
        )}
        {error && (
          <p className="px-6 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          {saved && (active || routed) && !remove && (
            <div className="sm:mr-auto">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setRemove(true)}
              >
                <T>Remove key…</T>
              </Button>
            </div>
          )}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>
            <T>Cancel</T>
          </Button>
          {remove ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void saveKey(null, false)}
            >
              <T>Remove key</T>
            </Button>
          ) : routed ? (
            saved !== undefined ? (
              <Button type="submit" form={formId} size="sm" disabled={busy || !canSubmit}>
                {active ? gt("Save", { $context: "verb" }) : gt("Save and enable")}
              </Button>
            ) : null
          ) : editingKey ? (
            <Button type="submit" form={formId} size="sm" disabled={busy || !credential}>
              {active ? gt("Save key") : gt("Save and enable")}
            </Button>
          ) : saved && !active ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                enable();
                close();
              }}
            >
              <T>
                Use <Var>{name}</Var>
              </T>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
