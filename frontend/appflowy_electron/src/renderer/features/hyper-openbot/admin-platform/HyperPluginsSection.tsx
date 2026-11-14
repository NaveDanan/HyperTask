// Adapted from OpenBot, MIT Copyright (c) 2026 CopilotKit.
import { HyperConnectionsPanel, type HyperConnectionNavigationProps } from '../connections';
export default function HyperPluginsSection(props: HyperConnectionNavigationProps & { context?: unknown }) { return <HyperConnectionsPanel admin {...props} />; }
