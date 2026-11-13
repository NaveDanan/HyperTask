import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { CalendarLayoutPB as Layout, CalendarLayoutSettingPBSchema } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { DatabaseLayoutPB, DatabaseViewSettingPBSchema } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperUpdateCalendarPeriod, type HyperCalendarPeriodSettingsBackend } from './HyperCalendarPeriodSettings';

function fixture() {
  let current=true,allow=true;
  const source=create(CalendarLayoutSettingPBSchema,{fieldId:'when',layoutTy:Layout.MonthLayout,firstDayOfWeek:1,showWeekends:true,showWeekNumbers:false});
  let fresh=clone(CalendarLayoutSettingPBSchema,source),databaseId='database',layout=DatabaseLayoutPB.Calendar;
  const writes:typeof source[]=[],calls:string[]=[];
  const owner={workspaceId:'workspace',actorId:'actor',contextKey:'period-fixture',isCurrent:()=>current};
  const service:HyperCalendarPeriodSettingsBackend={
    database:async()=>{calls.push('database');return{id:databaseId,layoutType:layout};},
    settings:async()=>{calls.push('settings');return create(DatabaseViewSettingPBSchema,{layoutType:layout,layoutSetting:{layoutType:layout,oneOfCalendar:{case:'calendar',value:fresh}}});},
    writable:async()=>{calls.push('writable');if(!allow)throw Error('Read only');return{layout:ViewLayoutPB.Calendar};},
    write:async(_view,setting)=>{calls.push('write');writes.push(setting);fresh=setting;},
  };
  const run=(target:Layout=Layout.WeekLayout)=>hyperUpdateCalendarPeriod('view','database',source,target,owner,()=>allow,service);
  return{source,owner,service,run,writes,calls,fresh:()=>fresh,setFresh:(value:typeof source)=>{fresh=value;},expire:()=>{current=false;},lock:()=>{allow=false;},foreign:()=>{databaseId='other';},grid:()=>{layout=DatabaseLayoutPB.Grid;}};
}
describe('Hyper calendar saved period guards',()=>{
  it('merges the fresh settings without overwriting unrelated concurrent choices',async()=>{
    const f=fixture();f.setFresh({...f.fresh(),showWeekends:false,showWeekNumbers:true,firstDayOfWeek:6});await f.run();
    expect(f.writes).toHaveLength(1);expect(f.writes[0]).toMatchObject({fieldId:'when',layoutTy:Layout.WeekLayout,showWeekends:false,showWeekNumbers:true,firstDayOfWeek:6});expect(f.source.layoutTy).toBe(Layout.MonthLayout);
  });
  it('confirms an already applied desired period without replaying its native write',async()=>{const f=fixture();f.setFresh({...f.fresh(),layoutTy:Layout.WeekLayout});await f.run();expect(f.writes).toHaveLength(0);});
  it('rejects observed period, field binding, database and layout changes before dispatch',async()=>{
    for(const mutate of [(f:ReturnType<typeof fixture>)=>f.setFresh({...f.fresh(),layoutTy:Layout.DayLayout}),(f:ReturnType<typeof fixture>)=>f.setFresh({...f.fresh(),fieldId:'other'}),(f:ReturnType<typeof fixture>)=>f.foreign(),(f:ReturnType<typeof fixture>)=>f.grid()]){const f=fixture();mutate(f);await expect(f.run()).rejects.toMatchObject({reason:'changed'});expect(f.writes).toHaveLength(0);}
  });
  it('blocks a stale owner and a fresh permission loss around awaited reads',async()=>{
    const old=fixture();old.expire();await expect(old.run()).rejects.toMatchObject({reason:'unavailable'});expect(old.calls).toEqual([]);
    const pending=fixture(),read=pending.service.database;pending.service.database=async view=>{const result=await read(view);pending.expire();return result;};await expect(pending.run()).rejects.toMatchObject({reason:'unavailable'});expect(pending.writes).toHaveLength(0);
    const locked=fixture(),settings=locked.service.settings;locked.service.settings=async view=>{const result=await settings(view);locked.lock();return result;};await expect(locked.run()).rejects.toMatchObject({reason:'unavailable'});expect(locked.writes).toHaveLength(0);
  });
  it('reports a fresh native permission rejection without dispatching the period write',async()=>{const f=fixture();f.service.writable=async()=>{throw Error('Native view locked');};await expect(f.run()).rejects.toMatchObject({reason:'unavailable'});expect(f.writes).toHaveLength(0);});
  it('rejects future source and fresh payload fields without writes',async()=>{
    const f=fixture();f.setFresh({...f.fresh(),$unknown:[{no:99,wireType:0,data:new Uint8Array([1])}]});await expect(f.run()).rejects.toMatchObject({reason:'unsupported'});expect(f.writes).toHaveLength(0);
    const old=fixture();old.source.layoutTy=300 as Layout;await expect(old.run()).rejects.toMatchObject({reason:'unsupported'});expect(old.calls).toEqual([]);
  });
  it('marks an uncertain acknowledgement and never replays automatically',async()=>{
    const f=fixture();f.service.write=async(_view,setting)=>{f.writes.push(setting);throw Error('Lost acknowledgement');};await expect(f.run()).rejects.toMatchObject({reason:'uncertain'});await Promise.resolve();expect(f.writes).toHaveLength(1);
  });
  it('does not expose a late write acknowledgement after owner loss',async()=>{
    const f=fixture(),write=f.service.write;f.service.write=async(view,setting)=>{await write(view,setting);f.expire();};await expect(f.run()).rejects.toMatchObject({reason:'unavailable'});expect(f.writes).toHaveLength(1);
  });
});
