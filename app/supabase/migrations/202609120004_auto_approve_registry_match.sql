

create or replace function public.submit_weekly_registration(p_full_name text,p_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[],p_known_emails text[]) returns public.verification_status language plpgsql security definer set search_path=public as $cm$
declare v_user_id uuid:=auth.uid();v_status public.verification_status;v_registry_id uuid;v_basis text;v_candidate_count int;v_email text:=lower(trim(coalesce(p_email,'')));v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');v_linkedin text:=nullif(trim(p_linkedin_url),'');v_auto_status public.verification_status;v_registry public.alumni_registry%rowtype;
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED';end if;
 if trim(p_full_name)='' or v_email='' or v_phone='' then raise exception 'PROFILE_REQUIRED';end if;
 if v_linkedin is null then raise exception 'LINKEDIN_URL_REQUIRED';end if;
 if p_school is null or p_school!~'^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'INVALID_SCHOOL';end if;
 if p_graduation_year not between 1900 and 2100 then raise exception 'INVALID_GRADUATION_YEAR';end if;
 if p_week_code!~'^[0-9]{4}-W[0-9]{2}$' then raise exception 'INVALID_WEEK_CODE';end if;
 update public.profiles set full_name=trim(p_full_name),email=v_email,normalized_email=v_email,phone=p_phone,normalized_phone=v_phone,linkedin_url=v_linkedin,school=p_school,graduation_year=p_graduation_year,city=trim(p_city),only_new_people=p_only_new_people,updated_at=now() where id=v_user_id;
 if not found then raise exception 'PROFILE_NOT_FOUND';end if;
 delete from public.weekly_availabilities where user_id=v_user_id and week_code=p_week_code;
 insert into public.weekly_availabilities(user_id,week_code,slot_id) select v_user_id,p_week_code,slot from unnest(coalesce(p_slot_ids,'{}')) slot where trim(slot)<>'' on conflict do nothing;
 delete from public.known_contacts where owner_id=v_user_id;
 insert into public.known_contacts(owner_id,normalized_phone) select v_user_id,phone from(select distinct regexp_replace(raw,'[^0-9+]','','g') phone from unnest(coalesce(p_known_phones,'{}')) raw)cleaned where phone~'^[+][1-9][0-9]{6,14}$';
 insert into public.known_contacts(owner_id,normalized_email) select v_user_id,email from(select distinct lower(trim(raw)) email from unnest(coalesce(p_known_emails,'{}')) raw)cleaned where email~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
 select count(*),(array_agg(id))[1],min(basis) into v_candidate_count,v_registry_id,v_basis from(select id,case when normalized_email=v_email then 'email' else 'phone' end basis from public.alumni_registry where active and(normalized_email=v_email or normalized_phone=v_phone))candidates;
 if v_candidate_count<>1 then v_registry_id:=null;v_basis:=null;end if;
 v_auto_status:=case when v_registry_id is not null then 'approved' else 'pending' end;
 insert into public.verification_requests(user_id,registry_id,status,match_basis,match_confidence,decided_at,notes)
  values(v_user_id,v_registry_id,v_auto_status,v_basis,case when v_registry_id is null then null else 1 end,
   case when v_auto_status='approved' then now() else null end,
   case when v_auto_status='approved' then 'Aprobación automática (coincidencia con el padrón)' else '' end)
  on conflict(user_id) do update set
   registry_id=case when verification_requests.status='pending' then excluded.registry_id else verification_requests.registry_id end,
   match_basis=case when verification_requests.status='pending' then excluded.match_basis else verification_requests.match_basis end,
   match_confidence=case when verification_requests.status='pending' then excluded.match_confidence else verification_requests.match_confidence end,
   status=case when verification_requests.status='pending' then excluded.status else verification_requests.status end,
   decided_at=case when verification_requests.status='pending' then excluded.decided_at else verification_requests.decided_at end,
   notes=case when verification_requests.status='pending' then excluded.notes else verification_requests.notes end,
   updated_at=now();
 if v_auto_status='approved' then
  select * into v_registry from public.alumni_registry where id=v_registry_id;
  update public.profiles set
   full_name=coalesce(nullif(trim(full_name),''),v_registry.full_name),
   alumni_email=coalesce(nullif(trim(alumni_email),''),nullif(trim(v_registry.email),''),nullif(trim(email),'')),
   phone=coalesce(nullif(trim(phone),''),v_registry.phone,''),
   normalized_phone=coalesce(nullif(trim(normalized_phone),''),v_registry.normalized_phone,''),
   school=coalesce(school,v_registry.school),
   graduation_year=coalesce(graduation_year,v_registry.graduation_year),
   verification_status='approved',updated_at=now()
  where id=v_user_id;
 end if;
 select verification_status into v_status from public.profiles where id=v_user_id;return v_status;
