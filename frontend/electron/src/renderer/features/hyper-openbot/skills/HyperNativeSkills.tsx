import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import { HyperSkillsPanel } from './HyperSkillsPanel';
import { hyperSkillSelectionFromPath } from './HyperSkillsNavigation';
export default function HyperNativeSkills({ context, path, admin = false }: { context: HyperOpenBotSectionContext; path?: string; admin?: boolean }) {
  const base = admin ? '/admin/skills' : '/skills';
  return <HyperSkillsPanel admin={admin} selection={path ? hyperSkillSelectionFromPath(path) : undefined} onSelectionChange={selection => context.navigate?.(admin ? 'admin-skills' : 'skills', { path: selection.page === 'list' ? base : selection.page === 'new' ? `${base}/new` : `${base}/${encodeURIComponent(selection.slug)}` })} />;
}
