begin;

drop function if exists public.submit_weekly_registration_v2(text,text,text,text,text,public.school,int,text,boolean,text,text[],text[]);
drop function if exists public.submit_weekly_registration(text,text,text,text,public.school,int,text,boolean,text,text[],text[]);
drop function if exists public.complete_membership_profile(text,text,text,text,text,public.school,int);

alter table public.profiles alter column school type text using school::text;
alter table public.alumni_registry alter column school type text using school::text;
alter table public.profiles add constraint profiles_school_format check(school is null or school ~ '^[a-z0-9][a-z0-9_-]{0,79}$') not valid;
alter table public.alumni_registry add constraint alumni_registry_school_format check(school is null or school ~ '^[a-z0-9][a-z0-9_-]{0,79}$') not valid;
alter table public.profiles validate constraint profiles_school_format;
alter table public.alumni_registry validate constraint alumni_registry_school_format;

create function public.submit_weekly_registration(p_full_name text,p_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[]) returns public.verification_status language plpgsql security definer set search_path=public as $cm$
declare v_user_id uuid:=auth.uid();v_status public.verification_status;v_registry_id uuid;v_basis text;v_candidate_count int;v_email text:=lower(trim(coalesce(p_email,'')));v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED';end if;
 if trim(p_full_name)='' or v_email='' or v_phone='' then raise exception 'PROFILE_REQUIRED';end if;
 if p_school is null or p_school!~'^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'INVALID_SCHOOL';end if;
 if p_graduation_year not between 1900 and 2100 then raise exception 'INVALID_GRADUATION_YEAR';end if;
 if p_week_code!~'^[0-9]{4}-W[0-9]{2}$' then raise exception 'INVALID_WEEK_CODE';end if;
 update public.profiles set full_name=trim(p_full_name),email=v_email,normalized_email=v_email,phone=p_phone,normalized_phone=v_phone,linkedin_url=nullif(trim(p_linkedin_url),''),school=p_school,graduation_year=p_graduation_year,city=trim(p_city),only_new_people=p_only_new_people,updated_at=now() where id=v_user_id;
 if not found then raise exception 'PROFILE_NOT_FOUND';end if;
 delete from public.weekly_availabilities where user_id=v_user_id and week_code=p_week_code;
 insert into public.weekly_availabilities(user_id,week_code,slot_id) select v_user_id,p_week_code,slot from unnest(coalesce(p_slot_ids,'{}')) slot where trim(slot)<>'' on conflict do nothing;
 delete from public.known_contacts where owner_id=v_user_id;
 insert into public.known_contacts(owner_id,normalized_phone) select v_user_id,phone from(select distinct regexp_replace(raw,'[^0-9+]','','g') phone from unnest(coalesce(p_known_phones,'{}')) raw)cleaned where phone~'^[+][1-9][0-9]{6,14}$';
 select count(*),(array_agg(id))[1],min(basis) into v_candidate_count,v_registry_id,v_basis from(select id,case when normalized_email=v_email then 'email' else 'phone' end basis from public.alumni_registry where active and(normalized_email=v_email or normalized_phone=v_phone))candidates;
 if v_candidate_count<>1 then v_registry_id:=null;v_basis:=null;end if;
 insert into public.verification_requests(user_id,registry_id,status,match_basis,match_confidence) values(v_user_id,v_registry_id,'pending',v_basis,case when v_registry_id is null then null else 1 end) on conflict(user_id) do update set registry_id=case when verification_requests.status='pending' then excluded.registry_id else verification_requests.registry_id end,match_basis=case when verification_requests.status='pending' then excluded.match_basis else verification_requests.match_basis end,match_confidence=case when verification_requests.status='pending' then excluded.match_confidence else verification_requests.match_confidence end,updated_at=now();
 select verification_status into v_status from public.profiles where id=v_user_id;return v_status;
end $cm$;

