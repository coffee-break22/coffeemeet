create or replace function public.decide_verification_request(
  p_request_id uuid,
  p_status public.verification_status,
  p_registry_id uuid default null,
  p_notes text default ''
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor uuid:=auth.uid();
  v_request public.verification_requests%rowtype;
  v_registry public.alumni_registry%rowtype;
  v_before jsonb;
begin
  if v_actor is null or not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
  if p_status not in ('approved','rejected') then raise exception 'INVALID_DECISION';end if;
  if p_status='approved' and p_registry_id is null then raise exception 'REGISTRY_LINK_REQUIRED';end if;
  if p_status='approved' then
    select * into v_registry from public.alumni_registry where id=p_registry_id and active;
    if not found then raise exception 'ACTIVE_REGISTRY_LINK_REQUIRED';end if;
  end if;

  select * into v_request from public.verification_requests where id=p_request_id for update;
  if not found then raise exception 'VERIFICATION_NOT_FOUND';end if;
  if v_request.status=p_status and v_request.registry_id is not distinct from p_registry_id and v_request.notes=trim(coalesce(p_notes,'')) then return;end if;
  v_before:=to_jsonb(v_request);

  update public.verification_requests set
    status=p_status,
    registry_id=case when p_status='approved' then p_registry_id else null end,
    match_basis=case when p_status='approved' then coalesce(match_basis,'manual') else match_basis end,
    notes=trim(coalesce(p_notes,'')),
    decided_by=v_actor,decided_at=now(),updated_at=now()
  where id=p_request_id;

  if p_status='approved' then
    update public.profiles set
      full_name=coalesce(nullif(trim(full_name),''),v_registry.full_name),
      alumni_email=coalesce(nullif(trim(alumni_email),''),nullif(trim(v_registry.email),''),nullif(trim(email),'')),
      phone=coalesce(nullif(trim(phone),''),v_registry.phone,''),
      normalized_phone=coalesce(nullif(trim(normalized_phone),''),v_registry.normalized_phone,''),
      school=coalesce(school,v_registry.school),
      graduation_year=coalesce(graduation_year,v_registry.graduation_year),
      verification_status='approved',updated_at=now()
    where id=v_request.user_id;
  else
    update public.profiles set verification_status='rejected',updated_at=now()
    where id=v_request.user_id;
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
  select v_actor,'verification_'||p_status,'verification_request',p_request_id::text,v_before,to_jsonb(v)
  from public.verification_requests v where v.id=p_request_id;
end $$;

create or replace function public.get_admin_participant_counts(p_week_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 select jsonb_build_object(
  'registered',count(*)filter(where a.user_id is null),
  'approved',count(*)filter(where a.user_id is null and p.verification_status='approved'),
  'confirmed',count(*)filter(where a.user_id is null and wp.status='confirmed'),
  'eligible',count(*)filter(where a.user_id is null and p.verification_status='approved' and wp.status='confirmed' and exists(
    select 1 from public.weekly_availabilities wa where wa.user_id=p.id and wa.week_code=p_week_code and wa.is_active
  ))
 ) into v_result
 from public.profiles p
 left join public.admin_users a on a.user_id=p.id
 left join public.weekly_participations wp on wp.user_id=p.id and wp.week_code=p_week_code;
 return v_result;
end $$;

revoke all on function public.decide_verification_request(uuid,public.verification_status,uuid,text),public.get_admin_participant_counts(text) from public,anon;
grant execute on function public.decide_verification_request(uuid,public.verification_status,uuid,text),public.get_admin_participant_counts(text) to authenticated;
