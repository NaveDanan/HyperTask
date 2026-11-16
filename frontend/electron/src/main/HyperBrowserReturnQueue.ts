/** A credential-free browser return waits for AI readiness; native handling still owns identity and confirmation. */
export class HyperBrowserReturnQueue {
  private pending = false;
  private busy = false;
  constructor(private readonly ready: () => boolean, private readonly handle: () => Promise<void>) {}
  request() { this.pending = true; void this.flush(); }
  async flush(): Promise<void> {
    if (!this.pending || this.busy || !this.ready()) return;
    this.pending = false; this.busy = true;
    try { await this.handle(); }
    catch { this.pending = true; return; }
    finally { this.busy = false; }
    if (this.pending) void this.flush();
  }
}
