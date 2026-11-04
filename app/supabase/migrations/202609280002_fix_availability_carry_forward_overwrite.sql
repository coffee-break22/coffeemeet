
create or replace function public.prepare_weekly_confirmations(p_week_code text) returns int language plpgsql security definer set search_path=public as $$
declare v_count int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 with latest as(select p.id user_id,(select max(w.week_code) from public.weekly_availabilities w where w.user_id=p.id and w.week_code<p_week_code and w.is_active) source_week from public.profiles p where p.verification_status='approved' and p.dormant_since is null and not exists(select 1 from public.admin_users a where a.user_id=p.id)),eligible as(select * from latest where source_week is not null)
 insert into public.weekly_participations(user_id,week_code,status) select user_id,p_week_code,'pending' from eligible on conflict do nothing;
 with source as(
  select wp.user_id,(select max(w.week_code) from public.weekly_availabilities w where w.user_id=wp.user_id and w.week_code<p_week_code and w.is_active) source_week
  from public.weekly_participations wp
  where wp.week_code=p_week_code
   and not exists(select 1 from public.weekly_availabilities x where x.user_id=wp.user_id and x.week_code=p_week_code)
 )
 insert into public.weekly_availabilities(user_id,week_code,slot_id,is_active)
 select s.user_id,p_week_code,public.shift_weekly_slot(w.slot_id,s.source_week,p_week_code),true from source s join public.weekly_availabilities w on w.user_id=s.user_id and w.week_code=s.source_week and w.is_active
 on conflict(user_id,week_code,slot_id) do nothing;
 get diagnostics v_count=row_count;return v_count;
end $$;
