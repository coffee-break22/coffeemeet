
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
  v_is_service boolean:=current_setting('request.jwt.claim.role',true)='service_role';
  v_cancelled_by uuid;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'MEETING_NOT_FOUND'; end if;
  if not v_is_service and (auth.uid() is null or (not v_is_admin and auth.uid() not in(v_meeting.user_a_id,v_meeting.user_b_id))) then raise exception 'FORBIDDEN'; end if;
  v_cancelled_by:=case when v_is_admin or v_is_service then p_cancelled_by else auth.uid() end;
  if v_cancelled_by is null or v_cancelled_by not in(v_meeting.user_a_id,v_meeting.user_b_id) then raise exception 'CANCELLED_BY_MUST_BE_PARTICIPANT'; end if;
  if not v_is_admin and not v_is_service and p_cancelled_by is not null and p_cancelled_by<>auth.uid() then raise exception 'FORBIDDEN'; end if;
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

drop function if exists public.withdraw_weekly_registration(text);
create function public.withdraw_weekly_registration(p_week_code text,p_user_id uuid default null) returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=coalesce(p_user_id,auth.uid());v_service boolean:=current_setting('request.jwt.claim.role',true)='service_role';
begin
 if not v_service and (auth.uid() is null or v_user<>auth.uid()) then raise exception 'AUTH_REQUIRED';end if;
 if public.app_now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(v_user,p_week_code,'withdrawn',null,now()) on conflict(user_id,week_code) do update set status='withdrawn',confirmed_at=null,updated_at=now();
end $$;
revoke all on function public.withdraw_weekly_registration(text,uuid) from public,anon;
grant execute on function public.withdraw_weekly_registration(text,uuid) to authenticated,service_role;

alter table public.meetings add column if not exists short_code text unique;

create or replace function public.generate_meeting_short_code() returns text
language sql volatile as $$
 select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789',(random()*36)::int+1,1),'')
 from generate_series(1,5)
$$;

create or replace function public.set_meeting_short_code() returns trigger
language plpgsql set search_path=public as $$
declare v_code text;v_attempt int:=0;
begin
 if new.short_code is not null then return new;end if;
 loop
  v_attempt:=v_attempt+1;
  v_code:=public.generate_meeting_short_code();
  if not exists(select 1 from public.meetings where short_code=v_code) then
   new.short_code:=v_code;
   return new;
  end if;
  if v_attempt>=5 then raise exception 'SHORT_CODE_GENERATION_FAILED';end if;
 end loop;
end $$;
drop trigger if exists set_meeting_short_code on public.meetings;
create trigger set_meeting_short_code before insert on public.meetings for each row execute function public.set_meeting_short_code();

update public.meetings set short_code=public.generate_meeting_short_code() where short_code is null;

create or replace function public.get_meeting_calendar_link(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_meeting public.meetings%rowtype;
 v_date text;v_time text;v_virtual boolean;v_place text;v_city text;
 v_starts timestamptz;v_ends timestamptz;v_location text;
begin
 select * into v_meeting from public.meetings where short_code=p_code;
 if not found then raise exception 'LINK_NOT_FOUND';end if;
 v_virtual:=split_part(v_meeting.slot_id,'|',1)='virtual';
 if v_virtual then
  v_date:=split_part(v_meeting.slot_id,'|',2);v_time:=split_part(v_meeting.slot_id,'|',3);
  v_location:=case when v_meeting.meet_link is not null then 'Google Meet: '||v_meeting.meet_link else 'Google Meet' end;
 else
  v_city:=split_part(v_meeting.slot_id,'|',1);v_place:=split_part(v_meeting.slot_id,'|',2);
  v_date:=split_part(v_meeting.slot_id,'|',3);v_time:=split_part(v_meeting.slot_id,'|',4);
  v_location:=v_place||', '||v_city;
 end if;
 begin
  v_starts:=(v_date||' '||v_time)::timestamp at time zone 'America/Bogota';
 exception when others then raise exception 'INVALID_MEETING_SLOT';end;
 v_ends:=v_starts+interval '30 minutes';
 return jsonb_build_object(
  'title','Café CoffeeMeet',
  'location',v_location,
  'description','Encuentro CoffeeMeet de 30 minutos con tu match de esta semana.'||case when v_virtual and v_meeting.meet_link is not null then ' Enlace: '||v_meeting.meet_link else '' end,
  'startsAt',v_starts,
  'endsAt',v_ends
 );
end $$;
revoke all on function public.get_meeting_calendar_link(text) from public;
grant execute on function public.get_meeting_calendar_link(text) to anon,authenticated;
