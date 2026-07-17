-- Migration: 20260717000010_auth_preauth_helpers.sql
-- Login/refresh run before request identity is known. RLS would hide users
-- and sessions from barakah_app, so auth uses narrow SECURITY DEFINER helpers.

CREATE OR REPLACE FUNCTION public.auth_find_user_by_email(p_email TEXT)
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.users
  WHERE email = lower(trim(p_email))::citext
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_find_user_by_id(p_user_id UUID)
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.users
  WHERE id = p_user_id
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_find_session_by_token_hash(p_token_hash TEXT)
RETURNS SETOF public.auth_sessions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.auth_sessions
  WHERE token_hash = p_token_hash
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_find_user_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_find_user_by_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_find_session_by_token_hash(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auth_find_user_by_email(TEXT) TO barakah_app;
GRANT EXECUTE ON FUNCTION public.auth_find_user_by_id(UUID) TO barakah_app;
GRANT EXECUTE ON FUNCTION public.auth_find_session_by_token_hash(TEXT) TO barakah_app;
