alter table public.survey_sessions drop constraint if exists survey_sessions_step_check;
alter table public.survey_sessions add constraint survey_sessions_step_check
 check(step in('awaiting_occurred','awaiting_self','awaiting_comment','completed'));

create or replace function public.save_attendance_comment(
 p_meeting_id uuid,
 p_user_id uuid,
 p_comment text
) returns void
language plpgsql security definer set search_path=public as $$
declare v_comment text:=trim(coalesce(p_comment,''));
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 if v_comment='' then return;end if;
 if char_length(v_comment)>1000 then raise exception 'COMMENT_TOO_LONG';end if;
 if not exists(select 1 from public.meetings m where m.id=p_meeting_id and p_user_id in(m.user_a_id,m.user_b_id)) then raise exception 'REPORTER_NOT_PARTICIPANT';end if;
 update public.attendance_reports report set comment=v_comment
 where report.meeting_id=p_meeting_id and report.reporter_id=p_user_id
 and report.response_version=(select max(latest.response_version) from public.attendance_reports latest where latest.meeting_id=p_meeting_id and latest.reporter_id=p_user_id);
 if not found then raise exception 'ATTENDANCE_REPORT_NOT_FOUND';end if;
 insert into public.audit_log(action,entity_type,entity_id,after_data)
 values('attendance.comment','meeting',p_meeting_id::text,jsonb_build_object('reporterId',p_user_id,'hasComment',true));
end $$;

revoke all on function public.save_attendance_comment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_attendance_comment(uuid,uuid,text) to service_role;
create or replace function public.get_admin_reputation_cases()
returns table(case_id text,case_type text,meeting_id uuid,meeting_status public.meeting_status,incident_id uuid,incident_kind text,incident_status text,user_id uuid,user_name text,user_a_id uuid,user_a_name text,user_b_id uuid,user_b_name text,second_chance_id uuid,occurred_at timestamptz,reports jsonb)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 return query
 select 'incident:'||i.id,'incident',m.id,m.status,i.id,i.kind,i.status,i.user_id,responsible.full_name,m.user_a_id,a.full_name,m.user_b_id,b.full_name,sc.id,i.created_at,'[]'::jsonb
 from public.reputation_incidents i join public.meetings m on m.id=i.meeting_id join public.profiles responsible on responsible.id=i.user_id join public.profiles a on a.id=m.user_a_id join public.profiles b on b.id=m.user_b_id left join public.second_chances sc on sc.incident_id=i.id
 union all
 select 'dispute:'||m.id,'dispute',m.id,m.status,null,null,null,null,null,m.user_a_id,a.full_name,m.user_b_id,b.full_name,null,m.created_at,coalesce((select jsonb_agg(jsonb_build_object('reporterId',r.reporter_id,'meetingOccurred',r.meeting_occurred,'selfAttended',r.self_attended,'partnerAttended',r.partner_attended,'comment',r.comment,'submittedAt',r.submitted_at) order by r.submitted_at) from public.attendance_reports r where r.meeting_id=m.id),'[]'::jsonb)
 from public.meetings m join public.profiles a on a.id=m.user_a_id join public.profiles b on b.id=m.user_b_id where m.status='attendance_disputed'
 order by 15 desc;
end $$;