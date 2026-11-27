import { create, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { expect, it } from 'vitest';
import { DateCellDataPBSchema } from '@shared/protobuf/hyper-database2/date_entities_pb';
import { DatabasePBSchema } from '@shared/protobuf/hyper-database2/database_entities_pb';
import { RepeatedCalendarEventPBSchema } from '@shared/protobuf/hyper-database2/calendar_entities_pb';
import { RepeatedViewPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/hyper-folder/workspace_pb';
import { UserProfilePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import { hyperBotsReadIdentity } from '../HyperBotsHub';
import { scope } from './HyperTaskHub.test-support';
import { HyperHubCalendarSource, hyperHubNativeOccurrence } from './HyperHubCalendarSource';

it('reserves only an explicit timed range and keeps a dated row without an end as a milestone', () => {
  const start = { oneOfTimestamp: { case: 'timestamp' as const, value: 1_800_000_000n } };
  const end = { oneOfEndTimestamp: { case: 'endTimestamp' as const, value: 1_800_001_800n } };
  const occurrence = (includeTime: boolean, isRange: boolean, hasEnd: boolean) => hyperHubNativeOccurrence('r', 'Row',
    create(DateCellDataPBSchema, { ...start, ...(hasEnd && end), includeTime, isRange }))!;
  const timed = occurrence(true, true, true);
  expect(timed.availability).toBe('busy');
  expect(Date.parse(timed.interval.end.iso) - Date.parse(timed.interval.start.iso)).toBe(30 * 60_000);
  const allDay = occurrence(false, true, true);
  expect(allDay).toMatchObject({ availability: 'free', allDay: true, interval: timed.interval });
  for (const milestone of [occurrence(true, false, false), occurrence(true, true, false), occurrence(true, false, true)]) {
    expect(milestone.availability).toBe('free');
    expect(milestone.interval.start).toEqual(milestone.interval.end);
  }
});

it('treats a silent calendar omission as partial when the selected view contains rows', async () => {
  const reply = <D extends DescMessage>(schema: D, value: MessageInitShape<D>) => ({
    status: 0, payload: toBinary(schema, create(schema, value)),
  });
  const view = { id: 'calendar', layout: ViewLayoutPB.Calendar };
  const request = async (event: string) => {
    switch (event) {
      case 'GetUserProfile': return reply(UserProfilePBSchema, { id: 7n });
      case 'GetCurrentWorkspaceSetting': return reply(WorkspaceLatestPBSchema, { workspaceId: scope.workspaceId });
      case 'GetAllViews': return reply(RepeatedViewPBSchema, { items: [view] });
      case 'GetView': return reply(ViewPBSchema, view);
      case 'GetDatabase': return reply(DatabasePBSchema, { id: 'db', rows: [{ id: 'missing' }] });
      case 'GetAllCalendarEvents': return reply(RepeatedCalendarEventPBSchema, { items: [] });
      default: throw Error(event);
    }
  };
  const source = new HyperHubCalendarSource(request, 'db', view.id, 'Asia/Jerusalem');
  const user = await hyperBotsReadIdentity(request);
  const result = await source.read({ ...scope, accountId: user!.key }, new AbortController().signal);
  expect(result).toMatchObject({ completeness: 'partial', agenda: [] });
});
