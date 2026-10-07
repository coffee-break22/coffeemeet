create or replace function public.cleanup_test_data()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_meeting_ids uuid[];
  v_pending_calendar int:=0;
  v_deleted_batches int:=0;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  select coalesce(array_agg(m.id),'{}'::uuid[]) into v_meeting_ids
  from public.meetings m join public.match_batches b on b.id=m.batch_id
  where b.is_test;

  update public.meetings m
  set status='cancelled_on_time',cancelled_at=coalesce(cancelled_at,now()),
      cancellation_exempt=true,cancellation_exempt_reason='test_cleanup'
  from public.match_batches b
  where m.batch_id=b.id and b.is_test
    and m.status in('confirmed','attendance_pending');

  delete from public.outbox o
  where o.kind<>'calendar_cancel'
    and (nullif(o.payload->>'meetingId','')::uuid=any(v_meeting_ids)
      or nullif(o.payload->>'meeting_id','')::uuid=any(v_meeting_ids));

  select count(*) into v_pending_calendar
  from public.meetings m join public.match_batches b on b.id=m.batch_id
  where b.is_test and m.calendar_event_id is not null
    and m.calendar_cancelled_at is null;

  if v_pending_calendar>0 then
    return jsonb_build_object('status','waiting_calendar','pendingCalendar',v_pending_calendar,'deletedBatches',0);
  end if;

  delete from public.second_chances s where s.incident_id in(
    select i.id from public.reputation_incidents i where i.meeting_id=any(v_meeting_ids)
  );
  delete from public.reputation_incidents i where i.meeting_id=any(v_meeting_ids);
  update public.meetings set prior_completed_meeting_id=null where prior_completed_meeting_id=any(v_meeting_ids);
  delete from public.outbox o
  where nullif(o.payload->>'meetingId','')::uuid=any(v_meeting_ids)
     or nullif(o.payload->>'meeting_id','')::uuid=any(v_meeting_ids);
  delete from public.match_batches where is_test;
  get diagnostics v_deleted_batches=row_count;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'test_data.cleanup','match_batches','test',jsonb_build_object('deletedBatches',v_deleted_batches));
  return jsonb_build_object('status','completed','pendingCalendar',0,'deletedBatches',v_deleted_batches);
end $$;

revoke all on function public.cleanup_test_data() from public,anon,authenticated;
grant execute on function public.cleanup_test_data() to authenticated;
