create or replace function public.submit_weekly_registration(
  p_full_name text,
  p_email text,
  p_phone text,
  p_linkedin_url text,
  p_school public.school,
  p_graduation_year int,
  p_city text,
  p_only_new_people boolean,
  p_week_code text,
  p_slot_ids text[],
  p_known_phones text[]
) returns public.verification_status
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_status public.verification_status;
  v_registry_id uuid;
  v_basis text;
  v_candidate_count int;
  v_email text:=lower(trim(coalesce(p_email,'')));
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if trim(p_full_name)='' or v_email='' or v_phone='' then raise exception 'PROFILE_REQUIRED'; end if;
  if p_graduation_year not between 1900 and 2100 then raise exception 'INVALID_GRADUATION_YEAR'; end if;
  if p_week_code !~ '^[0-9]{4}-W[0-9]{2}$' then raise exception 'INVALID_WEEK_CODE'; end if;

  update public.profiles set
    full_name=trim(p_full_name),email=v_email,normalized_email=v_email,
    phone=p_phone,normalized_phone=v_phone,linkedin_url=nullif(trim(p_linkedin_url),''),
    school=p_school,graduation_year=p_graduation_year,city=trim(p_city),
    only_new_people=p_only_new_people,updated_at=now()
  where id=v_user_id;

  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  delete from public.weekly_availabilities where user_id=v_user_id and week_code=p_week_code;
  insert into public.weekly_availabilities(user_id,week_code,slot_id)
  select v_user_id,p_week_code,slot from unnest(coalesce(p_slot_ids,'{}')) slot
  where trim(slot)<>'' on conflict do nothing;

  delete from public.known_contacts where owner_id=v_user_id;
  insert into public.known_contacts(owner_id,normalized_phone)
  select v_user_id,phone from (
    select distinct regexp_replace(raw,'[^0-9+]','','g') phone
    from unnest(coalesce(p_known_phones,'{}')) raw
  ) cleaned where phone~'^[+][1-9][0-9]{6,14}$';

  select count(*),(array_agg(id))[1],min(basis) into v_candidate_count,v_registry_id,v_basis
  from (
    select id,case when normalized_email=v_email then 'email' else 'phone' end basis
    from public.alumni_registry
    where active and (normalized_email=v_email or normalized_phone=v_phone)
  ) candidates;

  if v_candidate_count<>1 then v_registry_id:=null;v_basis:=null;end if;

  insert into public.verification_requests(user_id,registry_id,status,match_basis,match_confidence)
  values(v_user_id,v_registry_id,'pending',v_basis,case when v_registry_id is null then null else 1 end)
  on conflict(user_id) do update set
    registry_id=case when verification_requests.status='pending' then excluded.registry_id else verification_requests.registry_id end,
    match_basis=case when verification_requests.status='pending' then excluded.match_basis else verification_requests.match_basis end,
    match_confidence=case when verification_requests.status='pending' then excluded.match_confidence else verification_requests.match_confidence end,
    updated_at=now();

  select verification_status into v_status from public.profiles where id=v_user_id;
  return v_status;
end $$;


revoke all on function public.submit_weekly_registration(text,text,text,text,public.school,int,text,boolean,text,text[],text[]) from public,anon;
grant execute on function public.submit_weekly_registration(text,text,text,text,public.school,int,text,boolean,text,text[],text[]) to authenticated;
