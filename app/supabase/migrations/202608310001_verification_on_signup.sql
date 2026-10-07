alter table public.profiles
  add column if not exists alumni_email text,
  add column if not exists normalized_alumni_email text;

create index if not exists profiles_alumni_email_idx
on public.profiles(normalized_alumni_email);

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name,email,normalized_email,calendar_email,verification_status)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.email,''),lower(trim(coalesce(new.email,''))),coalesce(new.email,''),'pending')
  on conflict(id) do nothing;
  insert into public.verification_requests(user_id,status,match_basis,notes)
  values(new.id,'pending',null,'Cuenta creada; perfil alumni pendiente de completar.')
  on conflict(user_id) do nothing;
  return new;
end $$;

insert into public.verification_requests(user_id,status,match_basis,notes)
select profile.id,'pending',null,'Cuenta existente; perfil alumni pendiente de completar.'
from public.profiles profile
where profile.verification_status='pending'
and not exists(select 1 from public.admin_users admin where admin.user_id=profile.id)
on conflict(user_id) do nothing;

create or replace function public.remove_admin_from_participation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.weekly_availabilities set is_active=false where user_id=new.user_id and is_active;
  delete from public.verification_requests where user_id=new.user_id and status='pending';
  return new;
end $$;

drop trigger if exists remove_new_admin_from_participation on public.admin_users;
create trigger remove_new_admin_from_participation
after insert on public.admin_users
for each row execute function public.remove_admin_from_participation();

create or replace function public.submit_weekly_registration_v2(
  p_full_name text,
  p_contact_email text,
  p_alumni_email text,
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
language plpgsql security definer set search_path=public as $$
declare v_status public.verification_status;v_alumni_email text:=lower(trim(coalesce(p_alumni_email,'')));v_contact_email text:=lower(trim(coalesce(p_contact_email,'')));
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  if exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
  if v_alumni_email='' then raise exception 'ALUMNI_EMAIL_REQUIRED';end if;
  if v_contact_email='' then raise exception 'CONTACT_EMAIL_REQUIRED';end if;
  select public.submit_weekly_registration(p_full_name,v_alumni_email,p_phone,p_linkedin_url,p_school,p_graduation_year,p_city,p_only_new_people,p_week_code,p_slot_ids,p_known_phones) into v_status;
  update public.profiles set email=v_contact_email,normalized_email=v_contact_email,alumni_email=v_alumni_email,normalized_alumni_email=v_alumni_email,updated_at=now() where id=auth.uid();
  update public.verification_requests set notes='',updated_at=now() where user_id=auth.uid() and status='pending';
  return v_status;
end $$;

revoke all on function public.submit_weekly_registration_v2(text,text,text,text,text,public.school,int,text,boolean,text,text[],text[]) from public;
grant execute on function public.submit_weekly_registration_v2(text,text,text,text,text,public.school,int,text,boolean,text,text[],text[]) to authenticated;

delete from public.verification_requests request
using public.admin_users admin
where request.user_id=admin.user_id and request.status='pending';
