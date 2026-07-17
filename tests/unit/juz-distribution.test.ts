import { describe, expect, it } from 'vitest';
import {
  distributeJuz,
  isDhikrCampaignType,
  isQuranCampaignType,
  validateManualJuzAssignments,
} from '../../src/utils/juz-distribution.js';

describe('distributeJuz', () => {
  it('distributes 30 Juz across 14 users as 2×3 + 12×2', () => {
    const users = Array.from({ length: 14 }, (_, i) => `u${i + 1}`);
    const plan = distributeJuz(users);
    expect(plan).toHaveLength(14);
    const sizes = plan.map((p) => p.juzNumbers.length).sort((a, b) => b - a);
    expect(sizes.filter((n) => n === 3)).toHaveLength(2);
    expect(sizes.filter((n) => n === 2)).toHaveLength(12);
    const all = plan.flatMap((p) => p.juzNumbers).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('is deterministic for the same user order', () => {
    const users = ['a', 'b', 'c'];
    expect(distributeJuz(users)).toEqual(distributeJuz(users));
  });

  it('covers custom juz list exactly once', () => {
    const plan = distributeJuz(['u1', 'u2'], [1, 2, 3]);
    expect(plan[0]!.juzNumbers).toEqual([1, 2]);
    expect(plan[1]!.juzNumbers).toEqual([3]);
  });

  it('rejects empty users', () => {
    expect(() => distributeJuz([])).toThrow(/At least one user/);
  });

  it('assigns only the first users when there are more users than Juz', () => {
    expect(distributeJuz(['a', 'b', 'c'], [1, 2])).toEqual([
      { userId: 'a', juzNumbers: [1] },
      { userId: 'b', juzNumbers: [2] },
    ]);
  });

  it('assigns only the first 30 unique users for a full Quran', () => {
    const users = Array.from({ length: 35 }, (_, i) => `u${i + 1}`);
    const plan = distributeJuz(users);
    expect(plan).toHaveLength(30);
    expect(plan.at(-1)?.userId).toBe('u30');
    expect(plan.flatMap((item) => item.juzNumbers)).toHaveLength(30);
  });
});

describe('validateManualJuzAssignments', () => {
  it('accepts exact coverage without overlaps', () => {
    const result = validateManualJuzAssignments(
      [
        { userId: 'a', juzNumbers: [1, 2] },
        { userId: 'b', juzNumbers: [3] },
      ],
      [1, 2, 3],
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects overlaps', () => {
    const result = validateManualJuzAssignments(
      [
        { userId: 'a', juzNumbers: [1, 2] },
        { userId: 'b', juzNumbers: [2] },
      ],
      [1, 2],
    );
    expect(result.ok).toBe(false);
  });

  it('rejects missing juz', () => {
    const result = validateManualJuzAssignments([{ userId: 'a', juzNumbers: [1] }], [1, 2]);
    expect(result.ok).toBe(false);
  });

  it('accepts partial non-overlapping assignments when full coverage is not required', () => {
    const result = validateManualJuzAssignments(
      [{ userId: 'a', juzNumbers: [7] }],
      Array.from({ length: 30 }, (_, i) => i + 1),
      false,
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('campaign type helpers', () => {
  it('classifies quran and dhikr types', () => {
    expect(isQuranCampaignType('quran_complete')).toBe(true);
    expect(isDhikrCampaignType('darood')).toBe(true);
    expect(isDhikrCampaignType('quran_juz')).toBe(false);
  });
});