end $cm$;
revoke all on function public.submit_weekly_registration(text,text,text,text,text,int,text,boolean,text,text[],text[],text[]) from public,anon;
grant execute on function public.submit_weekly_registration(text,text,text,text,text,int,text,boolean,text,text[],text[],text[]) to authenticated;

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
  if p_status='approved' and p_registry_id is not null then
    select * into v_registry from public.alumni_registry where id=p_registry_id and active;
    if not found then raise exception 'ACTIVE_REGISTRY_LINK_REQUIRED';end if;
  end if;

  select * into v_request from public.verification_requests where id=p_request_id for update;
  if not found then raise exception 'VERIFICATION_NOT_FOUND';end if;
  if v_request.status=p_status and v_request.registry_id is not distinct from p_registry_id and v_request.notes=trim(coalesce(p_notes,'')) then return;end if;
  v_before:=to_jsonb(v_request);

  update public.verification_requests set
    status=p_status,
    registry_id=case when p_status='approved' then coalesce(p_registry_id,registry_id) else null end,
    match_basis=case when p_status='approved' then coalesce(match_basis,'manual') else match_basis end,
    notes=trim(coalesce(p_notes,'')),
    decided_by=v_actor,decided_at=now(),updated_at=now()
  where id=p_request_id;

  if p_status='approved' then
    if p_registry_id is not null then
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
      update public.profiles set verification_status='approved',updated_at=now()
      where id=v_request.user_id;
    end if;
  else
    update public.profiles set verification_status='rejected',updated_at=now()
    where id=v_request.user_id;
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
  select v_actor,'verification_'||p_status,'verification_request',p_request_id::text,v_before,to_jsonb(v)
  from public.verification_requests v where v.id=p_request_id;
end $$;
revoke all on function public.decide_verification_request(uuid,public.verification_status,uuid,text) from public,anon;
grant execute on function public.decide_verification_request(uuid,public.verification_status,uuid,text) to authenticated;

create or replace function public.get_admin_verification_page(p_query text default '',p_status text default null,p_page int default 1,p_page_size int default 10)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_status is not null and p_status not in('pending','approved','rejected') then raise exception 'INVALID_VERIFICATION_STATUS';end if;
 with filtered as(
  select r.*,p.full_name,p.email,p.alumni_email,p.phone,p.linkedin_url,p.school,p.graduation_year
  from public.verification_requests r join public.profiles p on p.id=r.user_id left join public.admin_users a on a.user_id=r.user_id
  where a.user_id is null and(p_status is null or r.status::text=p_status)
   and(trim(coalesce(p_query,''))='' or lower(p.full_name)like v_query or lower(coalesce(p.email,''))like v_query or lower(coalesce(p.alumni_email,''))like v_query or coalesce(p.phone,'')like v_query)
 ),page_rows as(select * from filtered order by updated_at desc,id limit v_size offset(v_page-1)*v_size)
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'userId',x.user_id,'registryId',x.registry_id,'status',x.status,'matchBasis',x.match_basis,'notes',x.notes,'decidedBy',x.decided_by,'decidedAt',x.decided_at,'createdAt',x.created_at,'updatedAt',x.updated_at,'fullName',x.full_name,'email',x.email,'alumniEmail',x.alumni_email,'phone',x.phone,'linkedin',x.linkedin_url,'school',x.school,'graduationYear',x.graduation_year)order by x.updated_at desc)from page_rows x),'[]'::jsonb),
  'total',(select count(*)from filtered),'pendingTotal',(select count(*)from public.verification_requests r left join public.admin_users a on a.user_id=r.user_id where a.user_id is null and r.status='pending')) into v_result;
 return v_result;
end $$;
revoke all on function public.get_admin_verification_page(text,text,int,int) from public,anon;
grant execute on function public.get_admin_verification_page(text,text,int,int) to authenticated;

create or replace function public.get_admin_participants_page(p_query text default '',p_page int default 1,p_page_size int default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 with filtered as(
  select p.* from public.profiles p left join public.admin_users a on a.user_id=p.id
  where a.user_id is null and p.verification_status='approved'
   and(trim(coalesce(p_query,''))='' or lower(p.full_name)like v_query or lower(coalesce(p.email,''))like v_query or lower(coalesce(p.alumni_email,''))like v_query or coalesce(p.phone,'')like v_query)
 ),page_rows as(select * from filtered order by updated_at desc,id limit v_size offset(v_page-1)*v_size)
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'fullName',x.full_name,'email',x.email,'alumniEmail',x.alumni_email,'phone',x.phone,'linkedinUrl',x.linkedin_url,'school',x.school,'graduationYear',x.graduation_year,'createdAt',x.created_at)order by x.updated_at desc)from page_rows x),'[]'::jsonb),
  'total',(select count(*)from filtered)) into v_result;
 return v_result;
end $$;
revoke all on function public.get_admin_participants_page(text,int,int) from public,anon;
grant execute on function public.get_admin_participants_page(text,int,int) to authenticated;

create or replace function public.admin_delete_account(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $cm$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if exists(select 1 from public.admin_users where user_id=p_user_id) then raise exception 'CANNOT_DELETE_ADMIN';end if;
 insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
  values('account_deletion',jsonb_build_object('userId',p_user_id),'account-deletion:'||p_user_id,now())
  on conflict(idempotency_key) do nothing;
 delete from public.profiles where id=p_user_id;
end $cm$;
revoke all on function public.admin_delete_account(uuid) from public,anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;
