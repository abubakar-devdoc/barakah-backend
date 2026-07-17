-- Dhikr campaigns are collective counting: org members can self-join by default.

ALTER TABLE public.dhikr_campaign_config
  ALTER COLUMN allow_self_join SET DEFAULT TRUE;

UPDATE public.dhikr_campaign_config
SET allow_self_join = TRUE,
    updated_at = NOW()
WHERE allow_self_join IS DISTINCT FROM TRUE;
