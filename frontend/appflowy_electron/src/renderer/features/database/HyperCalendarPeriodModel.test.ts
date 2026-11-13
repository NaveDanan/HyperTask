import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { CalendarLayoutPB as Layout, CalendarLayoutSettingPBSchema } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { hyperCalendarDays } from './HyperDatabaseCells';
import { hyperDatabaseDateCandidates } from './HyperDatabaseDate';
import { HyperDatabaseCalendarSpanIndex } from './HyperDatabaseCalendarSpans';
import { hyperCalendarPeriodFrame, hyperCalendarPeriodKind, hyperCalendarPeriodLabel, hyperCalendarPeriodMove, hyperCalendarPeriodSetting, hyperCalendarPeriodSettingsEditable, hyperCalendarPeriodToday } from './HyperCalendarPeriodModel';

describe('Hyper calendar period civil dates', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])('preserves the existing six-week month grid for week start %s', first => {
    const period = hyperCalendarPeriodFrame('2026-11-11', Layout.MonthLayout, first);
    expect(period.days).toEqual(hyperCalendarDays(2026, 10, first));
    expect(period).toMatchObject({ startDay:'2026-11-01',endDay:'2026-11-30',columns:7,currentMonth:11 });
  });
  it('makes exactly one or seven dates, aligned with the saved first day of week', () => {
    expect(hyperCalendarPeriodFrame('2026-11-11',Layout.DayLayout,1).days).toEqual(['2026-11-11']);
    expect(hyperCalendarPeriodFrame('2026-11-11',Layout.WeekLayout,1).days).toEqual(['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15']);
    expect(hyperCalendarPeriodFrame('2026-11-11',Layout.WeekLayout,0)).toMatchObject({ startDay:'2026-11-08',endDay:'2026-11-14',columns:7 });
    expect(hyperCalendarPeriodFrame('2026-01-01',Layout.WeekLayout,1)).toMatchObject({ startDay:'2025-12-29',endDay:'2026-01-04' });
  });
  it('uses the date property zone for Today independently of system timezone', () => {
    const instant=BigInt(Date.parse('2026-01-01T00:30:00Z')/1000);
    expect(hyperCalendarPeriodToday('America/Los_Angeles',instant)).toBe('2025-12-31');
    expect(hyperCalendarPeriodToday('Pacific/Kiritimati',instant)).toBe('2026-01-01');
    expect(()=>hyperCalendarPeriodToday('future invalid zone',instant)).toThrow();
  });
  it('moves civil days/weeks through DST transitions and month/year boundaries', () => {
    for(const anchor of ['2026-03-08','2026-11-01']) {
      const day=hyperCalendarPeriodFrame(anchor,Layout.DayLayout),week=hyperCalendarPeriodFrame(anchor,Layout.WeekLayout,1);
      const next=hyperCalendarPeriodMove(day,1); expect(new Set(hyperCalendarPeriodFrame(next,Layout.WeekLayout,1).days).size).toBe(7);
      expect(hyperCalendarPeriodMove(hyperCalendarPeriodFrame(next,Layout.DayLayout),-1)).toBe(anchor);
      expect(hyperCalendarPeriodMove(hyperCalendarPeriodFrame(hyperCalendarPeriodMove(week,1),Layout.WeekLayout,1),-1)).toBe(anchor);
    }
    expect(hyperCalendarPeriodMove(hyperCalendarPeriodFrame('2026-12-31',Layout.MonthLayout),1)).toBe('2027-01-01');
    expect(hyperCalendarPeriodMove(hyperCalendarPeriodFrame('2024-02-28',Layout.DayLayout),1)).toBe('2024-02-29');
    expect(hyperCalendarPeriodMove(hyperCalendarPeriodFrame('2024-02-29',Layout.DayLayout),1)).toBe('2024-03-01');
  });
  it('formats civil dates without a local timezone shift and handles cross-year weeks', () => {
    expect(hyperCalendarPeriodLabel(hyperCalendarPeriodFrame('2026-11-11',Layout.MonthLayout),'en-US')).toBe('November 2026');
    expect(hyperCalendarPeriodLabel(hyperCalendarPeriodFrame('2026-11-11',Layout.DayLayout),'en-US')).toContain('Wednesday');
    const week=hyperCalendarPeriodLabel(hyperCalendarPeriodFrame('2026-01-01',Layout.WeekLayout,1),'en-US');expect(week).toContain('2025');expect(week).toContain('2026');
  });
  it.each(['2026-02-30','0000-01-01','10000-01-01','2026-1-1','not a date'])('rejects invalid civil date %s', day=>expect(()=>hyperCalendarPeriodFrame(day,Layout.DayLayout)).toThrow());
  it('rejects future layout/week-start values without normalizing them and bounds the supported date edges', () => {
    expect(hyperCalendarPeriodKind(300)).toBeNull();
    for(const first of [-1,7,0.5,NaN])expect(()=>hyperCalendarPeriodFrame('2026-11-11',Layout.WeekLayout,first)).toThrow('unsupported');
    expect(()=>hyperCalendarPeriodFrame('2026-11-11',300)).toThrow('unsupported');
    expect(()=>hyperCalendarPeriodMove(hyperCalendarPeriodFrame('0001-01-01',Layout.DayLayout),-1)).toThrow('invalidDate');
    expect(()=>hyperCalendarPeriodMove(hyperCalendarPeriodFrame('9999-12-31',Layout.DayLayout),1)).toThrow('invalidDate');
    expect(hyperCalendarPeriodFrame('0099-02-28',Layout.DayLayout).days).toEqual(['0099-02-28']);
  });
  it('reuses bounded spans for day/week and preserves midnight exclusivity and date-only ranges', () => {
    const zone='America/New_York',instant=(day:string,time='00:00:00')=>hyperDatabaseDateCandidates(day,time,zone)[0];
    const events=[{id:'timed',start:instant('2026-10-31','23:30:00'),end:instant('2026-11-02'),includeTime:true},{id:'all-day',start:instant('2026-10-30'),end:instant('2026-11-02'),includeTime:false}];
    for(const layout of [Layout.DayLayout,Layout.WeekLayout]) {
      const frame=hyperCalendarPeriodFrame('2026-11-02',layout,1),index=new HyperDatabaseCalendarSpanIndex(events,event=>event,frame.days,zone);
      expect(index.days).toHaveLength(layout===Layout.DayLayout?1:7);expect(index.window('2026-11-02',0).items.map(event=>event.id)).toEqual(['all-day']);
    }
    const frame=hyperCalendarPeriodFrame('2026-11-01',Layout.WeekLayout,0),large=Array.from({length:10000},(_,id)=>({id,start:instant('1900-01-01'),end:instant('9999-12-31')})),index=new HyperDatabaseCalendarSpanIndex(large,event=>event,frame.days,zone);
    expect(index.counts).toHaveLength(7);expect(index.window('2026-11-01',0).items).toHaveLength(10);expect(index.window('2026-11-01',999999).page).toBe(999);
  });
});
describe('Hyper native calendar period values',()=>{
  it('changes only layoutTy while preserving explicit false and other saved settings',()=>{
    const setting=create(CalendarLayoutSettingPBSchema,{fieldId:'when',layoutTy:Layout.MonthLayout,firstDayOfWeek:1,showWeekends:false,showWeekNumbers:true}),before=toBinary(CalendarLayoutSettingPBSchema,setting);
    expect(hyperCalendarPeriodSetting(setting,Layout.MonthLayout)).toBe(setting);
    expect(hyperCalendarPeriodSetting(setting,Layout.WeekLayout)).toMatchObject({...setting,layoutTy:Layout.WeekLayout});
    expect(toBinary(CalendarLayoutSettingPBSchema,setting)).toEqual(before);
  });
  it('keeps future native fields, layouts and week starts read-only and byte-exact',()=>{
    const base=create(CalendarLayoutSettingPBSchema,{fieldId:'when'});
    for(const setting of [{...base,layoutTy:300},{...base,firstDayOfWeek:8},{...base,$unknown:[{no:99,wireType:0 as const,data:new Uint8Array([7])}]}]){
      const before=toBinary(CalendarLayoutSettingPBSchema,setting);expect(hyperCalendarPeriodSettingsEditable(setting)).toBe(false);expect(()=>hyperCalendarPeriodSetting(setting,Layout.DayLayout)).toThrow('unsupported');expect(toBinary(CalendarLayoutSettingPBSchema,setting)).toEqual(before);
    }
  });
});
