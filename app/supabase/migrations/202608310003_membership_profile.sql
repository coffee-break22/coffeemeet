create or replace function public.complete_membership_profile(
  p_full_name text,
  p_contact_email text,
  p_alumni_email text,
  p_phone text,
  p_linkedin_url text,
  p_school public.school,
  p_graduation_year int
) returns public.verification_status
language plpgsql security definer set search_path=public as $$
declare v_user_id uuid:=auth.uid();v_alumni_email text:=lower(trim(coalesce(p_alumni_email,'')));v_contact_email text:=lower(trim(coalesce(p_contact_email,'')));v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');v_registry_id uuid;v_basis text;v_count int;v_status public.verification_status;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED';end if;
  if exists(select 1 from public.admin_users where user_id=v_user_id) then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
  if trim(coalesce(p_full_name,''))='' or v_contact_email='' or v_alumni_email='' or v_phone='' then raise exception 'MEMBERSHIP_DATA_REQUIRED';end if;
  if p_graduation_year not between 1900 and 2100 then raise exception 'INVALID_GRADUATION_YEAR';end if;

  update public.profiles set full_name=trim(p_full_name),email=v_contact_email,normalized_email=v_contact_email,
    alumni_email=v_alumni_email,normalized_alumni_email=v_alumni_email,phone=p_phone,normalized_phone=v_phone,
    linkedin_url=nullif(trim(p_linkedin_url),''),school=p_school,graduation_year=p_graduation_year,updated_at=now()
  where id=v_user_id;

  select count(*),(array_agg(id))[1],min(basis) into v_count,v_registry_id,v_basis from(
    select id,case when normalized_email=v_alumni_email then 'email' else 'phone' end basis
    from public.alumni_registry where active and(normalized_email=v_alumni_email or normalized_phone=v_phone)
  )candidate;
  if v_count<>1 then v_registry_id:=null;v_basis:=null;end if;

  insert into public.verification_requests(user_id,registry_id,status,match_basis,match_confidence,notes)
  values(v_user_id,v_registry_id,'pending',v_basis,case when v_registry_id is null then null else 1 end,'')
  on conflict(user_id) do update set
    registry_id=case when verification_requests.status='pending' then excluded.registry_id else verification_requests.registry_id end,
    match_basis=case when verification_requests.status='pending' then excluded.match_basis else verification_requests.match_basis end,
    match_confidence=case when verification_requests.status='pending' then excluded.match_confidence else verification_requests.match_confidence end,
    notes=case when verification_requests.status='pending' then '' else verification_requests.notes end,
    updated_at=now();

  select verification_status into v_status from public.profiles where id=v_user_id;
  return v_status;
end $$;

revoke all on function public.complete_membership_profile(text,text,text,text,text,public.school,int) from public;
grant execute on function public.complete_membership_profile(text,text,text,text,text,public.school,int) to authenticated;
