import { expect, it } from 'vitest';
import { HyperOutlookBridge } from './HyperOutlookBridge';
it.skipIf(process.env.HYPER_OUTLOOK_IT !== '1' || process.platform !== 'win32')('reads real Outlook status and a bounded calendar range without writing', async () => {
  const bridge = new HyperOutlookBridge();
  try {
    const status = await bridge.request('status', undefined); expect(status.available, status.reason).toBe(true);
    const today = new Date(), start = new Date(today.getFullYear(), today.getMonth(), 1), end = new Date(today.getFullYear(), today.getMonth() + 2, 1);
    const items = await bridge.request('list', { start: start.toISOString(), end: end.toISOString() });
    expect(items.length).toBeLessThanOrEqual(2000); expect(items.every(item => !item.isCancelled)).toBe(true);
    for (const item of items) { expect(Date.parse(item.start)).toBeLessThan(end.getTime()); expect(Date.parse(item.end) + (item.allDay ? 86400000 : 0)).toBeGreaterThan(start.getTime()); }
    console.log(`Outlook available: ${status.available}; events in this and next month: ${items.length}`);
  } finally { bridge.stop(); }
});
