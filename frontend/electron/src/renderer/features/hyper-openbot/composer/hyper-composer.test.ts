// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { HyperScreenPickedFiles, HyperClassifyAttachment, HyperShouldClaimPaste, HyperMAX_FILE_BYTES } from './hyper-files';
import { HyperSwitchModel } from './hyper-models';
const file = (name: string, type: string, size = 1) => ({ name, type, size } as File);
describe('Hyper composer upstream policies', () => {
  it('normalizes MIME and refuses SVG before counting slots', () => {
    expect(HyperClassifyAttachment('TEXT/PLAIN;charset=utf-8')).toBe('text');
    const result = HyperScreenPickedFiles([file('bad.svg', 'image/svg+xml'), file('ok.txt', 'text/plain')], { alreadyStaged: 7 });
    expect(result.accepted.map((item) => item.name)).toEqual(['ok.txt']);
    expect(result.rejected[0].reason).toContain('SVG');
  });
  it('enforces size boundaries and permits unnamed types for server inspection', () => {
    const result = HyperScreenPickedFiles([file('limit', 'text/plain', HyperMAX_FILE_BYTES), file('large', 'text/plain', HyperMAX_FILE_BYTES + 1), file('unknown', 'application/octet-stream')], { alreadyStaged: 0 });
    expect(result.accepted.map((item) => item.name)).toEqual(['limit', 'unknown']);
    expect(result.rejected).toHaveLength(1);
    expect(HyperScreenPickedFiles([file('one', 'text/plain')], { alreadyStaged: 8 }).accepted).toHaveLength(0);
  });
  it('prefers clipboard text over accompanying images', () => {
    expect(HyperShouldClaimPaste({ kinds: ['image'], plainText: 'cell' })).toBe(false);
    expect(HyperShouldClaimPaste({ kinds: ['image'], plainText: '' })).toBe(true);
  });
  it('keeps compatible thinking effort when changing model', () => {
    const pick = { model: 'previous', effort: 'high' };
    expect(HyperSwitchModel(pick, { id: 'next', label: 'Next', efforts: ['high'] }).effort).toBe('high');
    expect(HyperSwitchModel(pick, { id: 'next', label: 'Next' }).effort).toBeNull();
  });
});
