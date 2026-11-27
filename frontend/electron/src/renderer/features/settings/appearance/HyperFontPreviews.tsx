// Ported from t3code (apps/web/src/components/settings/SettingsFontPreviews.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.

import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TERMINAL_THEME } from '@/features/hyper-openbot/computer-browser/HyperTerminalTheme';
import { cn } from '@/lib/utils';
import { useBrightness } from '@/theme/appearance-store';
import { HyperPromptEditor } from '@/features/hyper-bots/prompt/HyperPromptEditor';

const PROMPT_PREVIEW_SKILLS = new Map([['frontend-design', { label: 'frontend-design', description: 'Design and style interfaces.' }]]);
const PROMPT_PREVIEW_TEXT =
  'Use $frontend-design to fix the flaky test in ' +
  '[surface.test.ts](apps/web/src/terminal/ghostty/surface.test.ts) and align the header with ' +
  '[SettingsPanels.tsx](apps/web/src/components/settings/SettingsPanels.tsx) before shipping.';

export function PromptFontPreview() {
  const [prompt, setPrompt] = useState(PROMPT_PREVIEW_TEXT);
  return (
    <div className="mt-1 mb-2 rounded-lg border border-border bg-background px-3 py-2">
      <HyperPromptEditor aria-label="Prompt font preview" value={prompt} skills={PROMPT_PREVIEW_SKILLS} onChange={setPrompt} />
    </div>
  );
}

// t3code's sample patch (@@ -1,3 +1,3 @@), drawn as a unified diff with old and new line numbers.
const DIFF_PREVIEW_FILE = 'src/formatUser.ts';
const DIFF_PREVIEW_LINES: ReadonlyArray<{
  kind: ' ' | '-' | '+';
  old: number | null;
  new: number | null;
  text: string;
}> = [
  { kind: ' ', old: 1, new: 1, text: 'export function formatUser(user: User) {' },
  { kind: '-', old: 2, new: null, text: '  return user.name.toUpperCase();' },
  { kind: '+', old: null, new: 2, text: '  return `${user.name} <${user.email}>`; // 0O 1lI' },
  { kind: ' ', old: 3, new: 3, text: '}' },
];

const CODE_PREVIEW_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-code, 13px)',
};

export function CodeFontPreview() {
  return (
    <div className="mt-1 mb-2 space-y-2">
      <div className="overflow-hidden rounded-lg border border-border bg-background" style={CODE_PREVIEW_STYLE}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate font-sans text-xs font-medium text-foreground">
            {DIFF_PREVIEW_FILE}
          </span>
          <span className="font-sans text-xs tabular-nums text-destructive">-1</span>
          <span className="font-sans text-xs tabular-nums text-emerald-600 dark:text-emerald-400">+1</span>
        </div>
        <div className="overflow-x-auto py-1">
          {DIFF_PREVIEW_LINES.map((line, index) => (
            <div
              key={index}
              className={cn(
                'flex whitespace-pre',
                line.kind === '-' && 'bg-destructive/10',
                line.kind === '+' && 'bg-emerald-500/10',
              )}
            >
              <span className="w-9 shrink-0 select-none pr-2 text-right text-muted-foreground/60 tabular-nums">
                {line.old ?? ''}
              </span>
              <span className="w-9 shrink-0 select-none pr-2 text-right text-muted-foreground/60 tabular-nums">
                {line.new ?? ''}
              </span>
              <span
                className={cn(
                  'w-4 shrink-0 select-none text-center',
                  line.kind === '-' && 'text-destructive',
                  line.kind === '+' && 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {line.kind === ' ' ? '' : line.kind}
              </span>
              <span className="pr-3 text-foreground">{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TERMINAL_PROMPT =
  '\x1b[1;32m→\x1b[0m \x1b[1;36mhypertask\x1b[0m \x1b[1;34mgit:(\x1b[1;31mmain\x1b[1;34m)\x1b[0m \x1b[1;33m✗\x1b[0m ';
const TERMINAL_PREVIEW_TRANSCRIPT =
  `${TERMINAL_PROMPT}vpr dev\r\n` +
  '\r\n' +
  '  \x1b[1;32mVITE\x1b[0m \x1b[32mv7.1.1\x1b[0m  \x1b[2mready in\x1b[0m \x1b[1m1.24s\x1b[0m\r\n' +
  '\r\n' +
  '  \x1b[32m→\x1b[0m  \x1b[2mLocal:\x1b[0m    \x1b[4;36mhttp://127.0.0.1:5173/\x1b[0m\r\n' +
  '  \x1b[32m→\x1b[0m  \x1b[2mNetwork:\x1b[0m  \x1b[4;36mhttp://192.168.1.24:5173/\x1b[0m\r\n' +
  '\r\n' +
  '  \x1b[32m✓ 85 passed\x1b[0m   \x1b[33m△ 2 warnings\x1b[0m   \x1b[31m✗ 0 failed\x1b[0m\r\n' +
  '\r\n' +
  '  \x1b[42;30m READY \x1b[0m \x1b[2mwatching for changes, press\x1b[0m \x1b[1mq\x1b[0m \x1b[2mto quit\x1b[0m\r\n' +
  '\r\n' +
  TERMINAL_PROMPT;
const TERMINAL_LINE_HEIGHT = 1.2;

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#fbfbfd',
  foreground: '#1f1d2b',
  cursor: '#4f55d6',
  cursorAccent: '#fbfbfd',
  selectionBackground: '#4f55d640',
};

/** A read-only xterm showing a sample transcript in the given family and size. */
export function TerminalFontPreview({ family, size }: { family: string; size: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const brightness = useBrightness();

  // The terminal is rebuilt for each font, so its cell metrics always match the box it fits.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: 'block',
      disableStdin: true,
      fontFamily: family,
      fontSize: size,
      lineHeight: TERMINAL_LINE_HEIGHT,
      scrollback: 0,
      theme: brightness === 'dark' ? TERMINAL_THEME : LIGHT_TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(mount);
    // t3code's preview box is a fixed h-52; the terminal fills it and larger fonts show fewer rows.
    fit.fit();
    terminal.write(TERMINAL_PREVIEW_TRANSCRIPT);
    return () => {
      terminal.dispose();
    };
  }, [family, size, brightness]);

  return (
    <div
      ref={mountRef}
      className="relative mt-1 mb-2 h-52 overflow-hidden rounded-lg border border-border"
      aria-label="Terminal font preview"
    />
  );
}
