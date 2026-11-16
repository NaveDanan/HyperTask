// Copyright (c) 2026 CopilotKit. MIT. Ported from pinned f8af37a channel-chat.tsx.
import type { Message } from "@ag-ui/core";
/** One production recovery entry point; active runs retain their streamed state. */
export function hyperRestoreStoredMessages(agent: { isRunning: boolean; messages: Message[]; setMessages(messages: Message[]): void }, stored: Message[]) {
  if (agent.isRunning) return;
  agent.setMessages(mergeStoredMessages(agent.messages, stored, { readBack: true }));
}

export function mergeStoredMessages(
  local: Message[],
  stored: Message[],
  /**
   * Reading back a run whose live stream broke (`broken-stream.ts`): the store's copy of what that
   * stream drew is the whole of it. Only then does a longer stored reply win when the screen's is not
   * its beginning, and a stored message with more of a step's calls take the place of the one drawn.
   * Otherwise the screen's copy stands: a store a beat behind holds an older version of a message
   * this tab is still writing.
   */
  { readBack = false }: { readBack?: boolean } = {},
): Message[] {
  const localIds = new Set(local.map((message) => message.id));
  /*
   * The store can name a tool call's message differently from the live turn — `assistant-call_1`
   * where the stream said `call_1` — so a stored message whose every call the live turn already
   * holds is that live message, not a missing one. Added as missing, its card was drawn twice.
   */
  const localByCall = new Map<string, string>();
  for (const message of local) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? [])
      localByCall.set(call.id, message.id);
  }
  /*
   * One the live turn holds some of the calls of is that message too: a broken stream drew only the
   * first of a step's calls. Two live messages sharing its calls is not one message, and is left be.
   */
  const heldAs = (message: Message): string | undefined => {
    if (localIds.has(message.id)) return message.id;
    if (message.role !== "assistant" || !message.toolCalls?.length) return;
    const holders = new Set(
      message.toolCalls
        .map((call) => localByCall.get(call.id))
        .filter((holder) => !readBack || holder !== undefined),
    );
    const [holder] = holders;
    return holders.size === 1 ? holder : undefined;
  };
  const seenStored = new Set<string>();
  const before = new Map<string, Message[]>();
  /** The stored copy of each local message the store holds, by the local id. */
  const storedFor = new Map<string, Message>();
  let pending: Message[] = [];
  for (const message of stored) {
    if (seenStored.has(message.id)) continue;
    seenStored.add(message.id);
    const held = heldAs(message);
    if (held !== undefined) {
      if (pending.length > 0) before.set(held, [...(before.get(held) ?? []), ...pending]);
      pending = [];
      if ((readBack || held === message.id) && !storedFor.has(held))
        storedFor.set(held, message);
    } else {
      pending.push(message);
    }
  }
  let lengthened = false;
  const current = local.map((message) => {
    const later = storedFor.get(message.id);
    if (message.role === "tool" && later?.role === "tool" &&
      message.toolCallId === later.toolCallId && waitingTool(message) &&
      typeof later.content === "string" && later.content.trim() && !waitingTool(later)) {
      lengthened = true;
      return later;
    }
    if (message.role !== "assistant" || later?.role !== "assistant")
      return message;
    const localContent = typeof message.content === "string" ? message.content : readBack ? "" : undefined;
    const content =
      localContent !== undefined &&
      typeof later.content === "string" &&
      later.content.length > localContent.length &&
      (readBack || later.content.startsWith(localContent))
        ? later.content
        : undefined;
    const toolCalls = readBack
      ? moreCalls(message.toolCalls, later.toolCalls)
      : undefined;
    if (content === undefined && toolCalls === undefined) return message;
    lengthened = true;
    return {
      ...message,
      ...(content !== undefined ? { content } : {}),
      ...(toolCalls !== undefined ? { toolCalls } : {}),
    };
  });
  if (!lengthened && before.size === 0 && pending.length === 0) return local;
  return [
    ...current.flatMap((message) => [
      ...(before.get(message.id) ?? []),
      message,
    ]),
    ...pending,
  ];
}

function waitingTool(message: Message): boolean {
  if (message.role !== "tool" || typeof message.content !== "string") return false;
  try { return JSON.parse(message.content)?.waiting === true; }
  catch { return false; }
}

type ToolCalls = Extract<Message, { role: "assistant" }>["toolCalls"];

/**
 * Recover calls by ID. One improved or extra stored call must not shorten another live call,
 * and a lagging store must not remove a live call it has not recorded yet.
 */
function moreCalls(live: ToolCalls, stored: ToolCalls): ToolCalls {
  if (!stored?.length) return undefined;
  const storedById = new Map(stored.map((call) => [call.id, call]));
  const calls = live ?? [];
  let changed = false;
  const recovered = calls.map(call => {
    const saved = storedById.get(call.id);
    if (!saved || saved.function.arguments.length <= call.function.arguments.length) return call;
    changed = true;
    return { ...call, function: { ...call.function, arguments: saved.function.arguments } };
  });
  const held = new Set(calls.map(call => call.id));
  for (const call of stored) {
    if (held.has(call.id)) continue;
    held.add(call.id); recovered.push(call); changed = true;
  }
  return changed ? recovered : undefined;
}

