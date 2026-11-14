import HyperNativeConnections from '../connections/HyperNativeConnections';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
export default function HyperSection(props: { context: HyperOpenBotSectionContext; path?: string }) { return <HyperNativeConnections admin {...props} />; }
