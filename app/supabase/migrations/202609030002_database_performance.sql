create index if not exists profiles_verification_status_idx on public.profiles(verification_status,id);
create index if not exists verification_requests_status_updated_idx on public.verification_requests(status,updated_at desc);
create index if not exists weekly_participations_week_status_user_idx on public.weekly_participations(week_code,status,user_id);
create index if not exists weekly_availabilities_week_active_user_idx on public.weekly_availabilities(week_code,is_active,user_id);
create index if not exists meetings_week_status_idx on public.meetings(week_code,status);
create index if not exists meetings_user_a_status_created_idx on public.meetings(user_a_id,status,created_at desc);
create index if not exists meetings_user_b_status_created_idx on public.meetings(user_b_id,status,created_at desc);
create index if not exists reputation_incidents_user_status_idx on public.reputation_incidents(user_id,status);
create index if not exists second_chances_incident_idx on public.second_chances(incident_id);
create index if not exists survey_sessions_user_step_updated_idx on public.survey_sessions(user_id,step,updated_at desc);
create index if not exists match_batches_week_revision_idx on public.match_batches(week_code,revision desc);

create or replace function public.get_admin_overview(p_week_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 with active as(
  select distinct wp.user_id from public.weekly_participations wp
  join public.profiles p on p.id=wp.user_id and p.verification_status='approved'
  left join public.admin_users a on a.user_id=wp.user_id
  where wp.week_code=p_week_code and wp.status='confirmed' and a.user_id is null
 ),seen as(
  select distinct least(m.user_a_id::text,m.user_b_id::text)||':'||greatest(m.user_a_id::text,m.user_b_id::text) pair_key
  from public.meetings m join active a on a.user_id=m.user_a_id join active b on b.user_id=m.user_b_id
  where m.status='completed'
 ),latest as(
  select mb.status::text status,mb.revision,coalesce(jsonb_array_length(mb.result->'pairs'),0) pairs
  from public.match_batches mb where mb.week_code=p_week_code order by mb.revision desc limit 1
 ),numbers as(
  select
   (select count(*) from public.profiles p left join public.admin_users a on a.user_id=p.id where a.user_id is null and p.verification_status='approved') approved,
   (select count(*) from public.verification_requests r left join public.admin_users a on a.user_id=r.user_id where a.user_id is null and r.status='pending') pending,
   (select count(*) from public.profiles p left join public.admin_users a on a.user_id=p.id where a.user_id is null and p.verification_status='rejected') rejected,
   (select count(*) from active) active_count,
   (select count(*) from public.meetings m where m.week_code=p_week_code and m.status<>'draft') meetings_count,
   (select count(*) from seen) completed_pairs
 )
 select jsonb_build_object(
  'approved',n.approved,'pending',n.pending,'rejected',n.rejected,
  'activeParticipants',n.active_count,'meetings',n.meetings_count,
  'draftPairs',coalesce(l.pairs,0),'latestBatchStatus',coalesce(l.status,'Sin lote'),
  'latestRevision',l.revision,
  'sustainability',case when n.active_count<2 then null else jsonb_build_object(
   'activeAlumni',n.active_count,
   'possiblePairs',n.active_count*(n.active_count-1)/2,
   'completedPairs',n.completed_pairs,
   'newPairsRemaining',greatest(0,n.active_count*(n.active_count-1)/2-n.completed_pairs),
   'weeksLow',ceil(greatest(0,n.active_count*(n.active_count-1)/2-n.completed_pairs)/(n.active_count*0.4)),
   'weeksHigh',ceil(greatest(0,n.active_count*(n.active_count-1)/2-n.completed_pairs)/(n.active_count*0.25))
  )end
 ) into v_result from numbers n left join latest l on true;
 return v_result;
end $$;

revoke all on function public.get_admin_overview(text) from public,anon;
grant execute on function public.get_admin_overview(text) to authenticated;
