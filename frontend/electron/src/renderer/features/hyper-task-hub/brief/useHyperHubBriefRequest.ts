// Which meeting brief is open. HyperHome and Focus request a brief; the Task Hub page shows the one sheet,
// so every entry point opens the same occurrence (spec D9.3).
import { create } from 'zustand';

interface HyperHubBriefRequestState {
  meetingId: string | null;
  open: (meetingId: string) => void;
  close: () => void;
}

export const useHyperHubBriefRequest = create<HyperHubBriefRequestState>(set => ({
  meetingId: null,
  open: meetingId => set({ meetingId }),
  close: () => set({ meetingId: null }),
}));
