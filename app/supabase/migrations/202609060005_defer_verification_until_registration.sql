create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $cm$
begin
  insert into public.profiles(
    id,full_name,email,normalized_email,calendar_email,verification_status
  ) values(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.email,''),
    lower(trim(coalesce(new.email,''))),
    coalesce(new.email,''),
    'pending'
  ) on conflict(id) do nothing;
  return new;
end $cm$;

delete from public.verification_requests request
using public.profiles profile
where request.user_id=profile.id
  and request.status='pending'
  and request.decided_at is null
  and (
    nullif(trim(profile.phone),'') is null
    or profile.school is null
    or profile.graduation_year is null
    or nullif(trim(profile.city),'') is null
  );

revoke all on function public.handle_new_auth_user() from public,anon,authenticated;
