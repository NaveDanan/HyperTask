import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { hyperPropertyOperators, hyperPropertyTypes, type HyperCollectionConfig, type HyperCollectionRule, type HyperPropertyType } from './HyperCollectionModel';
import { useHyperCollectionText } from './HyperCollectionStrings';

export function HyperPropertyValueInput({ type, value, onChange, disabled, label }: { type: HyperPropertyType; value: unknown; onChange(value: string | number | boolean): void; disabled?: boolean; label: string }) {
  if (type === 'checkbox') return <Checkbox aria-label={label} disabled={disabled} checked={value === true} onCheckedChange={checked => onChange(checked === true)} />;
  return <Input aria-label={label} disabled={disabled} type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={event => onChange(type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />;
}
export function HyperCollectionEditor({ value, onChange, disabled }: { value: HyperCollectionConfig; onChange(config: HyperCollectionConfig): void; disabled?: boolean }) {
  const t = useHyperCollectionText();
  const updateRule = (index: number, patch: Partial<HyperCollectionRule>) => onChange({ ...value, rules: value.rules.map((rule, at) => at === index ? { ...rule, ...patch } : rule) });
  return <div className="flex flex-col gap-4">
    <Field><FieldLabel>{t('query')}</FieldLabel><Input disabled={disabled} aria-label={t('query')} value={value.query} onChange={event => onChange({ ...value, query: event.target.value })} /></Field>
    <Field><FieldLabel>{t('tag')}</FieldLabel><Input disabled={disabled} aria-label={t('tag')} value={value.tag} onChange={event => onChange({ ...value, tag: event.target.value })} /></Field>
    <div className="flex flex-wrap gap-2">
      <Select value={value.match} disabled={disabled} onValueChange={match => { if (match === 'all' || match === 'any') onChange({ ...value, match }); }} items={['all', 'any'].map(key => ({ value: key, label: t(key as 'all' | 'any') }))}><SelectTrigger aria-label={t('match')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('all')}</SelectItem><SelectItem value="any">{t('any')}</SelectItem></SelectContent></Select>
      <Select value={value.sort} disabled={disabled} onValueChange={sort => { if (sort === 'edited' || sort === 'name' || sort === 'created') onChange({ ...value, sort }); }} items={['edited', 'name', 'created'].map(key => ({ value: key, label: t(key === 'name' ? 'nameSort' : key as 'edited' | 'created') }))}><SelectTrigger aria-label={t('sort')}><SelectValue /></SelectTrigger><SelectContent>{(['edited', 'name', 'created'] as const).map(key => <SelectItem key={key} value={key}>{t(key === 'name' ? 'nameSort' : key)}</SelectItem>)}</SelectContent></Select>
    </div>
    {value.rules.map((rule, index) => <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <Input disabled={disabled} className="w-40" aria-label={t('propertyKey')} value={rule.property} placeholder="priority" onChange={event => updateRule(index, { property: event.target.value })} />
      <Select disabled={disabled} value={rule.type} onValueChange={type => { if (type) updateRule(index, { type: type as HyperPropertyType, operator: 'exists', value: undefined }); }} items={hyperPropertyTypes.map(type => ({ value: type, label: t(type) }))}><SelectTrigger aria-label={t('propertyType')}><SelectValue /></SelectTrigger><SelectContent>{hyperPropertyTypes.map(type => <SelectItem key={type} value={type}>{t(type)}</SelectItem>)}</SelectContent></Select>
      <Select disabled={disabled} value={rule.operator} onValueChange={operator => { if (operator) updateRule(index, { operator: operator as HyperCollectionRule['operator'], value: rule.type === 'checkbox' ? false : rule.type === 'number' ? 0 : '' }); }} items={hyperPropertyOperators(rule.type).map(operator => ({ value: operator, label: t(operator) }))}><SelectTrigger aria-label={t('operator')}><SelectValue /></SelectTrigger><SelectContent>{hyperPropertyOperators(rule.type).map(operator => <SelectItem key={operator} value={operator}>{t(operator)}</SelectItem>)}</SelectContent></Select>
      {rule.operator !== 'exists' && rule.operator !== 'missing' && <div className="min-w-32 flex-1"><HyperPropertyValueInput type={rule.type} value={rule.value} disabled={disabled} label={t('propertyValue')} onChange={value => updateRule(index, { value })} /></div>}
      <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t('removeRule')} onClick={() => onChange({ ...value, rules: value.rules.filter((_, at) => at !== index) })}><X /></Button>
    </div>)}
    <Button variant="outline" className="self-start" disabled={disabled || value.rules.length >= 100} onClick={() => onChange({ ...value, rules: [...value.rules, { property: '', type: 'text', operator: 'exists' }] })}><Plus />{t('addRule')}</Button>
  </div>;
}
