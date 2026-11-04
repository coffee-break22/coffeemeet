create or replace function public.notify_admin_new_registration()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_profile record;
begin
 select full_name,email,phone,school,graduation_year,city into v_profile
 from public.profiles where id=new.user_id;
 insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
 values(
  'admin_new_registration_email',
  jsonb_build_object(
   'userId',new.user_id::text,
   'fullName',coalesce(v_profile.full_name,''),
   'email',coalesce(v_profile.email,''),
   'phone',coalesce(v_profile.phone,''),
   'school',coalesce(v_profile.school,''),
   'graduationYear',coalesce(v_profile.graduation_year::text,''),
   'city',coalesce(v_profile.city,''),
   'status',new.status::text,
   'matchBasis',coalesce(new.match_basis,'')
  ),
  'admin-new-registration-email:'||new.id,
  now()
 )
 on conflict(idempotency_key) do nothing;
 return new;
end $$;
drop trigger if exists notify_admin_new_registration on public.verification_requests;
create trigger notify_admin_new_registration after insert on public.verification_requests
for each row execute function public.notify_admin_new_registration();
