import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { FieldPBSchema, FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { HyperDatabaseController } from '../hyper-database/HyperDatabaseController';
import { hyperDatabaseBackend } from '../hyper-database/HyperDatabaseBackend';
import { HyperGridFilterRows } from '../hyper-database/views/grid/HyperGridModel';
import { hyperBoardDefaultFields } from '../hyper-database/views/board/hyperBoardModel';
import { HyperPeopleFieldIcon } from './HyperPeopleProperty';
import { hyperSerializeMention } from './hyperMentions';
describe('Hyper People property', () => {
 it('writes the marker through UpdateField because CreateField drops field_icon',async()=>{
  const update=vi.fn().mockResolvedValue({ok:true,value:undefined}),c=new HyperDatabaseController('view',{...hyperDatabaseBackend,DatabaseEventUpdateField:update});
  const field=create(FieldPBSchema,{id:'people',name:'People',fieldType:FieldType.RichText});
  const make=vi.spyOn(c,'createField').mockResolvedValue(field);vi.spyOn(c,'refresh').mockResolvedValue(undefined);
  expect((await c.createHyperPeopleField()).icon).toBe(HyperPeopleFieldIcon);
  expect(make).toHaveBeenCalledWith('People',FieldType.RichText);
  expect(update).toHaveBeenCalledWith({viewId:'view',fieldId:'people',oneOfIcon:{case:'icon',value:HyperPeopleFieldIcon}});
  c.dispose();
 });
 it('filters exact normalized person identity and includes People in board defaults',()=>{
  const c=new HyperDatabaseController('view');const proto=create(FieldPBSchema,{id:'people',fieldType:FieldType.RichText,icon:HyperPeopleFieldIcon});
  const field={id:'people',type:FieldType.RichText,name:'People',isPrimary:false,proto,options:[],settings:{visibility:0} as never};
  const text=hyperSerializeMention({name:'Employee',email:'nave@example.test'});c.store.setState({fields:[field],rowIds:['a','b','c'],cells:{a:{people:{kind:'text',text,display:text}},b:{people:{kind:'text',text:'nave@example.test',display:'nave@example.test'}},c:{people:{kind:'text',text:hyperSerializeMention({name:'Employee',email:'other@example.test'}),display:''}}}});
  expect(HyperGridFilterRows(c.state,'',undefined,undefined,{fieldId:'people',email:'NAVE@example.test'})).toEqual(['a']);
  expect(hyperBoardDefaultFields([field])).toEqual([field]);c.dispose();
 });
});
