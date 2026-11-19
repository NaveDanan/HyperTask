// Copied from t3code (apps/server/src/speech/nativeLanguage.test.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
import { expect, it } from "vitest";

import { nativeSpeechLanguage } from "./nativeLanguage";

const nemotron = ["en-US", "en-GB", "es-US", "es-ES", "de-DE"];

it.each([
  ["auto omits the hint", nemotron, "auto", undefined],
  ["exact entry", ["en", "de"], "de", "de"],
  ["exact entry before a regional one", ["de-DE", "de"], "de", "de"],
  ["case and underscore normalize to the advertised spelling", nemotron, "DE_de", "de-DE"],
  ["bare code takes the first regional entry", nemotron, "en", "en-US"],
  ["regional request with another region passes through", nemotron, "de-AT", "de-AT"],
  ["unadvertised language passes through", nemotron, "fr", "fr"],
  ["model without an advertised list passes through", [], "de", "de"],
])("%s", (_name, advertised, language, expected) => {
  expect(nativeSpeechLanguage(advertised, language)).toBe(expected);
});
