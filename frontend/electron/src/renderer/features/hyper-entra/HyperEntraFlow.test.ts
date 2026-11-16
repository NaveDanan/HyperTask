import { describe, expect, it, vi } from 'vitest';
import { HyperEntraFlow } from './HyperEntraFlow';
const config={tenantId:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222'};
function setup() {
 const deps={token:vi.fn().mockResolvedValue({ok:true,value:{idToken:'fake-id',name:'Employee',nonce:'raw-nonce'}}),cancel:vi.fn().mockResolvedValue(undefined),request:vi.fn().mockResolvedValue({status:200,body:JSON.stringify({access_token:'access',refresh_token:'refresh',expires_in:3600,token_type:'bearer'})}),handoff:vi.fn().mockResolvedValue(undefined),signedIn:vi.fn().mockResolvedValue(undefined),changed:vi.fn()};
 return {deps,flow:new HyperEntraFlow(deps)};
}
describe('Hyper Entra sign-in flow',()=>{
 it('exchanges Azure ID token and nonce, then uses the existing protobuf session handoff',async()=>{
  const {flow,deps}=setup();await flow.start(config,'https://company.example/');
  expect(deps.request).toHaveBeenCalledWith(expect.objectContaining({url:'https://company.example/gotrue/token?grant_type=id_token',method:'POST',body:JSON.stringify({provider:'azure',id_token:'fake-id',nonce:'raw-nonce'})}));
  expect(deps.handoff).toHaveBeenCalledWith(expect.objectContaining({accessToken:'access',refreshToken:'refresh',expiresIn:3600n}));expect(deps.signedIn).toHaveBeenCalledOnce();expect(flow.state.phase).toBe('idle');
 });
 it('makes one automatic attempt per launch even after failure',async()=>{const {flow,deps}=setup();deps.token.mockResolvedValue({ok:false,message:'broker unavailable'});await flow.start(config,'https://company.example',true);await flow.start(config,'https://company.example',true);expect(deps.token).toHaveBeenCalledOnce();expect(flow.state.reason).toBe('broker unavailable');await flow.start(config,'https://company.example');expect(deps.token).toHaveBeenCalledTimes(2);});
 it('does not auto-run when signed out or unconfigured',async()=>{const {flow,deps}=setup();await flow.start(config,'https://company.example',true,true);await flow.start(null,'https://company.example',true);expect(deps.token).not.toHaveBeenCalled();await flow.start(null,'https://company.example');expect(flow.state.reason).toContain('not configured');});
 it('omits nonce for nonce-free WAM cache tokens',async()=>{const {flow,deps}=setup();deps.token.mockResolvedValue({ok:true,value:{idToken:'fake',name:'Employee'}});await flow.start(config,'https://company.example');expect(JSON.parse(deps.request.mock.calls[0][0].body)).not.toHaveProperty('nonce');});
 it('reports server rejection without exposing body or creating a session',async()=>{const {flow,deps}=setup();deps.request.mockResolvedValue({status:400,body:'SECRET diagnostic'});await flow.start(config,'https://company.example');expect(flow.state.reason).toContain('server rejected');expect(flow.state.reason).not.toContain('SECRET');expect(deps.handoff).not.toHaveBeenCalled();});
 it('rejects malformed success payloads and network failures',async()=>{for(const response of [{status:200,body:'invalid'},{status:200,body:'{}'}]){const {flow,deps}=setup();deps.request.mockResolvedValue(response);await flow.start(config,'https://company.example');expect(flow.state.phase).toBe('error');expect(deps.handoff).not.toHaveBeenCalled();}});
 it('cancels during broker or exchange and ignores all late session results',async()=>{
  for(const phase of ['broker','exchange']){const {flow,deps}=setup();let finish!:(value:unknown)=>void;const deferred=new Promise(resolve=>{finish=resolve});if(phase==='broker')deps.token.mockReturnValue(deferred);else deps.request.mockReturnValue(deferred);const pending=flow.start(config,'https://company.example');await Promise.resolve();flow.cancel();finish(phase==='broker'?{ok:true,value:{idToken:'late',name:'Employee'}}:{status:200,body:JSON.stringify({access_token:'access',refresh_token:'refresh',expires_in:3600})});await pending;expect(deps.handoff).not.toHaveBeenCalled();expect(flow.state.phase).toBe('idle');}
 });
 it('surfaces a Rust core session handoff failure',async()=>{const {flow,deps}=setup();deps.handoff.mockRejectedValue(new Error('core failed'));await flow.start(config,'https://company.example');expect(flow.state.phase).toBe('error');expect(deps.signedIn).not.toHaveBeenCalled();});
});
