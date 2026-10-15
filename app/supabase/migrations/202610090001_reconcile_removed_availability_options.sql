-- Invalida opciones retiradas sin tocar semanas históricas ni citas creadas.

create or replace function public.weekly_slot_is_valid(
 p_slot_id text,p_week_code text,p_config jsonb default null
) returns boolean language plpgsql stable set search_path=public as $$
declare v_config jsonb:=p_config;v_mode text:=split_part(p_slot_id,'|',1);
 v_city text;v_place text;v_date date;v_time text;
begin
 if v_config is null then select value into v_config from public.meeting_config where key='current';end if;
 if v_config is null or coalesce(v_config->>'weekCode','')<>p_week_code then return false;end if;
 if v_mode='virtual' then
  begin v_date:=split_part(p_slot_id,'|',2)::date;exception when others then return false;end;
  v_time:=split_part(p_slot_id,'|',3);
 else
  v_city:=v_mode;v_place:=split_part(p_slot_id,'|',2);
  begin v_date:=split_part(p_slot_id,'|',3)::date;exception when others then return false;end;
  v_time:=split_part(p_slot_id,'|',4);
  if not exists(
   select 1 from jsonb_array_elements(coalesce(v_config->'cities','[]'::jsonb)) city
   cross join lateral jsonb_array_elements(coalesce(city->'places','[]'::jsonb)) place
   where lower(trim(city->>'name'))=lower(trim(v_city))
    and lower(trim(place->>'name'))=lower(trim(v_place))
  ) then return false;end if;
 end if;
 return exists(
  select 1 from jsonb_array_elements(coalesce(v_config->'days','[]'::jsonb)) day
  where day->>'date'=v_date::text and coalesce((day->>'enabled')::boolean,true)
 ) and exists(
  select 1 from jsonb_array_elements_text(coalesce(v_config->'times','[]'::jsonb)) configured_time
  where configured_time=v_time
 );
end $$;
revoke all on function public.weekly_slot_is_valid(text,text,jsonb) from public,anon;
grant execute on function public.weekly_slot_is_valid(text,text,jsonb) to authenticated,service_role;

create or replace function public.guard_current_week_availability()
returns trigger language plpgsql set search_path=public as $$
declare v_config jsonb;v_week text;
begin
 if not new.is_active then return new;end if;
 select value into v_config from public.meeting_config where key='current';
 v_week:=v_config->>'weekCode';
 if new.week_code=v_week and not public.weekly_slot_is_valid(new.slot_id,new.week_code,v_config) then new.is_active:=false;end if;
 return new;
end $$;
drop trigger if exists guard_current_week_availability on public.weekly_availabilities;
create trigger guard_current_week_availability before insert or update of slot_id,is_active,week_code
on public.weekly_availabilities for each row execute function public.guard_current_week_availability();

create or replace function public.reconcile_current_week_availability()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_config jsonb;v_week text;v_affected uuid[];v_invalidated int:=0;v_requires_update int:=0;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' and not public.is_admin() then raise exception 'ADMIN_OR_SERVICE_ROLE_REQUIRED';end if;
 select value into v_config from public.meeting_config where key='current';
 v_week:=v_config->>'weekCode';
 if v_week is null then raise exception 'MEETING_CONFIG_NOT_FOUND';end if;
 select array_agg(distinct wa.user_id) into v_affected
 from public.weekly_availabilities wa where wa.week_code=v_week and wa.is_active
  and not public.weekly_slot_is_valid(wa.slot_id,v_week,v_config);
 update public.weekly_availabilities wa set is_active=false
 where wa.week_code=v_week and wa.is_active
  and not public.weekly_slot_is_valid(wa.slot_id,v_week,v_config);
 get diagnostics v_invalidated=row_count;
 if coalesce(array_length(v_affected,1),0)>0 then
  insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
  select 'availability_update_required',jsonb_build_object('userId',p.id,'weekCode',v_week),
   'availability-update-required:'||v_week||':'||p.id,now()
  from public.profiles p where p.id=any(v_affected) and p.verification_status='approved'
   and not exists(select 1 from public.admin_users a where a.user_id=p.id)
   and not exists(select 1 from public.weekly_availabilities a where a.user_id=p.id and a.week_code=v_week and a.is_active)
   and not exists(select 1 from public.meetings m where m.week_code=v_week and p.id in(m.user_a_id,m.user_b_id) and m.status<>'draft')
   and public.app_now()<public.weekly_confirmation_cutoff(v_week)
  on conflict(idempotency_key) do nothing;
  get diagnostics v_requires_update=row_count;
 end if;
 return jsonb_build_object('weekCode',v_week,'invalidatedSlots',v_invalidated,'participantsRequiringUpdate',v_requires_update);
