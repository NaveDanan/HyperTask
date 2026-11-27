import { Fragment, useId, useState, type ComponentType, type CSSProperties } from 'react';
import { createComponentImplementation, type ReactA2uiComponentProps, type ReactCatalogComponent } from '@a2ui/react';
import type { FunctionImplementation, NodeAction } from '@a2ui/web_core/v1_0';
import { hyperBotA2uiCatalog } from '@shared/HyperBotA2ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Child = string | { id: string; basePath: string };
type View<T> = ReactA2uiComponentProps<T>;
type Field<T> = { label?: string; value?: T; setValue?: (value: T) => void };

const renderChild = (build: View<unknown>['buildChild'], child: Child) =>
  typeof child === 'string' ? build(child) : build(child.id, child.basePath);
const childKey = (child: Child) => typeof child === 'string' ? child : child.id;
const alignment = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', spaceAround: 'space-around', spaceBetween: 'space-between', spaceEvenly: 'space-evenly' } as const;
type Layout = { children: Child[]; align?: keyof typeof alignment; justify?: keyof typeof alignment };

function HyperBotA2uiCard({ props, buildChild }: View<{ child: Child }>) {
  return <Card className="hyper-bot-a2ui-card border border-border bg-card shadow-xs ring-0">
    <CardContent>{renderChild(buildChild, props.child)}</CardContent>
  </Card>;
}

function HyperBotA2uiText({ props }: View<{ text?: string; variant?: 'body' | 'caption' }>) {
  return <span className={cn('hyper-bot-a2ui-text text-start whitespace-pre-wrap break-words [unicode-bidi:plaintext]', props.variant === 'caption' && 'text-xs text-muted-foreground')}>{props.text}</span>;
}

function HyperBotA2uiLayout({ props, buildChild, horizontal }: View<Layout> & { horizontal?: boolean }) {
  const style: CSSProperties = { alignItems: alignment[props.align ?? 'stretch'], justifyContent: alignment[props.justify ?? 'start'] };
  return <div className={cn('hyper-bot-a2ui-layout flex min-w-0 gap-3', horizontal ? 'flex-wrap' : 'flex-col')} style={style}>
    {props.children?.map(child => <Fragment key={childKey(child)}>{renderChild(buildChild, child)}</Fragment>)}
  </div>;
}

function HyperBotA2uiList({ props, buildChild }: View<Layout & { direction?: 'vertical' | 'horizontal' }>) {
  return <ul className={cn('m-0 flex list-none gap-2 p-0', props.direction === 'horizontal' ? 'flex-wrap' : 'flex-col')} style={{ alignItems: alignment[props.align ?? 'stretch'] }}>
    {props.children?.map(child => <li key={childKey(child)}>{renderChild(buildChild, child)}</li>)}
  </ul>;
}

function HyperBotA2uiButton({ props, buildChild, accessibilityRef, validationErrorsRef }: View<{ child: Child; action?: NodeAction; variant?: 'default' | 'primary' | 'borderless' }>) {
  return <div className="grid justify-items-start gap-1">
    <Button ref={accessibilityRef} type="button" size="sm" variant={props.variant === 'primary' ? 'default' : props.variant === 'borderless' ? 'ghost' : 'secondary'}
      className={cn('h-8 max-w-full rounded-full px-3 whitespace-normal', props.variant === 'primary' && 'hyper-bot-a2ui-primary')}
      onClick={event => { if (event.nativeEvent.isTrusted) void props.action?.(); }}>{renderChild(buildChild, props.child)}</Button>
    <div ref={validationErrorsRef} className="text-xs text-destructive empty:hidden" />
  </div>;
}

