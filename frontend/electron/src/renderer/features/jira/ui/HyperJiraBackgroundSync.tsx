import { useEffect } from 'react';
import { startHyperJiraBackgroundSync } from '../logic/HyperJiraRegistry';

export function HyperJiraBackgroundSync({ userId }: { userId: string }) {
  useEffect(() => startHyperJiraBackgroundSync(userId), [userId]);
  return null;
}
