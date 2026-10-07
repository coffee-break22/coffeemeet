create table if not exists public.whatsapp_worker_state (
  singleton boolean primary key default true check (singleton),
  status text not null default 'offline'
    check (status in ('offline','connecting','awaiting_qr','connected','reconnecting','logged_out','error')),
  qr_data_url text,
  phone text,
  connected_at timestamptz,
  heartbeat_at timestamptz,
  updated_at timestamptz not null default now(),
  last_error text,
  requested_command text check (requested_command in ('reconnect','logout')),
  requested_at timestamptz
);

insert into public.whatsapp_worker_state(singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.whatsapp_worker_state enable row level security;

drop policy if exists "admin reads whatsapp state" on public.whatsapp_worker_state;
create policy "admin reads whatsapp state"
on public.whatsapp_worker_state for select
using (public.is_admin());

create or replace function public.get_admin_whatsapp_state()
returns table (
  status text,
  qr_data_url text,
  phone text,
  connected_at timestamptz,
  heartbeat_at timestamptz,
  updated_at timestamptz,
  last_error text,
  requested_command text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return query
  select s.status, s.qr_data_url, s.phone, s.connected_at, s.heartbeat_at, s.updated_at,
         s.last_error, s.requested_command
  from public.whatsapp_worker_state s
  where s.singleton;
end
$$;

create or replace function public.request_admin_whatsapp_command(p_command text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_command not in ('reconnect','logout') then
    raise exception 'INVALID_WHATSAPP_COMMAND';
  end if;

  update public.whatsapp_worker_state
  set requested_command = p_command,
      requested_at = now(),
      updated_at = now()
  where singleton;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'whatsapp.' || p_command, 'whatsapp_worker', 'primary', '{}');
end
$$;

revoke all on table public.whatsapp_worker_state from public, anon, authenticated;
grant select on table public.whatsapp_worker_state to authenticated;
revoke all on function public.get_admin_whatsapp_state(),
  public.request_admin_whatsapp_command(text) from public, anon;
grant execute on function public.get_admin_whatsapp_state(),
  public.request_admin_whatsapp_command(text) to authenticated;

comment on table public.whatsapp_worker_state is
  'Estado y control administrativo de la sesión Baileys. El QR es transitorio y solo visible para administradores.';
