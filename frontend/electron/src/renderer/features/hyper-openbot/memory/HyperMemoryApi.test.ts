import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { createMemory, updateMemory, deleteMemory, addMemorySource, memorySourceAction } from './HyperMemoryApi';
import { reviewPersonalProposalMutationOptions, decideSharingMutationOptions, reviewLearningProposalMutationOptions } from './HyperLearningMutations';
import { personalProposalQueryOptions, learnedSkillQueryOptions } from './HyperLearningQueries';
const request = vi.mocked(hyperOpenBotRequest);
const cache = { invalidateQueries: vi.fn(async () => {}) };
beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue({}); });
it('sends memory writes and source actions through the tunnel', async () => {
 await createMemory('A fact'); expect(request).toHaveBeenLastCalledWith('/api/memory','POST',{content:'A fact'});
 await updateMemory('fact id',{reviewState:'confirmed'}); expect(request).toHaveBeenLastCalledWith('/api/memory/fact%20id','PATCH',{reviewState:'confirmed'});
 await deleteMemory('fact'); expect(request).toHaveBeenLastCalledWith('/api/memory/fact','DELETE',undefined);
 await addMemorySource({agentId:'bot',toolRef:'app.read',title:'Inbox',args:{limit:2}}); expect(request).toHaveBeenLastCalledWith('/api/memory/sources','POST',{agentId:'bot',toolRef:'app.read',title:'Inbox',args:{limit:2}});
 await memorySourceAction('source','disable'); expect(request).toHaveBeenLastCalledWith('/api/memory/sources/source','PATCH',{enabled:false});
 await memorySourceAction('source','sync'); expect(request).toHaveBeenLastCalledWith('/api/memory/sources/source/sync','POST',undefined);
});
it('keeps personal review scoped to its server container', async () => {
 request.mockResolvedValue({proposal:{id:'p',status:'approved'}});
 const result=await reviewPersonalProposalMutationOptions(cache).mutationFn({container:'space one',proposalId:'p',decision:'approve'});
 expect(result).toEqual({id:'p',status:'approved'});
 expect(request).toHaveBeenLastCalledWith('/api/settings/learning/proposals/p/approve?container=space%20one','POST',{});
 await personalProposalQueryOptions('space one','p').queryFn();
 expect(request).toHaveBeenLastCalledWith('/api/settings/learning/proposals/p?container=space%20one',undefined,undefined);
});
it('preserves sharing request concurrency and bot scope', async () => {
 await decideSharingMutationOptions(cache).mutationFn({userId:'person',skillName:'skill one',decision:'decline',requestedAt:'revision'});
 expect(request).toHaveBeenLastCalledWith('/api/admin/learning/sharing-requests/person/skill%20one/decline','POST',{requestedAt:'revision'});
 await reviewLearningProposalMutationOptions(cache).mutationFn({proposalId:'p',agentId:'bot one',decision:'reject'});
 expect(request).toHaveBeenLastCalledWith('/api/admin/learning/proposals/p/reject?agentId=bot%20one','POST',{});
 await learnedSkillQueryOptions({kind:'person',userId:'person'},'skill one').queryFn();
 expect(request).toHaveBeenLastCalledWith('/api/admin/learning/people/person/skills/skill%20one',undefined,undefined);
});
it('propagates refusals without claiming success', async () => {
 request.mockRejectedValue(new Error('refused'));
 await expect(createMemory('fact')).rejects.toThrow('refused');
 await expect(reviewPersonalProposalMutationOptions(cache).mutationFn({container:'space',proposalId:'p',decision:'reject'})).rejects.toThrow('refused');
 expect(cache.invalidateQueries).not.toHaveBeenCalled();
});
