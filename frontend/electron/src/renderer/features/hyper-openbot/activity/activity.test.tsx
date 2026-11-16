import { renderToStaticMarkup } from 'react-dom/server';
import type { FormEvent, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HyperApproval, HyperCommandOutput, HyperDecisionCard, HyperQuestion, HyperToolActivity, hyperPartsAnswer } from './index';

const interaction = vi.hoisted(() => ({ submit: undefined as ((event: FormEvent<HTMLFormElement>) => void) | undefined }));
vi.mock('./HyperDecisionCard', async importOriginal => {
  const original = await importOriginal<typeof import('./HyperDecisionCard')>();
  return { ...original, HyperDecisionCard: (props: Parameters<typeof original.HyperDecisionCard>[0]) => {
    // Keep the real card and its selection/validation logic; expose its real form event for this unit interaction.
    const tree = original.HyperDecisionCard(props);
    const form = (tree.props.children as ReactElement<{ onSubmit?: (event: FormEvent<HTMLFormElement>) => void }>[]).find(child => child?.type === 'form');
    interaction.submit = form?.props.onSubmit;
    return tree;
  } };
});

describe('Hyper activity ports', () => {
  it('keeps handoff choices separate from standing permissions', () => {
    const html = renderToStaticMarkup(<HyperApproval request={{ id: 'a', title: 'Save file', handOff: true, offersStandingRule: true }} onDecide={() => {}} />);
    expect(html).toContain('I did it myself');
    expect(html).toContain('Don&#x27;t do it');
    expect(html).not.toContain('Always allow here');
  });
  it('collapses answered choices', () => {
    const html = renderToStaticMarkup(<HyperDecisionCard title="Save?" options={[{ value: 'yes', label: 'Allow once' }]} answer={{ label: 'Allowed once' }} onSubmit={() => {}} />);
    expect(html).toContain('Allowed once');
    expect(html).not.toContain('type="radio"');
  });
  it('preserves command outcome notices without inventing output', () => {
    const html = renderToStaticMarkup(<HyperCommandOutput output="" exitCode={2} timedOut truncated />);
    expect(html).toContain('It printed nothing.');
    expect(html).toContain('Exit code 2.');
    expect(html).toContain('It ran too long');
  });
  it('places approval outside the collapsed tool group', () => {
    const html = renderToStaticMarkup(<HyperToolActivity steps={[{ id: 'step', label: 'Save', status: 'waiting', approval: <p>Approve this action</p> }]} />);
    expect(html.indexOf('Approve this action')).toBeGreaterThan(html.lastIndexOf('</details>'));
  });
  it('serializes multipart answers in upstream format', () => {
    expect(hyperPartsAnswer([{ header: 'Scope', question: 'Where?' }, { header: 'Time', question: 'When?' }], ['Here', 'Now'])).toBe('Scope: Here\nTime: Now');
  });
  it('keeps literal option labels separate from the free-text sentinel', () => {
    const html = renderToStaticMarkup(<HyperQuestion id="literal-option" parts={[{ header: '', question: 'Choose', options: ['__other__'] }]} onAnswer={() => {}} />);
    expect(html).toContain('value="choice:0"');
    expect(html).not.toContain('value="__other__"');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('__other__');
  });
  it('submits the selected literal __other__ option unchanged through the real card and question callbacks', () => {
    const onAnswer = vi.fn();
    renderToStaticMarkup(<HyperQuestion id="literal-submit" parts={[{ header: '', question: 'Choose', options: ['__other__', 'Another option'] }]} onAnswer={onAnswer} />);
    const preventDefault = vi.fn();
    expect(interaction.submit).toBeTypeOf('function');
    interaction.submit!({ preventDefault } as unknown as FormEvent<HTMLFormElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('literal-submit', '__other__');
  });
});
