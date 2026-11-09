import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, FeatureFlag, encodeFeatureFlagMap, isOnWith, parseFeatureFlagMap } from './feature-flags';

describe('feature flags (lib/shared/feature_flags.dart)', () => {
  it('defaults every flag to false in enum order when nothing is stored', () => {
    const values = parseFeatureFlagMap(null);
    expect([...values.keys()]).toEqual(FEATURE_FLAGS);
    expect([...values.values()].every((v) => v === false)).toBe(true);
  });

  it('overlays stored values and maps unknown names to `unknown`', () => {
    const values = parseFeatureFlagMap(JSON.stringify({ sharedSection: true, somethingNew: true }));
    expect(values.get(FeatureFlag.sharedSection)).toBe(true);
    expect(values.get(FeatureFlag.unknown)).toBe(true);
    expect([...values.keys()]).toEqual(FEATURE_FLAGS);
  });

  it('reads malformed JSON as no stored values', () => {
    expect(parseFeatureFlagMap('{not json').get(FeatureFlag.sharedSection)).toBe(false);
    expect(parseFeatureFlagMap('[1,2]').get(FeatureFlag.search)).toBe(false);
  });

  it('encodes every entry as {"name": bool}', () => {
    const values = parseFeatureFlagMap(null);
    values.set(FeatureFlag.sharedSection, true);
    const json = JSON.parse(encodeFeatureFlagMap(values));
    expect(Object.keys(json)).toEqual(FEATURE_FLAGS);
    expect(json.sharedSection).toBe(true);
    expect(json.unknown).toBe(false);
  });

  it('forces planBilling off and released flags on', () => {
    const values = parseFeatureFlagMap(JSON.stringify({ planBilling: true, search: false, membersSettings: false }));
    expect(isOnWith(FeatureFlag.planBilling, values)).toBe(false);
    expect(isOnWith(FeatureFlag.search, values)).toBe(true);
    expect(isOnWith(FeatureFlag.membersSettings, values)).toBe(true);
    expect(isOnWith(FeatureFlag.collaborativeWorkspace, values)).toBe(true);
  });

  it('uses the stored value for sharedSection, and the fallback after clear()', () => {
    expect(isOnWith(FeatureFlag.sharedSection, parseFeatureFlagMap(JSON.stringify({ sharedSection: true })))).toBe(true);
    expect(isOnWith(FeatureFlag.sharedSection, parseFeatureFlagMap(null))).toBe(false);
    const cleared = new Map();
    expect(isOnWith(FeatureFlag.sharedSection, cleared)).toBe(false);
    expect(isOnWith(FeatureFlag.unknown, cleared)).toBe(false);
  });
});
