/**
 * Deterministic Juz distribution across members.
 * Covers juz 1..30 (or a provided sorted unique list) exactly once with no overlaps.
 * Remainder juz are given to the first members (stable order).
 *
 * Example: 30 juz, 14 users → 2 users get 3 juz, 12 get 2 juz.
 */
export interface JuzAssignmentPlan {
  userId: string;
  juzNumbers: number[];
}

export function distributeJuz(
  userIds: string[],
  juzNumbers: number[] = Array.from({ length: 30 }, (_, i) => i + 1),
): JuzAssignmentPlan[] {
  if (userIds.length === 0) {
    throw new Error('At least one user is required for Juz distribution');
  }

  const uniqueUsers = [...new Set(userIds)];
  const uniqueJuz = [...new Set(juzNumbers)].filter((j) => j >= 1 && j <= 30).sort((a, b) => a - b);

  if (uniqueJuz.length === 0) {
    throw new Error('At least one valid Juz (1-30) is required');
  }

  // Stable input order is the tie-breaker. When there are more members than
  // units, only the first members receive an assignment.
  const eligibleUsers = uniqueUsers.slice(0, uniqueJuz.length);

  const base = Math.floor(uniqueJuz.length / eligibleUsers.length);
  const remainder = uniqueJuz.length % eligibleUsers.length;

  const plans: JuzAssignmentPlan[] = eligibleUsers.map((userId) => ({
    userId,
    juzNumbers: [],
  }));

  let cursor = 0;
  for (let i = 0; i < eligibleUsers.length; i += 1) {
    const count = base + (i < remainder ? 1 : 0);
    plans[i]!.juzNumbers = uniqueJuz.slice(cursor, cursor + count);
    cursor += count;
  }

  return plans;
}

export function validateManualJuzAssignments(
  assignments: Array<{ userId: string; juzNumbers: number[] }>,
  expectedJuz: number[] = Array.from({ length: 30 }, (_, i) => i + 1),
  requireCompleteCoverage = true,
): { ok: true } | { ok: false; reason: string } {
  const expected = new Set(expectedJuz);
  const seen = new Set<number>();

  for (const a of assignments) {
    if (!a.userId) return { ok: false, reason: 'Each assignment requires a userId' };
    if (!a.juzNumbers.length) return { ok: false, reason: 'Each user must receive at least one Juz' };
    for (const j of a.juzNumbers) {
      if (j < 1 || j > 30) return { ok: false, reason: `Invalid Juz ${j}` };
      if (!expected.has(j)) return { ok: false, reason: `Juz ${j} is not in the campaign target` };
      if (seen.has(j)) return { ok: false, reason: `Juz ${j} is assigned more than once` };
      seen.add(j);
    }
  }

  if (requireCompleteCoverage) {
    for (const j of expected) {
      if (!seen.has(j)) return { ok: false, reason: `Juz ${j} is not assigned` };
    }
  }

  return { ok: true };
}

export function isQuranCampaignType(type: string): boolean {
  return type.startsWith('quran_');
}

export function isDhikrCampaignType(type: string): boolean {
  return [
    'ayat_kareema',
    'darood',
    'istighfar',
    'tasbeeh',
    'custom_dhikr',
  ].includes(type);
}
