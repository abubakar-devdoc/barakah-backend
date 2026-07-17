-- Fix infinite RLS recursion: campaigns_select ↔ campaign_members_select

CREATE OR REPLACE FUNCTION public.is_campaign_member(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.campaign_members cm
      WHERE cm.campaign_id = p_campaign_id
        AND cm.user_id = public.app_user_id()
        AND cm.status = 'active'
        AND cm.deleted_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.is_campaign_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_campaign_member(UUID) TO barakah_app;

DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT USING (
    public.is_super_admin()
    OR public.is_org_member(organization_id)
    OR visibility = 'public'
    OR public.is_campaign_member(id)
  );
