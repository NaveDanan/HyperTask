/** Keep a successful write separate from a failed authoritative read-back. */
export type HyperMutationResult = 'confirmed' | 'unconfirmed' | 'refused';
export async function HyperRunMutation(write: () => Promise<unknown>, read: () => Promise<unknown>): Promise<HyperMutationResult> {
  try { await write(); } catch { return 'refused'; }
  try { await read(); return 'confirmed'; } catch { return 'unconfirmed'; }
}
