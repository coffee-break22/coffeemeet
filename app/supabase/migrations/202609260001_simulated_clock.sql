
create table if not exists public.system_clock(
 key text primary key default 'current',
 enabled boolean not null default false,
 simulated_at timestamptz,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
insert into public.system_clock(key,enabled) values('current',false) on conflict(key) do nothing;
alter table public.system_clock enable row level security;

create or replace function public.app_now() returns timestamptz
language sql stable security definer set search_path=public as $$
 select case when enabled and simulated_at is not null then simulated_at else now() end
 from public.system_clock where key='current'
$$;

create or replace function public.admin_set_simulated_clock(p_enabled boolean,p_at timestamptz default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_enabled and p_at is null then raise exception 'SIMULATED_AT_REQUIRED';end if;
 update public.system_clock set enabled=p_enabled,simulated_at=p_at,updated_at=now(),updated_by=auth.uid() where key='current';
end $$;

create or replace function public.admin_get_simulated_clock()
returns table(enabled boolean,simulated_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' and not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 return query select c.enabled,c.simulated_at,c.updated_at from public.system_clock c where c.key='current';
end $$;

revoke all on function public.admin_set_simulated_clock(boolean,timestamptz),public.admin_get_simulated_clock() from public,anon;
grant execute on function public.admin_set_simulated_clock(boolean,timestamptz),public.admin_get_simulated_clock() to authenticated,service_role;


create or replace function public.confirm_weekly_participation(p_week_code text,p_user_id uuid default null) returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=coalesce(p_user_id,auth.uid());v_service boolean:=current_setting('request.jwt.claim.role',true)='service_role';
begin
 if not v_service and (auth.uid() is null or v_user<>auth.uid()) then raise exception 'FORBIDDEN';end if;
 if public.app_now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;
 if not exists(select 1 from public.profiles where id=v_user and verification_status='approved') then raise exception 'USER_NOT_APPROVED';end if;
 if not exists(select 1 from public.weekly_availabilities where user_id=v_user and week_code=p_week_code and is_active) then raise exception 'NO_ACTIVE_AVAILABILITY';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(v_user,p_week_code,'confirmed',now(),now()) on conflict(user_id,week_code) do update set status='confirmed',confirmed_at=now(),updated_at=now();
end $$;

create or replace function public.submit_weekly_registration_v2(p_full_name text,p_contact_email text,p_alumni_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[],p_known_emails text[]) returns public.verification_status language plpgsql security definer set search_path=public as $$
declare v_status public.verification_status;v_alumni text:=lower(trim(coalesce(p_alumni_email,'')));v_contact text:=lower(trim(coalesce(p_contact_email,'')));
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;if public.is_admin() then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
 if public.app_now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;if v_alumni='' then raise exception 'ALUMNI_EMAIL_REQUIRED';end if;if v_contact='' then raise exception 'CONTACT_EMAIL_REQUIRED';end if;
 select public.submit_weekly_registration(p_full_name,v_alumni,p_phone,p_linkedin_url,p_school,p_graduation_year,p_city,p_only_new_people,p_week_code,p_slot_ids,p_known_phones,p_known_emails) into v_status;
 update public.profiles set email=v_contact,normalized_email=v_contact,alumni_email=v_alumni,normalized_alumni_email=v_alumni,updated_at=now() where id=auth.uid();
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(auth.uid(),p_week_code,'confirmed',now(),now()) on conflict(user_id,week_code) do update set status='confirmed',confirmed_at=now(),updated_at=now();return v_status;
end $$;

create or replace function public.withdraw_weekly_registration(p_week_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;if public.app_now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(auth.uid(),p_week_code,'withdrawn',null,now()) on conflict(user_id,week_code) do update set status='withdrawn',confirmed_at=null,updated_at=now();
end $$;

create or replace function public.close_weekly_confirmations(p_week_code text) returns int language plpgsql security definer set search_path=public as $$
declare v_count int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 if public.app_now()<public.weekly_confirmation_cutoff(p_week_code) then return 0;end if;
 update public.weekly_participations set status='withdrawn',confirmed_at=null,updated_at=now() where week_code=p_week_code and status='pending';
 get diagnostics v_count=row_count;return v_count;
end $$;

create or replace function public.reactivate_weekly_participation(p_user_id uuid,p_week_code text)
returns void language plpgsql security definer set search_path=public as $$
declare v_source text;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 if public.app_now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;
 if not exists(select 1 from public.profiles where id=p_user_id and verification_status='approved') then raise exception 'USER_NOT_APPROVED';end if;
 select max(week_code) into v_source from public.weekly_availabilities where user_id=p_user_id and week_code<p_week_code;
 if v_source is null then raise exception 'NO_PREVIOUS_AVAILABILITY';end if;
 insert into public.weekly_availabilities(user_id,week_code,slot_id,is_active)
 select p_user_id,p_week_code,public.shift_weekly_slot(slot_id,v_source,p_week_code),true from public.weekly_availabilities where user_id=p_user_id and week_code=v_source
 on conflict(user_id,week_code,slot_id) do update set is_active=true;
 if not found then raise exception 'NO_PREVIOUS_AVAILABILITY';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(p_user_id,p_week_code,'confirmed',now(),now()) on conflict(user_id,week_code) do update set status='confirmed',confirmed_at=now(),updated_at=now();
 insert into public.contact_preferences(user_id,opted_out,updated_at) values(p_user_id,false,now()) on conflict(user_id) do update set opted_out=false,updated_at=now();
end $$;

create or replace function public.prepare_weekly_reactivations(p_week_code text)
returns int language plpgsql security definer set search_path=public as $$
declare v_count int;v_send_at timestamptz;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 v_send_at:=((public.week_monday(p_week_code)-1)::text||' 15:00:00')::timestamp at time zone 'America/Bogota';
 with dormant as(
  select p.id,p.city,(select max(w.week_code) from public.weekly_availabilities w where w.user_id=p.id and w.week_code<p_week_code) source_week
  from public.profiles p left join public.contact_preferences cp on cp.user_id=p.id
  where p.verification_status='approved' and coalesce(cp.opted_out,false)=false and not exists(select 1 from public.admin_users a where a.user_id=p.id)
   and not exists(select 1 from public.reputation_incidents i where i.user_id=p.id and i.status='confirmed' and not exists(select 1 from public.second_chances sc where sc.incident_id=i.id))
   and not exists(select 1 from public.weekly_participations wp where wp.user_id=p.id and wp.week_code=p_week_code and wp.status in('pending','confirmed'))
 ),eligible as(
  select d.*,(select count(distinct candidate.id) from public.profiles candidate join public.weekly_participations wp on wp.user_id=candidate.id and wp.week_code=p_week_code and wp.status in('pending','confirmed') where candidate.id<>d.id and candidate.verification_status='approved' and not exists(select 1 from public.admin_users au where au.user_id=candidate.id) and not exists(select 1 from public.reputation_incidents i where i.user_id=candidate.id and i.status='confirmed' and not exists(select 1 from public.second_chances sc where sc.incident_id=i.id)) and not exists(select 1 from public.meetings m where m.status='completed' and ((m.user_a_id=d.id and m.user_b_id=candidate.id) or (m.user_a_id=candidate.id and m.user_b_id=d.id))) and (candidate.city=d.city or (exists(select 1 from public.weekly_availabilities old where old.user_id=d.id and old.week_code=d.source_week and split_part(old.slot_id,'|',1)='virtual') and exists(select 1 from public.weekly_availabilities current_slot where current_slot.user_id=candidate.id and current_slot.week_code=p_week_code and current_slot.is_active and split_part(current_slot.slot_id,'|',1)='virtual')))) new_count
  from dormant d where d.source_week is not null
 )
 insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
 select 'weekly_reactivation',jsonb_build_object('userId',id,'weekCode',p_week_code,'newCount',new_count),'weekly-reactivation:'||p_week_code||':'||id,greatest(public.app_now(),v_send_at) from eligible where new_count>=2
 on conflict(idempotency_key) do nothing;
 get diagnostics v_count=row_count;return v_count;
end $$;

create or replace function public.admin_withdraw_weekly_participation(p_user_id uuid,p_week_code text)
returns void language plpgsql security definer set search_path=public as $$
declare v_cutoff timestamptz;v_open_from timestamptz;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_cutoff:=public.weekly_confirmation_cutoff(p_week_code);
 v_open_from:=((public.week_monday(p_week_code)-1)::text||' 19:00:00')::timestamp at time zone 'America/Bogota';
 if public.app_now()<v_open_from or public.app_now()>=v_cutoff then raise exception 'CONFIRMATION_WINDOW_CLOSED';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at)
  values(p_user_id,p_week_code,'withdrawn',null,now())
  on conflict(user_id,week_code) do update set status='withdrawn',confirmed_at=null,updated_at=now();
end $$;

create or replace function public.get_admin_live_confirmations_page(
 p_week_code text,p_query text default '',p_page int default 1,p_page_size int default 20
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_cutoff timestamptz;v_open_from timestamptz;v_window_open boolean;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_cutoff:=public.weekly_confirmation_cutoff(p_week_code);
 v_open_from:=((public.week_monday(p_week_code)-1)::text||' 19:00:00')::timestamp at time zone 'America/Bogota';
 v_window_open:=public.app_now()>=v_open_from and public.app_now()<v_cutoff;
 if not v_window_open then
  return jsonb_build_object('windowOpen',false,'items','[]'::jsonb,'total',0,'counts',jsonb_build_object('confirmed',0,'pending',0,'withdrawn',0),'opensAt',v_open_from,'closesAt',v_cutoff);
 end if;
 with eligible as(
  select p.id,p.full_name,p.email,p.phone,p.school,wp.confirmed_at,
   coalesce(wp.status,'pending') status
  from public.profiles p
   left join public.admin_users a on a.user_id=p.id
   left join public.weekly_participations wp on wp.user_id=p.id and wp.week_code=p_week_code
  where a.user_id is null and p.verification_status='approved'
 ),filtered as(
  select * from eligible where
   trim(coalesce(p_query,''))='' or lower(full_name)like v_query or lower(coalesce(email,''))like v_query or coalesce(phone,'')like v_query
 ),page_rows as(select * from filtered order by full_name limit v_size offset(v_page-1)*v_size),
 counts as(
  select count(*)filter(where status='confirmed') confirmed,
   count(*)filter(where status='pending') pending,
   count(*)filter(where status='withdrawn') withdrawn
  from eligible
 )
 select jsonb_build_object(
  'windowOpen',true,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'fullName',x.full_name,'email',x.email,'phone',x.phone,'school',x.school,'status',x.status,'confirmedAt',x.confirmed_at)order by x.full_name)from page_rows x),'[]'::jsonb),
  'total',(select count(*)from filtered),
  'counts',jsonb_build_object('confirmed',c.confirmed,'pending',c.pending,'withdrawn',c.withdrawn),
  'opensAt',v_open_from,'closesAt',v_cutoff
 ) into v_result from counts c;
 return v_result;
