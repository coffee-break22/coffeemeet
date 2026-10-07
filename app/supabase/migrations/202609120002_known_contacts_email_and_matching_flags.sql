
alter table public.known_contacts drop constraint known_contacts_pkey;
alter table public.known_contacts alter column normalized_phone drop not null;
alter table public.known_contacts add column id uuid not null default gen_random_uuid();
alter table public.known_contacts add column normalized_email text;
alter table public.known_contacts add constraint known_contacts_pkey primary key(id);
alter table public.known_contacts add constraint known_contacts_one_of check(num_nonnulls(normalized_phone,normalized_email)=1);
alter table public.known_contacts add constraint known_contacts_email_format check(normalized_email is null or normalized_email~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
create unique index known_contacts_owner_phone_idx on public.known_contacts(owner_id,normalized_phone) where normalized_phone is not null;
create unique index known_contacts_owner_email_idx on public.known_contacts(owner_id,normalized_email) where normalized_email is not null;

drop function if exists public.submit_weekly_registration_v2(text,text,text,text,text,text,int,text,boolean,text,text[],text[]);
drop function if exists public.submit_weekly_registration(text,text,text,text,text,int,text,boolean,text,text[],text[]);

create function public.submit_weekly_registration(p_full_name text,p_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[],p_known_emails text[]) returns public.verification_status language plpgsql security definer set search_path=public as $cm$
declare v_user_id uuid:=auth.uid();v_status public.verification_status;v_registry_id uuid;v_basis text;v_candidate_count int;v_email text:=lower(trim(coalesce(p_email,'')));v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');v_linkedin text:=nullif(trim(p_linkedin_url),'');
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
 insert into public.verification_requests(user_id,registry_id,status,match_basis,match_confidence) values(v_user_id,v_registry_id,'pending',v_basis,case when v_registry_id is null then null else 1 end) on conflict(user_id) do update set registry_id=case when verification_requests.status='pending' then excluded.registry_id else verification_requests.registry_id end,match_basis=case when verification_requests.status='pending' then excluded.match_basis else verification_requests.match_basis end,match_confidence=case when verification_requests.status='pending' then excluded.match_confidence else verification_requests.match_confidence end,updated_at=now();
 select verification_status into v_status from public.profiles where id=v_user_id;return v_status;
end $cm$;

create function public.submit_weekly_registration_v2(p_full_name text,p_contact_email text,p_alumni_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[],p_known_emails text[]) returns public.verification_status language plpgsql security definer set search_path=public as $cm$
declare v_status public.verification_status;v_alumni text:=lower(trim(coalesce(p_alumni_email,'')));v_contact text:=lower(trim(coalesce(p_contact_email,'')));
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;if public.is_admin() then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
 if now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;if v_alumni='' then raise exception 'ALUMNI_EMAIL_REQUIRED';end if;if v_contact='' then raise exception 'CONTACT_EMAIL_REQUIRED';end if;
 select public.submit_weekly_registration(p_full_name,v_alumni,p_phone,p_linkedin_url,p_school,p_graduation_year,p_city,p_only_new_people,p_week_code,p_slot_ids,p_known_phones,p_known_emails) into v_status;
 update public.profiles set email=v_contact,normalized_email=v_contact,alumni_email=v_alumni,normalized_alumni_email=v_alumni,updated_at=now() where id=auth.uid();
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(auth.uid(),p_week_code,'confirmed',now(),now()) on conflict(user_id,week_code) do update set status='confirmed',confirmed_at=now(),updated_at=now();return v_status;
end $cm$;

revoke all on function public.submit_weekly_registration(text,text,text,text,text,int,text,boolean,text,text[],text[],text[]) from public,anon;
grant execute on function public.submit_weekly_registration(text,text,text,text,text,int,text,boolean,text,text[],text[],text[]) to authenticated;
revoke all on function public.submit_weekly_registration_v2(text,text,text,text,text,text,int,text,boolean,text,text[],text[],text[]) from public,anon;
grant execute on function public.submit_weekly_registration_v2(text,text,text,text,text,text,int,text,boolean,text,text[],text[],text[]) to authenticated;

create or replace function public.get_admin_matching_data(p_week_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 with active as(
  select p.id,p.full_name,p.phone,p.email,p.city,p.verification_status,p.only_new_people
  from public.profiles p join public.weekly_participations wp on wp.user_id=p.id
  left join public.admin_users ad on ad.user_id=p.id
  where wp.week_code=p_week_code and wp.status='confirmed' and p.verification_status='approved'
   and ad.user_id is null and exists(select 1 from public.weekly_availabilities wa where wa.user_id=p.id and wa.week_code=p_week_code and wa.is_active)
 ),slots as(
  select wa.user_id,jsonb_agg(wa.slot_id order by wa.slot_id) values
  from public.weekly_availabilities wa join active a on a.id=wa.user_id
  where wa.week_code=p_week_code and wa.is_active group by wa.user_id
 ),contacts as(
  select kc.owner_id,jsonb_agg(kc.normalized_phone order by kc.normalized_phone) values
  from public.known_contacts kc join active a on a.id=kc.owner_id where kc.normalized_phone is not null group by kc.owner_id
 ),contact_emails as(
  select kc.owner_id,jsonb_agg(kc.normalized_email order by kc.normalized_email) values
  from public.known_contacts kc join active a on a.id=kc.owner_id where kc.normalized_email is not null group by kc.owner_id
 ),meeting_rows as(
  select m.user_a_id user_id,m.status,m.cancelled_by,m.cancellation_exempt from public.meetings m join active a on a.id=m.user_a_id where not m.is_test
  union all
  select m.user_b_id,m.status,m.cancelled_by,m.cancellation_exempt from public.meetings m join active a on a.id=m.user_b_id where not m.is_test
 ),meeting_stats as(
  select user_id,count(*) total,count(*)filter(where status='completed') completed,
   count(*)filter(where status='cancelled_on_time' and cancelled_by=user_id and not cancellation_exempt) noticed
  from meeting_rows group by user_id
 ),blocked as(
  select distinct ri.user_id from public.reputation_incidents ri join active a on a.id=ri.user_id
  where ri.status='confirmed' and not exists(select 1 from public.second_chances sc where sc.incident_id=ri.id)
 ),participant_json as(
  select jsonb_agg(jsonb_build_object(
   'id',a.id,'fullName',a.full_name,'phone',a.phone,'email',coalesce(a.email,''),'city',coalesce(a.city,''),
   'verificationStatus',a.verification_status,'blocked',b.user_id is not null,
   'slotIds',coalesce(s.values,'[]'::jsonb),'knownPhones',coalesce(c.values,'[]'::jsonb),
   'knownEmails',coalesce(ce.values,'[]'::jsonb),'onlyNewPeople',coalesce(a.only_new_people,false),
   'completedMeetingCount',coalesce(ms.completed,0),
   'noticeCancellationRate',case when coalesce(ms.total,0)=0 then 0 else coalesce(ms.noticed,0)::numeric/ms.total end
  )order by a.id) value
  from active a left join slots s on s.user_id=a.id left join contacts c on c.owner_id=a.id
  left join contact_emails ce on ce.owner_id=a.id
  left join meeting_stats ms on ms.user_id=a.id left join blocked b on b.user_id=a.id
 ),history_json as(
  select jsonb_agg(jsonb_build_object('userAId',m.user_a_id,'userBId',m.user_b_id,'completedAt',m.created_at)order by m.created_at) value
  from public.meetings m join active a on a.id=m.user_a_id join active b on b.id=m.user_b_id
  where m.status='completed' and not m.is_test
 ),batch_json as(
  select jsonb_agg(jsonb_build_object('id',x.id,'weekCode',x.week_code,'revision',x.revision,'fingerprint',coalesce(x.fingerprint,''),'status',x.status,'result',x.result,'generatedAt',x.generated_at,'confirmedAt',x.confirmed_at,'isTest',x.is_test)order by x.revision) value
  from public.match_batches x where x.week_code=p_week_code
 )
 select jsonb_build_object('participants',coalesce(p.value,'[]'::jsonb),'history',coalesce(h.value,'[]'::jsonb),'batches',coalesce(b.value,'[]'::jsonb))
 into v_result from participant_json p cross join history_json h cross join batch_json b;
 return v_result;
end $$;

revoke all on function public.get_admin_matching_data(text) from public,anon;
grant execute on function public.get_admin_matching_data(text) to authenticated;
