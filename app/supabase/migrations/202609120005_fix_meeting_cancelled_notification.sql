
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
  elsif v_scheduled_at-now()>=interval '30 minutes' then
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
revoke all on function public.cancel_meeting(uuid,uuid) from public;
grant execute on function public.cancel_meeting(uuid,uuid) to authenticated;
