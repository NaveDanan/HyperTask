import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport',()=>({hyperOpenBotRequest:vi.fn()}));
import { hyperOpenBotRequest } from '../transport';
import { hyperDecideSharing, hyperSaveParticipation, hyperSafeMemoryLink, hyperSourceArguments, hyperSourceFields } from './HyperLearningActions';
import { translateCapabilityChanges } from './HyperCapabilityTranslate';
import { capabilityChangesPreviewQueryOptions } from './HyperCapabilityQueries';
import { saveCapabilityChangesMutationOptions } from './HyperCapabilityMutations';
const request=vi.mocked(hyperOpenBotRequest);
beforeEach(()=>{vi.clearAllMocks();request.mockResolvedValue({});});
it('participation saves omit approval settings and preserve null exclusions and exact revisions',async()=>{
 const settings={enabled:true,defaultTarget:{containerId:'team',revision:'exact'},agents:{a:null,b:{containerId:'other'}},personalReview:'people' as const,autoApprove:true};
 request.mockResolvedValue({settings:{...settings,enabled:false}});
 const saved=await hyperSaveParticipation(settings);
 expect(request).toHaveBeenCalledWith('/api/admin/learning/settings','PUT',{enabled:true,defaultTarget:settings.defaultTarget,agents:settings.agents});
 expect(saved.settings.enabled).toBe(false);
});
it('sharing refuses an unread skill, a different skill, or a removed request without a write',async()=>{
 const open={name:'Person',userId:'person',skillName:'skill',requestedAt:'old'};
 await expect(hyperDecideSharing(open,[open],undefined,'approve')).rejects.toThrow('Read');
 await expect(hyperDecideSharing(open,[open],'/api/admin/learning/people/other/skills/skill','approve')).rejects.toThrow('Read');
 await expect(hyperDecideSharing(open,[], '/api/admin/learning/people/person/skills/skill','decline')).rejects.toThrow('Read');
 expect(request).not.toHaveBeenCalled();
});
it('sharing uses the current server stamp rather than the stamp captured on opening',async()=>{
 const open={name:'Person',userId:'person one',skillName:'skill one',requestedAt:'old'};
 await hyperDecideSharing(open,[{...open,requestedAt:'current'}],'/api/admin/learning/people/person%20one/skills/skill%20one','approve');
 expect(request).toHaveBeenCalledWith('/api/admin/learning/sharing-requests/person%20one/skill%20one/approve','POST',{requestedAt:'current'});
 request.mockRejectedValue(new Error('conflict'));
 await expect(hyperDecideSharing(open,[open],'/api/admin/learning/people/person%20one/skills/skill%20one','decline')).rejects.toThrow('conflict');
});
it('capability description, preview and atomic save preserve upstream payloads and server validation',async()=>{
 const changes=[{scopeKind:'group' as const,scopeId:'Support',capability:'useBots' as const,allowed:true}];
 request.mockResolvedValue({changes,check:{ok:true}});
 await translateCapabilityChanges('Allow Support to use Bots');
 expect(request).toHaveBeenLastCalledWith('/api/admin/enterprise/capabilities/translate','POST',{text:'Allow Support to use Bots'});
 await capabilityChangesPreviewQueryOptions(changes).queryFn();
 expect(request).toHaveBeenLastCalledWith('/api/admin/enterprise/capabilities/preview','POST',{changes});
 const cache={invalidateQueries:vi.fn(async()=>{})};
 await saveCapabilityChangesMutationOptions(cache).mutationFn({changes,authoring:{source:'english',text:'Allow Support to use Bots'}});
 expect(request).toHaveBeenLastCalledWith('/api/admin/enterprise/capabilities/batch','POST',{changes,authoring:{source:'english',text:'Allow Support to use Bots'}});
 request.mockRejectedValue(new Error('refused'));
 await expect(saveCapabilityChangesMutationOptions(cache).mutationFn({changes})).rejects.toThrow('refused');
 expect(cache.invalidateQueries).not.toHaveBeenCalled();
});
it('source arguments preserve numeric, boolean and multiline values and refuse unsupported settings',()=>{
 const fields=hyperSourceFields({properties:{count:{type:'integer'},ratio:{type:'number'},flag:{type:'boolean'},lines:{type:'array'},text:{type:'string'},bad:null,other:[]}});
 expect(hyperSourceArguments(fields,{count:'0',ratio:'1.5',flag:'false',lines:' a \n\n b ',text:'inbox'})).toEqual({count:0,ratio:1.5,flag:false,lines:['a','b'],text:'inbox'});
 expect(()=>hyperSourceArguments({count:{type:'number'}},{count:'Infinity'})).toThrow('finite');
 expect(()=>hyperSourceArguments({obj:{type:'object'}},{obj:'{}'})).toThrow('cannot show');
 expect(hyperSourceFields({properties:[]})).toEqual({});
});
it('remote links allow only web addresses without embedded credentials',()=>{
 expect(hyperSafeMemoryLink('https://example.org/record')).toBe('https://example.org/record');
 for(const value of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','https://secret@example.org','invalid'])expect(hyperSafeMemoryLink(value)).toBeUndefined();
});
