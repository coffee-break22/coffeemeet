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
  v_before jsonb;
begin
  if v_actor is null or not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
  if p_status not in ('approved','rejected') then raise exception 'INVALID_DECISION';end if;
  if p_status='approved' and p_registry_id is null then raise exception 'REGISTRY_LINK_REQUIRED';end if;
  if p_status='approved' and not exists(select 1 from public.alumni_registry where id=p_registry_id and active) then
    raise exception 'ACTIVE_REGISTRY_LINK_REQUIRED';
  end if;

  select * into v_request from public.verification_requests where id=p_request_id for update;
  if not found then raise exception 'VERIFICATION_NOT_FOUND';end if;
  if v_request.status=p_status and v_request.registry_id is not distinct from p_registry_id and v_request.notes=trim(coalesce(p_notes,'')) then return;end if;
  v_before:=to_jsonb(v_request);

  update public.verification_requests set
    status=p_status,
    registry_id=case when p_status='approved' then p_registry_id else null end,
    notes=trim(coalesce(p_notes,'')),
    decided_by=v_actor,decided_at=now(),updated_at=now()
  where id=p_request_id;

  update public.profiles set verification_status=p_status,updated_at=now()
  where id=v_request.user_id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
  select v_actor,'verification_'||p_status,'verification_request',p_request_id::text,v_before,to_jsonb(v)
  from public.verification_requests v where v.id=p_request_id;
end $$;

revoke all on function public.decide_verification_request(uuid,public.verification_status,uuid,text) from public;
grant execute on function public.decide_verification_request(uuid,public.verification_status,uuid,text) to authenticated;
