
create or replace function public.get_admin_overview(p_week_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_prev_week text; v_cutoff timestamptz; v_config_monday date;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_prev_week:=to_char(public.week_monday(p_week_code)-7,'IYYY-"W"IW');
 v_cutoff:=public.weekly_confirmation_cutoff(v_prev_week);
 v_config_monday:=public.week_monday(p_week_code);
 with eligible_prev as(
  select p.id user_id
  from public.profiles p
   left join public.admin_users a on a.user_id=p.id
   join public.verification_requests r on r.user_id=p.id and r.status='approved'
  where a.user_id is null and p.verification_status='approved' and r.decided_at<=v_cutoff
 ),week_status as(
  select e.user_id,coalesce(wp.status,'pending') status
  from eligible_prev e
   left join public.weekly_participations wp on wp.user_id=e.user_id and wp.week_code=v_prev_week
 ),confirmed_prev as(
  select count(*)filter(where status='confirmed') confirmed,
   count(*)filter(where status='withdrawn') withdrawn,
   count(*)filter(where status='pending') not_confirmed
  from week_status
 ),meetings_prev as(
  select count(*) pairs,count(*)filter(where m.last_resort) repeats
  from public.meetings m where m.week_code=v_prev_week and m.status<>'draft'
 ),ever_pairs as(
  select count(distinct least(m.user_a_id::text,m.user_b_id::text)||':'||greatest(m.user_a_id::text,m.user_b_id::text)) n
  from public.meetings m
  where m.status='completed'
   and m.user_a_id in(select user_id from week_status where status='confirmed')
   and m.user_b_id in(select user_id from week_status where status='confirmed')
 ),repeat_history as(
  select count(*) total_meetings,count(*)filter(where m.last_resort) repeat_meetings
  from public.meetings m where m.status='completed'
 ),approved_profiles as(
  select p.id,p.normalized_email,p.normalized_phone
  from public.profiles p left join public.admin_users a on a.user_id=p.id
  where a.user_id is null and p.verification_status='approved'
 ),approved_in_directory as(
  select count(*) n from approved_profiles ap where
   exists(select 1 from public.verification_requests vr where vr.user_id=ap.id and vr.registry_id is not null)
   or(ap.normalized_email is not null and ap.normalized_email<>'' and exists(select 1 from public.alumni_registry r where r.normalized_email=ap.normalized_email))
   or(ap.normalized_phone is not null and ap.normalized_phone<>'' and exists(select 1 from public.alumni_registry r where r.normalized_phone=ap.normalized_phone))
 ),numbers as(
  select
   (select count(*) from approved_profiles) approved,
   (select count(*) from public.verification_requests r left join public.admin_users a on a.user_id=r.user_id where a.user_id is null and r.status='pending') pending,
   (select count(*) from public.profiles p left join public.admin_users a on a.user_id=p.id where a.user_id is null and p.verification_status='rejected') rejected,
   (select count(*) from public.alumni_registry where active) community_members,
   (select n from approved_in_directory) approved_in_directory,
   (select count(*) from eligible_prev) registered_at_cutoff,
   (select confirmed from confirmed_prev) confirmed_prev,
   (select withdrawn from confirmed_prev) withdrawn_prev,
   (select not_confirmed from confirmed_prev) not_confirmed_prev,
   (select pairs from meetings_prev) pairs_prev,
   (select repeats from meetings_prev) repeats_prev,
   (select n from ever_pairs) ever_pairs,
   (select total_meetings from repeat_history) total_meetings_ever,
   (select repeat_meetings from repeat_history) repeat_meetings_ever
 )
 select jsonb_build_object(
  'approved',n.approved,'pending',n.pending,'rejected',n.rejected,
  'communityMembers',n.community_members,
  'approvedInDirectory',least(n.approved_in_directory,n.community_members),
  'approvedBeyondDirectory',greatest(0,n.approved-n.approved_in_directory),
  'previousWeekCode',v_prev_week,
  'previousWeekMonday',public.week_monday(v_prev_week),
  'configuredWeekStart',v_config_monday,'configuredWeekEnd',v_config_monday+6,
  'registeredAtCutoff',n.registered_at_cutoff,
  'confirmedLastWeek',jsonb_build_object('confirmed',n.confirmed_prev,'notConfirmed',n.not_confirmed_prev,'withdrawn',n.withdrawn_prev,'registeredAtCutoff',n.registered_at_cutoff),
  'meetingsLastWeek',jsonb_build_object('pairs',n.pairs_prev,'people',n.pairs_prev*2,'confirmedParticipants',n.confirmed_prev),
  'sustainability',case when n.confirmed_prev<2 then null else jsonb_build_object(
   'confirmedParticipants',n.confirmed_prev,
   'possiblePairs',n.confirmed_prev*(n.confirmed_prev-1)/2,
   'completedPairs',n.ever_pairs,
   'newPairsRemaining',greatest(0,n.confirmed_prev*(n.confirmed_prev-1)/2-n.ever_pairs),
   'totalMeetingsEver',n.total_meetings_ever,
   'repeatMeetingsEver',n.repeat_meetings_ever,
   'repeatRatePct',case when n.total_meetings_ever>0 then round(n.repeat_meetings_ever*100.0/n.total_meetings_ever) else 0 end,
   'lastWeekPairs',n.pairs_prev,
   'lastWeekRepeats',n.repeats_prev
  )end
 ) into v_result from numbers n;
 return v_result;
end $$;
