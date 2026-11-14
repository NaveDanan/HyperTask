import { HyperSkillsPanel, type HyperSkillsNavigationProps } from '../skills';
export default function HyperSkillsSection(props: HyperSkillsNavigationProps & { context?: unknown }) { return <HyperSkillsPanel admin {...props} />; }
