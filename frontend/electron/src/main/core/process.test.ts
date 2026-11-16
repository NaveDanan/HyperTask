import { expect, it } from 'vitest';
import { CoreProcess } from './process';

it('reports a missing core promptly with an actionable HyperTask error', async () => {
  const core = new CoreProcess('missing-hypertask-core-executable');
  await expect(core.start(() => {})).rejects.toThrow(/HyperTask core.*build:core/i);
}, 3000);
