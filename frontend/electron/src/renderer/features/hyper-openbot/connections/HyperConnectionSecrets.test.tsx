import { expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HyperConnectionSecrets } from './HyperConnectionSecrets';
it('masks secrets, omits secret defaults and clears the form before forwarding ephemeral values', async () => {
  const reset = vi.fn();
  const submit = vi.fn(async (values: Record<string, string>) => { expect(reset).toHaveBeenCalledOnce(); expect(values).toEqual({ key: 'synthetic-value' }); });
  vi.stubGlobal('FormData', class { get() { return 'synthetic-value'; } });
  const props = { fields: [{ name: 'key', label: 'Service key', help: 'Help', required: true, secret: true, default: 'must-not-render' }], busy: false, onSubmit: submit, onCancel: vi.fn() };
  try {
    const tree = HyperConnectionSecrets(props);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('type="password"'); expect(html).not.toContain('must-not-render');
    tree.props.onSubmit({ preventDefault: vi.fn(), currentTarget: { reset } } as unknown as FormEvent<HTMLFormElement>);
    await Promise.resolve(); await Promise.resolve();
    expect(submit).toHaveBeenCalledOnce(); expect(submit.mock.calls[0]?.[0]).toEqual({});
  } finally { vi.unstubAllGlobals(); }
});
