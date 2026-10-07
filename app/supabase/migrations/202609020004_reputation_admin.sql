create or replace function public.get_admin_reputation_cases()
returns table(case_id text,case_type text,meeting_id uuid,meeting_status public.meeting_status,incident_id uuid,incident_kind text,incident_status text,user_id uuid,user_name text,user_a_id uuid,user_a_name text,user_b_id uuid,user_b_name text,second_chance_id uuid,occurred_at timestamptz,reports jsonb)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 return query
 select 'incident:'||i.id,'incident',m.id,m.status,i.id,i.kind,i.status,i.user_id,responsible.full_name,m.user_a_id,a.full_name,m.user_b_id,b.full_name,sc.id,i.created_at,'[]'::jsonb
 from public.reputation_incidents i join public.meetings m on m.id=i.meeting_id join public.profiles responsible on responsible.id=i.user_id join public.profiles a on a.id=m.user_a_id join public.profiles b on b.id=m.user_b_id left join public.second_chances sc on sc.incident_id=i.id
 union all
 select 'dispute:'||m.id,'dispute',m.id,m.status,null,null,null,null,null,m.user_a_id,a.full_name,m.user_b_id,b.full_name,null,m.created_at,coalesce((select jsonb_agg(jsonb_build_object('reporterId',r.reporter_id,'meetingOccurred',r.meeting_occurred,'selfAttended',r.self_attended,'partnerAttended',r.partner_attended,'submittedAt',r.submitted_at) order by r.submitted_at) from public.attendance_reports r where r.meeting_id=m.id),'[]'::jsonb)
 from public.meetings m join public.profiles a on a.id=m.user_a_id join public.profiles b on b.id=m.user_b_id where m.status='attendance_disputed'
 order by 15 desc;
end $$;

create or replace function public.grant_second_chance(p_incident_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_incident public.reputation_incidents%rowtype;v_id uuid;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'REASON_REQUIRED';end if;
 select * into v_incident from public.reputation_incidents where id=p_incident_id and status='confirmed' for update;
 if not found then raise exception 'INCIDENT_NOT_ELIGIBLE';end if;
 select id into v_id from public.second_chances where incident_id=v_incident.id;
 if found then return v_id;end if;
 insert into public.second_chances(user_id,incident_id,granted_by,reason) values(v_incident.user_id,v_incident.id,auth.uid(),trim(p_reason)) returning id into v_id;
 insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data) values(auth.uid(),'reputation.second_chance','incident',v_incident.id::text,jsonb_build_object('userId',v_incident.user_id,'reason',trim(p_reason)));
 return v_id;
end $$;

create or replace function public.resolve_attendance_dispute(p_meeting_id uuid,p_resolution text,p_responsible_user_id uuid default null,p_notes text default '')
returns public.meeting_status language plpgsql security definer set search_path=public as $$
declare v_meeting public.meetings%rowtype;v_status public.meeting_status;v_prior uuid;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 select * into v_meeting from public.meetings where id=p_meeting_id for update;
 if not found or v_meeting.status<>'attendance_disputed' then raise exception 'DISPUTE_NOT_OPEN';end if;
 if p_resolution='completed' then v_status:='completed';
 elsif p_resolution='excused' then v_status:='cancelled_on_time';update public.meetings set cancellation_exempt=true,cancellation_exempt_reason='admin_resolution' where id=p_meeting_id;
 elsif p_resolution='no_show' then
  if p_responsible_user_id is null or p_responsible_user_id not in(v_meeting.user_a_id,v_meeting.user_b_id) then raise exception 'RESPONSIBLE_PARTICIPANT_REQUIRED';end if;
  select m.id into v_prior from public.meetings m where m.id<>p_meeting_id and m.status='completed' and m.created_at<v_meeting.created_at and ((m.user_a_id=v_meeting.user_a_id and m.user_b_id=v_meeting.user_b_id) or (m.user_a_id=v_meeting.user_b_id and m.user_b_id=v_meeting.user_a_id)) order by m.created_at desc limit 1;
  if v_prior is not null then raise exception 'PAIR_EXEMPT_PRIOR_COMPLETED';end if;
  v_status:='no_show';insert into public.reputation_incidents(meeting_id,user_id,kind,status,idempotency_key,decided_by) values(p_meeting_id,p_responsible_user_id,'no_show_no_notice','confirmed','admin-no-show:'||p_meeting_id||':'||p_responsible_user_id,auth.uid()) on conflict(idempotency_key) do nothing;
 else raise exception 'INVALID_RESOLUTION';end if;
 update public.meetings set status=v_status where id=p_meeting_id;
 insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data) values(auth.uid(),'attendance.resolve','meeting',p_meeting_id::text,jsonb_build_object('resolution',p_resolution,'responsibleUserId',p_responsible_user_id,'notes',trim(coalesce(p_notes,''))));
 return v_status;
end $$;
revoke all on function public.get_admin_reputation_cases(),public.grant_second_chance(uuid,text),public.resolve_attendance_dispute(uuid,text,uuid,text) from public,anon;
grant execute on function public.get_admin_reputation_cases(),public.grant_second_chance(uuid,text),public.resolve_attendance_dispute(uuid,text,uuid,text) to authenticated;