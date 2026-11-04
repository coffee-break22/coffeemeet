

begin;


update public.meetings set prior_completed_meeting_id = null;


delete from public.survey_sessions;
delete from public.attendance_reports;
delete from public.second_chances;
delete from public.reputation_incidents;
delete from public.meeting_participants;
delete from public.meetings;
delete from public.match_batches;


delete from public.weekly_participations;
delete from public.weekly_availabilities;
delete from public.known_contacts;
delete from public.contact_preferences;
delete from public.verification_requests;


delete from public.outbox;
delete from public.audit_log;


delete from public.alumni_registry;
delete from public.registry_imports;


update public.notification_status_counters set total = 0;


delete from public.profiles where id not in (select user_id from public.admin_users);
delete from auth.users where id not in (select user_id from public.admin_users);


update public.system_clock set enabled = false, simulated_at = null where key = 'current';

commit;


