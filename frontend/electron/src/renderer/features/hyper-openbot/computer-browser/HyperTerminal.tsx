// Adapted from OpenBot components/computer/live-terminal.tsx. Copyright (c) 2026 CopilotKit. MIT.
import { Button } from "@/components/ui/button";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  connectScreen,
  type ScreenSocket,
} from "./HyperScreenConnection";
import { socketUrl } from "./HyperScreenGeometry";
import { HyperOpenBotSocket } from "../socket";
import { TERMINAL_THEME } from "./HyperTerminalTheme";
import { useTerminalTypography } from "@/features/settings/appearance/font-families";

/**
 * The Bot's live shell, drawn by xterm.js.
 *
 * The computer runs one bash for the Bot (agent-computer/src/live-shell.ts). Its commands are typed
 * into it, so this shows each one typed and its output as it streams; a person holding the wheel types
 * into the same shell. The socket is proxied by the server from `/api/computers/:botId/terminal`.
 *
 * THE PROTOCOL, from this end. Binary frames are terminal bytes, written as they come. Text frames are
 * JSON: `snapshot` resets the terminal before the screen as it is now is redrawn, `ready` says the
 * bytes are live, `error` says what went wrong. This end sends `resize` whenever the fit add-on gives
 * the terminal a new size, `input` with what the person types while they hold the wheel, and `ack` with
 * the bytes it has drawn, which is the flow control xterm.js recommends: the computer stops sending a
 * viewer that falls behind and redraws it from its copy of the screen once it catches up.
 */

/**
 * Show the cursor to someone who is only watching.
 *
 * xterm.js draws no cursor until its terminal has been focused or typed into, so a person watching the
 * Bot work saw a prompt with nothing after it. There is no option for it. Entering the alternate
 * screen and leaving it at once is one of the things that marks the cursor ready in xterm.js's own
 * code, and it changes nothing on screen.
 */
const SHOW_CURSOR = "\x1b[?47h\x1b[?47l";

/** Acknowledged in batches: after this many bytes, or a moment after the last write. */
const ACK_EVERY_BYTES = 32 * 1024;
const ACK_AFTER_MS = 100;

export type HyperTerminalHandle = { focus: () => void };

/**
 * Give the terminal the keyboard without moving the page. xterm.js focuses a hidden textarea that
 * follows the cursor, and a plain focus scrolled the Computer panel to it, taking the tabs out of view.
 */
function focusTerminal(terminal: Terminal | null) {
  if (!terminal) return;
  if (terminal.textarea) terminal.textarea.focus({ preventScroll: true });
  else terminal.focus();
}

type Props = {
  computerId: string;
  /** Whether the signed-in person holds the wheel. Typing reaches the shell only then. */
  driving: boolean;
  /** Checked at dispatch time, including callbacks retained by xterm. Omission disables input. */
  canInput?: () => boolean;
  /** Why the terminal cannot be shown, when retrying will not change it, or the retries are spent. */
  onProblem?: (problem: string | null) => void;
  onReconnecting?: (reconnecting: boolean) => void;
  /** Bumped by the parent's Retry, which reconnects. */
  retryKey?: number;
  ref?: Ref<HyperTerminalHandle>;
};

