import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
vi.stubGlobal('React',React);
const state=vi.hoisted(()=>({role:'admin',edition:'team',refused:false}));
vi.mock('./HyperGovernanceUi', async importOriginal => ({
  ...await importOriginal<typeof import('./HyperGovernanceUi')>(),
  useHyperResource:(path:string)=>({loading:false,error:state.refused&&path==='/api/computers/policy'?'Refused':'',reload:vi.fn(),data:
    path==='/api/me'?{user:{role:state.role}}:path==='/api/capabilities'?{edition:state.edition}:path==='/api/computers/policy'?state.refused?undefined:{policy:{mode:'enforce',deny:['first-rule','second-rule'],allow:[]}}:undefined}),
}));
vi.mock('./HyperGovernanceFlows',()=>({
  HyperDescribeChanges:({kind}:{kind:string})=><div data-editor={kind}/>,
  HyperTeamApprovals:()=> <div data-team-approvals="true"/>,
  HyperBoundaryEditor:({original,initialOpen}:{original?:string;initialOpen?:boolean})=><div data-rule={original??'new'} data-open={String(initialOpen)}/>,
}));
vi.mock('./HyperAudit',()=>({HyperAudit:({initialFilters}:{initialFilters?:unknown})=><div data-audit={JSON.stringify(initialFilters)}/>}));
vi.mock('./HyperWhatIf',()=>({HyperWhatIf:({initial}:{initial?:unknown})=><div data-action={JSON.stringify(initial)}/>}));
import HyperGovernanceSection, { HyperBoundaryDestination } from './HyperGovernanceSection';
import { HyperAdminAccessView } from './HyperAdminDestinationGate';
import { hyperAdminSelectionFromPath, hyperAdminBackSelection, hyperAdminPlatformPath, HYPER_ADMIN_PAGE_PATHS } from './HyperAdminNavigation';
import { hyperConversationDestination } from '../conversations/HyperNavigation';
import { HyperBoundaryEditor } from './HyperGovernanceFlows';
function elements(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[] {
  if(Array.isArray(node))return node.flatMap(elements);
  if(!React.isValidElement<Record<string,unknown>>(node))return [];
  return [node,...elements(node.props.children as React.ReactNode)];
}
beforeEach(()=>{state.role='admin';state.edition='team';state.refused=false;});
it('allocates every upstream admin page to its native host rather than personal Approvals',()=>{
  for(const [page,path] of Object.entries(HYPER_ADMIN_PAGE_PATHS)) {
    expect(hyperConversationDestination(path).sectionId).toBe('admin-governance');
    expect(renderToStaticMarkup(<HyperGovernanceSection path={path}/>)).toContain(`>${page}</h2>`);
  }
  expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/enterprise"/>)).toContain('>Admin</h2>');
  for(const [path,section] of [['/admin/credentials/new','admin-credentials'],['/admin/providers','admin-providers'],['/admin/proactive','admin-proactive'],['/admin/computers','admin-computers'],['/admin/playground','admin-playground']])expect(hyperConversationDestination(path).sectionId).toBe(section);
});
it('opens describe editors and approval settings via the actual governance host',()=>{
  expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/permissions/describe"/>)).toContain('data-editor="permissions"');
  expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/approvals/describe"/>)).toContain('data-editor="approvals"');
  expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/approvals"/>)).toContain('data-team-approvals="true"');
  expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/approvals/guidance"/>)).toContain('Guidance for auto-review');
});
it('selects the requested boundary, starts New open, and never substitutes a missing rule',()=>{
  expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/boundaries/1"/>)).toContain('data-rule="second-rule"');
  expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/boundaries/new"/>)).toContain('data-rule="new" data-open="true"');
  const missing=renderToStaticMarkup(<HyperGovernanceSection path="/admin/boundaries/99"/>);
  expect(missing).toContain('no longer in place');expect(missing).not.toContain('data-rule');
  const onBack=vi.fn();const node=HyperBoundaryDestination({policy:{mode:'enforce',deny:['first','second'],allow:[]},boundary:1,reload:vi.fn(),onBack});
  const tree=elements(node);const editor=tree.find(element=>element.type===HyperBoundaryEditor)!;
  expect(editor.props.original).toBe('second');
  const back=tree.find(element=>element.props.children==='Back to boundaries')!;
  (back.props.onClick as ()=>void)();expect(onBack).toHaveBeenCalledOnce();
});
it('passes audit filter and allowlisted What-if action intent without unrelated query fields',()=>{
  const html=renderToStaticMarkup(<HyperGovernanceSection path="/admin/audit?bot=bot-1&code=synthetic"/>);
  expect(html).toContain('bot-1');expect(html).not.toContain('synthetic');
  const selection=hyperAdminSelectionFromPath('/admin/what-if?action='+encodeURIComponent(JSON.stringify({bot:'bot-1',detail:'Check',token:'synthetic',unknown:'hidden'})));
  expect(selection.page).toBe('What would happen');expect(JSON.stringify(selection)).not.toContain('synthetic');expect(JSON.stringify(selection)).not.toContain('hidden');
});
it('keeps missing, refused, non-admin and personal team-only destinations closed',()=>{
  state.role='user';expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/boundaries/new"/>)).not.toContain('data-rule');
  state.role='admin';state.refused=true;expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/boundaries/0"/>)).not.toContain('data-rule');
  state.edition='personal';expect(renderToStaticMarkup(<HyperGovernanceSection path="/admin/permissions/describe"/>)).not.toContain('data-editor');
  for(const role of [undefined,'user'])expect(renderToStaticMarkup(<HyperAdminAccessView role={role} loading={false} error=""><div>protected-editor</div></HyperAdminAccessView>)).not.toContain('protected-editor');
  expect(hyperAdminSelectionFromPath('/admin/boundaries/-1')).toEqual({page:'missing'});
});

it('returns nested editors to their parent and rejects nonexistent platform detail paths',()=>{
 expect(hyperAdminBackSelection(hyperAdminSelectionFromPath('/admin/permissions/describe'))).toEqual({page:'Permissions'});
 expect(hyperAdminBackSelection(hyperAdminSelectionFromPath('/admin/approvals/guidance'))).toEqual({page:'Approvals'});
 expect(hyperAdminBackSelection(hyperAdminSelectionFromPath('/admin/boundaries/0'))).toEqual({page:'Boundaries'});
 expect(hyperAdminPlatformPath('/admin/credentials/new')).toEqual({valid:true,backPath:'/admin/credentials'});
 for(const area of ['providers','computers','proactive','playground'])expect(hyperAdminPlatformPath(`/admin/${area}/missing`).valid).toBe(false);
});
