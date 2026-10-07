with exempt as(
 select m.id,(select prior.id from public.meetings prior where prior.id<>m.id and prior.status='completed' and prior.created_at<m.created_at and ((prior.user_a_id=m.user_a_id and prior.user_b_id=m.user_b_id) or (prior.user_a_id=m.user_b_id and prior.user_b_id=m.user_a_id)) order by prior.created_at desc limit 1) prior_id
 from public.meetings m where m.status='no_show'
)
update public.meetings m set status='cancelled_on_time',cancellation_exempt=true,cancellation_exempt_reason='prior_completed_meeting',prior_completed_meeting_id=e.prior_id
from exempt e where m.id=e.id and e.prior_id is not null;
update public.reputation_incidents i set status='dismissed' where i.kind='no_show_no_notice' and i.status='confirmed' and exists(select 1 from public.meetings m where m.id=i.meeting_id and m.cancellation_exempt and m.cancellation_exempt_reason='prior_completed_meeting');
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
   select m.id into v_prior_id from public.meetings m where m.id<>p_meeting_id and m.status='completed' and m.created_at<v_meeting.created_at and ((m.user_a_id=v_meeting.user_a_id and m.user_b_id=v_meeting.user_b_id) or (m.user_a_id=v_meeting.user_b_id and m.user_b_id=v_meeting.user_a_id)) order by m.created_at desc limit 1;
   if v_prior_id is not null then
     v_status:='cancelled_on_time';
     update public.meetings set cancellation_exempt=true,cancellation_exempt_reason='prior_completed_meeting',prior_completed_meeting_id=v_prior_id where id=p_meeting_id;
   else
     v_status:='no_show';
     insert into public.reputation_incidents(meeting_id,user_id,kind,status,idempotency_key)
     values(p_meeting_id,case when p_self_attended then v_other else p_reporter_id end,'no_show_no_notice','confirmed','attendance-no-show:'||p_meeting_id||':'||(case when p_self_attended then v_other else p_reporter_id end)) on conflict(idempotency_key) do nothing;
   end if;
 else v_status:='attendance_disputed';end if;
 update public.meetings set status=v_status where id=p_meeting_id;
 insert into public.audit_log(action,entity_type,entity_id,after_data) values('attendance.report','meeting',p_meeting_id::text,jsonb_build_object('reporterId',p_reporter_id,'version',v_version,'status',v_status,'exempt',v_prior_id is not null,'priorCompletedMeetingId',v_prior_id));
 return v_status;
end $$;
revoke all on function public.record_attendance_report(uuid,uuid,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_attendance_report(uuid,uuid,boolean,boolean,boolean) to service_role;