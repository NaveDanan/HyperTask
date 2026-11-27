import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape, type MessageShape } from '@bufbuild/protobuf';
import { HyperErrorSchema } from '@shared/protobuf/hyper-error/errors_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/hyper-folder/workspace_pb';
import { hyperBotsReadIdentity } from './HyperBotsHub';
import { HyperBotsToolError } from './HyperBotsRuntime';
import { Status } from './core/protocol';
import type { CoreReply } from './core/process';

export type HyperBotsProjectRequest = (event: string, payload: Uint8Array) => Promise<CoreReply>;

/** Uses the same events and protobufs as the database views, with the bot's account and workspace pinned. */
export class HyperBotsProjectCore {
  constructor(private readonly request: HyperBotsProjectRequest, private readonly userKey: string, private readonly signal: AbortSignal) {}

  async scope(expected?: string): Promise<string> {
    this.signal.throwIfAborted();
    const identity = await hyperBotsReadIdentity(this.request);
    if (identity?.key !== this.userKey) throw new HyperBotsToolError('refused', 'The HyperTask account changed. Start another request in the current account.');
    const { workspaceId } = await this.read('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
    if (!workspaceId || (expected !== undefined && expected !== workspaceId)) throw new HyperBotsToolError('refused', 'The HyperTask workspace changed. Start another request in the current workspace.');
    return workspaceId;
  }

  private workspaceId?: string;

  async pin(): Promise<string> {
    this.workspaceId = await this.scope(this.workspaceId);
    return this.workspaceId;
  }

  async read<D extends DescMessage, I extends DescMessage>(event: string, output: D, input?: I, payload?: MessageInitShape<I>): Promise<MessageShape<D>> {
    return fromBinary(output, await this.call(event, input && toBinary(input, create(input, payload))));
  }

  async write<D extends DescMessage, I extends DescMessage>(event: string, output: D, input: I, payload: MessageInitShape<I>): Promise<MessageShape<D>> {
    await this.pin();
    return fromBinary(output, await this.call(event, toBinary(input, create(input, payload)), true));
  }

  async writeVoid<I extends DescMessage>(event: string, input: I, payload: MessageInitShape<I>): Promise<void> {
    await this.pin();
    await this.call(event, toBinary(input, create(input, payload)), true);
  }

  private async call(event: string, payload = new Uint8Array(), write = false): Promise<Uint8Array> {
    this.signal.throwIfAborted();
    let reply: CoreReply;
    try { reply = await this.request(event, payload); }
    catch { throw new HyperBotsToolError(write ? 'transport' : 'refused', `HyperTask could not return a result for ${event}.`); }
    if (reply.status === Status.Ok) return reply.payload;
    if (reply.status === Status.Err) {
      let detail: string | undefined;
      try { detail = fromBinary(HyperErrorSchema, reply.payload).msg; } catch { /* Some core dispatch errors contain plain text. */ }
      throw new HyperBotsToolError('refused', detail || `HyperTask refused ${event}.`);
    }
    throw new HyperBotsToolError(write ? 'transport' : 'refused', `HyperTask could not complete ${event}.`);
  }
}