create function public.submit_weekly_registration_v2(p_full_name text,p_contact_email text,p_alumni_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[]) returns public.verification_status language plpgsql security definer set search_path=public as $cm$
declare v_status public.verification_status;v_alumni text:=lower(trim(coalesce(p_alumni_email,'')));v_contact text:=lower(trim(coalesce(p_contact_email,'')));
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;if public.is_admin() then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
 if now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;if v_alumni='' then raise exception 'ALUMNI_EMAIL_REQUIRED';end if;if v_contact='' then raise exception 'CONTACT_EMAIL_REQUIRED';end if;
 select public.submit_weekly_registration(p_full_name,v_alumni,p_phone,p_linkedin_url,p_school,p_graduation_year,p_city,p_only_new_people,p_week_code,p_slot_ids,p_known_phones) into v_status;
 update public.profiles set email=v_contact,normalized_email=v_contact,alumni_email=v_alumni,normalized_alumni_email=v_alumni,updated_at=now() where id=auth.uid();
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(auth.uid(),p_week_code,'confirmed',now(),now()) on conflict(user_id,week_code) do update set status='confirmed',confirmed_at=now(),updated_at=now();return v_status;
end $cm$;

create function public.complete_membership_profile(p_full_name text,p_contact_email text,p_alumni_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int) returns public.verification_status language plpgsql security definer set search_path=public as $cm$
declare v_user_id uuid:=auth.uid();v_alumni_email text:=lower(trim(coalesce(p_alumni_email,'')));v_contact_email text:=lower(trim(coalesce(p_contact_email,'')));v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');v_registry_id uuid;v_basis text;v_count int;v_status public.verification_status;
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED';end if;if public.is_admin() then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
 if trim(coalesce(p_full_name,''))='' or v_contact_email='' or v_alumni_email='' or v_phone='' then raise exception 'MEMBERSHIP_DATA_REQUIRED';end if;
 if p_school is null or p_school!~'^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'INVALID_SCHOOL';end if;
 if p_graduation_year not between 1900 and 2100 then raise exception 'INVALID_GRADUATION_YEAR';end if;
 update public.profiles set full_name=trim(p_full_name),email=v_contact_email,normalized_email=v_contact_email,alumni_email=v_alumni_email,normalized_alumni_email=v_alumni_email,phone=p_phone,normalized_phone=v_phone,linkedin_url=nullif(trim(p_linkedin_url),''),school=p_school,graduation_year=p_graduation_year,updated_at=now() where id=v_user_id;
 select count(*),(array_agg(id))[1],min(basis) into v_count,v_registry_id,v_basis from(select id,case when normalized_email=v_alumni_email then 'email' else 'phone' end basis from public.alumni_registry where active and(normalized_email=v_alumni_email or normalized_phone=v_phone))candidate;
 if v_count<>1 then v_registry_id:=null;v_basis:=null;end if;
 insert into public.verification_requests(user_id,registry_id,status,match_basis,match_confidence,notes) values(v_user_id,v_registry_id,'pending',v_basis,case when v_registry_id is null then null else 1 end,'') on conflict(user_id) do update set registry_id=case when verification_requests.status='pending' then excluded.registry_id else verification_requests.registry_id end,match_basis=case when verification_requests.status='pending' then excluded.match_basis else verification_requests.match_basis end,match_confidence=case when verification_requests.status='pending' then excluded.match_confidence else verification_requests.match_confidence end,notes=case when verification_requests.status='pending' then '' else verification_requests.notes end,updated_at=now();
 select verification_status into v_status from public.profiles where id=v_user_id;return v_status;
end $cm$;

revoke all on function public.submit_weekly_registration(text,text,text,text,text,int,text,boolean,text,text[],text[]) from public,anon;
grant execute on function public.submit_weekly_registration(text,text,text,text,text,int,text,boolean,text,text[],text[]) to authenticated;
revoke all on function public.submit_weekly_registration_v2(text,text,text,text,text,text,int,text,boolean,text,text[],text[]) from public,anon;
grant execute on function public.submit_weekly_registration_v2(text,text,text,text,text,text,int,text,boolean,text,text[],text[]) to authenticated;
revoke all on function public.complete_membership_profile(text,text,text,text,text,text,int) from public,anon;
grant execute on function public.complete_membership_profile(text,text,text,text,text,text,int) to authenticated;

update public.meeting_config set value=jsonb_set(value,'{schools}','[{"id":"harvard","name":"Harvard"},{"id":"mit","name":"MIT"},{"id":"harvard_mit","name":"Harvard y MIT"}]'::jsonb,true),updated_at=now() where key='current' and not(value?'schools');

commit;
