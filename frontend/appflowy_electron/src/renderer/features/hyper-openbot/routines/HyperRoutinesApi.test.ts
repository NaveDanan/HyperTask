import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport',()=>({hyperOpenBotRequest:vi.fn()}));
import { hyperOpenBotRequest } from '../transport';
import { HyperCreatePlan, HyperRoutineWrite, SavedButRefused } from './HyperRoutinesApi';
import { planRoutine } from './HyperRoutinePlan';
import { ROUTINE_FORM_DEFAULTS, routineFormSchema } from './HyperRoutineForm';
const request=vi.mocked(hyperOpenBotRequest);
const values={...ROUTINE_FORM_DEFAULTS,agentId:'bot',channelId:'new',instruction:'Review updates'};
beforeEach(()=>request.mockReset());
it('plans all creation branches and validates instruction limits',()=>{
 expect(planRoutine(values,'UTC').kind).toBe('routine');
 expect(planRoutine({...values,doneWhen:'All reviewed'},'UTC').kind).toBe('goal');
 expect(planRoutine({...values,does:'tell'},'UTC')).toMatchObject({kind:'check-in',checkIn:{subject:'Review updates'}});
 expect(routineFormSchema.safeParse({...values,does:'tell',instruction:'x'.repeat(1001)}).success).toBe(false);
});
it('creates and names one conversation before saving a routine',async()=>{
 request.mockResolvedValueOnce({channel:{id:'channel'}}).mockResolvedValue(undefined);
 await HyperCreatePlan(planRoutine(values,'UTC'));
 expect(request.mock.calls).toEqual([
 ['/api/channels','POST',{agentIds:['bot']}],
 ['/api/channels/channel/title','PUT',{title:'Review updates'}],
 ['/api/routines','POST',expect.objectContaining({channelId:'channel',cron:'0 9 * * 1-5'})],
 ]);
});
it('removes an empty conversation on explicit refusal',async()=>{
 request.mockResolvedValueOnce({channel:{id:'channel'}}).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('OpenBot request failed (403)')).mockResolvedValue(undefined);
 await expect(HyperCreatePlan(planRoutine(values,'UTC'))).rejects.toThrow('403');
 expect(request).toHaveBeenLastCalledWith('/api/channels/channel','DELETE',undefined);
});
it('locks uncertain creates and keeps their conversation',async()=>{
 request.mockResolvedValueOnce({channel:{id:'channel'}}).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disconnected'));
 await expect(HyperCreatePlan(planRoutine(values,'UTC'))).rejects.toBeInstanceOf(SavedButRefused);
 expect(request).toHaveBeenCalledTimes(3);
});
it('removes a goal when its schedule is explicitly refused',async()=>{
 request.mockResolvedValueOnce({responsibility:{id:'goal',title:'Goal'}}).mockRejectedValueOnce(new Error('OpenBot request failed (422)')).mockResolvedValue(undefined);
 await expect(HyperCreatePlan(planRoutine({...values,channelId:'existing',doneWhen:'Done'},'UTC'))).rejects.toThrow('422');
 expect(request).toHaveBeenLastCalledWith('/api/responsibilities/goal','DELETE',undefined);
});
it('encodes record identifiers in mutations',async()=>{
 await HyperRoutineWrite('tasks','a/b','resolve');
 expect(request).toHaveBeenCalledWith('/api/tasks/a%2Fb/resolve','POST',undefined);
});
it('creates check-ins with duplicate refusal enabled',async()=>{
 request.mockResolvedValue(undefined);
 await HyperCreatePlan(planRoutine({...values,channelId:'existing',does:'tell'},'UTC'));
 expect(request).toHaveBeenCalledWith('/api/proactive/settings?refuseExisting=true','POST',expect.objectContaining({channelId:'existing',subject:'Review updates',intervalMinutes:1440}));
});
it('keeps uncertain goal schedules without pausing or deleting',async()=>{
 request.mockResolvedValueOnce({responsibility:{id:'goal',title:'Goal'}}).mockRejectedValueOnce(new Error('OpenBot request failed (500)'));
 await expect(HyperCreatePlan(planRoutine({...values,channelId:'existing',doneWhen:'Done'},'UTC'))).rejects.toBeInstanceOf(SavedButRefused);
 expect(request).toHaveBeenCalledTimes(2);
});
it.each([true,false])('locks kept goals when rollback fails, pause succeeds=%s',async(paused)=>{
 request.mockResolvedValueOnce({responsibility:{id:'goal',title:'Goal'}}).mockRejectedValueOnce(new Error('OpenBot request failed (422)')).mockRejectedValueOnce(new Error('Delete failed'));
 if(paused)request.mockResolvedValueOnce(undefined);else request.mockRejectedValueOnce(new Error('Pause failed'));
 await expect(HyperCreatePlan(planRoutine({...values,channelId:'existing',doneWhen:'Done'},'UTC'))).rejects.toThrow(paused?'saved but paused':'saved on the Routines page');
 expect(request).toHaveBeenLastCalledWith('/api/responsibilities/goal/pause','POST',undefined);
});
it('keeps a saved goal and its new conversation when run-now fails',async()=>{
 request.mockResolvedValueOnce({channel:{id:'channel'}}).mockResolvedValueOnce(undefined).mockResolvedValueOnce({responsibility:{id:'goal',title:'Goal'}}).mockRejectedValueOnce(new Error('OpenBot request failed (409)'));
 await expect(HyperCreatePlan(planRoutine({...values,starts:'now'},'UTC'))).rejects.toThrow("saved on the Routines page, but it didn't start");
 expect(request.mock.calls.some(c=>c[1]==='DELETE')).toBe(false);
});
it('rolls back both the goal and newly created conversation on schedule refusal',async()=>{
 request.mockResolvedValueOnce({channel:{id:'channel'}}).mockResolvedValueOnce(undefined).mockResolvedValueOnce({responsibility:{id:'goal',title:'Goal'}}).mockRejectedValueOnce(new Error('OpenBot request failed (422)')).mockResolvedValue(undefined);
 await expect(HyperCreatePlan(planRoutine({...values,doneWhen:'Done'},'UTC'))).rejects.toThrow('422');
 expect(request.mock.calls.slice(-2)).toEqual([['/api/responsibilities/goal','DELETE',undefined],['/api/channels/channel','DELETE',undefined]]);
});
it('does not create a routine if conversation creation fails',async()=>{
 request.mockRejectedValueOnce(new Error('OpenBot request failed (403)'));
 await expect(HyperCreatePlan(planRoutine(values,'UTC'))).rejects.toThrow('403');
 expect(request).toHaveBeenCalledTimes(1);
});
it('tolerates conversation naming failure and cleanup failure',async()=>{
 request.mockResolvedValueOnce({channel:{id:'channel'}}).mockRejectedValueOnce(new Error('Rename failed')).mockRejectedValueOnce(new Error('OpenBot request failed (422)')).mockRejectedValueOnce(new Error('Delete failed'));
 await expect(HyperCreatePlan(planRoutine(values,'UTC'))).rejects.toThrow('422');
 expect(request).toHaveBeenCalledTimes(4);
});
