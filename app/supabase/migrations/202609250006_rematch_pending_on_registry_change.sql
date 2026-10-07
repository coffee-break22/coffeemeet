create or replace function public.rematch_pending_verification_requests()
returns int language plpgsql security definer set search_path=public as $$
declare v_count int:=0;v_req record;v_candidate_count int;v_registry_id uuid;v_basis text;v_registry public.alumni_registry%rowtype;
begin
 if not public.is_admin() and coalesce(current_setting('coffeemeet.auto_approve',true),'')<>'true' then raise exception 'ADMIN_REQUIRED';end if;
 for v_req in
  select vr.id req_id,vr.user_id,p.normalized_email,p.normalized_phone
  from public.verification_requests vr
  join public.profiles p on p.id=vr.user_id
  where vr.status='pending'
 loop
  select count(*),(array_agg(id))[1],min(basis) into v_candidate_count,v_registry_id,v_basis
  from(
   select id,case when normalized_email=v_req.normalized_email then 'email' else 'phone' end basis
   from public.alumni_registry
   where active
    and((v_req.normalized_email<>'' and normalized_email=v_req.normalized_email)
        or(v_req.normalized_phone<>'' and normalized_phone=v_req.normalized_phone))
  )candidates;
  if v_candidate_count=1 then
   select * into v_registry from public.alumni_registry where id=v_registry_id;
   update public.verification_requests set
    registry_id=v_registry_id,match_basis=v_basis,match_confidence=1,
    status='approved',decided_at=now(),
    notes='Aprobación automática (coincidencia con el padrón)',updated_at=now()
   where id=v_req.req_id;
   update public.profiles set
    full_name=coalesce(nullif(trim(full_name),''),v_registry.full_name),
    alumni_email=coalesce(nullif(trim(alumni_email),''),nullif(trim(v_registry.email),''),nullif(trim(email),'')),
    phone=coalesce(nullif(trim(phone),''),v_registry.phone,''),
    normalized_phone=coalesce(nullif(trim(normalized_phone),''),v_registry.normalized_phone,''),
    school=coalesce(school,v_registry.school),
    graduation_year=coalesce(graduation_year,v_registry.graduation_year),
    verification_status='approved',updated_at=now()
   where id=v_req.user_id;
   v_count:=v_count+1;
  end if;
 end loop;
 return v_count;
end $$;
revoke all on function public.rematch_pending_verification_requests() from public,anon;
grant execute on function public.rematch_pending_verification_requests() to authenticated;

create or replace function public.trigger_rematch_on_registry_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform public.rematch_pending_verification_requests();
 return null;
end $$;

drop trigger if exists rematch_pending_on_registry_change on public.alumni_registry;
create trigger rematch_pending_on_registry_change
after insert or update on public.alumni_registry
for each statement execute function public.trigger_rematch_on_registry_change();

-- Backfill único: atrapa solicitudes que ya estaban pendientes ANTES de
-- este trigger (como "joselin l") y que ya coinciden con el directorio hoy.
-- Corre desde el SQL Editor (sin sesión de admin autenticada), así que usa
-- el mismo GUC de escape que ya usa submit_weekly_registration.
select set_config('coffeemeet.auto_approve','true',false);
select public.rematch_pending_verification_requests();
select set_config('coffeemeet.auto_approve','false',false);
