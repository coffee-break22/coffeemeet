create or replace function public.protect_verification_status()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.verification_status is distinct from old.verification_status and not public.is_admin() then
    raise exception 'ADMIN_REQUIRED_FOR_VERIFICATION';
  end if;
  if new.verification_status='approved' and new.verification_status is distinct from old.verification_status then
    if nullif(trim(coalesce(new.full_name,'')),'') is null
      or nullif(trim(coalesce(new.phone,'')),'') is null
      or nullif(trim(coalesce(new.alumni_email,'')),'') is null
      or new.school is null
      or new.graduation_year is null then
      raise exception 'PROFILE_INCOMPLETE_FOR_APPROVAL';
    end if;
    if not exists(
      select 1 from public.verification_requests request
      join public.alumni_registry registry on registry.id=request.registry_id and registry.active
      where request.user_id=new.id and request.status='approved'
    ) then
      raise exception 'ACTIVE_REGISTRY_LINK_REQUIRED';
    end if;
  end if;
  return new;
end $$;
