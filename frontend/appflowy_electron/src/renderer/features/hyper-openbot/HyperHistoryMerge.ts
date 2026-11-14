// Copyright (c) 2026 CopilotKit. MIT. Ported from pinned f8af37a channel-chat.tsx.
import type { Message } from "@ag-ui/core";
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
      if (pending.length > 0) before.set(held, pending);
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
    if (message.role !== "assistant" || later?.role !== "assistant")
      return message;
    const content =
      typeof message.content === "string" &&
      typeof later.content === "string" &&
      later.content.length > message.content.length &&
      (readBack || later.content.startsWith(message.content))
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

type ToolCalls = Extract<Message, { role: "assistant" }>["toolCalls"];

/**
 * The stored calls, when they are more of the live ones: every live call is among them, and the
 * store has another, or more of one's arguments. Otherwise nothing, and the live calls stand.
 */
function moreCalls(live: ToolCalls, stored: ToolCalls): ToolCalls {
  if (!stored?.length) return undefined;
  const storedById = new Map(stored.map((call) => [call.id, call]));
  const calls = live ?? [];
  if (!calls.every((call) => storedById.has(call.id))) return undefined;
  const longer = calls.some(
    (call) =>
      (storedById.get(call.id)?.function.arguments.length ?? 0) >
      call.function.arguments.length,
  );
  return stored.length > calls.length || longer ? stored : undefined;
}

