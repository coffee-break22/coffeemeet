create table if not exists public.weekly_participations(
 user_id uuid not null references public.profiles(id) on delete cascade,
 week_code text not null check(week_code~'^\d{4}-W\d{2}$'),
 status text not null default 'pending' check(status in('pending','confirmed','withdrawn')),
 confirmed_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(user_id,week_code)
);
alter table public.weekly_participations enable row level security;
create policy "own weekly participation" on public.weekly_participations for select using(user_id=auth.uid() or public.is_admin());
create policy "admin weekly participation" on public.weekly_participations for all using(public.is_admin()) with check(public.is_admin());


create or replace function public.week_monday(p_week_code text) returns date language sql immutable as $$
 select to_date(p_week_code||'-1','IYYY-"W"IW-ID')
$$;
create or replace function public.weekly_confirmation_cutoff(p_week_code text) returns timestamptz language sql immutable as $$
 select (public.week_monday(p_week_code)::text||' 10:00:00')::timestamp at time zone 'America/Bogota'
$$;
create or replace function public.shift_weekly_slot(p_slot text,p_from_week text,p_to_week text) returns text language plpgsql immutable as $$
declare v text[]:=string_to_array(p_slot,'|');v_index int;v_date date;v_delta int:=public.week_monday(p_to_week)-public.week_monday(p_from_week);
begin
 v_index:=case when v[1]='virtual' then 2 else 3 end;v_date:=v[v_index]::date+v_delta;v[v_index]:=v_date::text;return array_to_string(v,'|');
exception when others then raise exception 'INVALID_SLOT_ID';end $$;

create or replace function public.prepare_weekly_confirmations(p_week_code text) returns int language plpgsql security definer set search_path=public as $$
declare v_count int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 with latest as(select p.id user_id,(select max(w.week_code) from public.weekly_availabilities w where w.user_id=p.id and w.week_code<p_week_code and w.is_active) source_week from public.profiles p where p.verification_status='approved' and not exists(select 1 from public.admin_users a where a.user_id=p.id)),eligible as(select * from latest where source_week is not null)
 insert into public.weekly_participations(user_id,week_code,status) select user_id,p_week_code,'pending' from eligible on conflict do nothing;
 with source as(select wp.user_id,(select max(w.week_code) from public.weekly_availabilities w where w.user_id=wp.user_id and w.week_code<p_week_code and w.is_active) source_week from public.weekly_participations wp where wp.week_code=p_week_code)
 insert into public.weekly_availabilities(user_id,week_code,slot_id,is_active)
 select s.user_id,p_week_code,public.shift_weekly_slot(w.slot_id,s.source_week,p_week_code),true from source s join public.weekly_availabilities w on w.user_id=s.user_id and w.week_code=s.source_week and w.is_active
 on conflict(user_id,week_code,slot_id) do nothing;
 get diagnostics v_count=row_count;return v_count;
end $$;

create or replace function public.confirm_weekly_participation(p_week_code text,p_user_id uuid default null) returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=coalesce(p_user_id,auth.uid());v_service boolean:=current_setting('request.jwt.claim.role',true)='service_role';
begin
 if not v_service and (auth.uid() is null or v_user<>auth.uid()) then raise exception 'FORBIDDEN';end if;
 if now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;
 if not exists(select 1 from public.profiles where id=v_user and verification_status='approved') then raise exception 'USER_NOT_APPROVED';end if;
 if not exists(select 1 from public.weekly_availabilities where user_id=v_user and week_code=p_week_code and is_active) then raise exception 'NO_ACTIVE_AVAILABILITY';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(v_user,p_week_code,'confirmed',now(),now()) on conflict(user_id,week_code) do update set status='confirmed',confirmed_at=now(),updated_at=now();
end $$;

create or replace function public.submit_weekly_registration_v2(p_full_name text,p_contact_email text,p_alumni_email text,p_phone text,p_linkedin_url text,p_school public.school,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[]) returns public.verification_status language plpgsql security definer set search_path=public as $$
declare v_status public.verification_status;v_alumni text:=lower(trim(coalesce(p_alumni_email,'')));v_contact text:=lower(trim(coalesce(p_contact_email,'')));
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;if public.is_admin() then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
 if now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;if v_alumni='' then raise exception 'ALUMNI_EMAIL_REQUIRED';end if;if v_contact='' then raise exception 'CONTACT_EMAIL_REQUIRED';end if;
 select public.submit_weekly_registration(p_full_name,v_alumni,p_phone,p_linkedin_url,p_school,p_graduation_year,p_city,p_only_new_people,p_week_code,p_slot_ids,p_known_phones) into v_status;
 update public.profiles set email=v_contact,normalized_email=v_contact,alumni_email=v_alumni,normalized_alumni_email=v_alumni,updated_at=now() where id=auth.uid();
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(auth.uid(),p_week_code,'confirmed',now(),now()) on conflict(user_id,week_code) do update set status='confirmed',confirmed_at=now(),updated_at=now();return v_status;
end $$;
create or replace function public.withdraw_weekly_registration(p_week_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;if now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(auth.uid(),p_week_code,'withdrawn',null,now()) on conflict(user_id,week_code) do update set status='withdrawn',confirmed_at=null,updated_at=now();
end $$;

create or replace function public.close_weekly_confirmations(p_week_code text) returns int language plpgsql security definer set search_path=public as $$
declare v_count int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 if now()<public.weekly_confirmation_cutoff(p_week_code) then return 0;end if;
 update public.weekly_participations set status='withdrawn',confirmed_at=null,updated_at=now() where week_code=p_week_code and status='pending';
 get diagnostics v_count=row_count;return v_count;
end $$;

create or replace function public.enforce_weekly_matching_time() returns trigger language plpgsql set search_path=public as $$
begin
 if now()<public.weekly_confirmation_cutoff(new.week_code) then raise exception 'MATCHING_NOT_OPEN';end if;
 return new;
end $$;
drop trigger if exists enforce_weekly_matching_time on public.match_batches;
create trigger enforce_weekly_matching_time before insert on public.match_batches for each row execute function public.enforce_weekly_matching_time();
create or replace function public.schedule_match_notice() returns trigger language plpgsql set search_path=public as $$
declare v_week text;
begin
 if new.kind='match_whatsapp' then select week_code into v_week from public.meetings where id=(new.payload->>'meetingId')::uuid;new.next_attempt_at:=greatest(new.next_attempt_at,(public.week_monday(v_week)::text||' 11:00:00')::timestamp at time zone 'America/Bogota');end if;return new;
end $$;
drop trigger if exists schedule_match_notice on public.outbox;create trigger schedule_match_notice before insert on public.outbox for each row execute function public.schedule_match_notice();

revoke all on function public.prepare_weekly_confirmations(text),public.confirm_weekly_participation(text,uuid),public.close_weekly_confirmations(text) from public,anon,authenticated;
grant execute on function public.prepare_weekly_confirmations(text),public.confirm_weekly_participation(text,uuid),public.close_weekly_confirmations(text) to service_role;
grant execute on function public.confirm_weekly_participation(text,uuid) to authenticated;
grant select on public.weekly_participations to authenticated;grant all on public.weekly_participations to service_role;

