// Microphone priority order (apps/web/src/speech/microphoneOrder.ts) as the Voice settings and recording use it.
import { expect, it } from "vitest";
import {
  forgetMicrophone,
  microphoneOrder,
  moveMicrophone,
  preferMicrophone,
  preferredMicrophoneId,
  rememberMicrophones,
} from "./microphoneOrder";

const usb = { kind: "device", deviceId: "usb", label: "USB Mic" } as const;

it("starts from System default, or the legacy choice above it", () => {
  expect(microphoneOrder({ voiceMicrophones: [], voiceMicrophone: "" })).toEqual([{ kind: "default" }]);
  expect(microphoneOrder({ voiceMicrophones: [], voiceMicrophone: "usb" })).toEqual([
    { kind: "device", deviceId: "usb", label: "" },
    { kind: "default" },
  ]);
});

it("remembers labelled devices below System default and skips alias ids", () => {
  const order = rememberMicrophones(
    [{ kind: "default" }],
    [
      { deviceId: "default", label: "Default - USB Mic" },
      { deviceId: "usb", label: "USB Mic" },
    ],
  );
  expect(order).toEqual([{ kind: "default" }, usb]);
});

it("records from the first connected entry, falling back to System default", () => {
  const order = preferMicrophone([{ kind: "default" }, usb], usb);
  expect(order[0]).toEqual(usb);
  expect(preferredMicrophoneId(order, [{ deviceId: "usb", label: "USB Mic" }])).toBe("usb");
  expect(preferredMicrophoneId(order, [{ deviceId: "other", label: "Other" }])).toBe("");
  expect(moveMicrophone(order, "device:usb", 1)[1]).toEqual(usb);
  expect(forgetMicrophone(order, "default")).toBe(order);
  expect(forgetMicrophone(order, "device:usb")).toEqual([{ kind: "default" }]);
});
