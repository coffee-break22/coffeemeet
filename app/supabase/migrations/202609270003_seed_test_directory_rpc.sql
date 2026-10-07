create or replace function public.admin_seed_test_directory_entry(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_school text,
  p_graduation_year int
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_email text:=lower(trim(p_email));v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');v_registry_id uuid;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
  perform set_config('coffeemeet.auto_approve','true',true);
  select id into v_registry_id from public.alumni_registry where normalized_email=v_email;
  if v_registry_id is null then
    insert into public.alumni_registry(full_name,email,normalized_email,phone,normalized_phone,school,graduation_year,active,source,notes)
    values(p_full_name,v_email,v_email,p_phone,v_phone,p_school,p_graduation_year,true,'manual','Cuenta de prueba E2E (importada por script)')
    returning id into v_registry_id;
  end if;
  update public.verification_requests set registry_id=v_registry_id,match_basis='email',match_confidence=1,updated_at=now() where user_id=p_user_id;
  return v_registry_id;
end $$;
revoke all on function public.admin_seed_test_directory_entry(uuid,text,text,text,text,int) from public,anon,authenticated;
grant execute on function public.admin_seed_test_directory_entry(uuid,text,text,text,text,int) to service_role;
