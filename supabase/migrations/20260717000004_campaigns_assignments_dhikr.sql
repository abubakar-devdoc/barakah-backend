-- Migration: 20260717000004_campaigns_assignments_dhikr.sql

CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  purpose TEXT,
  deceased_name TEXT,
  category TEXT NOT NULL DEFAULT 'organization'
    CHECK (category IN ('family', 'mosque', 'organization', 'public', 'private', 'school', 'business')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'org', 'public')),
  campaign_type TEXT NOT NULL
    CHECK (campaign_type IN (
      'quran_complete', 'quran_surahs', 'quran_juz', 'quran_daily',
      'ayat_kareema', 'darood', 'istighfar', 'tasbeeh', 'custom_dhikr'
    )),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  target_date DATE,
  target_count BIGINT CHECK (target_count IS NULL OR target_count > 0),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TRIGGER campaigns_set_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_campaigns_org_status ON public.campaigns(organization_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_campaigns_type ON public.campaigns(campaign_type)
  WHERE deleted_at IS NULL;

CREATE TABLE public.campaign_members (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  role TEXT NOT NULL DEFAULT 'participant'
    CHECK (role IN ('participant', 'moderator')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'left')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TRIGGER campaign_members_set_updated_at
  BEFORE UPDATE ON public.campaign_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_campaign_members_user ON public.campaign_members(user_id)
  WHERE deleted_at IS NULL AND status = 'active';

-- Quran assignments
CREATE TABLE public.quran_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('juz', 'surah', 'ayah_range', 'full_quran')),
  juz_number INT CHECK (juz_number IS NULL OR (juz_number BETWEEN 1 AND 30)),
  surah_number INT CHECK (surah_number IS NULL OR (surah_number BETWEEN 1 AND 114)),
  ayah_start INT CHECK (ayah_start IS NULL OR ayah_start > 0),
  ayah_end INT CHECK (ayah_end IS NULL OR ayah_end > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'started', 'completed', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (progress_pct >= 0 AND progress_pct <= 100),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  notes TEXT,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT quran_assignments_range_check CHECK (
    ayah_end IS NULL OR ayah_start IS NULL OR ayah_end >= ayah_start
  )
);

CREATE TRIGGER quran_assignments_set_updated_at
  BEFORE UPDATE ON public.quran_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX uq_quran_assignments_juz
  ON public.quran_assignments(campaign_id, juz_number)
  WHERE deleted_at IS NULL AND scope_type = 'juz' AND juz_number IS NOT NULL;

CREATE INDEX idx_quran_assignments_campaign_status
  ON public.quran_assignments(campaign_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_quran_assignments_user
  ON public.quran_assignments(user_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE public.quran_assignment_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.quran_assignments(id) ON DELETE CASCADE,
  segment_order INT NOT NULL CHECK (segment_order >= 1),
  surah_number INT NOT NULL CHECK (surah_number BETWEEN 1 AND 114),
  ayah_start INT NOT NULL CHECK (ayah_start > 0),
  ayah_end INT NOT NULL CHECK (ayah_end >= ayah_start),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'started', 'completed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, segment_order)
);

CREATE TRIGGER quran_assignment_segments_set_updated_at
  BEFORE UPDATE ON public.quran_assignment_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.assignment_progress_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.quran_assignments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignment_progress_events_assignment
  ON public.assignment_progress_events(assignment_id, created_at DESC);

-- Dhikr
CREATE TABLE public.dhikr_campaign_config (
  campaign_id UUID PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  dhikr_text TEXT NOT NULL,
  dhikr_text_arabic TEXT,
  allow_self_join BOOLEAN NOT NULL DEFAULT FALSE,
  batch_auto_save_every INT NOT NULL DEFAULT 100 CHECK (batch_auto_save_every > 0),
  max_batch_delta INT NOT NULL DEFAULT 1000 CHECK (max_batch_delta > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER dhikr_campaign_config_set_updated_at
  BEFORE UPDATE ON public.dhikr_campaign_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.dhikr_member_totals (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  count BIGINT NOT NULL DEFAULT 0 CHECK (count >= 0),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX idx_dhikr_member_totals_campaign_count
  ON public.dhikr_member_totals(campaign_id, count DESC);

CREATE TABLE public.dhikr_count_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  client_batch_id TEXT NOT NULL,
  delta BIGINT NOT NULL CHECK (delta > 0),
  applied BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, user_id, client_batch_id)
);

CREATE INDEX idx_dhikr_count_batches_campaign
  ON public.dhikr_count_batches(campaign_id, created_at DESC);

-- Denormalized campaign stats
CREATE TABLE public.campaign_stats (
  campaign_id UUID PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  assigned_count INT NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
  completed_count INT NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  pending_count INT NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  started_count INT NOT NULL DEFAULT 0 CHECK (started_count >= 0),
  skipped_count INT NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  dhikr_total BIGINT NOT NULL DEFAULT 0 CHECK (dhikr_total >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
