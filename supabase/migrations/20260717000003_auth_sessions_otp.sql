-- Migration: 20260717000003_auth_sessions_otp.sql

CREATE TABLE public.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  family_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID NULL REFERENCES public.auth_sessions(id),
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent TEXT,
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER auth_sessions_set_updated_at
  BEFORE UPDATE ON public.auth_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_auth_sessions_user_active ON public.auth_sessions(user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_sessions_family ON public.auth_sessions(family_id);
CREATE INDEX idx_auth_sessions_expires ON public.auth_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE public.password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  purpose TEXT NOT NULL DEFAULT 'password_reset'
    CHECK (purpose IN ('password_reset', 'email_verify')),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_otps_user ON public.password_reset_otps(user_id, purpose)
  WHERE consumed_at IS NULL;
