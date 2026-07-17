-- Campaign visibility for participants + backfill org membership from campaign_members

-- Allow campaign participants to see campaigns they were added to,
-- even if org membership was missing at invite time.
DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT USING (
    public.is_super_admin()
    OR public.is_org_member(organization_id)
    OR visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM public.campaign_members cm
      WHERE cm.campaign_id = campaigns.id
        AND cm.user_id = public.app_user_id()
        AND cm.status = 'active'
        AND cm.deleted_at IS NULL
    )
  );

-- Backfill: any active campaign participant becomes an active org member
INSERT INTO public.organization_members (
  organization_id, user_id, role, status
)
SELECT DISTINCT
  c.organization_id,
  cm.user_id,
  'member',
  'active'
FROM public.campaign_members cm
JOIN public.campaigns c ON c.id = cm.campaign_id
WHERE cm.deleted_at IS NULL
  AND cm.status = 'active'
  AND c.deleted_at IS NULL
ON CONFLICT (organization_id, user_id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = NOW();
