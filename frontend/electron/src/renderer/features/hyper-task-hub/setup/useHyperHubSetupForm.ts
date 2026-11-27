// Shared state for the Task Hub setup form (spec D9.9, M5 E5): the first-run sheet and Settings → Task Hub
// edit the same scope through this hook, so a field added in one place cannot be lost in the other.
import { useEffect, useMemo, useState } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import type { HyperHubSetupOptions, HyperHubSetupScope } from '@shared/HyperTaskHub';
import { hyperTaskViewKind } from '@shared/HyperTaskView';
import { DatabaseEventGetDatabase } from '@/backend/events';
import { hyperIsGeneralCalendar } from '@/features/hyper-outlook/HyperGeneralCalendar';
import { ViewBackendService } from '@/features/view/view-service';

export const hyperHubJiraConnection = 'jira';
export const hyperHubNewsletterConnection = 'newsletter';
export const hyperHubWeeks = { 'sun-thu': [0, 1, 2, 3, 4], 'mon-fri': [1, 2, 3, 4, 5] } as const;
export type HyperHubWeek = keyof typeof hyperHubWeeks;
export const hyperHubNotMe = '__none__';

export function hyperHubSplitList(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map(part => part.trim()).filter(Boolean))];
}

function hyperHubDefaultWeek(): HyperHubWeek {
  const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
  const firstDay = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay;
  return firstDay === 7 ? 'sun-thu' : 'mon-fri';
}

type Setter<T> = (value: T | ((previous: T) => T)) => void;
type HyperHubScopeWithWriteBack = HyperHubSetupScope & { writeBack?: { jira: boolean; newsletter: boolean } };

export interface HyperHubSetupForm {
  views: ViewPB[] | null;
  taskViews: ViewPB[] | null;
  calendarViews: ViewPB[] | null;
  options: HyperHubSetupOptions | null;
  selectedViews: ReadonlySet<string>; setSelectedViews: Setter<ReadonlySet<string>>;
  selectedCalendars: ReadonlySet<string>; setSelectedCalendars: Setter<ReadonlySet<string>>;
  outlookCalendar: boolean; setOutlookCalendar: (value: boolean) => void;
  newsletter: Record<string, string>; setNewsletter: Setter<Record<string, string>>;
  mailEnabled: boolean; setMailEnabled: (value: boolean) => void;
  mailFolders: ReadonlySet<'inbox' | 'sent'>; setMailFolders: Setter<ReadonlySet<'inbox' | 'sent'>>;
  retentionDays: number; setRetentionDays: (value: number) => void;
  importFlags: boolean; setImportFlags: (value: boolean) => void;
  aiSummaries: boolean; setAiSummaries: (value: boolean) => void;
  writeBackJira: boolean; setWriteBackJira: (value: boolean) => void;
  writeBackNewsletter: boolean; setWriteBackNewsletter: (value: boolean) => void;
  jiraProjects: string; setJiraProjects: (value: string) => void;
  aliases: string; setAliases: (value: string) => void;
  week: HyperHubWeek | 'custom'; setWeek: (value: HyperHubWeek | 'custom') => void;
  start: string; setStart: (value: string) => void;
  end: string; setEnd: (value: string) => void;
  zone: string; setZone: (value: string) => void;
  hoursValid: boolean; zoneValid: boolean; keysValid: boolean; anySource: boolean; canSave: boolean;
  /** True once the form differs from the scope it was loaded from. */
  dirty: boolean;
  toggle: (set: Setter<ReadonlySet<string>>) => (id: string, on: boolean) => void;
  /** Resolves the selected views to databases and returns the scope to save. */
  build: () => Promise<HyperHubSetupScope>;
}

