alter table public.match_batches add column if not exists is_test boolean not null default false;
alter table public.meetings add column if not exists is_test boolean not null default false;

create or replace function public.enforce_weekly_matching_time()
returns trigger language plpgsql set search_path=public as $$
begin
 if not new.is_test and now()<public.weekly_confirmation_cutoff(new.week_code) then
  raise exception 'MATCHING_NOT_OPEN';
 end if;
 return new;
end $$;

drop function if exists public.save_match_draft(text,text,jsonb,boolean);
create function public.save_match_draft(
 p_week_code text,p_fingerprint text,p_result jsonb,
 p_regenerate boolean default false,p_test_mode boolean default false
) returns table(batch_id uuid,revision int,status text,generated_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_existing public.match_batches%rowtype;v_revision int;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if not p_regenerate then
  select m.* into v_existing from public.match_batches m
  where m.week_code=p_week_code and m.fingerprint=p_fingerprint
   and m.is_test=p_test_mode and m.status<>'superseded'
  order by m.revision desc limit 1;
  if found then return query select v_existing.id,v_existing.revision,v_existing.status,v_existing.generated_at;return;end if;
 end if;
 perform pg_advisory_xact_lock(hashtext(p_week_code));
 select coalesce(max(m.revision),0)+1 into v_revision from public.match_batches m where m.week_code=p_week_code;
 update public.match_batches m set status='superseded' where m.week_code=p_week_code and m.status='draft';
 insert into public.match_batches(week_code,idempotency_key,status,revision,generated_by,fingerprint,result,is_test)
 values(p_week_code,p_week_code||':'||v_revision||':'||p_fingerprint,'draft',v_revision,auth.uid(),p_fingerprint,p_result,p_test_mode)
 returning id,match_batches.revision,match_batches.status,match_batches.generated_at
 into batch_id,revision,status,generated_at;
 return next;
end $$;

create or replace function public.confirm_match_batch(p_batch_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_batch public.match_batches%rowtype;v_pair jsonb;v_meeting_id uuid;v_a uuid;v_b uuid;v_index int:=0;v_key text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 select * into v_batch from public.match_batches where id=p_batch_id for update;
 if not found then raise exception 'MATCH_BATCH_NOT_FOUND';end if;
 if v_batch.status='superseded' then raise exception 'MATCH_BATCH_SUPERSEDED';end if;
 if v_batch.status='confirmed' then return;end if;
 for v_pair in select value from jsonb_array_elements(v_batch.result->'pairs') loop
  v_index:=v_index+1;v_a:=(v_pair->>'userAId')::uuid;v_b:=(v_pair->>'userBId')::uuid;
  insert into public.meetings(batch_id,week_code,user_a_id,user_b_id,slot_id,status,score,score_explanation,last_resort,is_test)
  values(v_batch.id,v_batch.week_code,v_a,v_b,v_pair->'slot'->>'id','confirmed',coalesce((v_pair->>'score')::numeric,0),coalesce(v_pair->'explanation','[]'),coalesce((v_pair->>'lastResort')::boolean,false),v_batch.is_test)
  returning id into v_meeting_id;
  insert into public.meeting_participants(meeting_id,week_code,user_id) values(v_meeting_id,v_batch.week_code,v_a),(v_meeting_id,v_batch.week_code,v_b);
  v_key:='calendar:'||v_meeting_id;
  insert into public.outbox(kind,payload,idempotency_key) values('calendar',jsonb_build_object('meetingId',v_meeting_id,'testMode',v_batch.is_test),v_key) on conflict(idempotency_key) do nothing;
  insert into public.outbox(kind,payload,idempotency_key) values('match_whatsapp',jsonb_build_object('meetingId',v_meeting_id,'userId',v_a,'testMode',v_batch.is_test),'match-whatsapp:'||v_meeting_id||':'||v_a) on conflict(idempotency_key) do nothing;
  insert into public.outbox(kind,payload,idempotency_key) values('match_whatsapp',jsonb_build_object('meetingId',v_meeting_id,'userId',v_b,'testMode',v_batch.is_test),'match-whatsapp:'||v_meeting_id||':'||v_b) on conflict(idempotency_key) do nothing;
 end loop;
 update public.match_batches set status='confirmed',confirmed_by=auth.uid(),confirmed_at=now() where id=v_batch.id;
 insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data)
 values(auth.uid(),case when v_batch.is_test then 'test_match_batch_confirmed' else 'match_batch_confirmed' end,'match_batch',v_batch.id::text,jsonb_build_object('weekCode',v_batch.week_code,'pairCount',v_index,'testMode',v_batch.is_test));
end $$;

create or replace function public.schedule_match_notice()
returns trigger language plpgsql set search_path=public as $$
declare v_week text;
begin
 if new.kind='match_whatsapp' and not coalesce((new.payload->>'testMode')::boolean,false) then
  select week_code into v_week from public.meetings where id=(new.payload->>'meetingId')::uuid;
  new.next_attempt_at:=greatest(new.next_attempt_at,(public.week_monday(v_week)::text||' 11:00:00')::timestamp at time zone 'America/Bogota');
 end if;
 return new;
end $$;

revoke all on function public.save_match_draft(text,text,jsonb,boolean,boolean) from public,anon;
grant execute on function public.save_match_draft(text,text,jsonb,boolean,boolean) to authenticated;

comment on column public.match_batches.is_test is 'Lote integral de prueba: permite ejecución anticipada y queda excluido de operación productiva.';
comment on column public.meetings.is_test is 'Cita generada por un lote de prueba integral.';

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

create or replace function public.record_attendance_report(p_meeting_id uuid,p_reporter_id uuid,p_meeting_occurred boolean,p_self_attended boolean,p_partner_attended boolean)
returns public.meeting_status language plpgsql security definer set search_path=public as $$
declare
 v_meeting public.meetings%rowtype;v_other uuid;v_previous public.attendance_reports%rowtype;
 v_other_report public.attendance_reports%rowtype;v_version int;v_status public.meeting_status;v_prior_id uuid;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select * into v_meeting from public.meetings where id=p_meeting_id for update;
 if not found then raise exception 'MEETING_NOT_FOUND';end if;
 if p_reporter_id not in(v_meeting.user_a_id,v_meeting.user_b_id) then raise exception 'REPORTER_NOT_PARTICIPANT';end if;
 v_other:=case when p_reporter_id=v_meeting.user_a_id then v_meeting.user_b_id else v_meeting.user_a_id end;
 select * into v_previous from public.attendance_reports where meeting_id=p_meeting_id and reporter_id=p_reporter_id order by response_version desc limit 1;
 if found and v_previous.meeting_occurred is not distinct from p_meeting_occurred and v_previous.self_attended is not distinct from p_self_attended and v_previous.partner_attended is not distinct from p_partner_attended then return v_meeting.status;end if;
 v_version:=coalesce(v_previous.response_version,0)+1;
 insert into public.attendance_reports(meeting_id,reporter_id,response_version,meeting_occurred,self_attended,partner_attended) values(p_meeting_id,p_reporter_id,v_version,p_meeting_occurred,p_self_attended,p_partner_attended);
 select * into v_other_report from public.attendance_reports where meeting_id=p_meeting_id and reporter_id=v_other order by response_version desc limit 1;
 if not found then v_status:='attendance_pending';
 elsif p_meeting_occurred and p_self_attended and p_partner_attended and v_other_report.meeting_occurred and v_other_report.self_attended and v_other_report.partner_attended then v_status:='completed';
 elsif (p_self_attended and not p_partner_attended and v_other_report.self_attended=false) or (v_other_report.self_attended and not v_other_report.partner_attended and p_self_attended=false) then
  if not v_meeting.is_test then
   select m.id into v_prior_id from public.meetings m where m.id<>p_meeting_id and not m.is_test and m.status='completed' and m.created_at<v_meeting.created_at and ((m.user_a_id=v_meeting.user_a_id and m.user_b_id=v_meeting.user_b_id) or (m.user_a_id=v_meeting.user_b_id and m.user_b_id=v_meeting.user_a_id)) order by m.created_at desc limit 1;
  end if;
  if v_prior_id is not null then
   v_status:='cancelled_on_time';
   update public.meetings set cancellation_exempt=true,cancellation_exempt_reason='prior_completed_meeting',prior_completed_meeting_id=v_prior_id where id=p_meeting_id;
  else
   v_status:='no_show';
   if not v_meeting.is_test then
    insert into public.reputation_incidents(meeting_id,user_id,kind,status,idempotency_key)
    values(p_meeting_id,case when p_self_attended then v_other else p_reporter_id end,'no_show_no_notice','confirmed','attendance-no-show:'||p_meeting_id||':'||(case when p_self_attended then v_other else p_reporter_id end)) on conflict(idempotency_key) do nothing;
   end if;
  end if;
 else v_status:='attendance_disputed';end if;
 update public.meetings set status=v_status where id=p_meeting_id;
 insert into public.audit_log(action,entity_type,entity_id,after_data) values(case when v_meeting.is_test then 'test_attendance.report' else 'attendance.report' end,'meeting',p_meeting_id::text,jsonb_build_object('reporterId',p_reporter_id,'version',v_version,'status',v_status,'testMode',v_meeting.is_test,'exempt',v_prior_id is not null,'priorCompletedMeetingId',v_prior_id));
 return v_status;
end $$;
revoke all on function public.record_attendance_report(uuid,uuid,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_attendance_report(uuid,uuid,boolean,boolean,boolean) to service_role;
