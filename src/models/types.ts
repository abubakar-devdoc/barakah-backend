export type PlatformRole = 'super_admin' | 'user';
export type OrgRole = 'org_owner' | 'org_admin' | 'member';
export type UserStatus = 'active' | 'invited' | 'disabled';

export type CampaignType =
  | 'quran_complete'
  | 'quran_surahs'
  | 'quran_juz'
  | 'quran_daily'
  | 'ayat_kareema'
  | 'darood'
  | 'istighfar'
  | 'tasbeeh'
  | 'custom_dhikr';

export type CampaignStatus = 'draft' | 'active' | 'completed' | 'archived';
export type AssignmentStatus = 'pending' | 'started' | 'completed' | 'skipped';
export type AssignmentScope = 'juz' | 'surah' | 'ayah_range' | 'full_quran';

export interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  password_hash: string;
  full_name: string;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  platform_role: PlatformRole;
  status: UserStatus;
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  org_type: string;
  settings: Record<string, unknown>;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface OrganizationMemberRow {
  organization_id: string;
  user_id: string;
  role: OrgRole;
  status: string;
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AuthSessionRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  remember_me: boolean;
  user_agent: string | null;
  ip: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CampaignRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  deceased_name: string | null;
  category: string;
  visibility: string;
  campaign_type: CampaignType;
  status: CampaignStatus;
  target_date: string | null;
  target_count: string | null;
  config: Record<string, unknown>;
  version: number;
  completed_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface QuranAssignmentRow {
  id: string;
  campaign_id: string;
  user_id: string;
  scope_type: AssignmentScope;
  juz_number: number | null;
  surah_number: number | null;
  ayah_start: number | null;
  ayah_end: number | null;
  status: AssignmentStatus;
  started_at: Date | null;
  completed_at: Date | null;
  duration_seconds: number | null;
  progress_pct: string;
  version: number;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CampaignStatsRow {
  campaign_id: string;
  assigned_count: number;
  completed_count: number;
  pending_count: number;
  started_count: number;
  skipped_count: number;
  dhikr_total: string;
  updated_at: Date;
}

export interface AccessTokenClaims {
  sub: string;
  platform_role: PlatformRole;
  org_id?: string;
  org_role?: OrgRole;
  must_change_password?: boolean;
  jti: string;
}

export interface AuthContext {
  userId: string;
  platformRole: PlatformRole;
  orgId?: string;
  orgRole?: OrgRole;
  mustChangePassword: boolean;
  jti: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}
