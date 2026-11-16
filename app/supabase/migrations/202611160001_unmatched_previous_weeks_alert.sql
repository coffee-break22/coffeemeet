create or replace function public.get_admin_unmatched_previous_weeks(p_current_week text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 select coalesce(
  jsonb_agg(jsonb_build_object('weekCode',week_code,'confirmedCount',confirmed_count) order by week_code desc),
  '[]'::jsonb
 ) into v_result
 from (
  select wp.week_code,count(*) confirmed_count
  from public.weekly_participations wp
  join public.profiles p on p.id=wp.user_id
  left join public.admin_users a on a.user_id=p.id
  where a.user_id is null and wp.status='confirmed' and wp.week_code<p_current_week
   and not exists(
    select 1 from public.meetings m
    where m.week_code=wp.week_code and m.status<>'draft' and wp.user_id in(m.user_a_id,m.user_b_id)
   )
  group by wp.week_code
 ) counted;
 return v_result;
end $$;
revoke all on function public.get_admin_unmatched_previous_weeks(text) from public,anon;
grant execute on function public.get_admin_unmatched_previous_weeks(text) to authenticated;
