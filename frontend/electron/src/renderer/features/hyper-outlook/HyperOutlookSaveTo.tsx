import { useId } from 'react';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { floatingSurfaceClass } from '@/components/app/menu-row';
export function HyperOutlookSaveTo({ value, onChange }: { value: 'outlook' | 'calendar'; onChange: (value: 'outlook' | 'calendar') => void }) {
  const id = useId();
  return <Field orientation="horizontal"><FieldLabel htmlFor={id}>Save to</FieldLabel><Select value={value} onValueChange={value => { if (value === 'outlook' || value === 'calendar') onChange(value); }} items={[{ value: 'outlook', label: 'Outlook' }, { value: 'calendar', label: 'This calendar' }]}>
    <SelectTrigger id={id} className="ml-auto w-40"><SelectValue /></SelectTrigger><SelectContent className={floatingSurfaceClass}><SelectItem value="outlook">Outlook</SelectItem><SelectItem value="calendar">This calendar</SelectItem></SelectContent>
  </Select></Field>;
}