function HyperBotA2uiTextField({ props, accessibilityRef, validationErrorsRef }: View<Field<string> & { placeholder?: string; variant?: 'shortText' | 'longText' | 'number' | 'obscured' }>) {
  const id = useId();
  const shared = { id, ref: accessibilityRef, value: props.value ?? '', placeholder: props.placeholder, readOnly: !props.setValue, autoComplete: 'off' };
  return <div className="grid min-w-0 gap-2">
    {props.label && <Label htmlFor={id} className="text-xs">{props.label}</Label>}
    {props.variant === 'longText'
      ? <Textarea {...shared} onChange={event => props.setValue?.(event.target.value)} />
      : <Input {...shared} type={props.variant === 'number' ? 'number' : props.variant === 'obscured' ? 'password' : 'text'} onChange={event => props.setValue?.(event.target.value)} />}
    <div ref={validationErrorsRef} className="text-xs text-destructive empty:hidden" />
  </div>;
}

function HyperBotA2uiCheckbox({ props, accessibilityRef, validationErrorsRef }: View<Field<boolean>>) {
  const id = useId();
  return <div className="grid gap-1">
    <div className="flex items-center gap-2">
      <Checkbox ref={accessibilityRef} id={id} checked={props.value ?? false} readOnly={!props.setValue} onCheckedChange={value => props.setValue?.(value)} />
      {props.label && <Label htmlFor={id}>{props.label}</Label>}
    </div>
    <div ref={validationErrorsRef} className="text-xs text-destructive empty:hidden" />
  </div>;
}

function HyperBotA2uiTabs({ props, buildChild }: View<{ tabs: { title?: string; child: Child }[] }>) {
  return <Tabs defaultValue="0" className="min-w-0">
    <TabsList className="max-w-full justify-start overflow-x-auto">
      {props.tabs.map((tab, index) => <TabsTrigger key={index} value={String(index)}>{tab.title}</TabsTrigger>)}
    </TabsList>
    {props.tabs.map((tab, index) => <TabsContent key={index} value={String(index)}>{renderChild(buildChild, tab.child)}</TabsContent>)}
  </Tabs>;
}

function HyperBotA2uiSlider({ props, accessibilityRef, validationErrorsRef }: View<Field<number> & { min?: number; max: number; steps?: number }>) {
  const min = props.min ?? 0;
  const max = Math.max(min, props.max);
  return <div className="grid min-w-0 gap-2">
    {props.label && <span className="text-xs font-medium">{props.label}</span>}
    <Slider ref={accessibilityRef} value={[props.value ?? min]} min={min} max={max} disabled={!props.setValue || min === max}
      step={props.steps && max > min ? (max - min) / props.steps : 1} aria-label={props.label}
      onValueChange={value => props.setValue?.(Array.isArray(value) ? value[0]! : value)} />
    <div ref={validationErrorsRef} className="text-xs text-destructive empty:hidden" />
  </div>;
}

function HyperBotA2uiDateTime({ props, accessibilityRef, validationErrorsRef }: View<Field<string> & { enableDate?: boolean; enableTime?: boolean; min?: string; max?: string }>) {
  const id = useId();
  const time = props.enableTime ?? false;
  const date = props.enableDate ?? !time;
  if (!date && !time) return null;
  const type = date && time ? 'datetime-local' : date ? 'date' : 'time';
  const format = (value?: string) => {
    const day = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    const clock = value?.match(/(?:^|T)(\d{2}:\d{2})/)?.[1];
    return date && time ? (day && clock ? `${day}T${clock}` : '') : (date ? day : clock) ?? '';
  };
  return <div className="grid min-w-0 gap-2">
    {props.label && <Label htmlFor={id} className="text-xs">{props.label}</Label>}
    <Input ref={accessibilityRef} id={id} type={type} value={format(props.value)} min={format(props.min)} max={format(props.max)}
      aria-label={props.label || (date && time ? 'Date and time' : date ? 'Date' : 'Time')} readOnly={!props.setValue}
      onChange={event => { const value = event.target.value; props.setValue?.(value && date && time ? `${value}:00` : value); }} />
    <div ref={validationErrorsRef} className="text-xs text-destructive empty:hidden" />
  </div>;
}

