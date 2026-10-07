create table if not exists public.action_rate_limits(
  actor_id uuid not null,
  action text not null check(length(action) between 1 and 80),
  window_start timestamptz not null,
  hits int not null default 1 check(hits>0),
  primary key(actor_id,action,window_start)
);
alter table public.action_rate_limits enable row level security;
revoke all on public.action_rate_limits from public,anon,authenticated;
grant all on public.action_rate_limits to service_role;

create or replace function public.consume_action_rate_limit(p_action text,p_max int,p_window_seconds int)
returns void language plpgsql security definer set search_path=public as $cm$
declare v_actor uuid:=auth.uid();v_window timestamptz;v_hits int;
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED';end if;
 if p_max not between 1 and 1000 or p_window_seconds not between 10 and 86400 then raise exception 'INVALID_RATE_LIMIT';end if;
 v_window:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
 insert into public.action_rate_limits(actor_id,action,window_start,hits) values(v_actor,left(p_action,80),v_window,1)
 on conflict(actor_id,action,window_start) do update set hits=action_rate_limits.hits+1 returning hits into v_hits;
 if v_hits>p_max then raise exception 'RATE_LIMIT_EXCEEDED' using errcode='P0001';end if;
end $cm$;
revoke all on function public.consume_action_rate_limit(text,int,int) from public,anon,authenticated;

create or replace function public.limit_public_registration_updates()
returns trigger language plpgsql security definer set search_path=public as $cm$
begin
 if auth.uid()=new.user_id and new.status='pending' then perform public.consume_action_rate_limit('weekly_registration',5,600);end if;
 return new;
end $cm$;
drop trigger if exists limit_public_registration_updates on public.verification_requests;
create trigger limit_public_registration_updates before insert or update on public.verification_requests for each row execute function public.limit_public_registration_updates();

create or replace function public.limit_sensitive_writes()
returns trigger language plpgsql security definer set search_path=public as $cm$
begin
 if auth.uid() is null then return new;end if;
 if tg_table_name='match_batches' then perform public.consume_action_rate_limit('matching_batch',20,600);
 elsif tg_table_name='second_chances' then perform public.consume_action_rate_limit('second_chance',20,3600);
 elsif tg_table_name='verification_requests' and old.status::text is distinct from new.status::text then perform public.consume_action_rate_limit('verification_decision',60,3600);
 elsif tg_table_name='meetings' and new.status::text in('cancelled_on_time','late_cancellation') and old.status::text is distinct from new.status::text then perform public.consume_action_rate_limit('meeting_cancellation',10,3600);
 end if;
 return new;
end $cm$;
drop trigger if exists limit_matching_batches on public.match_batches;
create trigger limit_matching_batches before insert on public.match_batches for each row execute function public.limit_sensitive_writes();
drop trigger if exists limit_second_chances on public.second_chances;
create trigger limit_second_chances before insert on public.second_chances for each row execute function public.limit_sensitive_writes();
drop trigger if exists limit_verification_decisions on public.verification_requests;
create trigger limit_verification_decisions before update on public.verification_requests for each row execute function public.limit_sensitive_writes();
drop trigger if exists limit_meeting_cancellations on public.meetings;
create trigger limit_meeting_cancellations before update on public.meetings for each row execute function public.limit_sensitive_writes();

create or replace function public.sanitize_profile_fields()
returns trigger language plpgsql set search_path=public as $cm$
begin
 new.full_name=btrim(regexp_replace(coalesce(new.full_name,''),'[[:cntrl:]]','','g'));
 new.email=lower(btrim(coalesce(new.email,'')));new.alumni_email=lower(btrim(coalesce(new.alumni_email,'')));
 new.phone=btrim(coalesce(new.phone,''));new.city=btrim(regexp_replace(coalesce(new.city,''),'[[:cntrl:]]','','g'));
 new.linkedin_url=nullif(btrim(coalesce(new.linkedin_url,'')),'');new.headline=btrim(coalesce(new.headline,''));
 new.bio=btrim(coalesce(new.bio,''));new.industry=btrim(coalesce(new.industry,''));new.current_role=btrim(coalesce(new.current_role,''));
 if new.linkedin_url is not null and new.linkedin_url !~* '^https://([a-z0-9-]+[.])*linkedin[.]com/' then raise exception 'INVALID_LINKEDIN_URL';end if;
 return new;
