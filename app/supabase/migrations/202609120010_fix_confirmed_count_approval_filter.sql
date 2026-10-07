create or replace function public.get_admin_participant_counts(p_week_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 select jsonb_build_object(
  'registered',count(*)filter(where a.user_id is null),
  'approved',count(*)filter(where a.user_id is null and p.verification_status='approved'),
  'confirmed',count(*)filter(where a.user_id is null and p.verification_status='approved' and wp.status='confirmed'),
  'eligible',count(*)filter(where a.user_id is null and p.verification_status='approved' and wp.status='confirmed' and exists(
    select 1 from public.weekly_availabilities wa where wa.user_id=p.id and wa.week_code=p_week_code and wa.is_active
  ))
 ) into v_result
 from public.profiles p
 left join public.admin_users a on a.user_id=p.id
 left join public.weekly_participations wp on wp.user_id=p.id and wp.week_code=p_week_code;
 return v_result;
end $$;
revoke all on function public.get_admin_participant_counts(text) from public,anon;
grant execute on function public.get_admin_participant_counts(text) to authenticated;
