import { fromBinary } from '@bufbuild/protobuf';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SubscribeObjectSchema, type SubscribeObject } from '@shared/protobuf/flowy-notification/subject_pb';
import type { FlowyResult } from './dispatch';

/** The `source` each Rust crate stamps on its notifications (…_OBSERVABLE_SOURCE). */
export const NotificationSource = {
  Folder: 'Workspace',
  User: 'User',
  Document: 'Document',
  Database: 'Database',
  Chat: 'Chat',
  Search: 'Search',
} as const;

type SubjectListener = (subject: SubscribeObject) => void;

const listeners = new Set<SubjectListener>();
let subscribed = false;

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  window.appflowy.core.onNotification((bytes) => {
    let subject: SubscribeObject;
    try {
      subject = fromBinary(SubscribeObjectSchema, bytes);
    } catch (error) {
      console.error('SubscribeObject deserialize error', error);
      return;
    }
    listeners.forEach((listener) => listener(subject));
  });
}

/** Counterpart of Dart's RustStreamReceiver.listen. */
export function listenAll(listener: SubjectListener): () => void {
  subscribe();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type NotificationHandler<T extends number> = (ty: T, result: FlowyResult<Uint8Array>) => void;

/**
 * Counterpart of Dart's NotificationParser: delivers notifications from one source,
 * optionally only for one object id, with the payload or the FlowyError.
 */
export function listen<T extends number>(
  source: string,
  handler: NotificationHandler<T>,
  objectId?: string,
): () => void {
  return listenAll((subject) => {
    if (subject.source !== source) return;
    if (objectId !== undefined && subject.id !== objectId) return;
    if (subject.oneOfError.case === 'error') {
      handler(subject.ty as T, { ok: false, error: fromBinary(FlowyErrorSchema, subject.oneOfError.value) });
    } else {
      const payload = subject.oneOfPayload.case === 'payload' ? subject.oneOfPayload.value : new Uint8Array();
      handler(subject.ty as T, { ok: true, value: payload });
    }
  });
}
