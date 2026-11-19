// Copied from t3code (apps/web/src/speech/requestMicrophone.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: no Linux audio-service restart (HyperTask has no desktop bridge for it).
export async function requestMicrophone(
  microphoneId: string,
  signal?: AbortSignal,
): Promise<MediaStream> {
  const constraints = { audio: microphoneId ? { deviceId: { exact: microphoneId } } : true };
  const open = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      const name = typeof error === "object" && error !== null && "name" in error ? error.name : "";
      if (!microphoneId || (name !== "OverconstrainedError" && name !== "NotFoundError"))
        throw error;
      signal?.throwIfAborted();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (signal?.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      signal.throwIfAborted();
    }
    return stream;
  };
  return await open();
}
