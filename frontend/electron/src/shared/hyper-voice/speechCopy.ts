// Copied from t3code (packages/shared/src/speechCopy.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md.
// Adapted for HyperTask by NaveDanan: product name.
import { CLOUD_SPEECH_PROVIDER_NAMES, type CloudSpeechProvider } from "./speech";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

/** @public */
export function cloudSpeechDisclosure(
  provider: CloudSpeechProvider,
  environment: string,
  resolve: MFunctionType = mFallback,
) {
  return provider === "openrouter"
    ? resolve(
        msg(
          "After you stop, {environment} sends the recording to OpenRouter. OpenRouter chooses who runs your model. HyperTask requests zero data retention; your OpenRouter account may allow safety retention.",
          { environment },
        ),
      )
    : resolve(
        msg(
          "After you stop, {environment} sends your recording and vocabulary hints to {provider}.",
          { environment, provider: CLOUD_SPEECH_PROVIDER_NAMES[provider] },
        ),
      );
}
