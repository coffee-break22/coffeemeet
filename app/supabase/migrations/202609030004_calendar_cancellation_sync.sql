alter table public.meetings add column if not exists calendar_cancelled_at timestamptz;

create or replace function public.enqueue_calendar_cancellation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in('cancelled_on_time','late_cancellation') and old.status not in('cancelled_on_time','late_cancellation') then
  update public.outbox set status='cancelled',processed_at=now(),last_error='Cita cancelada antes del envío'
  where status in('pending','failed') and payload->>'meetingId'=new.id::text
   and kind in('calendar','match_whatsapp','meeting_reminder','attendance_survey');
  insert into public.outbox(kind,payload,idempotency_key)
  values('calendar_cancel',jsonb_build_object('meetingId',new.id),'calendar-cancel:'||new.id)
  on conflict(idempotency_key) do nothing;
 end if;
 return new;
end $$;

drop trigger if exists enqueue_calendar_cancellation_on_meeting on public.meetings;
create trigger enqueue_calendar_cancellation_on_meeting
after update of status on public.meetings for each row
execute function public.enqueue_calendar_cancellation();

revoke all on function public.enqueue_calendar_cancellation() from public,anon,authenticated;
