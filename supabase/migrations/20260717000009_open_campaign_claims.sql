-- Allow organization members to see the Juz claim board.
-- Writes remain limited to the assignment owner or organization admins.

DROP POLICY IF EXISTS quran_assignments_select ON public.quran_assignments;

CREATE POLICY quran_assignments_select ON public.quran_assignments
  FOR SELECT USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = campaign_id
        AND (
          public.is_org_member(c.organization_id)
          OR c.visibility = 'public'
        )
    )
  );

-- Open campaigns must not auto-complete after the first claimed Juz is read.
-- They complete only after all 30 Juz have been claimed and resolved.
CREATE OR REPLACE FUNCTION public.try_complete_quran_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_assignment_mode TEXT;
  v_remaining INT;
  v_total INT;
  v_distinct_juz INT;
BEGIN
  SELECT
    status,
    COALESCE(config->>'assignmentMode', 'admin')
  INTO v_status, v_assignment_mode
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
    COUNT(*) FILTER (
      WHERE deleted_at IS NULL AND status NOT IN ('completed', 'skipped')
    ),
    COUNT(DISTINCT juz_number) FILTER (
      WHERE deleted_at IS NULL AND scope_type = 'juz' AND juz_number IS NOT NULL
    )
  INTO v_total, v_remaining, v_distinct_juz
  FROM public.quran_assignments
  WHERE campaign_id = p_campaign_id;

  IF v_total = 0 OR v_remaining > 0 THEN
    RETURN FALSE;
  END IF;

  IF v_assignment_mode = 'open' AND v_distinct_juz < 30 THEN
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
