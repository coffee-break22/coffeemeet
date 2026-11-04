create or replace function public.admin_seed_test_participant(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_linkedin_url text,
  p_school text,
  p_graduation_year int,
  p_city text,
  p_only_new_people boolean,
  p_week_code text,
  p_slot_ids text[],
  p_known_phone text default null,
  p_notes text default ''
) returns void language plpgsql security definer set search_path=public as $$
declare v_email text:=lower(trim(p_email));v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
  perform set_config('coffeemeet.auto_approve','true',true);
  update public.profiles set
    full_name=p_full_name,
    email=v_email,normalized_email=v_email,
    alumni_email=v_email,normalized_alumni_email=v_email,
    phone=p_phone,normalized_phone=v_phone,
    linkedin_url=p_linkedin_url,
    school=p_school,graduation_year=p_graduation_year,
    city=p_city,only_new_people=p_only_new_people,
    verification_status='approved',updated_at=now()
  where id=p_user_id;
  if not found then raise exception 'PROFILE_NOT_FOUND: %',p_user_id; end if;
  insert into public.verification_requests(user_id,status,match_basis,match_confidence,decided_at,notes,updated_at)
  values(p_user_id,'approved','manual',1,now(),coalesce(p_notes,'')||' — Cuenta de prueba E2E (importada por script)',now())
  on conflict(user_id) do update set status='approved',match_basis='manual',decided_at=now(),notes=excluded.notes,updated_at=now();
  insert into public.weekly_availabilities(user_id,week_code,slot_id,is_active)
  select p_user_id,p_week_code,s,true from unnest(p_slot_ids) s
  on conflict(user_id,week_code,slot_id) do update set is_active=true;
  insert into public.weekly_participations(user_id,week_code,status)
  values(p_user_id,p_week_code,'pending')
  on conflict(user_id,week_code) do nothing;
  delete from public.known_contacts where owner_id=p_user_id;
  if p_known_phone is not null and trim(p_known_phone)<>'' then
    insert into public.known_contacts(owner_id,normalized_phone)
    values(p_user_id,regexp_replace(p_known_phone,'[^0-9+]','','g'));
  end if;
end $$;
revoke all on function public.admin_seed_test_participant(uuid,text,text,text,text,text,int,text,boolean,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.admin_seed_test_participant(uuid,text,text,text,text,text,int,text,boolean,text,text[],text,text) to service_role;
