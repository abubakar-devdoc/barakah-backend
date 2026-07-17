-- Migration: 20260717000006_views_functions.sql

CREATE OR REPLACE VIEW public.v_campaign_progress AS
SELECT
  c.id AS campaign_id,
  c.organization_id,
  c.name,
  c.campaign_type,
  c.status,
  c.target_count,
  c.target_date,
  COALESCE(s.assigned_count, 0) AS assigned_count,
  COALESCE(s.completed_count, 0) AS completed_count,
  COALESCE(s.pending_count, 0) AS pending_count,
  COALESCE(s.started_count, 0) AS started_count,
  COALESCE(s.skipped_count, 0) AS skipped_count,
  COALESCE(s.dhikr_total, 0) AS dhikr_total,
  CASE
    WHEN c.campaign_type LIKE 'quran_%' AND COALESCE(s.assigned_count, 0) > 0
      THEN ROUND((COALESCE(s.completed_count, 0)::numeric / s.assigned_count) * 100, 2)
    WHEN c.target_count IS NOT NULL AND c.target_count > 0
      THEN ROUND((LEAST(COALESCE(s.dhikr_total, 0), c.target_count)::numeric / c.target_count) * 100, 2)
    ELSE 0
  END AS progress_pct,
  s.updated_at AS stats_updated_at
FROM public.campaigns c
LEFT JOIN public.campaign_stats s ON s.campaign_id = c.id
WHERE c.deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.recompute_campaign_assignment_stats(p_campaign_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_assigned INT;
  v_completed INT;
  v_pending INT;
  v_started INT;
  v_skipped INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE deleted_at IS NULL),
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'completed'),
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'pending'),
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'started'),
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'skipped')
  INTO v_assigned, v_completed, v_pending, v_started, v_skipped
  FROM public.quran_assignments
  WHERE campaign_id = p_campaign_id;

  INSERT INTO public.campaign_stats AS cs (
    campaign_id, assigned_count, completed_count, pending_count, started_count, skipped_count, updated_at
  ) VALUES (
    p_campaign_id, v_assigned, v_completed, v_pending, v_started, v_skipped, NOW()
  )
  ON CONFLICT (campaign_id) DO UPDATE SET
    assigned_count = EXCLUDED.assigned_count,
    completed_count = EXCLUDED.completed_count,
    pending_count = EXCLUDED.pending_count,
    started_count = EXCLUDED.started_count,
    skipped_count = EXCLUDED.skipped_count,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.try_complete_quran_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_remaining INT;
  v_total INT;
BEGIN
  SELECT status INTO v_status
  FROM public.campaigns
  WHERE id = p_campaign_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'active' THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = p_campaign_id AND campaign_type LIKE 'quran_%'
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE deleted_at IS NULL),
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status NOT IN ('completed', 'skipped'))
  INTO v_total, v_remaining
  FROM public.quran_assignments
  WHERE campaign_id = p_campaign_id;

  IF v_total = 0 OR v_remaining > 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.campaigns
  SET status = 'completed',
      completed_at = NOW(),
      version = version + 1,
      updated_at = NOW()
  WHERE id = p_campaign_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

-- Idempotent dhikr batch: inserts batch once, then bumps totals only when newly inserted.
CREATE OR REPLACE FUNCTION public.apply_dhikr_batch(
  p_campaign_id UUID,
  p_user_id UUID,
  p_client_batch_id TEXT,
  p_delta BIGINT
)
RETURNS TABLE (
  personal_count BIGINT,
  global_count BIGINT,
  applied BOOLEAN,
  campaign_completed BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_target BIGINT;
  v_max_delta INT;
  v_batch_id UUID;
  v_applied BOOLEAN := FALSE;
  v_personal BIGINT;
  v_global BIGINT;
  v_completed BOOLEAN := FALSE;
BEGIN
  SELECT c.status, c.target_count
  INTO v_status, v_target
  FROM public.campaigns c
  WHERE c.id = p_campaign_id AND c.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'campaign_not_active' USING ERRCODE = 'P0001';
  END IF;

  SELECT max_batch_delta INTO v_max_delta
  FROM public.dhikr_campaign_config
  WHERE campaign_id = p_campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dhikr_config_missing' USING ERRCODE = 'P0002';
  END IF;

  IF p_delta IS NULL OR p_delta <= 0 OR p_delta > v_max_delta THEN
    RAISE EXCEPTION 'invalid_delta' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.dhikr_count_batches (campaign_id, user_id, client_batch_id, delta)
  VALUES (p_campaign_id, p_user_id, p_client_batch_id, p_delta)
  ON CONFLICT (campaign_id, user_id, client_batch_id) DO NOTHING
  RETURNING id INTO v_batch_id;

  IF v_batch_id IS NOT NULL THEN
    v_applied := TRUE;

    INSERT INTO public.dhikr_member_totals (campaign_id, user_id, count, version, updated_at)
    VALUES (p_campaign_id, p_user_id, p_delta, 1, NOW())
    ON CONFLICT (campaign_id, user_id) DO UPDATE
      SET count = public.dhikr_member_totals.count + EXCLUDED.count,
          version = public.dhikr_member_totals.version + 1,
          updated_at = NOW();

    INSERT INTO public.campaign_stats (campaign_id, dhikr_total, updated_at)
    VALUES (p_campaign_id, p_delta, NOW())
    ON CONFLICT (campaign_id) DO UPDATE
      SET dhikr_total = public.campaign_stats.dhikr_total + EXCLUDED.dhikr_total,
          updated_at = NOW();
  END IF;

  SELECT COALESCE(count, 0) INTO v_personal
  FROM public.dhikr_member_totals
  WHERE campaign_id = p_campaign_id AND user_id = p_user_id;

  SELECT COALESCE(dhikr_total, 0) INTO v_global
  FROM public.campaign_stats
  WHERE campaign_id = p_campaign_id;

  v_personal := COALESCE(v_personal, 0);
  v_global := COALESCE(v_global, 0);

  IF v_status = 'active' AND v_target IS NOT NULL AND v_global >= v_target THEN
    UPDATE public.campaigns
    SET status = 'completed',
        completed_at = NOW(),
        version = version + 1,
        updated_at = NOW()
    WHERE id = p_campaign_id AND status = 'active';
    v_completed := FOUND;
  END IF;

  personal_count := v_personal;
  global_count := v_global;
  applied := v_applied;
  campaign_completed := v_completed;
  RETURN NEXT;
END;
$$;
