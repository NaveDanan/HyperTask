import type { Writable } from 'node:stream';

/** A detached desktop launch may close its console while the core is still running. */
export function createCoreOutputWriter(output: Writable): (chunk: Buffer) => void {
  let closed = false;
  output.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
    closed = true;
  });
  return (chunk) => {
    if (!closed && !output.destroyed) output.write(chunk);
  };
}
