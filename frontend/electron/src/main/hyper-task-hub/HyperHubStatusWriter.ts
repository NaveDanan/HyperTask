import { HyperBotsToolError } from '../HyperBotsRuntime';
import { ZodError } from 'zod';
import type { HyperHubStatusCandidate, HyperHubStatusIntent, HyperHubStatusPreview, HyperHubStatusRejectCode, HyperHubWriteSource, HyperHubWriteView } from '@shared/HyperTaskHub';
import type { HyperHubRecord } from './HyperTaskHubStore';

export class HyperHubStatusError extends Error {
  constructor(readonly code: HyperHubStatusRejectCode) { super(code); }
}

export type HyperHubWriteTarget = Pick<HyperHubRecord, 'id' | 'key' | 'projectId'>;
export type HyperHubDiscovery = Omit<HyperHubStatusPreview, 'previewId' | 'expiresAt'> & { principal: string };
export interface HyperHubStatusWriter {
  readonly source: HyperHubWriteSource;
  readonly binding: string;
  principal?(signal: AbortSignal): Promise<string | undefined>;
  discover(target: HyperHubWriteTarget, intent: HyperHubStatusIntent, previous: string | undefined, signal: AbortSignal, phase?: 'final' | 'observe'): Promise<HyperHubDiscovery>;
  send(target: HyperHubWriteTarget, candidate: HyperHubStatusCandidate, resolution: string | undefined, signal: AbortSignal): Promise<void>;
}

export interface HyperHubWriteEntry {
  target: HyperHubWriteTarget;
  binding: string;
  principal: string;
  before: HyperHubDiscovery['current'];
  beforeRevision: string;
  requestedId: string;
  after?: HyperHubDiscovery['current'];
  afterRevision?: string;
  inverseOf?: string;
  view: HyperHubWriteView;
  events: { time: number; state: HyperHubWriteView['state'] }[];
}

export function hyperHubStatusCode(error: unknown): HyperHubStatusRejectCode {
  if (error instanceof HyperHubStatusError) return error.code;
  const status = error instanceof Error && /^(?:Jira|Newsletter) returned HTTP (\d{3})\./.exec(error.message)?.[1];
  switch (status) {
    case '401': return 'reconnect';
    case '403': return 'forbidden';
    case '404': return 'not-found';
    default: return error instanceof ZodError ? 'unsupported' : error instanceof HyperBotsToolError && error.kind === 'transport' ? 'offline' : 'unavailable';
  }
}
