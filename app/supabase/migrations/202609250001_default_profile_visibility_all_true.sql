alter table public.profiles
  alter column profile_visibility set default '{"email":true,"phone":true,"linkedin":true}'::jsonb;
