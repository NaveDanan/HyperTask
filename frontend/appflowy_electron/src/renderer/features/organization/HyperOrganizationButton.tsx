import { Files } from 'lucide-react';
import { NavItem } from '@/components/app/nav';
import { useTr } from '@/i18n';
import { localToolPlugin } from '../tabs/plugin';
import { tabsActions, useTabsStore } from '../tabs/tabs-store';

export function HyperOrganizationButton() {
  const { tr } = useTr();
  const active = useTabsStore(state => state.tabs[state.currentIndex]?.plugin.id === 'local-tool:organization');
  return <NavItem icon={<Files />} label={tr('hyperOrganization.title')} active={active} onClick={() => tabsActions.openPlugin(localToolPlugin('organization'))} />;
}
