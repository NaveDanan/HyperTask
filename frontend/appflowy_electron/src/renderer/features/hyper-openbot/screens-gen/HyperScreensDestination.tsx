// Adapted from OpenBot routes/_authed/_app/s/$screen.tsx and component gallery routes.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import type { HyperOpenBotSectionContext } from '../HyperOpenBotSections';
import HyperGallerySection, { HyperAdminComponentsSection } from './HyperGallerySection';
import HyperPlaygroundSection from './HyperPlaygroundSection';
import { HyperGeneratedScreen } from './HyperGeneratedScreen';

export interface HyperScreensDestinationProps {
  context: HyperOpenBotSectionContext;
  /** Original nested route, e.g. /settings/components-gallery/showTable or /admin/components/askForm. */
  path?: string;
}
export type HyperScreenDestination = {kind: 'gallery' | 'admin'; name?: string} | {kind: 'playground'} | {kind: 'screen'; name: string; agentId: string; args: Record<string, unknown>} | {kind: 'missing'};
export function hyperParseScreenDestination(path = '/settings/components-gallery'): HyperScreenDestination {
  if (!path.startsWith('/') || path.startsWith('//')) return {kind: 'missing'};
  try {
    const url = new URL(path, 'https://hypertask.invalid');
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments.some(segment => segment.includes('/') || segment === '..' || segment === '.')) return {kind: 'missing'};
    if (segments[0] === 'admin' && segments[1] === 'playground' && segments.length === 2) return {kind: 'playground'};
    const gallery = segments[0] === 'settings' && segments[1] === 'components-gallery';
    const admin = segments[0] === 'admin' && segments[1] === 'components';
    if ((gallery || admin) && segments.length <= 3) return {kind: admin ? 'admin' : 'gallery', name: segments[2]};
    if (segments[0] === 's' && segments.length === 2) {
      const args: unknown = JSON.parse(url.searchParams.get('args') ?? '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) return {kind: 'missing'};
      return {kind: 'screen', name: segments[1], agentId: url.searchParams.get('agentId') ?? '', args: args as Record<string, unknown>};
    }
  } catch { /* Stale/invalid destinations return to the native gallery. */ }
  return {kind: 'missing'};
}
export default function HyperScreensDestination({context, path}: HyperScreensDestinationProps) {
  const destination = hyperParseScreenDestination(path ?? context.navigationIntent?.path);
  if (destination.kind === 'admin') return <HyperAdminComponentsSection initialName={destination.name} />;
  if (destination.kind === 'gallery') return <HyperGallerySection initialName={destination.name} />;
  if (destination.kind === 'playground') return <HyperPlaygroundSection />;
  if (destination.kind === 'screen') return <HyperGeneratedScreen name={destination.name} agentId={destination.agentId} args={destination.args} />;
  return <HyperGallerySection />;
}
