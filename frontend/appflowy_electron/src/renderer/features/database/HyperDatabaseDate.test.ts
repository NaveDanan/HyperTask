import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { WireType } from '@bufbuild/protobuf/wire';
import { DateCellChangesetPBSchema, DateCellDataPBSchema, DateFormatPB, DateTypeOptionPBSchema, TimeFormatPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { hyperDatabaseDateCandidates, hyperDatabaseDateChangeset, hyperDatabaseDateCloneOptions, hyperDatabaseDateDisplay, hyperDatabaseDateEditable, hyperDatabaseDateInitial, hyperDatabaseDateMutation, hyperDatabaseDateOffset, hyperDatabaseDateParts, hyperDatabaseDateZone } from './HyperDatabaseDate';

const options = (timezoneId = 'UTC') => create(DateTypeOptionPBSchema, { timezoneId, dateFormat: DateFormatPB.ISO, timeFormat: TimeFormatPB.TwentyFourHour });
const data = (timestamp = 1794353405n) => create(DateCellDataPBSchema, { oneOfTimestamp: { case: 'timestamp', value: timestamp }, includeTime: true });
describe('database date wall clocks and typed changesets', () => {
  it('converts instants in the field timezone and preserves second precision', () => {
    expect(hyperDatabaseDateParts(0n, 'UTC')).toEqual({ day: '1970-01-01', time: '00:00:00' });
    expect(hyperDatabaseDateParts(0n, 'Asia/Kathmandu')).toEqual({ day: '1970-01-01', time: '05:30:00' });
    const instant = hyperDatabaseDateCandidates('2026-11-11', '13:30:05', 'Asia/Kathmandu')[0];
    expect(hyperDatabaseDateParts(instant, 'Asia/Kathmandu')).toEqual({ day: '2026-11-11', time: '13:30:05' });
    expect(hyperDatabaseDateOffset(instant, 'Asia/Kathmandu')).toBe('UTC+05:45');
  });
  it('rejects impossible dates, invalid times, invalid zones and out-of-range instants', () => {
    for (const day of ['2026-02-30', '0000-01-01', '2026-1-01', 'invalid']) expect(() => hyperDatabaseDateCandidates(day, '00:00', 'UTC')).toThrow('invalidDate');
    for (const time of ['24:00', '12:60', '12:00:60', '1:00', 'invalid']) expect(() => hyperDatabaseDateCandidates('2026-11-11', time, 'UTC')).toThrow('invalidTime');
    expect(() => hyperDatabaseDateZone('Invented/Timezone')).toThrow('invalidZone');
    expect(() => hyperDatabaseDateZone('+05:30')).toThrow('invalidZone');
    expect(() => hyperDatabaseDateParts(9223372036854775807n, 'UTC')).toThrow('invalidDate');
    expect(hyperDatabaseDateParts(hyperDatabaseDateCandidates('0099-01-01', '00:00', 'UTC')[0], 'UTC').day).toBe('0099-01-01');
  });
  it('detects daylight-saving gaps and folds without normalizing wall times', () => {
    expect(hyperDatabaseDateCandidates('2026-03-08', '02:30', 'America/New_York')).toEqual([]);
    const repeated = hyperDatabaseDateCandidates('2026-11-01', '01:30', 'America/New_York');
    expect(repeated).toHaveLength(2); expect(repeated[1] - repeated[0]).toBe(3600n);
    expect(repeated.map(timestamp => hyperDatabaseDateOffset(timestamp, 'America/New_York'))).toEqual(['UTC-04:00', 'UTC-05:00']);
    expect(hyperDatabaseDateCandidates('2026-10-04', '02:15', 'Australia/Lord_Howe')).toEqual([]);
    const halfHour = hyperDatabaseDateCandidates('2026-04-05', '01:45', 'Australia/Lord_Howe');
    expect(halfHour).toHaveLength(2); expect(halfHour[1] - halfHour[0]).toBe(1800n);
    expect(hyperDatabaseDateCandidates('2011-12-30', '12:00', 'Pacific/Apia')).toEqual([]);
  });
  it('requires an explicit choice for a newly entered repeated clock time', () => {
    const source = data(), zone = options('America/New_York'), form = { ...hyperDatabaseDateInitial(source, zone), start: '2026-11-01', startTime: '01:30:00', startChoice: '' };
    expect(() => hyperDatabaseDateMutation(source, zone, form)).toThrow('fold');
    const candidates = hyperDatabaseDateCandidates(form.start, form.startTime, zone.timezoneId);
    expect(hyperDatabaseDateMutation(source, zone, { ...form, startChoice: String(candidates[1]) }).timestamp).toBe(candidates[1]);
    expect(() => hyperDatabaseDateMutation(source, zone, { ...form, start: '2026-03-08', startTime: '02:30:00' })).toThrow('gap');
  });
  it('preserves an existing fold choice, hidden time, seconds and paired range endpoints', () => {
    const zone = options('America/New_York'), repeated = hyperDatabaseDateCandidates('2026-11-01', '01:30:05', zone.timezoneId), source = data(repeated[1]);
    const initial = hyperDatabaseDateInitial(source, zone);
    expect(hyperDatabaseDateMutation(source, zone, initial).timestamp).toBe(repeated[1]);
    expect(hyperDatabaseDateMutation(source, zone, { ...initial, includeTime: '0' }).timestamp).toBe(repeated[1]);
    const range = hyperDatabaseDateMutation(source, zone, { ...initial, isRange: '1', end: '2026-11-02', endTime: '03:45:12' });
    expect(range.isRange).toBe(true); expect(hyperDatabaseDateParts(range.endTimestamp!, zone.timezoneId).time).toBe('03:45:12');
    expect(() => hyperDatabaseDateMutation(source, zone, { ...initial, isRange: '1', end: '2026-10-30' })).toThrow('endBeforeStart');
  });
  it('formats all native date formats, 12/24-hour times, ranges and the epoch', () => {
    const source = data(hyperDatabaseDateCandidates('2026-11-11', '13:30:05', 'UTC')[0]);
    const expected = ['11/11/2026', '2026/11/11', '2026-11-11', 'Nov 11, 2026', '11/11/2026', 'November 11, 2026'];
    for (const [format, prefix] of expected.entries()) expect(hyperDatabaseDateDisplay(source, { ...options(), dateFormat: format }, 'en-US')).toBe(prefix + ' 13:30:05');
    expect(hyperDatabaseDateDisplay(source, { ...options(), timeFormat: TimeFormatPB.TwelveHour }, 'en-US')).toBe('2026-11-11 01:30:05 PM');
    expect(hyperDatabaseDateDisplay({ ...source, isRange: true, oneOfEndTimestamp: { case: 'endTimestamp', value: source.oneOfTimestamp.value! + 3600n } }, options(), 'en-US')).toContain('→ 2026-11-11 14:30:05');
    expect(hyperDatabaseDateDisplay(data(0n), options(), 'en-US')).toBe('1970-01-01 00:00');
  });
  it('preserves reminders, unknown protobuf data and future enum values by preventing destructive writes', () => {
    const source = data(), zone = options(), unknown = [{ no: 99, wireType: WireType.Varint, data: new Uint8Array([1]) }];
    for (const value of [{ ...source, reminderId: 'existing-reminder' }, { ...source, $unknown: unknown }]) expect(hyperDatabaseDateEditable(value, zone)).toBe(false);
    for (const value of [{ ...zone, $unknown: unknown }, { ...zone, dateFormat: 99 }, { ...zone, timeFormat: 99 }]) {
      expect(hyperDatabaseDateEditable(source, value)).toBe(false); expect(() => hyperDatabaseDateCloneOptions(value, { dateFormat: DateFormatPB.ISO })).toThrow('unsupported');
    }
    expect(() => hyperDatabaseDateMutation({ ...source, reminderId: 'existing-reminder' }, zone, hyperDatabaseDateInitial(source, zone))).toThrow('reminder');
    const changed = hyperDatabaseDateCloneOptions(zone, { timeFormat: TimeFormatPB.TwelveHour }); expect(changed.timezoneId).toBe('UTC'); expect(zone.timeFormat).toBe(TimeFormatPB.TwentyFourHour);
  });
  it('encodes optional native oneofs without clearing metadata or confusing epoch zero with missing', () => {
    const patch = create(DateCellChangesetPBSchema, hyperDatabaseDateChangeset({ timestamp: 0n, endTimestamp: 3600n, isRange: true, includeTime: true }));
    const roundTrip = fromBinary(DateCellChangesetPBSchema, toBinary(DateCellChangesetPBSchema, patch));
    expect(roundTrip.oneOfTimestamp).toEqual({ case: 'timestamp', value: 0n }); expect(roundTrip.oneOfEndTimestamp.value).toBe(3600n); expect(roundTrip.oneOfReminderId.case).toBeUndefined();
    expect(hyperDatabaseDateChangeset({ includeTime: false })).toEqual({ oneOfIncludeTime: { case: 'includeTime', value: false } });
    expect(hyperDatabaseDateChangeset({ clearFlag: true })).toEqual({ oneOfClearFlag: { case: 'clearFlag', value: true } });
  });
});
