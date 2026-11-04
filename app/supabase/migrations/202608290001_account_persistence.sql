create policy "own pending verification insert"
on public.verification_requests for insert
with check (user_id=auth.uid() and status='pending' and registry_id is null and decided_by is null and decided_at is null);

create policy "own pending verification update"
on public.verification_requests for update
using (user_id=auth.uid() and status='pending')
with check (user_id=auth.uid() and status='pending' and registry_id is null and decided_by is null and decided_at is null);

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_admin() $$;
grant execute on function public.current_user_is_admin() to authenticated;
