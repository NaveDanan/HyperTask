import { create, toBinary } from '@bufbuild/protobuf';
import { unwrap } from '@/backend/dispatch';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { SelectOptionPBSchema, SingleSelectTypeOptionPBSchema } from '@shared/protobuf/hyper-database2/select_option_entities_pb';
import { DateTypeOptionPBSchema, DateFormatPB, TimeFormatPB } from '@shared/protobuf/hyper-database2/date_entities_pb';
import { HyperDatabaseController, hyperCoreLayout } from './HyperDatabaseController';
import { hyperDatabaseBackend, type HyperDatabaseBackend } from './HyperDatabaseBackend';
import type { HyperLayout } from './HyperDatabaseTypes';

export interface HyperSampleDatabase {
  viewId: string; databaseId: string; layout: HyperLayout; rowIds: string[];
  fields: Record<'title' | 'status' | 'priority' | 'assignee' | 'dates' | 'checklist' | 'estimate', string>;
}
const titles = ['Define launch scope', 'Interview workspace users', 'Draft interaction flows', 'Build the database shell', 'Review keyboard navigation', 'Test date ranges', 'Prepare release notes', 'Run acceptance checks', 'Polish empty states', 'Publish the launch plan', 'Follow up on feedback', 'Measure adoption'];
/** Explicit development fixture. Creates four isolated databases; never runs at app startup. */
export async function seedHyperDatabaseSamples(parentViewId: string, backend: HyperDatabaseBackend = hyperDatabaseBackend, count = 12): Promise<HyperSampleDatabase[]> {
  const result: HyperSampleDatabase[] = [];
  for (const layout of ['grid', 'board', 'calendar', 'gantt'] as const) {
    const view = unwrap(await backend.views.createView({ parentViewId, name: `Launch plan · ${layout}`, layoutType: hyperCoreLayout(layout), hyperLayout: layout === 'gantt' ? 'gantt' : undefined }));
    const controller = new HyperDatabaseController(view.id, backend);
    try {
      await controller.open(); if (controller.state.status !== 'ready') throw new Error(controller.state.error ?? 'Database failed to open');
      if (controller.state.rowIds.length) await controller.deleteRows(controller.state.rowIds);
      for (const f of controller.state.fields.filter(f => !f.isPrimary)) await controller.deleteField(f.id);
      const title = controller.state.fields.find(f => f.isPrimary)!.id;
      await controller.renameField(title, 'Task');
      const optionData = (names: string[]) => toBinary(SingleSelectTypeOptionPBSchema, create(SingleSelectTypeOptionPBSchema, { options: names.map((name, index) => create(SelectOptionPBSchema, { id: `hyper-${globalThis.crypto.randomUUID()}`, name, color: [7, 4, 6, 0][index % 4] })) }));
      const status = await controller.createField('Status', FieldType.SingleSelect, { oneOfTypeOptionData: { case: 'typeOptionData', value: optionData(['To do', 'In progress', 'Done']) } });
      const priority = await controller.createField('Priority', FieldType.SingleSelect, { oneOfTypeOptionData: { case: 'typeOptionData', value: optionData(['High', 'Medium', 'Low']) } });
      const assignee = await controller.createField('Assignee', FieldType.MultiSelect, { oneOfTypeOptionData: { case: 'typeOptionData', value: optionData(['Nave', 'Maya', 'Alex']) } });
      const dates = await controller.createField('Schedule', FieldType.DateTime, { oneOfTypeOptionData: { case: 'typeOptionData', value: toBinary(DateTypeOptionPBSchema, create(DateTypeOptionPBSchema, { dateFormat: DateFormatPB.ISO, timeFormat: TimeFormatPB.TwentyFourHour, timezoneId: 'UTC' })) } });
      const checklist = await controller.createField('Checklist', FieldType.Checklist);
      const estimate = await controller.createField('Estimate (h)', FieldType.Number);
      await controller.setGroupByField(status.id);
      if (layout === 'calendar') await controller.updateCalendarSettings({ fieldId: dates.id, firstDayOfWeek: 1, showWeekends: true });
      const rowIds: string[] = [];
      const now = new Date(); const first = BigInt(Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2, 9) / 1000));
      for (let i = 0; i < count; i++) {
        const row = await controller.createRow({ data: { [title]: titles[i % titles.length], [estimate.id]: String(2 + i % 7) } }); rowIds.push(row.id);
        await controller.updateCell(row.id, status.id, { kind: 'singleSelect', insertOptionIds: [controller.state.fields.find(f => f.id === status.id)!.options[i % 3].id] });
        await controller.updateCell(row.id, priority.id, { kind: 'singleSelect', insertOptionIds: [controller.state.fields.find(f => f.id === priority.id)!.options[i % 3].id] });
        await controller.updateCell(row.id, assignee.id, { kind: 'multiSelect', insertOptionIds: [controller.state.fields.find(f => f.id === assignee.id)!.options[i % 3].id] });
        await controller.updateCell(row.id, dates.id, { kind: 'date', timestamp: first + BigInt(i * 86400), endTimestamp: first + BigInt((i + 2) * 86400), isRange: true, includeTime: i % 3 === 0 });
        await controller.updateCell(row.id, checklist.id, { kind: 'checklist', insert: [{ name: 'Prepare' }, { name: 'Review' }, { name: 'Approve' }] });
        const items = controller.state.cells[row.id]?.[checklist.id];
        if (items?.kind === 'checklist' && i % 3 !== 0) await controller.updateCell(row.id, checklist.id, { kind: 'checklist', completedIds: items.items.slice(0, i % 3).map(item => item.id) });
      }
      result.push({ viewId: view.id, databaseId: controller.state.databaseId, layout, rowIds, fields: { title, status: status.id, priority: priority.id, assignee: assignee.id, dates: dates.id, checklist: checklist.id, estimate: estimate.id } });
      // The Grid sample also demonstrates the linked-view tab bar without changing the other databases.
      if (layout === 'grid') { await controller.addView('board', 'Board'); const calendar = await controller.addView('calendar', 'Calendar'); const linked = new HyperDatabaseController(calendar.id, backend); try { await linked.open(); await linked.updateCalendarSettings({ fieldId: dates.id, firstDayOfWeek: 1, showWeekends: true }); } finally { linked.dispose(); } await controller.addView('gantt', 'Gantt'); }
    } finally { controller.dispose(); }
  }
  return result;
}
