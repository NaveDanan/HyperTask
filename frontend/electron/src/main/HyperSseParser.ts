const MAX_EVENT = 1024 * 1024;

/** Incremental text/event-stream reader. Only data fields contribute to events. */
export class HyperSseParser {
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private data: string[] = [];
  private size = 0;
  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const events: string[] = [];
    for (;;) {
      const end = this.buffer.search(/\r\n|\r|\n/);
      // A final \r may be the first half of a \r\n split across chunks.
      if (end < 0 || (this.buffer[end] === '\r' && end === this.buffer.length - 1)) break;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + (this.buffer.startsWith('\r\n', end) ? 2 : 1));
      if (!line) { if (this.data.length) events.push(this.data.join('\n')); this.data = []; this.size = 0; continue; }
      const colon = line.indexOf(':');
      if (colon === 0 || (colon < 0 ? line : line.slice(0, colon)) !== 'data') continue;
      const value = colon < 0 ? '' : line.slice(colon + (line[colon + 1] === ' ' ? 2 : 1));
      this.size += value.length + 1;
      if (this.size > MAX_EVENT) throw new Error('The response contained an event larger than 1 MiB.');
      this.data.push(value);
    }
    if (this.buffer.length > MAX_EVENT) throw new Error('The response contained an event larger than 1 MiB.');
    return events;
  }
}
