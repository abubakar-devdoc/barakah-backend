import { describe, expect, it } from 'vitest';
import {
  createCampaignSchema,
  createUserSchema,
  dhikrBatchSchema,
  distributeJuzSchema,
  loginSchema,
  manualAssignmentsSchema,
} from '../../src/validators/schemas.js';
import { AppError, badRequest, conflict } from '../../src/utils/errors.js';

describe('validation schemas', () => {
  it('accepts valid login payloads', () => {
    const parsed = loginSchema.parse({
      email: 'Admin@Example.com',
      password: 'x',
    });
    expect(parsed.email).toBe('admin@example.com');
    expect(parsed.rememberMe).toBe(false);
  });

  it('rejects invalid emails', () => {
    expect(() => loginSchema.parse({ email: 'nope', password: 'x' })).toThrow();
  });

  it('requires organizationId and campaign fields for create campaign', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        campaignType: 'quran_complete',
      }),
    ).toThrow();

    const ok = createCampaignSchema.parse({
      organizationId: '11111111-1111-1111-1111-111111111111',
      name: 'Esal-e-Sawab',
      campaignType: 'quran_complete',
    });
    expect(ok.visibility).toBe('private');
  });

  it('validates dhikr batch bounds', () => {
    expect(() =>
      dhikrBatchSchema.parse({ clientBatchId: 'short', delta: 1 }),
    ).toThrow();
    expect(() =>
      dhikrBatchSchema.parse({ clientBatchId: 'batch-12345678', delta: 0 }),
    ).toThrow();
    expect(
      dhikrBatchSchema.parse({ clientBatchId: 'batch-12345678', delta: 100 }),
    ).toEqual({ clientBatchId: 'batch-12345678', delta: 100 });
  });

  it('validates distribution payload', () => {
    const parsed = distributeJuzSchema.parse({
      userIds: ['11111111-1111-1111-1111-111111111111'],
      persist: false,
    });
    expect(parsed.persist).toBe(false);
  });

  it('validates manual assignment shape', () => {
    expect(() =>
      manualAssignmentsSchema.parse({
        assignments: [{ userId: '11111111-1111-1111-1111-111111111111', juzNumbers: [] }],
      }),
    ).toThrow();
  });

  it('defaults create-user platform role to user', () => {
    const parsed = createUserSchema.parse({
      email: 'a@b.co',
      fullName: 'Test User',
    });
    expect(parsed.platformRole).toBe('user');
    expect(parsed.orgRole).toBe('member');
  });
});

describe('domain error helpers', () => {
  it('builds operational AppErrors', () => {
    const err = badRequest('Nope', { field: 'x' });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(conflict('dup').statusCode).toBe(409);
  });
});
