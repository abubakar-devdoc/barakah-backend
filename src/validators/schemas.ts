import { z } from 'zod';

export const uuidParam = z.object({ id: z.string().uuid() });
export const orgIdParam = z.object({ orgId: z.string().uuid() });
export const campaignIdParam = z.object({ campaignId: z.string().uuid() });
export const assignmentIdParam = z.object({ assignmentId: z.string().uuid() });
export const userIdParam = z.object({ userId: z.string().uuid() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const loginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
  orgId: z.string().uuid().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  fullName: z.string().min(1).max(200),
  phone: z.string().max(40).optional(),
  city: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  platformRole: z.enum(['super_admin', 'user']).optional().default('user'),
  organizationId: z.string().uuid().optional(),
  orgRole: z.enum(['org_owner', 'org_admin', 'member']).optional().default('member'),
  temporaryPassword: z.string().min(8).optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  status: z.enum(['active', 'invited', 'disabled']).optional(),
  platformRole: z.enum(['super_admin', 'user']).optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  orgType: z.enum(['family', 'mosque', 'school', 'business', 'other']).default('other'),
  settings: z.record(z.unknown()).optional(),
});

export const addMembershipSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['org_owner', 'org_admin', 'member']).default('member'),
});

export const updateMembershipSchema = z.object({
  role: z.enum(['org_owner', 'org_admin', 'member']).optional(),
  status: z.enum(['active', 'invited', 'removed']).optional(),
});

const campaignTypeEnum = z.enum([
  'quran_complete',
  'quran_surahs',
  'quran_juz',
  'quran_daily',
  'ayat_kareema',
  'darood',
  'istighfar',
  'tasbeeh',
  'custom_dhikr',
]);

export const createCampaignSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  purpose: z.string().max(2000).optional(),
  deceasedName: z.string().max(200).optional(),
  category: z
    .enum(['family', 'mosque', 'organization', 'public', 'private', 'school', 'business'])
    .default('organization'),
  visibility: z.enum(['private', 'org', 'public']).default('private'),
  campaignType: campaignTypeEnum,
  targetDate: z.string().date().optional(),
  targetCount: z.number().int().positive().optional(),
  config: z.record(z.unknown()).optional(),
  dhikrText: z.string().min(1).max(500).optional(),
  dhikrTextArabic: z.string().max(500).optional(),
  allowSelfJoin: z.boolean().optional(),
  memberUserIds: z.array(z.string().uuid()).optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  purpose: z.string().max(2000).nullable().optional(),
  deceasedName: z.string().max(200).nullable().optional(),
  category: z
    .enum(['family', 'mosque', 'organization', 'public', 'private', 'school', 'business'])
    .optional(),
  visibility: z.enum(['private', 'org', 'public']).optional(),
  targetDate: z.string().date().nullable().optional(),
  targetCount: z.number().int().positive().nullable().optional(),
  config: z.record(z.unknown()).optional(),
});

export const campaignLifecycleSchema = z.object({
  status: z.enum(['draft', 'active', 'completed', 'archived']),
  version: z.number().int().positive().optional(),
});

export const campaignMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  role: z.enum(['participant', 'moderator']).default('participant'),
});

export const distributeJuzSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  juzNumbers: z.array(z.number().int().min(1).max(30)).optional(),
  persist: z.boolean().optional().default(true),
});

export const manualAssignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        userId: z.string().uuid(),
        juzNumbers: z.array(z.number().int().min(1).max(30)).min(1),
      }),
    )
    .min(1),
  replaceExisting: z.boolean().optional().default(true),
});

export const claimJuzSchema = z.object({
  juzNumber: z.number().int().min(1).max(30),
});

export const completeAssignmentSchema = z.object({
  durationSeconds: z.number().int().min(0).optional(),
  version: z.number().int().positive().optional(),
});

export const skipAssignmentSchema = z.object({
  reason: z.string().max(500).optional(),
  version: z.number().int().positive().optional(),
});

export const dhikrBatchSchema = z.object({
  clientBatchId: z.string().min(8).max(128),
  delta: z.number().int().positive().max(1000),
});
