import { describe, expect, it } from 'vitest';
import { hyperMentionDeletion, hyperMentionPeople, hyperMentionQuery, hyperMentionText, hyperParseMentions, hyperSerializeMention } from './hyperMentions';
import { hyperIsPeopleField, HyperPeopleFieldIcon } from './HyperPeopleProperty';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
describe('Hyper mention storage', () => {
  const person = { name: 'נוה [Danan] \\ Name', email: 'NAVE@example.test' };
  it('round-trips Hebrew, brackets and escapes and deduplicates identity', () => {
    const token = hyperSerializeMention(person);
    expect(hyperMentionPeople(token + ' ' + token)).toEqual([{ ...person, email: 'nave@example.test' }]);
    expect(hyperMentionText('Ask ' + token)).toBe('Ask @' + person.name);
    expect(hyperParseMentions(token)[0].kind).toBe('mention');
  });
  it('requires a standalone trigger and two characters', () => {
    expect(hyperMentionQuery('@n',2)).toBeNull();
    expect(hyperMentionQuery('a@nave',6)).toBeNull();
    expect(hyperMentionQuery('Ask @נוה',8)?.query).toBe('נוה');
  });
  it('deletes tokens atomically at either boundary and across a selection', () => {
    const token=hyperSerializeMention(person), value='a'+token+'b';
    expect(hyperMentionDeletion(value,1+token.length,1+token.length,true)).toEqual({value:'ab',caret:1});
    expect(hyperMentionDeletion(value,1,1,false)).toEqual({value:'ab',caret:1});
    expect(hyperMentionDeletion(value,3,7,true)).toEqual({value:'ab',caret:1});
  });
  it('does not interpret other URI schemes as people', () => {
    expect(hyperMentionPeople('@[Name](javascript:alert) @[Name](mailto:invalid)')).toEqual([]);
  });
  it('recognizes only the versioned database-wide RichText marker', () => {
    expect(hyperIsPeopleField({fieldType:FieldType.RichText,icon:HyperPeopleFieldIcon})).toBe(true);
    expect(hyperIsPeopleField({fieldType:FieldType.Number,icon:HyperPeopleFieldIcon})).toBe(false);
    expect(hyperIsPeopleField({fieldType:FieldType.RichText,icon:'hyper:people:v2'})).toBe(false);
  });
});