end $$;

create or replace function public.enforce_weekly_matching_time()
returns trigger language plpgsql set search_path=public as $$
begin
 if not new.is_test and public.app_now()<public.weekly_confirmation_cutoff(new.week_code) then
  raise exception 'MATCHING_NOT_OPEN';
 end if;
 return new;
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

create or replace function public.advance_weekly_config()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_config jsonb;v_week text;v_monday date;v_days jsonb;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' and not public.is_admin() then raise exception 'ADMIN_OR_SERVICE_ROLE_REQUIRED';end if;
 select value into v_config from public.meeting_config where key='current' for update;
 if v_config is null then raise exception 'MEETING_CONFIG_NOT_FOUND';end if;
 loop
  v_week:=v_config->>'weekCode';
  if v_week is null or v_week!~'^[0-9]{4}-W[0-9]{2}$' then raise exception 'INVALID_WEEK_CODE';end if;
  v_monday:=public.week_monday(v_week);
  select coalesce(jsonb_agg(day||jsonb_build_object(
   'date',(v_monday+(extract(isodow from (day->>'date')::date)::int-1))::text
  ) order by ordinal),'[]'::jsonb) into v_days
  from jsonb_array_elements(v_config->'days') with ordinality as item(day,ordinal);
  v_config:=jsonb_set(v_config,'{days}',v_days);
  exit when public.app_now()<public.weekly_confirmation_cutoff(v_week);
  select coalesce(jsonb_agg(day||jsonb_build_object(
   'date',((day->>'date')::date+7)::text,'blocked',false,'reason',''
  ) order by ordinal),'[]'::jsonb) into v_days
  from jsonb_array_elements(v_config->'days') with ordinality as item(day,ordinal);
  v_config:=jsonb_set(jsonb_set(v_config,'{weekCode}',to_jsonb(to_char(v_monday+7,'IYYY-"W"IW'))),'{days}',v_days);
 end loop;
 update public.meeting_config set value=v_config,updated_at=now() where key='current';
 return v_config;
