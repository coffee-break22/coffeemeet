

create or replace function public.finalize_pending_attendance_reports()
returns int language plpgsql security definer set search_path=public as $$
declare v_count int:=0; v_meeting record; v_report public.attendance_reports%rowtype;
  v_status public.meeting_status; v_prior_id uuid; v_target uuid; v_deadline timestamptz;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 for v_meeting in select * from public.meetings where status='attendance_pending' and not is_test for update loop
  -- Plazo: domingo 7pm de la propia semana de la cita (mismo momento en
  -- que sale el B1 de la semana siguiente) — da unos días de margen para
  -- que conteste el otro lado antes de decidir con uno solo.
  v_deadline:=((public.week_monday(v_meeting.week_code)+6)::text||' 19:00:00')::timestamp at time zone 'America/Bogota';
  if public.app_now()<v_deadline then continue; end if;
  select * into v_report from public.attendance_reports where meeting_id=v_meeting.id order by response_version desc limit 1;
  if not found then continue; end if;
  if v_report.meeting_occurred and v_report.self_attended and v_report.partner_attended then
   v_status:='completed';
  else
   v_target:=case when v_report.self_attended then(case when v_report.reporter_id=v_meeting.user_a_id then v_meeting.user_b_id else v_meeting.user_a_id end) else v_report.reporter_id end;
   v_prior_id:=null;
   if not v_meeting.is_test then
    select m.id into v_prior_id from public.meetings m where m.id<>v_meeting.id and not m.is_test and m.status='completed' and m.created_at<v_meeting.created_at and((m.user_a_id=v_meeting.user_a_id and m.user_b_id=v_meeting.user_b_id)or(m.user_a_id=v_meeting.user_b_id and m.user_b_id=v_meeting.user_a_id)) order by m.created_at desc limit 1;
   end if;
   if v_prior_id is not null then
    v_status:='cancelled_on_time';
    update public.meetings set cancellation_exempt=true,cancellation_exempt_reason='prior_completed_meeting',prior_completed_meeting_id=v_prior_id where id=v_meeting.id;
   else
    v_status:='no_show';
    insert into public.reputation_incidents(meeting_id,user_id,kind,status,idempotency_key)
    values(v_meeting.id,v_target,'no_show_no_notice','confirmed','attendance-no-show-single:'||v_meeting.id||':'||v_target) on conflict(idempotency_key) do nothing;
   end if;
  end if;
  update public.meetings set status=v_status where id=v_meeting.id;
  insert into public.audit_log(action,entity_type,entity_id,after_data) values('attendance.report_finalized_single_side','meeting',v_meeting.id::text,jsonb_build_object('reporterId',v_report.reporter_id,'status',v_status,'deadline',v_deadline));
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.finalize_pending_attendance_reports() from public,anon,authenticated;
grant execute on function public.finalize_pending_attendance_reports() to service_role;