end $$;
revoke all on function public.reconcile_current_week_availability() from public,anon,authenticated;
grant execute on function public.reconcile_current_week_availability() to authenticated,service_role;

create or replace function public.reconcile_availability_after_config_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.key='current' and new.value is distinct from old.value then perform public.reconcile_current_week_availability();end if;
 return new;
end $$;
drop trigger if exists reconcile_availability_after_config_change on public.meeting_config;
create trigger reconcile_availability_after_config_change after update of value on public.meeting_config
for each row execute function public.reconcile_availability_after_config_change();

create or replace function public.get_meeting_config_change_impact(p_config jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_week text;v_result jsonb;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_week:=p_config->>'weekCode';
 if v_week is null or v_week!~'^[0-9]{4}-W[0-9]{2}$' then raise exception 'INVALID_WEEK_CODE';end if;
 with people as(
  select p.id,(select max(wa.week_code) from public.weekly_availabilities wa
   where wa.user_id=p.id and wa.week_code<=v_week and wa.is_active) source_week
  from public.profiles p where p.verification_status='approved'
   and not exists(select 1 from public.admin_users a where a.user_id=p.id)
   and not exists(select 1 from public.meetings m where m.week_code=v_week and p.id in(m.user_a_id,m.user_b_id) and m.status<>'draft')
 ),evaluated as(
  select person.id,
   bool_or(not public.weekly_slot_is_valid(case when person.source_week=v_week then wa.slot_id else public.shift_weekly_slot(wa.slot_id,person.source_week,v_week) end,v_week,p_config)) affected,
   bool_or(public.weekly_slot_is_valid(case when person.source_week=v_week then wa.slot_id else public.shift_weekly_slot(wa.slot_id,person.source_week,v_week) end,v_week,p_config)) has_valid
  from people person join public.weekly_availabilities wa
   on wa.user_id=person.id and wa.week_code=person.source_week and wa.is_active
  where person.source_week is not null group by person.id
 )
 select jsonb_build_object(
  'affectedParticipants',count(*)filter(where affected),
  'participantsRequiringUpdate',count(*)filter(where affected and not has_valid)
 ) into v_result from evaluated;
 return coalesce(v_result,jsonb_build_object('affectedParticipants',0,'participantsRequiringUpdate',0));
end $$;
revoke all on function public.get_meeting_config_change_impact(jsonb) from public,anon;
grant execute on function public.get_meeting_config_change_impact(jsonb) to authenticated;

-- Hereda únicamente combinaciones que siguen disponibles en la configuración.
create or replace function public.prepare_weekly_confirmations(p_week_code text)
returns int language plpgsql security definer set search_path=public as $$
declare v_count int:=0;v_config jsonb;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select value into v_config from public.meeting_config where key='current';
 if coalesce(v_config->>'weekCode','')<>p_week_code then raise exception 'CONFIG_WEEK_MISMATCH';end if;
 perform public.reconcile_current_week_availability();
 with latest as(
  select p.id user_id,(select max(w.week_code) from public.weekly_availabilities w
   where w.user_id=p.id and w.week_code<p_week_code and w.is_active) source_week
  from public.profiles p where p.verification_status='approved' and p.dormant_since is null
   and not exists(select 1 from public.admin_users a where a.user_id=p.id)
 ),eligible as(select * from latest where source_week is not null)
 insert into public.weekly_participations(user_id,week_code,status)
 select user_id,p_week_code,'pending' from eligible on conflict do nothing;
 with source as(
  select wp.user_id,(select max(w.week_code) from public.weekly_availabilities w
   where w.user_id=wp.user_id and w.week_code<p_week_code and w.is_active) source_week
  from public.weekly_participations wp where wp.week_code=p_week_code
   and not exists(select 1 from public.weekly_availabilities x where x.user_id=wp.user_id and x.week_code=p_week_code)
 ),shifted as(
  select s.user_id,public.shift_weekly_slot(w.slot_id,s.source_week,p_week_code) slot_id
  from source s join public.weekly_availabilities w
   on w.user_id=s.user_id and w.week_code=s.source_week and w.is_active
 )
 insert into public.weekly_availabilities(user_id,week_code,slot_id,is_active)
 select user_id,p_week_code,slot_id,true from shifted
 where public.weekly_slot_is_valid(slot_id,p_week_code,v_config)
 on conflict(user_id,week_code,slot_id) do nothing;
 get diagnostics v_count=row_count;
 insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
 select 'availability_update_required',jsonb_build_object('userId',wp.user_id,'weekCode',p_week_code),
  'availability-update-required:'||p_week_code||':'||wp.user_id,now()
 from public.weekly_participations wp join public.profiles p on p.id=wp.user_id
 where wp.week_code=p_week_code and wp.status in('pending','confirmed') and p.verification_status='approved'
  and not exists(select 1 from public.weekly_availabilities wa where wa.user_id=wp.user_id and wa.week_code=p_week_code and wa.is_active)
  and not exists(select 1 from public.meetings m where m.week_code=p_week_code and wp.user_id in(m.user_a_id,m.user_b_id) and m.status<>'draft')
 on conflict(idempotency_key) do nothing;
 return v_count;
end $$;
revoke all on function public.prepare_weekly_confirmations(text) from public,anon,authenticated;
grant execute on function public.prepare_weekly_confirmations(text) to service_role;

-- El admin ve un estado explícito en vez de confundirlo con retiro.
create or replace function public.get_admin_live_confirmations_page(
 p_week_code text,p_query text default '',p_page int default 1,p_page_size int default 20
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_cutoff timestamptz;v_open_from timestamptz;v_window_open boolean;
 v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);
 v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_cutoff:=public.weekly_confirmation_cutoff(p_week_code);
 v_open_from:=((public.week_monday(p_week_code)-1)::text||' 19:00:00')::timestamp at time zone 'America/Bogota';
 v_window_open:=public.app_now()>=v_open_from and public.app_now()<v_cutoff;
 if not v_window_open then
  return jsonb_build_object('windowOpen',false,'items','[]'::jsonb,'total',0,
   'counts',jsonb_build_object('confirmed',0,'pending',0,'withdrawn',0,'needsAvailability',0),
   'opensAt',v_open_from,'closesAt',v_cutoff);
 end if;
 with eligible as(
  select p.id,p.full_name,p.email,p.phone,p.school,wp.confirmed_at,
   case when not exists(select 1 from public.weekly_availabilities wa
    where wa.user_id=p.id and wa.week_code=p_week_code and wa.is_active)
    then 'needs_availability' else coalesce(wp.status,'pending') end status
  from public.profiles p left join public.admin_users a on a.user_id=p.id
   left join public.weekly_participations wp on wp.user_id=p.id and wp.week_code=p_week_code
  where a.user_id is null and p.verification_status='approved'
 ),filtered as(
  select * from eligible where trim(coalesce(p_query,''))='' or lower(full_name)like v_query
   or lower(coalesce(email,''))like v_query or coalesce(phone,'')like v_query
 ),page_rows as(select * from filtered order by full_name limit v_size offset(v_page-1)*v_size),
 counts as(
  select count(*)filter(where status='confirmed') confirmed,
   count(*)filter(where status='pending') pending,
   count(*)filter(where status='withdrawn') withdrawn,
   count(*)filter(where status='needs_availability') needs_availability from eligible
 )
 select jsonb_build_object(
  'windowOpen',true,
  'items',coalesce((select jsonb_agg(jsonb_build_object(
   'id',x.id,'fullName',x.full_name,'email',x.email,'phone',x.phone,'school',x.school,
   'status',x.status,'confirmedAt',x.confirmed_at)order by x.full_name)from page_rows x),'[]'::jsonb),
  'total',(select count(*)from filtered),
  'counts',jsonb_build_object('confirmed',c.confirmed,'pending',c.pending,
   'withdrawn',c.withdrawn,'needsAvailability',c.needs_availability),
  'opensAt',v_open_from,'closesAt',v_cutoff
 ) into v_result from counts c;
 return v_result;
end $$;
revoke all on function public.get_admin_live_confirmations_page(text,text,int,int) from public,anon;
grant execute on function public.get_admin_live_confirmations_page(text,text,int,int) to authenticated;
