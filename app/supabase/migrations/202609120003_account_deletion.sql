
alter table public.meetings drop constraint if exists meetings_user_a_id_fkey;
alter table public.meetings add constraint meetings_user_a_id_fkey foreign key(user_a_id) references public.profiles(id) on delete cascade;
alter table public.meetings drop constraint if exists meetings_user_b_id_fkey;
alter table public.meetings add constraint meetings_user_b_id_fkey foreign key(user_b_id) references public.profiles(id) on delete cascade;
alter table public.meetings drop constraint if exists meetings_cancelled_by_fkey;
alter table public.meetings add constraint meetings_cancelled_by_fkey foreign key(cancelled_by) references public.profiles(id) on delete cascade;

alter table public.reputation_incidents drop constraint if exists reputation_incidents_user_id_fkey;
alter table public.reputation_incidents add constraint reputation_incidents_user_id_fkey foreign key(user_id) references public.profiles(id) on delete cascade;

alter table public.second_chances drop constraint if exists second_chances_user_id_fkey;
alter table public.second_chances add constraint second_chances_user_id_fkey foreign key(user_id) references public.profiles(id) on delete cascade;
alter table public.second_chances drop constraint if exists second_chances_incident_id_fkey;
alter table public.second_chances add constraint second_chances_incident_id_fkey foreign key(incident_id) references public.reputation_incidents(id) on delete cascade;

alter table public.meeting_participants drop constraint if exists meeting_participants_user_id_fkey;
alter table public.meeting_participants add constraint meeting_participants_user_id_fkey foreign key(user_id) references public.profiles(id) on delete cascade;

alter table public.attendance_reports drop constraint if exists attendance_reports_reporter_id_fkey;
alter table public.attendance_reports add constraint attendance_reports_reporter_id_fkey foreign key(reporter_id) references public.profiles(id) on delete cascade;


create or replace function public.delete_account()
returns void language plpgsql security definer set search_path=public as $cm$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;
 if public.is_admin() then raise exception 'ADMIN_CANNOT_DELETE_ACCOUNT';end if;
 insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
  values('account_deletion',jsonb_build_object('userId',v_uid),'account-deletion:'||v_uid,now());
 delete from public.profiles where id=v_uid;
end $cm$;
revoke all on function public.delete_account() from public,anon;
grant execute on function public.delete_account() to authenticated;
