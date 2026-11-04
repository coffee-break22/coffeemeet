alter table public.outbox
  add column if not exists external_id text,
  add column if not exists sent_at timestamptz;

comment on column public.outbox.external_id is
  'Identificador devuelto por el proveedor externo. Evita reenviar después de una entrega ya confirmada.';

create or replace function public.record_outbox_delivery(
  p_id uuid,
  p_external_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  update public.outbox
  set external_id = coalesce(external_id, nullif(p_external_id, '')),
      sent_at = coalesce(sent_at, now())
  where id = p_id
    and status = 'processing';
end
$$;

revoke all on function public.record_outbox_delivery(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_outbox_delivery(uuid, text)
  to service_role;
