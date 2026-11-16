import { beforeEach, expect, it, vi } from 'vitest';
import { IpcChannel as C } from '@shared/api';
const mock=vi.hoisted(()=>({handlers:new Map<string,Function>()}));
vi.mock('electron',()=>({ipcMain:{handle:(name:string,handler:Function)=>mock.handlers.set(name,handler)}}));
import { registerHyperEntraIpc } from './HyperEntraIpc';
const sender={mainFrame:{}},broker={idToken:vi.fn().mockResolvedValue({idToken:'fake',name:'Employee'}),cancel:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();mock.handlers.clear();registerHyperEntraIpc(()=>({webContents:sender,getNativeWindowHandle:()=>Buffer.from([1])}) as never,broker as never)});
it('refuses other windows and subframes before invoking the broker',async()=>{
 for(const event of [{sender:{},senderFrame:sender.mainFrame},{sender,senderFrame:{}}]){
  expect(await mock.handlers.get(C.AuthEntraIdToken)!(event,{})).toMatchObject({ok:false,kind:'state'});
  await mock.handlers.get(C.AuthEntraCancel)!(event);
 }
 expect(broker.idToken).not.toHaveBeenCalled();expect(broker.cancel).not.toHaveBeenCalled();
});
it('forwards only a trusted token request and its native parent handle',async()=>{
 const event={sender,senderFrame:sender.mainFrame},config={tenantId:'tenant',clientId:'client'};
 expect(await mock.handlers.get(C.AuthEntraIdToken)!(event,config)).toMatchObject({ok:true,value:{idToken:'fake'}});
 expect(broker.idToken).toHaveBeenCalledWith(config,Buffer.from([1]));await mock.handlers.get(C.AuthEntraCancel)!(event);expect(broker.cancel).toHaveBeenCalledOnce();
});
