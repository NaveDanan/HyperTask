import { describe, expect, it } from 'vitest';
import { cssToHexString, hexStringToCss } from './appearance-utils';

// ReUI emits CSS hex with an optional final alpha byte; preferences retain Dart ARGB.
describe('document ColorPicker preference compatibility', () => {
  it.each([
    ['#123456', '0xff123456'],
    ['#12345680', '0x80123456'],
    ['#1234560d', '0x0d123456'],
    ['#12345600', '0x00123456'],
  ])('converts %s without dropping or reordering the alpha byte', (css, stored) => {
    expect(cssToHexString(css)).toBe(stored);
    expect(cssToHexString(hexStringToCss(stored))).toBe(stored);
  });
});
