// Adapted from OpenBot at f8af37ab73e96784f174a11104505a965e722cab.
// MIT License. Copyright (c) 2026 CopilotKit. See ../LICENSE.
const NOT_RUN_AFTER_FAILURE = "Not run: an earlier browser action in this step failed. Look at the page again before trying it.";
function hyperReadOutcome(text: string): { ok?: boolean } | null { try { return JSON.parse(text); } catch { return null; } }
type StepMessage = {
  id?: string;
  role: string;
  toolCalls?: readonly { id: string; function: { name: string } }[];
  toolCallId?: string;
  content?: unknown;
};

type StepLine = { tail: Promise<void>; failedAt?: number };

/** Each step's line, by computer and step. Only the most recent are kept; a step is soon over. */
const lines = new Map<string, StepLine>();
const KEPT = 200;

/** Whether a computer action's answer says it did not happen as asked. */
function didNotWork(result: unknown): boolean {
  if (typeof result === "string") return hyperReadOutcome(result)?.ok === false;
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { ok?: unknown }).ok === false
  );
}

/**
 * Take a computer action in its step's order, and only if nothing before it in the step failed.
 *
 * ONE AT A TIME, IN ORDER. Each action waits for the one asked for before it in its step, on the
 * same computer, whatever the SDK does with the calls: it runs them one after another today, and
 * nothing in the protocol says it must. Each step's line is kept here, in the tab that runs the
 * step, because that is the only place that sees the step whole; the server's gate sees one call at
 * a time, from any replica, and the computer takes its actions one at a time in the order they
 * reach it.
 *
 * STOPPED AT THE FIRST FAILURE. An action after one that did not work is answered as not run
 * ({@link NOT_RUN_AFTER_FAILURE}), not thrown: a thrown handler ends the Bot's turn with nothing
 * said. An earlier action of the step already answered as failed, by this tab or by the server's
 * continuation, counts too.
 *
 * A call outside any step it can find (no conversation, or one that does not hold it) is taken as
 * it is.
 */
export async function hyperInStepOrder<T>(
  where: {
    computerId: string;
    messages: readonly StepMessage[] | undefined;
    toolCallId: string | undefined;
  },
  act: () => Promise<T>,
): Promise<T | typeof NOT_RUN_AFTER_FAILURE> {
  const { computerId, messages, toolCallId } = where;
  const holder = messages?.find(
    (message) =>
      message.role === "assistant" &&
      message.toolCalls?.some((call) => call.id === toolCallId),
  );
  if (!messages || !toolCallId || !holder?.id || !holder.toolCalls)
    return act();
  const step = holder.toolCalls;
  const at = step.findIndex((call) => call.id === toolCallId);
  const key = `${computerId}\n${holder.id}`;
  const line: StepLine = lines.get(key) ?? { tail: Promise.resolve() };
  lines.delete(key);
  lines.set(key, line);
  if (lines.size > KEPT) {
    const oldest = lines.keys().next().value;
    if (oldest !== undefined) lines.delete(oldest);
  }
  const failed = () => {
    line.failedAt = Math.min(line.failedAt ?? at, at);
  };
  const before = line.tail;
  let done = () => {};
  line.tail = new Promise<void>((resolve) => {
    done = resolve;
  });
  try {
    await before;
    if (
      (line.failedAt !== undefined && line.failedAt < at) ||
      failedBefore(messages, step, at)
    )
      return NOT_RUN_AFTER_FAILURE;
    try {
      const result = await act();
      if (didNotWork(result)) failed();
      return result;
    } catch (error) {
      failed();
      throw error;
    }
  } finally {
    done();
  }
}

/** Whether a computer action asked for earlier in the step already has an answer that failed. */
function failedBefore(
  messages: readonly StepMessage[],
  step: readonly { id: string; function: { name: string } }[],
  at: number,
): boolean {
  const earlier = step
    .slice(0, at)
    .filter((call) => call.function.name.startsWith("computer_"))
    .map((call) => call.id);
  return messages.some(
    (message) =>
      message.role === "tool" &&
      typeof message.toolCallId === "string" &&
      earlier.includes(message.toolCallId) &&
      didNotWork(message.content),
  );
}
