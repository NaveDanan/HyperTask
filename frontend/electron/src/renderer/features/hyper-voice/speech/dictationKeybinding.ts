// The dictation chord, t3code's `composer.dictation` default ({ key: "mod+shift+d", when: "!terminalFocus" } in
// packages/shared/src/keybindings.ts), matched and labelled as t3code's apps/web/src/keybindings.ts does.
// Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// HyperTask's Settings → Shortcuts lists the document editor's commands only, so the chord is fixed here.

export type ShortcutEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** True for Ctrl+Shift+D (⇧⌘D on macOS), with no other modifier. */
export function matchesDictationShortcut(event: ShortcutEventLike): boolean {
  const mac = isMac();
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return (
    (key === "d" || event.code === "KeyD") &&
    event.shiftKey &&
    !event.altKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  );
}

/** formatShortcutLabel for the chord: "Ctrl+Shift+D", or "⇧⌘D" on macOS. */
export function dictationShortcutLabel(): string {
  return isMac() ? "⇧⌘D" : "Ctrl+Shift+D";
}