function HyperLiveTerminal({
  computerId,
  driving,
  canInput,
  onProblem,
  onReconnecting,
  retryKey = 0,
  ref,
}: Props) {
  const host = useRef<HTMLElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<HyperOpenBotSocket | null>(null);
  const drivingRef = useRef(driving);
  drivingRef.current = driving;
  const inputRef = useRef({ computerId, live: true, canInput });
  if (inputRef.current.computerId !== computerId) {
    inputRef.current.live = false;
    inputRef.current = { computerId, live: true, canInput };
  }
  const input = inputRef.current; input.canInput = canInput;
  const problemRef = useRef(onProblem);
  problemRef.current = onProblem;
  const reconnectingRef = useRef(onReconnecting);
  reconnectingRef.current = onReconnecting;
  const [live, setLive] = useState(false);
  // The font and size follow the Appearance settings; a change reaches a live terminal (see below).
  const { family: fontFamily, size: fontSize } = useTerminalTypography();
  const refitRef = useRef<(() => void) | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => focusTerminal(terminalRef.current),
  }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry reconnects by bumping `retryKey`.
  useEffect(() => {
    input.live = true;
    const element = host.current;
    if (!element) return;
    const terminal = new Terminal({
      cursorBlink: drivingRef.current,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      disableStdin: !drivingRef.current,
      fontFamily,
      fontSize,
      lineHeight: 1.2,
      scrollback: 5_000,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    terminal.write(SHOW_CURSOR);
    terminalRef.current = terminal;

    let socket: HyperOpenBotSocket | null = null;
    const send = (message: Record<string, unknown>) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(message));
    };

    let sent = { cols: 0, rows: 0 };
    /** Fit the terminal to its box and tell the shell, which takes the size of whoever said last. */
    const refit = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      try {
        fit.fit();
      } catch {
        // A box with no layout yet; the observer calls again once it has one.
      }
      if (terminal.cols === sent.cols && terminal.rows === sent.rows) return;
      sent = { cols: terminal.cols, rows: terminal.rows };
      send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    };
    const observer = new ResizeObserver(() => refit());
    observer.observe(element);
    refitRef.current = refit;

    let drawn = 0;
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const acknowledge = () => {
      clearTimeout(ackTimer);
      ackTimer = undefined;
      if (drawn > 0) send({ type: "ack", bytes: drawn });
      drawn = 0;
    };
    const wrote = (bytes: number) => {
      drawn += bytes;
      if (drawn >= ACK_EVERY_BYTES) acknowledge();
      else ackTimer ??= setTimeout(acknowledge, ACK_AFTER_MS);
    };

    const connection = connectScreen({
      open: () => {
        const opened = new HyperOpenBotSocket(
          socketUrl(
            `/api/computers/${encodeURIComponent(computerId)}/terminal`,
          ),
        );
        opened.binaryType = "arraybuffer";
        socket = opened;
        socketRef.current = opened;
        return {
          set onopen(callback: ScreenSocket["onopen"]) {
            opened.onopen = callback
              ? () => {
                  void callback();
                }
              : null;
          },
          set onclose(callback: ScreenSocket["onclose"]) {
            opened.onclose = callback;
          },
          set onerror(callback: ScreenSocket["onerror"]) {
            opened.onerror = callback;
          },
          set onmessage(callback: ScreenSocket["onmessage"]) {
            opened.onmessage = callback;
          },
          close: () => opened.close(),
        };
      },
      // Watching needs nothing more than the socket; typing is the wheel's question.
      verifyOwnership: async () => true,
      // The size is said once the computer says `ready`, below: by then every hop is open.
      onReady: () => undefined,
      onProblem: (problem) => problemRef.current?.(problem),
      onReconnecting: (reconnecting) => reconnectingRef.current?.(reconnecting),
      onDisconnect: () => setLive(false),
      onMessage: (event) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          terminal.write(bytes, () => wrote(bytes.byteLength));
          return;
        }
        let message: { type?: unknown } | null = null;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        // An error that ends the terminal arrives through `onProblem`. Any other (a keystroke sent
        // as the wheel went back) changes nothing on screen, so it is not drawn over the shell.
        if (message?.type === "snapshot") {
          terminal.reset();
          terminal.write(SHOW_CURSOR);
        } else if (message?.type === "ready") {
          setLive(true);
          // Live from here: say the size again, since the shell may have taken someone else's.
          sent = { cols: 0, rows: 0 };
          refit();
        }
      },
      disconnected: "The terminal is disconnected. Retry to reconnect.",
    });

    return () => {
      input.live = false;
      connection.stop();
      socketRef.current = null;
      observer.disconnect();
      clearTimeout(ackTimer);
      terminalRef.current = null;
      refitRef.current = null;
      terminal.dispose();
    };
  }, [computerId, retryKey]);

  // Rebind typing to the rendered ownership guard without replacing the terminal's output or socket.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const type = (data: string) => {
      const socket = socketRef.current;
      if (terminalRef.current === terminal && input.live && inputRef.current === input && drivingRef.current && canInput?.() === true && input.canInput?.() === true && socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'input', data }));
    };
    const typing = terminal.onData(type), binary = terminal.onBinary(type);
    return () => { typing.dispose(); binary.dispose(); };
  }, [computerId, retryKey, canInput]);

  // The wheel changing hands: the keyboard reaches the shell only while it is the person's.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.disableStdin = !driving;
    terminal.options.cursorBlink = driving;
    if (driving) focusTerminal(terminal);
  }, [driving]);

  // A font or size change from the Appearance settings reaches the live terminal, and the grid is
  // refitted so the shell is told the new size. The terminal was created with these values, so the
  // first run does nothing.
  const appliedFont = useRef({ fontFamily, fontSize });
  useEffect(() => {
    const terminal = terminalRef.current;
    const applied = appliedFont.current;
    if (!terminal || (applied.fontFamily === fontFamily && applied.fontSize === fontSize)) return;
    appliedFont.current = { fontFamily, fontSize };
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize;
    refitRef.current?.();
  }, [fontFamily, fontSize]);

  return (
    <section
      aria-label={
        driving
          ? "The Bot's terminal. You have control. Type here."
          : "The Bot's terminal"
      }
      className="h-full w-full"
      data-live={live ? "" : undefined}
      ref={host}
    />
  );
}

/** Native recovery controls around the upstream streaming terminal. */
export function HyperTerminal({ computerId, driving, canInput }: { computerId: string; driving: boolean; canInput?: () => boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [retry, setRetry] = useState(0);
  return <section className="flex h-full flex-col gap-2">
    {problem && <p role="alert">{problem} <Button variant="outline" onClick={() => { setProblem(null); setRetry(value => value + 1); }}>Retry</Button></p>}
    {reconnecting && <p role="status">Reconnecting terminal…</p>}
    <div className="min-h-0 flex-1"><HyperLiveTerminal computerId={computerId} driving={driving} canInput={canInput} retryKey={retry} onProblem={setProblem} onReconnecting={setReconnecting} /></div>
  </section>;
}
