import type { UserProfilePB } from '@shared/protobuf/hyper-user/user_profile_pb';
import { HyperBotScreen } from './HyperBotScreen';
export { HyperBotsView, type HyperBotActions as HyperBotsActions } from './HyperBotScreen';
export { HyperBotsApprovalCard } from './HyperBotApproval';
export { HyperBotsComposer, HyperBotsComposerBox } from './HyperBotComposer';
export { hyperBotsMentionHint } from './HyperBotChat';
export function HyperBotsPage({ userProfile }: { userProfile?: UserProfilePB | null }) {
  // Remount per signed-in user; main independently verifies the account on every IPC call.
  const userId = userProfile?.id.toString();
  return userId ? <HyperBotScreen key={userId} userId={userId} /> : <p role="status" className="p-6 text-center text-sm text-muted-foreground">Sign in to use Hyper-Bot.</p>;
}
