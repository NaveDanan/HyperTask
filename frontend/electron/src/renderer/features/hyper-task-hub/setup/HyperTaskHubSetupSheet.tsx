// First-run setup (spec D9.9): three steps — sources and scopes, identity aliases, working week. Scope
// choices are collected before the first import. The form and its sections are shared with Settings → Task
// Hub (M5 E5). Persistence is Astra's (setSetupScope); this is the UI.
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import type { HyperHubSetupOptions, HyperHubSetupScope } from '@shared/HyperTaskHub';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { HyperHubAiConsentField, HyperHubAliasesField, HyperHubSourcesSection, HyperHubWeekFields } from './HyperHubSetupSections';
import { useHyperHubSetupForm } from './useHyperHubSetupForm';

const hyperHubSteps = ['Sources', 'You', 'Work week'] as const;

export interface HyperTaskHubSetupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved scope, if any. */
  initial: HyperHubSetupScope | null;
  /** The Jira project from Settings → Connections → Jira, offered as the default. */
  defaultJiraProject?: string;
  loadOptions?: () => Promise<HyperHubSetupOptions>;
  onSave: (scope: HyperHubSetupScope) => Promise<void>;
}

export function HyperTaskHubSetupSheet({ open, onOpenChange, initial, defaultJiraProject, loadOptions, onSave }: HyperTaskHubSetupSheetProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const form = useHyperHubSetupForm({ active: open, initial, defaultJiraProject, loadOptions });
  useEffect(() => { if (open) setStep(0); }, [open]);

  const save = async () => {
    if (!form.canSave || saving) return;
    setSaving(true);
    try {
      await onSave(await form.build());
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Task Hub setup.');
    } finally { setSaving(false); }
  };

  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" data-hyper-task-hub-setup className="max-w-full data-[side=right]:w-[440px] data-[side=right]:sm:max-w-[440px]">
      <SheetHeader>
        <SheetTitle>Set up Task Hub</SheetTitle>
        <SheetDescription>Task Hub reads these sources. It changes a source only when you turn that on and confirm each change.</SheetDescription>
        <ol className="mt-2 flex items-center gap-2 text-xs" aria-label="Setup steps">
          {hyperHubSteps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}
            className={cn('flex items-center gap-1.5 text-muted-foreground', index === step && 'font-medium text-foreground')}>
            <span className={cn('flex size-5 items-center justify-center rounded-full border text-2xs tabular-nums', index < step && 'border-transparent bg-primary text-primary-foreground', index === step && 'border-foreground')}>
              {index < step ? <Check className="size-3" /> : index + 1}
            </span>{label}
          </li>)}
        </ol>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4">
        {step === 0 && <HyperHubSourcesSection form={form} />}
        {step === 1 && <><HyperHubAliasesField form={form} /><HyperHubAiConsentField form={form} /></>}
        {step === 2 && <HyperHubWeekFields form={form} />}
      </div>
      <SheetFooter className="flex-row justify-between border-t">
        <Button variant="outline" disabled={step === 0 || saving} onClick={() => setStep(value => value - 1)}>Back</Button>
        {step < hyperHubSteps.length - 1
          ? <Button disabled={step === 0 && (!form.keysValid || !form.anySource)} onClick={() => setStep(value => value + 1)}>Next</Button>
          : <Button disabled={!form.canSave || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save and import'}</Button>}
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
