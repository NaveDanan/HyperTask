import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], state: 0, ref: 0, effects: [] as (() => unknown)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: any) => { const slot = h.state++, values = h.values; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; }, useRef: (initial: any) => { const slot = h.ref++; return h.refs[slot] ?? (h.refs[slot] = { current: initial }); }, useEffect: (effect: () => unknown) => h.effects.push(effect) }));
vi.mock('./HyperPlatformApi', async original => ({ ...await original<typeof import('./HyperPlatformApi')>(), hyperLoadProvider: vi.fn(), hyperLoadModelUsage: vi.fn(), hyperLoadProviderControls: vi.fn() }));
import { hyperLoadProvider, hyperLoadModelUsage } from './HyperPlatformApi';
import HyperProvidersSection from './HyperProvidersSection';
function render() { h.state = 0; h.ref = 0; h.effects = []; return HyperProvidersSection(); }
function text(node: any): string { if (Array.isArray(node)) return node.map(text).join(''); if (React.isValidElement(node)) return text((node as React.ReactElement<any>).props.children); return typeof node === 'string' ? node : ''; }
afterEach(() => { h.values = []; h.refs = []; vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('keeps a successfully loaded personal catalogue visible when the usage endpoint is unavailable', async () => {
  vi.stubGlobal('React', React);
  vi.mocked(hyperLoadProvider).mockResolvedValue({ provider: 'openai', source: 'personal', exposure: 'all', default: 'model', listed: true, models: [{ id: 'model', label: 'Available model' }] });
  vi.mocked(hyperLoadModelUsage).mockRejectedValue(new Error('Usage is not available in personal edition'));
  render(); for (const effect of h.effects) effect(); for (let i = 0; i < 10; i++) await Promise.resolve();
  const shown = text(render()); expect(shown).toContain('Available model'); expect(shown).toContain('could not be read');
});
