import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./HyperMemorySection',()=>({useHyperMemoryData:vi.fn(),HyperMemoryStatus:({loading,error}:{loading:boolean;error:string})=>loading?'Loading':error}));
import { useHyperMemoryData } from './HyperMemorySection';
import { HyperLearningDetail } from './HyperLearningDetail';
const resource=vi.mocked(useHyperMemoryData);
const render=(props:Partial<React.ComponentProps<typeof HyperLearningDetail>>={})=>renderToStaticMarkup(<HyperLearningDetail path="/api/admin/learning/proposals/p" kind="proposal" onClose={()=>{}} onDecide={()=>{}} {...props}/>);
beforeEach(()=>resource.mockReturnValue({loading:false,error:'',data:undefined,reload:vi.fn()}));
it('cannot approve before the requested skill has loaded or after a refusal',()=>{
 resource.mockReturnValue({loading:true,error:'',data:undefined,reload:vi.fn()});expect(render()).not.toContain('Approve and publish');
 resource.mockReturnValue({loading:false,error:'Refused',data:undefined,reload:vi.fn()});expect(render()).toContain('Refused');expect(render()).not.toContain('Approve and publish');
});
it('shows inert files, conversation and recording evidence and binary files',()=>{
 resource.mockReturnValue({loading:false,error:'',reload:vi.fn(),data:{title:'test-skill',description:'Test skill',reason:'Evidence',status:'pending_review',operation:'add',files:[{path:'SKILL.md',content:'---\nname: test\n---\n<script>alert(1)</script>'},{path:'image.png',text:null}],insights:[{id:'i',statement:'Insight',impact:'Impact',evidence:[{kind:'conversation',id:'c',title:'Conversation',available:true,messages:[{id:'m',role:'user',content:'<img src=x onerror=alert(1)>'}]},{kind:'recording',id:'r',title:'Recording',available:true,eventCount:2,events:['Click save']},{kind:'recording',id:'gone',title:null,available:false,eventCount:0,events:[]}]}]}});
 const html=render();expect(html).toContain('Approve and publish');expect(html).toContain('Binary file');expect(html).toContain('No longer available');expect(html).toContain('Click save');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');
 expect(render({onDecide:undefined})).not.toContain('Approve and publish');
});
it('reviewed skills have no decision controls',()=>{
 resource.mockReturnValue({loading:false,error:'',reload:vi.fn(),data:{title:'Skill',status:'approved',files:[],insights:[]}});
 expect(render()).not.toContain('Approve and publish');
});
