-- Migration: 20260717000007_rls_policies.sql
-- Express is the primary authz boundary. RLS is defense-in-depth for the
-- non-BYPASSRLS barakah_app role using request-scoped set_config values.

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_otps FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.quran_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quran_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.quran_assignment_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quran_assignment_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_progress_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dhikr_campaign_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dhikr_campaign_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dhikr_member_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dhikr_member_totals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dhikr_count_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dhikr_count_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_stats FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;

-- Helper: active org membership for current user
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = p_org_id
        AND m.user_id = public.app_user_id()
        AND m.status = 'active'
        AND m.deleted_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin_of(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = p_org_id
        AND m.user_id = public.app_user_id()
        AND m.role IN ('org_owner', 'org_admin')
        AND m.status = 'active'
        AND m.deleted_at IS NULL
    )
    OR (
      public.app_org_id() = p_org_id
      AND public.app_org_role() IN ('org_owner', 'org_admin')
    );
$$;

-- Organizations
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT USING (public.is_super_admin() OR public.is_org_member(id));
CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT WITH CHECK (public.is_super_admin() OR public.app_user_id() IS NOT NULL);
CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE USING (public.is_org_admin_of(id));
CREATE POLICY organizations_delete ON public.organizations
  FOR DELETE USING (public.is_super_admin());

-- Users
CREATE POLICY users_select ON public.users
  FOR SELECT USING (
    public.is_super_admin()
    OR id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.organization_members me
      JOIN public.organization_members them
        ON them.organization_id = me.organization_id
      WHERE me.user_id = public.app_user_id()
        AND them.user_id = users.id
        AND me.status = 'active' AND them.status = 'active'
        AND me.deleted_at IS NULL AND them.deleted_at IS NULL
    )
  );
CREATE POLICY users_insert ON public.users
  FOR INSERT WITH CHECK (public.is_super_admin() OR public.is_org_admin());
CREATE POLICY users_update ON public.users
  FOR UPDATE USING (public.is_super_admin() OR id = public.app_user_id() OR public.is_org_admin());
CREATE POLICY users_delete ON public.users
  FOR DELETE USING (public.is_super_admin());

-- Organization members
CREATE POLICY org_members_select ON public.organization_members
  FOR SELECT USING (public.is_super_admin() OR public.is_org_member(organization_id) OR user_id = public.app_user_id());
CREATE POLICY org_members_insert ON public.organization_members
  FOR INSERT WITH CHECK (public.is_org_admin_of(organization_id));
CREATE POLICY org_members_update ON public.organization_members
  FOR UPDATE USING (public.is_org_admin_of(organization_id));
CREATE POLICY org_members_delete ON public.organization_members
  FOR DELETE USING (public.is_org_admin_of(organization_id));

-- Auth sessions: own rows or super_admin
CREATE POLICY auth_sessions_select ON public.auth_sessions
  FOR SELECT USING (public.is_super_admin() OR user_id = public.app_user_id());
CREATE POLICY auth_sessions_insert ON public.auth_sessions
  FOR INSERT WITH CHECK (user_id = public.app_user_id() OR public.is_super_admin() OR public.app_user_id() IS NULL);
CREATE POLICY auth_sessions_update ON public.auth_sessions
  FOR UPDATE USING (user_id = public.app_user_id() OR public.is_super_admin());
CREATE POLICY auth_sessions_delete ON public.auth_sessions
  FOR DELETE USING (public.is_super_admin() OR user_id = public.app_user_id());

-- OTP: service path typically sets identity after lookup; allow self + admin
CREATE POLICY otp_select ON public.password_reset_otps
  FOR SELECT USING (public.is_super_admin() OR user_id = public.app_user_id());
CREATE POLICY otp_insert ON public.password_reset_otps
  FOR INSERT WITH CHECK (TRUE);
CREATE POLICY otp_update ON public.password_reset_otps
  FOR UPDATE USING (public.is_super_admin() OR user_id = public.app_user_id());