function HyperBotA2uiChoices({ props, accessibilityRef, validationErrorsRef }: View<Field<string[]> & { options: { label?: string; value: string }[]; variant?: 'mutuallyExclusive' | 'multipleSelection'; displayStyle?: 'checkbox' | 'chips'; filterable?: boolean }>) {
  const [filter, setFilter] = useState('');
  const id = useId();
  const selected = props.value ?? [];
  const multiple = props.variant === 'multipleSelection';
  const choices = props.options.filter(option => !props.filterable || (option.label ?? option.value).toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const pick = (value: string) => props.setValue?.(multiple ? (selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]) : [value]);
  return <fieldset ref={accessibilityRef} className="grid min-w-0 gap-2" disabled={!props.setValue}>
    {props.label && <legend className="mb-2 text-xs font-medium">{props.label}</legend>}
    {props.filterable && <Input type="search" aria-label={props.label ? `Filter ${props.label}` : 'Filter options'} value={filter} onChange={event => setFilter(event.target.value)} />}
    {props.displayStyle === 'chips' ? <div className="flex flex-wrap gap-2">
      {choices.map(option => <Button key={option.value} type="button" size="sm" variant={selected.includes(option.value) ? 'secondary' : 'outline'}
        aria-pressed={selected.includes(option.value)} className="rounded-full" onClick={() => pick(option.value)}>{option.label ?? option.value}</Button>)}
    </div> : multiple ? <div className="grid gap-2">
      {choices.map((option, index) => <div key={option.value} className="flex items-center gap-2">
        <Checkbox id={`${id}-${index}`} checked={selected.includes(option.value)} onCheckedChange={() => pick(option.value)} />
        <Label htmlFor={`${id}-${index}`}>{option.label ?? option.value}</Label>
      </div>)}
    </div> : <RadioGroup value={selected[0] ?? ''} onValueChange={value => pick(String(value))} aria-label={props.label}>
      {choices.map((option, index) => <div key={option.value} className="flex items-center gap-2">
        <RadioGroupItem id={`${id}-${index}`} value={option.value} />
        <Label htmlFor={`${id}-${index}`}>{option.label ?? option.value}</Label>
      </div>)}
    </RadioGroup>}
    <div ref={validationErrorsRef} className="text-xs text-destructive empty:hidden" />
  </fieldset>;
}

function hyperBotA2uiComponent<T>(name: string, View: ComponentType<View<T>>): ReactCatalogComponent {
  const api = hyperBotA2uiCatalog.components.get(name);
  if (!api) throw new Error(`Unknown Hyper-Bot A2UI component: ${name}`);
  return createComponentImplementation(api, args => <View {...args as View<T>} />);
}

export const hyperBotA2uiReactCatalog = hyperBotA2uiCatalog.copyWith<ReactCatalogComponent, FunctionImplementation>({
  components: [
    hyperBotA2uiComponent('Text', HyperBotA2uiText),
    hyperBotA2uiComponent('Card', HyperBotA2uiCard),
    hyperBotA2uiComponent('Column', HyperBotA2uiLayout),
    hyperBotA2uiComponent<Layout>('Row', args => <HyperBotA2uiLayout {...args} horizontal />),
    hyperBotA2uiComponent('List', HyperBotA2uiList),
    hyperBotA2uiComponent('Divider', () => <Separator />),
    hyperBotA2uiComponent('Tabs', HyperBotA2uiTabs),
    hyperBotA2uiComponent('Button', HyperBotA2uiButton),
    hyperBotA2uiComponent('TextField', HyperBotA2uiTextField),
    hyperBotA2uiComponent('CheckBox', HyperBotA2uiCheckbox),
    hyperBotA2uiComponent('ChoicePicker', HyperBotA2uiChoices),
    hyperBotA2uiComponent('Slider', HyperBotA2uiSlider),
    hyperBotA2uiComponent('DateTimeInput', HyperBotA2uiDateTime),
  ],
});
