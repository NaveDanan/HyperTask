// Adapted from OpenBot, MIT Copyright (c) 2026 CopilotKit.
import HyperNativeSkills from '../skills/HyperNativeSkills';
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
export default function HyperSection(props: { context: HyperOpenBotSectionContext; path?: string }) { return <HyperNativeSkills admin {...props} />; }
