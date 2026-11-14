import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it,vi } from 'vitest';
import { HyperMemorySourcesView, type HyperMemorySourcesViewProps } from './HyperMemorySources';
import { hyperMemorySelectionFromPath } from './HyperMemoryNavigation';
vi.stubGlobal('React',React);
const source={id:'s/2',agentId:'bot-1',title:'Chosen source',toolRef:'mail/read',enabled:true,syncStatus:'idle' as const,syncError:null,lastSyncAt:null};
function props():HyperMemorySourcesViewProps{return {sources:[{...source,id:'other',title:'Other source'},source],selection:hyperMemorySelectionFromPath('/memory/sources/s%2F2'),loading:false,error:'',busy:false,onSelect:vi.fn(),onAction:vi.fn(),onRefresh:vi.fn()};}
function elements(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[]{
 if(Array.isArray(node))return node.flatMap(elements);
 if(!React.isValidElement<Record<string,unknown>>(node))return [];
 return [node,...elements(node.props.children as React.ReactNode)];
}
it('renders the selected source and invokes real source action and Back handlers',()=>{
 const viewProps=props();const html=renderToStaticMarkup(<HyperMemorySourcesView {...viewProps}/>);
 expect(html).toContain('Chosen source');expect(html).not.toContain('Other source');
 const nodes=elements(HyperMemorySourcesView(viewProps));
 (nodes.find(node=>node.props.children==='Sync now')!.props.onClick as ()=>void)();expect(viewProps.onAction).toHaveBeenCalledWith(source,'sync');
 (nodes.find(node=>node.props.children==='Back to sources')!.props.onClick as ()=>void)();expect(viewProps.onSelect).toHaveBeenCalledWith({page:'sources'});
 const list=elements(HyperMemorySourcesView({...viewProps,selection:{page:'sources'}}));
 (list.find(node=>node.props.children==='Chosen source')!.props.onClick as ()=>void)();expect(viewProps.onSelect).toHaveBeenLastCalledWith({page:'source',sourceId:'s/2'});
});
it('never offers source controls for missing, loading or refused reads',()=>{
 for(const overrides of [{sources:[]},{loading:true},{error:'Refused'}]){
  const html=renderToStaticMarkup(<HyperMemorySourcesView {...props()} {...overrides}/>);
  expect(html).not.toContain('Sync now');expect(html).not.toContain('Remove source');
 }
 expect(hyperMemorySelectionFromPath('/memory/sources/')).toEqual({page:'sources'});
 expect(hyperMemorySelectionFromPath('/settings/memory/sources/s1?token=synthetic')).toEqual({page:'source',sourceId:'s1'});
 expect(hyperMemorySelectionFromPath('https://evil/memory/sources/s1')).toEqual({page:'missing'});
});