-- Campaigns
CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT USING (
    public.is_super_admin()
    OR public.is_org_member(organization_id)
    OR visibility = 'public'
  );
CREATE POLICY campaigns_insert ON public.campaigns
  FOR INSERT WITH CHECK (public.is_org_admin_of(organization_id));
CREATE POLICY campaigns_update ON public.campaigns
  FOR UPDATE USING (public.is_org_admin_of(organization_id));
CREATE POLICY campaigns_delete ON public.campaigns
  FOR DELETE USING (public.is_org_admin_of(organization_id));

-- Campaign members
CREATE POLICY campaign_members_select ON public.campaign_members
  FOR SELECT USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_member(c.organization_id)
    )
  );
CREATE POLICY campaign_members_write ON public.campaign_members
  FOR ALL USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
    OR user_id = public.app_user_id()
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
    OR user_id = public.app_user_id()
  );

-- Quran assignments
CREATE POLICY quran_assignments_select ON public.quran_assignments
  FOR SELECT USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
  );
CREATE POLICY quran_assignments_write ON public.quran_assignments
  FOR ALL USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
  );

CREATE POLICY quran_segments_all ON public.quran_assignment_segments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.quran_assignments a
      WHERE a.id = assignment_id
        AND (
          public.is_super_admin()
          OR a.user_id = public.app_user_id()
          OR EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = a.campaign_id AND public.is_org_admin_of(c.organization_id)
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quran_assignments a
      WHERE a.id = assignment_id
        AND (
          public.is_super_admin()
          OR a.user_id = public.app_user_id()
          OR EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = a.campaign_id AND public.is_org_admin_of(c.organization_id)
          )
        )
    )
  );

CREATE POLICY assignment_progress_all ON public.assignment_progress_events
  FOR ALL USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.quran_assignments a
      JOIN public.campaigns c ON c.id = a.campaign_id
      WHERE a.id = assignment_id AND public.is_org_admin_of(c.organization_id)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR user_id = public.app_user_id()
  );

-- Dhikr
CREATE POLICY dhikr_config_all ON public.dhikr_campaign_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id
        AND (public.is_super_admin() OR public.is_org_member(c.organization_id) OR c.visibility = 'public')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
  );

CREATE POLICY dhikr_totals_all ON public.dhikr_member_totals
  FOR ALL USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_member(c.organization_id)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
  );

CREATE POLICY dhikr_batches_all ON public.dhikr_count_batches
  FOR ALL USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.is_org_admin_of(c.organization_id)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR user_id = public.app_user_id()
  );

CREATE POLICY campaign_stats_select ON public.campaign_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id
        AND (public.is_super_admin() OR public.is_org_member(c.organization_id) OR c.visibility = 'public')
    )
  );
CREATE POLICY campaign_stats_write ON public.campaign_stats
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND (public.is_super_admin() OR public.is_org_admin_of(c.organization_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND (public.is_super_admin() OR public.is_org_admin_of(c.organization_id))
    )
  );

-- Notifications
CREATE POLICY notifications_all ON public.notifications
  FOR ALL USING (public.is_super_admin() OR user_id = public.app_user_id())
  WITH CHECK (public.is_super_admin() OR user_id = public.app_user_id());

-- Audit: append-only for app role (insert + select for admins)
CREATE POLICY audit_select ON public.audit_logs
  FOR SELECT USING (
    public.is_super_admin()
    OR (organization_id IS NOT NULL AND public.is_org_admin_of(organization_id))
  );
CREATE POLICY audit_insert ON public.audit_logs
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY activity_select ON public.activity_logs
  FOR SELECT USING (
    public.is_super_admin()
    OR user_id = public.app_user_id()
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id))
  );
CREATE POLICY activity_insert ON public.activity_logs
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY outbox_all ON public.outbox_events
  FOR ALL USING (public.is_super_admin() OR public.app_user_id() IS NOT NULL)
  WITH CHECK (public.is_super_admin() OR public.app_user_id() IS NOT NULL);

-- Revoke direct PostgREST-style access for anon/authenticated if roles exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
  END IF;
END $$;
