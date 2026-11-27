// The setup form's sections, shared by the first-run sheet and Settings → Task Hub (M5 E5). Each section
// renders fields over one HyperHubSetupForm; neither host keeps its own copy of the form state.
import { CalendarDays, ChartGantt, Mail, SquareCheckBig, SquareKanban } from 'lucide-react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { hyperTaskViewKind } from '@shared/HyperTaskView';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { hyperIsGeneralCalendar } from '@/features/hyper-outlook/HyperGeneralCalendar';
import { nameOrDefault } from '@/features/view/view-ext';
import { cn } from '@/lib/utils';
import { hyperHubNotMe, type HyperHubSetupForm, type HyperHubWeek } from './useHyperHubSetupForm';

function HyperSetupViewList({ views, selected, onToggle, empty, badge }: {
  views: ViewPB[] | null; selected: ReadonlySet<string>; onToggle: (id: string, on: boolean) => void; empty: string; badge: (view: ViewPB) => string | null;
}) {
  if (views === null) return <>{[0, 1].map(id => <Skeleton key={id} className="h-8 w-full" />)}</>;
  if (!views.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return <div className="flex max-h-48 flex-col divide-y overflow-y-auto rounded-lg border">
    {views.map(view => {
      const kind = hyperTaskViewKind(view);
      const label = badge(view);
      return <label key={view.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50">
        <Checkbox checked={selected.has(view.id)} onCheckedChange={value => onToggle(view.id, !!value)} />
        {view.layout === ViewLayoutPB.Calendar ? <CalendarDays className="size-4 shrink-0 text-muted-foreground" /> : kind === 'gantt' ? <ChartGantt className="size-4 shrink-0 text-muted-foreground" /> : <SquareKanban className="size-4 shrink-0 text-muted-foreground" />}
        <bdi className="min-w-0 truncate">{nameOrDefault(view)}</bdi>
        {label && <span className="ms-auto shrink-0 text-xs text-muted-foreground">{label}</span>}
      </label>;
    })}
  </div>;
}

/** Jira projects, HyperTask boards, calendars, Newsletter resources and the mail opt-in. */
export function HyperHubSourcesSection({ form }: { form: HyperHubSetupForm }) {
  const { options } = form;
  const newsletterProjects = options?.newsletter.configured && options.newsletter.gantt ? options.newsletter.projects : [];
  return <>
    <Field>
      <FieldLabel htmlFor="hyper-hub-jira"><SquareCheckBig className="size-4 text-muted-foreground" />Jira projects</FieldLabel>
      <Input id="hyper-hub-jira" className="font-mono text-xs" placeholder="ENG, OPS" value={form.jiraProjects} onChange={event => form.setJiraProjects(event.target.value)} aria-invalid={!form.keysValid} />
      <FieldDescription>Issues assigned to you or reported by you. Separate keys with commas. The Jira connection is set up in Settings → Connections → Jira.</FieldDescription>
    </Field>
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex items-center gap-2 text-sm font-medium"><SquareKanban className="size-4 text-muted-foreground" />HyperTask boards and Gantt charts</legend>
      <HyperSetupViewList views={form.taskViews} selected={form.selectedViews} onToggle={form.toggle(form.setSelectedViews)} empty="No boards or Gantt charts in this workspace yet." badge={view => hyperTaskViewKind(view) === 'general' ? 'Hyper-Kanban' : null} />
    </fieldset>
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4 text-muted-foreground" />Calendars for free time</legend>
      <label className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
        <Switch checked={form.outlookCalendar && !!options?.outlook.available} disabled={!options?.outlook.available} onCheckedChange={form.setOutlookCalendar} aria-label="Use my Outlook calendar" />
        <span className="min-w-0 flex-1">Outlook calendar<span className="block text-xs text-muted-foreground">{options === null ? 'Checking Outlook…' : options.outlook.available ? 'Private meetings count only as busy time.' : options.outlook.reason ?? 'Classic Outlook is not available.'}</span></span>
      </label>
      <HyperSetupViewList views={form.calendarViews} selected={form.selectedCalendars} onToggle={form.toggle(form.setSelectedCalendars)} empty="No HyperTask calendars in this workspace." badge={view => hyperIsGeneralCalendar(view) ? 'Hyper-Event' : null} />
      <p className="text-xs text-muted-foreground">Only timed events with a start and an end reserve time.</p>
    </fieldset>
    {newsletterProjects.length > 0 && <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex items-center gap-2 text-sm font-medium"><ChartGantt className="size-4 text-muted-foreground" />Newsletter Gantt</legend>
      <p className="text-xs text-muted-foreground">Pick the resource that is you in each project. Its tasks join Task Hub.</p>
      <div className="flex flex-col divide-y rounded-lg border">
        {newsletterProjects.map(project => <div key={project.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <bdi className="min-w-0 flex-1 truncate">{project.name}</bdi>
          <Select value={form.newsletter[project.id] ?? hyperHubNotMe} onValueChange={value => form.setNewsletter(previous => ({ ...previous, [project.id]: String(value) }))}>
            <SelectTrigger size="sm" className="w-40" aria-label={`Your resource in ${project.name}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={hyperHubNotMe}>Not included</SelectItem>
              {project.resources.map(resource => <SelectItem key={resource.id} value={resource.id}>{resource.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>)}
      </div>
    </fieldset>}
    <HyperHubMailFields form={form} />
  </>;
}

/** Mail opt-in (spec D4.5): off until the owner turns it on and confirms folders and retention. */
export function HyperHubMailFields({ form }: { form: HyperHubSetupForm }) {
  const { options } = form;
  return <fieldset className="flex flex-col gap-2">
    <legend className="mb-2 flex items-center gap-2 text-sm font-medium"><Mail className="size-4 text-muted-foreground" />Suggestions from mail</legend>
    <label className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
      <Switch checked={form.mailEnabled && !!options?.mailbox?.available} disabled={!options?.mailbox?.available} onCheckedChange={form.setMailEnabled} aria-label="Suggest tasks from my mail" />
      <span className="min-w-0 flex-1">Suggest tasks from my mail<span className="block text-xs text-muted-foreground">{options === null ? 'Checking Outlook…' : options.mailbox?.available ? 'Off until you turn it on. Every suggestion waits in Triage for you.' : 'Classic Outlook mail is not available.'}</span></span>
    </label>
    {form.mailEnabled && options?.mailbox?.available && <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs text-muted-foreground">Read</span>
        {(['inbox', 'sent'] as const).map(folder => <label key={folder} className="flex items-center gap-2">
          <Checkbox checked={form.mailFolders.has(folder)} onCheckedChange={value => form.setMailFolders(previous => { const next = new Set(previous); if (value) next.add(folder); else next.delete(folder); return next; })} />
          {folder === 'inbox' ? 'Inbox (requests to you)' : 'Sent (your promises)'}
        </label>)}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Keep excerpts for</span>
        <Select value={String(form.retentionDays)} onValueChange={value => form.setRetentionDays(Number(value))}>
          <SelectTrigger size="sm" className="w-28" aria-label="Keep mail excerpts for"><SelectValue /></SelectTrigger>
          <SelectContent>{[7, 14, 30].map(days => <SelectItem key={days} value={String(days)}>{days} days</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <label className={cn('flex items-center gap-2', !options.mailbox.flagsVerified && 'opacity-60')}>
        <Checkbox checked={form.importFlags && options.mailbox.flagsVerified} disabled={!options.mailbox.flagsVerified} onCheckedChange={value => form.setImportFlags(!!value)} />
        Import flagged messages as tasks{!options.mailbox.flagsVerified && <span className="text-xs text-muted-foreground"> · not available yet</span>}
      </label>
      <p className="text-xs text-muted-foreground">Task Hub reads the newest text of each message on this device and keeps short excerpts encrypted. Protected and confidential mail is skipped. Nothing is sent anywhere.</p>
    </div>}
  </fieldset>;
}

export function HyperHubAliasesField({ form }: { form: HyperHubSetupForm }) {
  return <Field>
    <FieldLabel htmlFor="hyper-hub-aliases">Names you go by</FieldLabel>
    <Input id="hyper-hub-aliases" dir="auto" placeholder="Yael Cohen, יעל כהן, Yael" value={form.aliases} onChange={event => form.setAliases(event.target.value)} />
    <FieldDescription>English and Hebrew spellings, separated by commas. Task Hub uses them to recognize work assigned to you.</FieldDescription>
  </Field>;
}

export function HyperHubAiConsentField({ form }: { form: HyperHubSetupForm }) {
  return <label className="flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm">
    <Switch className="mt-0.5" checked={form.aiSummaries} onCheckedChange={form.setAiSummaries} aria-label="Allow AI summaries of meeting briefs" />
    <span className="min-w-0 flex-1">Allow AI summaries of meeting briefs<span className="block text-xs text-muted-foreground">Off by default. Each time, you pick the excerpts to send to the AI endpoint in Settings → Connections → AI endpoint. Briefs work fully without it.</span></span>
  </label>;
}

export function HyperHubWeekFields({ form }: { form: HyperHubSetupForm }) {
  return <>
    <Field>
      <FieldLabel>Working week</FieldLabel>
      <ToggleGroup variant="outline" value={[form.week]} onValueChange={value => { if (value[0]) form.setWeek(value[0] as HyperHubWeek); }}>
        <ToggleGroupItem value="sun-thu">Sunday–Thursday</ToggleGroupItem>
        <ToggleGroupItem value="mon-fri">Monday–Friday</ToggleGroupItem>
      </ToggleGroup>
      {form.week === 'custom' && <FieldDescription>Your saved custom week is kept until you pick a preset.</FieldDescription>}
    </Field>
    <div className="grid max-w-sm grid-cols-2 gap-3">
      <Field><FieldLabel htmlFor="hyper-hub-start">Starts</FieldLabel><Input id="hyper-hub-start" type="time" value={form.start} onChange={event => form.setStart(event.target.value)} aria-invalid={!form.hoursValid} /></Field>
      <Field><FieldLabel htmlFor="hyper-hub-end">Ends</FieldLabel><Input id="hyper-hub-end" type="time" value={form.end} onChange={event => form.setEnd(event.target.value)} aria-invalid={!form.hoursValid} /></Field>
    </div>
    <Field>
      <FieldLabel htmlFor="hyper-hub-zone">Time zone</FieldLabel>
      <Input id="hyper-hub-zone" className="max-w-sm font-mono text-xs" value={form.zone} onChange={event => form.setZone(event.target.value.trim())} aria-invalid={!form.zoneValid} />
      <FieldDescription>{form.zoneValid ? 'Deadlines and your plan use this zone.' : 'Enter an IANA time zone, such as Asia/Jerusalem.'}</FieldDescription>
    </Field>
  </>;
}
