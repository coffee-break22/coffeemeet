create or replace function public.get_admin_matching_data(p_week_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 with active as(
  select p.id,p.full_name,p.phone,p.city,p.verification_status
  from public.profiles p join public.weekly_participations wp on wp.user_id=p.id
  left join public.admin_users ad on ad.user_id=p.id
  where wp.week_code=p_week_code and wp.status='confirmed' and p.verification_status='approved'
   and ad.user_id is null and exists(select 1 from public.weekly_availabilities wa where wa.user_id=p.id and wa.week_code=p_week_code and wa.is_active)
 ),slots as(
  select wa.user_id,jsonb_agg(wa.slot_id order by wa.slot_id) values
  from public.weekly_availabilities wa join active a on a.id=wa.user_id
  where wa.week_code=p_week_code and wa.is_active group by wa.user_id
 ),contacts as(
  select kc.owner_id,jsonb_agg(kc.normalized_phone order by kc.normalized_phone) values
  from public.known_contacts kc join active a on a.id=kc.owner_id group by kc.owner_id
 ),meeting_rows as(
  select m.user_a_id user_id,m.status,m.cancelled_by,m.cancellation_exempt from public.meetings m join active a on a.id=m.user_a_id
  union all
  select m.user_b_id,m.status,m.cancelled_by,m.cancellation_exempt from public.meetings m join active a on a.id=m.user_b_id
 ),meeting_stats as(
  select user_id,count(*) total,count(*)filter(where status='completed') completed,
   count(*)filter(where status='cancelled_on_time' and cancelled_by=user_id and not cancellation_exempt) noticed
  from meeting_rows group by user_id
 ),blocked as(
  select distinct ri.user_id from public.reputation_incidents ri join active a on a.id=ri.user_id
  where ri.status='confirmed' and not exists(select 1 from public.second_chances sc where sc.incident_id=ri.id)
 ),participant_json as(
  select jsonb_agg(jsonb_build_object(
   'id',a.id,'fullName',a.full_name,'phone',a.phone,'city',coalesce(a.city,''),
   'verificationStatus',a.verification_status,'blocked',b.user_id is not null,
   'slotIds',coalesce(s.values,'[]'::jsonb),'knownPhones',coalesce(c.values,'[]'::jsonb),
   'completedMeetingCount',coalesce(ms.completed,0),
   'noticeCancellationRate',case when coalesce(ms.total,0)=0 then 0 else coalesce(ms.noticed,0)::numeric/ms.total end
  )order by a.id) value
  from active a left join slots s on s.user_id=a.id left join contacts c on c.owner_id=a.id
  left join meeting_stats ms on ms.user_id=a.id left join blocked b on b.user_id=a.id
 ),history_json as(
  select jsonb_agg(jsonb_build_object('userAId',m.user_a_id,'userBId',m.user_b_id,'completedAt',m.created_at)order by m.created_at) value
  from public.meetings m join active a on a.id=m.user_a_id join active b on b.id=m.user_b_id where m.status='completed'
 ),batch_json as(
  select jsonb_agg(jsonb_build_object('id',x.id,'weekCode',x.week_code,'revision',x.revision,'fingerprint',coalesce(x.fingerprint,''),'status',x.status,'result',x.result,'generatedAt',x.generated_at,'confirmedAt',x.confirmed_at)order by x.revision) value
  from public.match_batches x where x.week_code=p_week_code
 )
 select jsonb_build_object('participants',coalesce(p.value,'[]'::jsonb),'history',coalesce(h.value,'[]'::jsonb),'batches',coalesce(b.value,'[]'::jsonb))
 into v_result from participant_json p cross join history_json h cross join batch_json b;
 return v_result;
end $$;

revoke all on function public.get_admin_matching_data(text) from public,anon;
grant execute on function public.get_admin_matching_data(text) to authenticated;
