import { Badge } from '@/components/reui/badge';
import { JiraStatusCategory, jiraStatusCategoryLabels } from '..';

export function HyperJiraStatusBadge({ label, category }: { label: string; category: JiraStatusCategory }) {
  const variant = category === JiraStatusCategory.done ? 'success-light' : category === JiraStatusCategory.inProgress ? 'info-light' : category === JiraStatusCategory.unknown ? 'warning-light' : 'secondary';
  return <Badge variant={variant} size="sm" className="max-w-32 rounded-md text-xs"><span className="truncate">{label || jiraStatusCategoryLabels[category]}</span></Badge>;
}
export { HyperJiraStatusBadge as JiraStatusBadge };