/** Loads the form from `initial` each time `active` turns true (the sheet opens, the settings page mounts). */
export function useHyperHubSetupForm({ active, initial, defaultJiraProject, loadOptions }: {
  active: boolean; initial: HyperHubSetupScope | null; defaultJiraProject?: string; loadOptions?: () => Promise<HyperHubSetupOptions>;
}): HyperHubSetupForm {
  const [views, setViews] = useState<ViewPB[] | null>(null);
  const [options, setOptions] = useState<HyperHubSetupOptions | null>(null);
  const [selectedViews, setSelectedViews] = useState<ReadonlySet<string>>(new Set());
  const [selectedCalendars, setSelectedCalendars] = useState<ReadonlySet<string>>(new Set());
  const [outlookCalendar, setOutlookCalendar] = useState(false);
  const [newsletter, setNewsletter] = useState<Record<string, string>>({});
  const [mailEnabled, setMailEnabled] = useState(false);
  const [mailFolders, setMailFolders] = useState<ReadonlySet<'inbox' | 'sent'>>(new Set(['inbox', 'sent']));
  const [retentionDays, setRetentionDays] = useState(30);
  const [importFlags, setImportFlags] = useState(false);
  const [aiSummaries, setAiSummaries] = useState(false);
  const [writeBackJira, setWriteBackJira] = useState(false);
  const [writeBackNewsletter, setWriteBackNewsletter] = useState(false);
  const [jiraProjects, setJiraProjects] = useState('');
  const [aliases, setAliases] = useState('');
  const [week, setWeek] = useState<HyperHubWeek | 'custom'>('sun-thu');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!active) return;
    const saved = initial as HyperHubScopeWithWriteBack | null;
    setJiraProjects(saved ? saved.jiraProjects.map(project => project.projectId).join(', ') : defaultJiraProject ?? '');
    setAliases(saved?.aliases.join(', ') ?? '');
    const days = saved?.workdays.join();
    setWeek(!saved ? hyperHubDefaultWeek() : days === hyperHubWeeks['sun-thu'].join() ? 'sun-thu' : days === hyperHubWeeks['mon-fri'].join() ? 'mon-fri' : 'custom');
    setStart(saved?.hours.start ?? '09:00');
    setEnd(saved?.hours.end ?? '18:00');
    setZone(saved?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setSelectedViews(new Set(saved?.nativeViews.map(view => view.viewId) ?? []));
    setSelectedCalendars(new Set(saved?.nativeCalendars?.map(view => view.viewId) ?? []));
    setOutlookCalendar(saved?.outlookCalendar ?? false);
    setNewsletter(Object.fromEntries((saved?.newsletterProjects ?? []).map(project => [project.projectId, project.resourceId])));
    setMailEnabled(!!saved?.mail?.enabled);
    setMailFolders(new Set(saved?.mail?.folders ?? ['inbox', 'sent']));
    setRetentionDays(saved?.mail?.retentionDays ?? 30);
    setImportFlags(!!saved?.mail?.importFlags);
    setAiSummaries(!!saved?.ai?.summaries);
    setWriteBackJira(!!saved?.writeBack?.jira);
    setWriteBackNewsletter(!!saved?.writeBack?.newsletter);
    setViews(null); setOptions(null); setDirty(false);
    let cancelled = false;
    void ViewBackendService.getAllViews().then(result => {
      if (cancelled) return;
      const items = result.ok ? result.value.items : [];
      setViews(items);
      // First run: preselect the workspace Hyper-Kanban and Hyper-Event.
      if (!saved) {
        setSelectedViews(new Set(items.filter(view => hyperTaskViewKind(view) === 'general').map(view => view.id)));
        setSelectedCalendars(new Set(items.filter(view => view.layout === ViewLayoutPB.Calendar && hyperIsGeneralCalendar(view)).map(view => view.id)));
      }
    }, () => { if (!cancelled) setViews([]); });
    void loadOptions?.().then(value => {
      if (cancelled) return;
      setOptions(value);
      if (!saved && value.outlook.available) setOutlookCalendar(true);
    }, () => {});
    return () => { cancelled = true; };
  }, [active, initial, defaultJiraProject, loadOptions]);

  // Any edit after loading marks the form dirty; the wrappers below keep the setters' identity simple.
  const mark = <T,>(set: (value: T) => void) => (value: T) => { setDirty(true); set(value); };
  const markSet = <T,>(set: Setter<T>): Setter<T> => value => { setDirty(true); set(value); };

  const taskViews = useMemo(() => views?.filter(view => hyperTaskViewKind(view)) ?? null, [views]);
  const calendarViews = useMemo(() => views?.filter(view => view.layout === ViewLayoutPB.Calendar) ?? null, [views]);
  const hoursValid = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
  const zoneValid = useMemo(() => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } }, [zone]);
  const projectKeys = hyperHubSplitList(jiraProjects).map(key => key.toUpperCase());
  const keysValid = projectKeys.every(key => /^[A-Z][A-Z0-9_]{0,49}$/.test(key));
  const newsletterChoices = Object.entries(newsletter).filter(([, resourceId]) => resourceId && resourceId !== hyperHubNotMe);
  const anySource = projectKeys.length > 0 || selectedViews.size > 0 || newsletterChoices.length > 0 || (mailEnabled && mailFolders.size > 0);
  const canSave = keysValid && hoursValid && zoneValid && anySource;
  const toggle = (set: Setter<ReadonlySet<string>>) => (id: string, on: boolean) =>
    set(previous => { const next = new Set(previous); if (on) next.add(id); else next.delete(id); return next; });

  const resolve = (ids: ReadonlySet<string>) => Promise.all([...ids].map(async viewId => {
    const result = await DatabaseEventGetDatabase({ value: viewId });
    if (!result.ok) throw new Error('A selected board or calendar is no longer available.');
    return { databaseId: result.value.id, viewId };
  }));

  const build = async (): Promise<HyperHubSetupScope> => {
    const saved = initial as HyperHubScopeWithWriteBack | null;
    const [nativeViews, nativeCalendars] = await Promise.all([resolve(selectedViews), resolve(selectedCalendars)]);
    const now = { kind: 'instant' as const, iso: new Date().toISOString() };
    const scope: HyperHubScopeWithWriteBack = {
      // Keep fields this form does not edit (manual meeting links, linked articles and pages).
      ...(saved ?? {}),
      jiraProjects: projectKeys.map(projectId => ({ connectionId: hyperHubJiraConnection, projectId })),
      nativeViews,
      nativeCalendars,
      outlookCalendar: outlookCalendar && !!options?.outlook.available,
      newsletterProjects: newsletterChoices.map(([projectId, resourceId]) => ({ connectionId: hyperHubNewsletterConnection, projectId, resourceId })),
      // Consent (spec D4.5): no scan runs until the owner turns this on and confirms the scope and retention.
      mail: mailEnabled && mailFolders.size && options?.mailbox?.available
        ? { enabled: true, folders: [...mailFolders], retentionDays, confirmedAt: now, importFlags: importFlags && options.mailbox.flagsVerified }
        : null,
      // Consent (spec D8.6): summaries also need a configured AI endpoint and a per-brief excerpt selection.
      ai: aiSummaries ? { summaries: true, confirmedAt: saved?.ai?.summaries ? saved.ai.confirmedAt ?? now : now } : null,
      // M5 E1.2: off by default; main binds consent to the configured connection.
      writeBack: { jira: writeBackJira, newsletter: writeBackNewsletter },
      aliases: hyperHubSplitList(aliases),
      zone,
      workdays: week === 'custom' ? [...(saved?.workdays ?? hyperHubWeeks['sun-thu'])] : [...hyperHubWeeks[week]],
      hours: { start, end },
      breaks: saved?.breaks ?? [],
      daysOff: saved?.daysOff ?? [],
    };
    return scope;
  };

  return {
    views, taskViews, calendarViews, options,
    selectedViews, setSelectedViews: markSet(setSelectedViews),
    selectedCalendars, setSelectedCalendars: markSet(setSelectedCalendars),
    outlookCalendar, setOutlookCalendar: mark(setOutlookCalendar),
    newsletter, setNewsletter: markSet(setNewsletter),
    mailEnabled, setMailEnabled: mark(setMailEnabled),
    mailFolders, setMailFolders: markSet(setMailFolders),
    retentionDays, setRetentionDays: mark(setRetentionDays),
    importFlags, setImportFlags: mark(setImportFlags),
    aiSummaries, setAiSummaries: mark(setAiSummaries),
    writeBackJira, setWriteBackJira: mark(setWriteBackJira),
    writeBackNewsletter, setWriteBackNewsletter: mark(setWriteBackNewsletter),
    jiraProjects, setJiraProjects: mark(setJiraProjects),
    aliases, setAliases: mark(setAliases),
    week, setWeek: mark(setWeek),
    start, setStart: mark(setStart),
    end, setEnd: mark(setEnd),
    zone, setZone: mark(setZone),
    hoursValid, zoneValid, keysValid, anySource, canSave, dirty, toggle, build,
  };
}
