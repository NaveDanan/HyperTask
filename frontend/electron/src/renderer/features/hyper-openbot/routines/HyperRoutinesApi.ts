// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT licensed; see ../LICENSE.
import { hyperOpenBotRequest as request } from '../transport';
import { NEW_CONVERSATION } from './HyperRoutineForm';
import { type RoutinePlan, runGoalInstruction } from './HyperRoutinePlan';
import type { ResponsibilityRecord } from './HyperRoutineTypes';
class ClientError extends Error { constructor(public status: number, message: string) { super(message); } }
async function client(path:string, options:{method?:string;body?:unknown;fallback?:string} = {}) {
 try { const value = await request(path, options.method, options.body); return {json: async()=>value}; }
 catch(error) { const message=error instanceof Error?error.message:'Request failed'; const status=Number(/request failed \((\d+)\)/.exec(message)?.[1]); throw new ClientError(status, message); }
}
const createRoutine=(body:RoutineInput & {goalId?:string})=>client('/api/routines',{method:'POST',body});
const createProactiveSetting=(body:unknown,_options:unknown)=>client('/api/proactive/settings?refuseExisting=true',{method:'POST',body});
const createResponsibility=async(body:unknown)=>{const response=await client('/api/responsibilities',{method:'POST',body});return (await response.json() as {responsibility:ResponsibilityRecord}).responsibility;};
const deleteResponsibility=(id:string)=>HyperRoutineWrite('responsibilities',id,'','DELETE');
const responsibilityAction=(id:string,action:string)=>HyperRoutineWrite('responsibilities',id,action);
const GOAL_ACTION_FALLBACK={run: "Couldn't start the goal."};
export class SavedButRefused extends Error {}
export function HyperRoutineWrite(family:string,id:string,suffix='',method='POST',body?:unknown) {return request(`/api/${family}/${encodeURIComponent(id)}${suffix?'/'+suffix:''}`,method,body);}
export type RoutineInput = {
  agentId: string;
  instruction: string;
  title?: string;
  /** Five cron fields, built by `cronFrom` in `form.ts`. */
  cron: string;
  timezone: string;
  /** A conversation the person and the Bot share, or `NEW_CONVERSATION` to start one for it. */
  channelId: string;
};

async function withConversation<T>(
  agentId: string,
  channelId: string,
  name: string,
  write: (channelId: string, saved: () => void) => Promise<T>,
): Promise<T> {
  let started: string | null = null;
  if (channelId === NEW_CONVERSATION) {
    const response = await client("/api/channels", {
      method: "POST",
      body: { agentIds: [agentId] },
      fallback: "Couldn't start a conversation for this routine.",
    });
    started = ((await response.json()) as { channel: { id: string } }).channel
      .id;
    // Best effort: a conversation that keeps its default name still works.
    await client(`/api/channels/${started}/title`, {
      method: "PUT",
      body: { title: Array.from(name.trim()).slice(0, 60).join("") },
      fallback: "Couldn't name the conversation.",
    }).catch(() => undefined);
  }
  let kept = false;
  try {
    return await write(started ?? channelId, () => {
      kept = true;
    });
  } catch (error) {
    // An uncertain create may already have committed. Keep its conversation and prevent a retry,
    // even with an existing conversation: retrying could duplicate the saved work.
    const refused =
      error instanceof ClientError && error.status >= 400 && error.status < 500;
    if (!kept && !refused)
      throw new SavedButRefused(
        "It may have been saved on the Routines page. Open it there to check before creating another one.",
      );
    if (started && !kept) {
      await client(`/api/channels/${started}`, {
        method: "DELETE",
        fallback: "Couldn't remove the conversation.",
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function HyperCreatePlan(plan:RoutinePlan):Promise<void> {
      if (plan.kind === "routine") {
        const { routine } = plan;
        await withConversation(
          routine.agentId,
          routine.channelId,
          routine.title?.trim() || routine.instruction.trim(),
          async (channelId, saved) => {
            await createRoutine({ ...routine, channelId });
            saved();
          },
        );
        return;
      }

      if (plan.kind === "check-in") {
        const { checkIn } = plan;
        await withConversation(
          checkIn.agentId,
          checkIn.channelId,
          checkIn.subject.trim() || checkIn.focus.trim(),
          async (channelId, saved) => {
            // A new one: the server refuses one the Bot already has, should this screen's list of
            // them be out of date, as Name does while it is typed.
            await createProactiveSetting(
              { ...checkIn, channelId },
              { refuseExisting: true },
            );
            saved();
          },
        );
        return;
      }

      const { goal: input, schedule, runNow } = plan;
      await withConversation(
        input.agentId,
        input.channelId,
        input.title,
        async (channelId, saved) => {
          const goal = await createResponsibility({ ...input, channelId });
          const { id } = goal;

          if (schedule) {
            try {
              await createRoutine({
                agentId: input.agentId,
                channelId,
                goalId: id,
                instruction: runGoalInstruction(goal.title, id),
                cron: schedule.cron,
                timezone: schedule.timezone,
                // The routine store refuses a title over 100 characters.
                ...(Array.from(goal.title).length <= 100
                  ? { title: goal.title }
                  : {}),
              });
            } catch (error) {
              /*
               * Only a 4xx is the server saying no. A 5xx, a timeout or a dropped connection
               * says nothing about whether the routine was saved, and pausing the goal then
               * would leave a live routine firing into a paused goal.
               */
              const refused =
                error instanceof ClientError &&
                error.status >= 400 &&
                error.status < 500;
              if (!refused) {
                saved();
                throw new SavedButRefused(
                  "It's saved on the Routines page, but its schedule may not have been set. Open it there to check.",
                );
              }
              // Nothing was made but the goal: take it back. `withConversation` then takes back the
              // conversation started for it, since `saved` was not called.
              const removed = await deleteResponsibility(id).then(
                () => true,
                () => false,
              );
              if (removed) throw error;
              saved();
              const refusal = error.message;
              const paused = await responsibilityAction(id, "pause").then(
                () => true,
                () => false,
              );
              throw new SavedButRefused(
                paused
                  ? `It's saved but paused, on the Routines page. Its schedule was refused. ${refusal}`
                  : `It's saved on the Routines page, but it won't run on its own. Its schedule was refused. ${refusal}`,
              );
            }
          }
          // Nothing after this is undone: the goal and its conversation are kept.
          saved();

          if (runNow) {
            try {
              await responsibilityAction(id, "run");
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              // The fallback only says it didn't start, which this sentence already says.
              throw new SavedButRefused(
                `It's saved on the Routines page, but it didn't start. ${
                  message === GOAL_ACTION_FALLBACK.run
                    ? "Open it there to run it."
                    : message
                }`,
              );
            }
          }
        },
      );

}