end $cm$;
drop trigger if exists sanitize_profile_fields on public.profiles;
create trigger sanitize_profile_fields before insert or update on public.profiles for each row execute function public.sanitize_profile_fields();

alter table public.profiles drop constraint if exists profiles_public_lengths_check;
alter table public.profiles add constraint profiles_public_lengths_check check(
 length(full_name)<=120 and length(email)<=254 and length(alumni_email)<=254 and length(phone)<=32 and
 length(coalesce(linkedin_url,''))<=500 and length(coalesce(city,''))<=100 and length(headline)<=120 and
 length(bio)<=500 and length(industry)<=100 and length(current_role)<=100
) not valid;
alter table public.alumni_registry drop constraint if exists alumni_registry_lengths_check;
alter table public.alumni_registry add constraint alumni_registry_lengths_check check(
 length(full_name)<=120 and length(coalesce(email,''))<=254 and length(coalesce(phone,''))<=32 and length(notes)<=2000 and length(source)<=40
) not valid;
alter table public.verification_requests drop constraint if exists verification_notes_length_check;
alter table public.verification_requests add constraint verification_notes_length_check check(length(notes)<=2000) not valid;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "avatar public read" on storage.objects;
create policy "avatar public read" on storage.objects for select using(bucket_id='profile-avatars');
drop policy if exists "avatar owner insert" on storage.objects;
create policy "avatar owner insert" on storage.objects for insert to authenticated with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "avatar owner update" on storage.objects;
create policy "avatar owner update" on storage.objects for update to authenticated using(bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "avatar owner delete" on storage.objects;
create policy "avatar owner delete" on storage.objects for delete to authenticated using(bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.get_admin_reputation_page(p_filter text default 'open',p_page int default 1,p_page_size int default 8)
returns jsonb language plpgsql stable security definer set search_path=public as $cm$
declare v_result jsonb;v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),50);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_filter not in('open','all') then raise exception 'INVALID_FILTER';end if;
 with cases as(
  select 'incident:'||i.id case_id,'incident' case_type,m.id meeting_id,m.status meeting_status,i.id incident_id,i.kind incident_kind,i.status incident_status,i.user_id,responsible.full_name user_name,m.user_a_id,a.full_name user_a_name,m.user_b_id,b.full_name user_b_name,sc.id second_chance_id,i.created_at occurred_at,'[]'::jsonb reports
  from public.reputation_incidents i join public.meetings m on m.id=i.meeting_id join public.profiles responsible on responsible.id=i.user_id join public.profiles a on a.id=m.user_a_id join public.profiles b on b.id=m.user_b_id left join public.second_chances sc on sc.incident_id=i.id
  union all
  select 'dispute:'||m.id,'dispute',m.id,m.status,null,null,null,null,null,m.user_a_id,a.full_name,m.user_b_id,b.full_name,null,m.created_at,coalesce((select jsonb_agg(jsonb_build_object('reporterId',r.reporter_id,'meetingOccurred',r.meeting_occurred,'selfAttended',r.self_attended,'partnerAttended',r.partner_attended,'comment',r.comment,'submittedAt',r.submitted_at)order by r.submitted_at)from public.attendance_reports r where r.meeting_id=m.id),'[]'::jsonb)
  from public.meetings m join public.profiles a on a.id=m.user_a_id join public.profiles b on b.id=m.user_b_id where m.status='attendance_disputed'
 ),filtered as(select * from cases where p_filter='all' or case_type='dispute' or(incident_status='confirmed' and second_chance_id is null)),page_rows as(select * from filtered order by occurred_at desc,case_id limit v_size offset(v_page-1)*v_size)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.occurred_at desc)from page_rows x),'[]'::jsonb),'total',(select count(*)from filtered)) into v_result;
 return v_result;
end $cm$;
revoke all on function public.get_admin_reputation_page(text,int,int) from public,anon;
grant execute on function public.get_admin_reputation_page(text,int,int) to authenticated;

do $cm$ declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef loop execute format('revoke execute on function %s from public, anon',r.signature);end loop;end $cm$;

create index if not exists action_rate_limits_cleanup_idx on public.action_rate_limits(window_start);
