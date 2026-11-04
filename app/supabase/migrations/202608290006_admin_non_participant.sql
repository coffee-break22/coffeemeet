create or replace function public.prevent_admin_participation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.is_active and exists(select 1 from public.admin_users where user_id=new.user_id) then
    raise exception 'ADMIN_CANNOT_PARTICIPATE';
  end if;
  return new;
end $$;

drop trigger if exists prevent_admin_weekly_availability on public.weekly_availabilities;
create trigger prevent_admin_weekly_availability
before insert or update of is_active,user_id on public.weekly_availabilities
for each row execute function public.prevent_admin_participation();

update public.weekly_availabilities availability
set is_active=false
where availability.is_active
and exists(select 1 from public.admin_users admin where admin.user_id=availability.user_id);

create policy "admins see admin roster"
on public.admin_users for select
using(public.is_admin());
