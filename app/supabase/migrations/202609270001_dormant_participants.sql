
alter table public.profiles add column if not exists weeks_inactive int not null default 0;
alter table public.profiles add column if not exists dormant_since text;

create or replace function public.prepare_weekly_confirmations(p_week_code text) returns int language plpgsql security definer set search_path=public as $$
declare v_count int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 with latest as(select p.id user_id,(select max(w.week_code) from public.weekly_availabilities w where w.user_id=p.id and w.week_code<p_week_code and w.is_active) source_week from public.profiles p where p.verification_status='approved' and p.dormant_since is null and not exists(select 1 from public.admin_users a where a.user_id=p.id)),eligible as(select * from latest where source_week is not null)
 insert into public.weekly_participations(user_id,week_code,status) select user_id,p_week_code,'pending' from eligible on conflict do nothing;
 with source as(select wp.user_id,(select max(w.week_code) from public.weekly_availabilities w where w.user_id=wp.user_id and w.week_code<p_week_code and w.is_active) source_week from public.weekly_participations wp where wp.week_code=p_week_code)
 insert into public.weekly_availabilities(user_id,week_code,slot_id,is_active)
 select s.user_id,p_week_code,public.shift_weekly_slot(w.slot_id,s.source_week,p_week_code),true from source s join public.weekly_availabilities w on w.user_id=s.user_id and w.week_code=s.source_week and w.is_active
 on conflict(user_id,week_code,slot_id) do nothing;
 get diagnostics v_count=row_count;return v_count;
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
  where p.verification_status='approved' and p.dormant_since is null and coalesce(cp.opted_out,false)=false and not exists(select 1 from public.admin_users a where a.user_id=p.id)
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

create or replace function public.reactivate_weekly_participation(p_user_id uuid,p_week_code text)
returns void language plpgsql security definer set search_path=public as $$
declare v_source text;v_was_dormant boolean;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select dormant_since is not null into v_was_dormant from public.profiles where id=p_user_id;
 if v_was_dormant then
  update public.profiles set dormant_since=null,weeks_inactive=0 where id=p_user_id;
  insert into public.contact_preferences(user_id,opted_out,updated_at) values(p_user_id,false,now()) on conflict(user_id) do update set opted_out=false,updated_at=now();
  return;
 end if;
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

create or replace function public.advance_weekly_config()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_config jsonb;v_week text;v_monday date;v_days jsonb;v_next_week text;v_next_sunday timestamptz;
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
  v_next_week:=to_char(v_monday+7,'IYYY-"W"IW');
  v_next_sunday:=((v_monday+6)::text||' 15:00:00')::timestamp at time zone 'America/Bogota';
  update public.profiles p set weeks_inactive=case
    when exists(select 1 from public.weekly_participations wp where wp.user_id=p.id and wp.week_code=v_week and wp.status='confirmed') then 0
    else weeks_inactive+1
   end
   where p.verification_status='approved' and p.dormant_since is null
    and not exists(select 1 from public.admin_users a where a.user_id=p.id)
    and exists(select 1 from public.weekly_participations wp2 where wp2.user_id=p.id and wp2.week_code=v_week);
  insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
  select 'dormant_notice',jsonb_build_object('userId',id),'dormant-notice:'||v_next_week||':'||id,v_next_sunday
  from public.profiles where verification_status='approved' and dormant_since is null and weeks_inactive>=3
   and not exists(select 1 from public.admin_users a where a.user_id=profiles.id)
  on conflict(idempotency_key) do nothing;
  update public.profiles set dormant_since=v_next_week where verification_status='approved' and dormant_since is null and weeks_inactive>=3
   and not exists(select 1 from public.admin_users a where a.user_id=profiles.id);
  select coalesce(jsonb_agg(day||jsonb_build_object(
   'date',((day->>'date')::date+7)::text,'blocked',false,'reason',''
  ) order by ordinal),'[]'::jsonb) into v_days
  from jsonb_array_elements(v_config->'days') with ordinality as item(day,ordinal);
  v_config:=jsonb_set(jsonb_set(v_config,'{weekCode}',to_jsonb(v_next_week)),'{days}',v_days);
 end loop;
 update public.meeting_config set value=v_config,updated_at=now() where key='current';
 return v_config;
end $$;