end $$;

create or replace function public.claim_outbox_job()
returns setof public.outbox language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select id into v_id from public.outbox where status in('pending','failed') and next_attempt_at<=public.app_now() and attempt_count<8 order by next_attempt_at,created_at for update skip locked limit 1;
 if v_id is null then return;end if;
 return query update public.outbox set status='processing',attempt_count=attempt_count+1 where id=v_id returning *;
end $$;

create or replace function public.fail_outbox_job(p_id uuid,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare v_attempt int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select attempt_count into v_attempt from public.outbox where id=p_id for update;
 update public.outbox set status=case when v_attempt>=8 then 'cancelled'::public.job_status else 'failed'::public.job_status end,last_error=left(p_error,1000),next_attempt_at=public.app_now()+make_interval(secs=>least(3600,30*power(2,greatest(v_attempt-1,0))::int)) where id=p_id;
end $$;

create or replace function public.cancel_meeting(p_meeting_id uuid,p_cancelled_by uuid default null)
returns table(meeting_status public.meeting_status,cancellation_exempt boolean,cancellation_exempt_reason text,prior_completed_meeting_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  v_meeting public.meetings%rowtype;
  v_prior_id uuid;
  v_scheduled_at timestamptz;
  v_date text;
  v_time text;
  v_status public.meeting_status;
  v_is_admin boolean:=public.is_admin();
  v_cancelled_by uuid;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'MEETING_NOT_FOUND'; end if;
  if auth.uid() is null or (not v_is_admin and auth.uid() not in(v_meeting.user_a_id,v_meeting.user_b_id)) then raise exception 'FORBIDDEN'; end if;
  v_cancelled_by:=case when v_is_admin then p_cancelled_by else auth.uid() end;
  if v_cancelled_by is null or v_cancelled_by not in(v_meeting.user_a_id,v_meeting.user_b_id) then raise exception 'CANCELLED_BY_MUST_BE_PARTICIPANT'; end if;
  if not v_is_admin and p_cancelled_by is not null and p_cancelled_by<>auth.uid() then raise exception 'FORBIDDEN'; end if;
  if v_meeting.status not in('confirmed','attendance_pending') then
    if v_meeting.cancelled_by=v_cancelled_by or v_is_admin then
      return query select v_meeting.status,v_meeting.cancellation_exempt,v_meeting.cancellation_exempt_reason,v_meeting.prior_completed_meeting_id;
      return;
    end if;
    raise exception 'MEETING_NOT_CANCELLABLE';
  end if;

  select m.id into v_prior_id
  from public.meetings m
  where m.id<>v_meeting.id and m.status='completed' and m.created_at<v_meeting.created_at
    and ((m.user_a_id=v_meeting.user_a_id and m.user_b_id=v_meeting.user_b_id)
      or (m.user_a_id=v_meeting.user_b_id and m.user_b_id=v_meeting.user_a_id))
  order by m.created_at desc limit 1;

  if split_part(v_meeting.slot_id,'|',1)='virtual' then
    v_date:=split_part(v_meeting.slot_id,'|',2);v_time:=split_part(v_meeting.slot_id,'|',3);
  else
    v_date:=split_part(v_meeting.slot_id,'|',3);v_time:=split_part(v_meeting.slot_id,'|',4);
  end if;
  begin
    v_scheduled_at:=(v_date||' '||v_time)::timestamp at time zone 'America/Bogota';
  exception when others then raise exception 'INVALID_MEETING_SLOT'; end;

  if v_prior_id is not null then
    v_status:='cancelled_on_time';
    update public.meetings set status=v_status,cancelled_by=v_cancelled_by,cancelled_at=now(),cancellation_exempt=true,cancellation_exempt_reason='prior_completed_meeting',prior_completed_meeting_id=v_prior_id where id=v_meeting.id;
  elsif v_scheduled_at-public.app_now()>=interval '3 hours' then
    v_status:='cancelled_on_time';
    update public.meetings set status=v_status,cancelled_by=v_cancelled_by,cancelled_at=now(),cancellation_exempt=false,cancellation_exempt_reason=null,prior_completed_meeting_id=null where id=v_meeting.id;
  else
    v_status:='late_cancellation';
    update public.meetings set status=v_status,cancelled_by=v_cancelled_by,cancelled_at=now(),cancellation_exempt=false,cancellation_exempt_reason=null,prior_completed_meeting_id=null where id=v_meeting.id;
    insert into public.reputation_incidents(meeting_id,user_id,kind,status,idempotency_key,decided_by)
    values(v_meeting.id,v_cancelled_by,'late_cancellation','confirmed','late-cancellation:'||v_meeting.id||':'||v_cancelled_by,case when v_is_admin then auth.uid() else null end)
    on conflict(idempotency_key) do nothing;
  end if;

  insert into public.outbox(kind,payload,idempotency_key)
  values('meeting_cancelled',jsonb_build_object('meetingId',v_meeting.id,'cancelled_by',v_cancelled_by,'status',v_status,'exempt',v_prior_id is not null),'meeting-cancelled:'||v_meeting.id)
  on conflict(idempotency_key) do nothing;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
  values(auth.uid(),'meeting.cancel','meeting',v_meeting.id::text,to_jsonb(v_meeting),jsonb_build_object('status',v_status,'cancellation_exempt',v_prior_id is not null,'prior_completed_meeting_id',v_prior_id));
  return query select v_status,(v_prior_id is not null),case when v_prior_id is not null then 'prior_completed_meeting'::text else null end,v_prior_id;
end $$;