create or replace function public.get_admin_matching_data(p_week_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_prev_week text;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_prev_week:=to_char(public.week_monday(p_week_code)-7,'IYYY-"W"IW');
 with active as(
  select p.id,p.full_name,p.phone,p.email,p.city,p.verification_status,p.only_new_people
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
  from public.known_contacts kc join active a on a.id=kc.owner_id where kc.normalized_phone is not null group by kc.owner_id
 ),contact_emails as(
  select kc.owner_id,jsonb_agg(kc.normalized_email order by kc.normalized_email) values
  from public.known_contacts kc join active a on a.id=kc.owner_id where kc.normalized_email is not null group by kc.owner_id
 ),meeting_rows as(
  select m.user_a_id user_id,m.status,m.cancelled_by,m.cancellation_exempt from public.meetings m join active a on a.id=m.user_a_id where not m.is_test
  union all
  select m.user_b_id,m.status,m.cancelled_by,m.cancellation_exempt from public.meetings m join active a on a.id=m.user_b_id where not m.is_test
 ),meeting_stats as(
  select user_id,count(*) total,count(*)filter(where status='completed') completed,
   count(*)filter(where status='cancelled_on_time' and cancelled_by=user_id and not cancellation_exempt) noticed
  from meeting_rows group by user_id
 ),blocked as(
  select distinct ri.user_id from public.reputation_incidents ri join active a on a.id=ri.user_id
  where ri.status='confirmed' and not exists(select 1 from public.second_chances sc where sc.incident_id=ri.id)
 -- Regla 2: la pareja de la semana anterior de esta persona no se
 -- presentó (no-show confirmado a favor de esta persona) o la canceló
 -- (a tiempo o tarde) — la persona se quedó sin café por una causa
 -- ajena a ella misma, tiene prioridad esta semana.
 ),partner_issue as(
  select a.id user_id,bool_or(
   (m.status in('cancelled_on_time','late_cancellation') and m.cancelled_by is not null and m.cancelled_by<>a.id)
   or (m.status='no_show' and exists(select 1 from public.reputation_incidents ri where ri.meeting_id=m.id and ri.user_id<>a.id and ri.status='confirmed'))
  ) had_issue
  from active a join public.meetings m on(m.user_a_id=a.id or m.user_b_id=a.id) and m.week_code=v_prev_week and not m.is_test
  group by a.id
 -- Regla 4: quién perdió el empate más recientemente (quedó sin pareja
 -- por "odd_compatible_pool" en un lote YA CONFIRMADO de una semana
 -- anterior) — se calcula en semanas de antigüedad relativas a esta
 -- semana; entre más reciente (número más chico), más prioridad.
 ),tiebreak_loss as(
  select (elem->>'userId')::uuid user_id,mb.week_code,
   row_number() over(partition by(elem->>'userId')::uuid order by mb.week_code desc) rn
  from public.match_batches mb cross join lateral jsonb_array_elements(coalesce(mb.result->'unmatched','[]'::jsonb)) elem
  where mb.status='confirmed' and mb.week_code<p_week_code and(elem->>'reason')='odd_compatible_pool'
 ),tiebreak_loss_latest as(
  select user_id,(public.week_monday(p_week_code)-public.week_monday(week_code))/7 weeks_ago
  from tiebreak_loss where rn=1
 ),participant_json as(
  select jsonb_agg(jsonb_build_object(
   'id',a.id,'fullName',a.full_name,'phone',a.phone,'email',coalesce(a.email,''),'city',coalesce(a.city,''),
   'verificationStatus',a.verification_status,'blocked',b.user_id is not null,
   'slotIds',coalesce(s.values,'[]'::jsonb),'knownPhones',coalesce(c.values,'[]'::jsonb),
   'knownEmails',coalesce(ce.values,'[]'::jsonb),'onlyNewPeople',coalesce(a.only_new_people,false),
   'completedMeetingCount',coalesce(ms.completed,0),
   'noticeCancellationRate',case when coalesce(ms.total,0)=0 then 0 else coalesce(ms.noticed,0)::numeric/ms.total end,
   'hadPartnerIssueLastWeek',coalesce(pi.had_issue,false),
   'weeksSinceTiebreakLoss',tl.weeks_ago
  )order by a.id) value
  from active a left join slots s on s.user_id=a.id left join contacts c on c.owner_id=a.id
  left join contact_emails ce on ce.owner_id=a.id
  left join meeting_stats ms on ms.user_id=a.id left join blocked b on b.user_id=a.id
  left join partner_issue pi on pi.user_id=a.id left join tiebreak_loss_latest tl on tl.user_id=a.id
 ),history_json as(
  select jsonb_agg(jsonb_build_object('userAId',m.user_a_id,'userBId',m.user_b_id,'completedAt',m.created_at)order by m.created_at) value
  from public.meetings m join active a on a.id=m.user_a_id join active b on b.id=m.user_b_id
  where m.status='completed' and not m.is_test
 ),batch_json as(
  select jsonb_agg(jsonb_build_object('id',x.id,'weekCode',x.week_code,'revision',x.revision,'fingerprint',coalesce(x.fingerprint,''),'status',x.status,'result',x.result,'generatedAt',x.generated_at,'confirmedAt',x.confirmed_at,'isTest',x.is_test)order by x.revision) value
  from public.match_batches x where x.week_code=p_week_code
 )
 select jsonb_build_object('participants',coalesce(p.value,'[]'::jsonb),'history',coalesce(h.value,'[]'::jsonb),'batches',coalesce(b.value,'[]'::jsonb))
 into v_result from participant_json p cross join history_json h cross join batch_json b;
 return v_result;
end $$;
revoke all on function public.get_admin_matching_data(text) from public,anon;
grant execute on function public.get_admin_matching_data(text) to authenticated;
