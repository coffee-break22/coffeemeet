create index if not exists outbox_created_at_desc_idx
  on public.outbox(created_at desc);
create index if not exists outbox_status_created_at_desc_idx
  on public.outbox(status, created_at desc);
create index if not exists outbox_payload_user_idx
  on public.outbox((payload->>'userId'))
  where payload ? 'userId';
create index if not exists outbox_payload_meeting_idx
  on public.outbox((payload->>'meetingId'))
  where payload ? 'meetingId';

create table if not exists public.notification_status_counters (
  status public.job_status primary key,
  total bigint not null default 0 check (total >= 0)
);

insert into public.notification_status_counters(status,total)
select candidate.status,
  (select count(*) from public.outbox o where o.status=candidate.status)
from unnest(enum_range(null::public.job_status)) candidate(status)
on conflict(status) do update set total=excluded.total;

create or replace function public.update_notification_status_counter()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.notification_status_counters(status,total) values(new.status,1)
    on conflict(status) do update set total=public.notification_status_counters.total+1;
  elsif tg_op='DELETE' then
    update public.notification_status_counters set total=greatest(total-1,0) where status=old.status;
  elsif old.status is distinct from new.status then
    update public.notification_status_counters set total=greatest(total-1,0) where status=old.status;
    insert into public.notification_status_counters(status,total) values(new.status,1)
    on conflict(status) do update set total=public.notification_status_counters.total+1;
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end $$;

drop trigger if exists maintain_notification_status_counters on public.outbox;
create trigger maintain_notification_status_counters
after insert or delete or update of status on public.outbox
for each row execute function public.update_notification_status_counter();

create or replace function public.get_admin_notification_summary()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
  select jsonb_build_object(
    'pending',coalesce(max(total)filter(where status='pending'),0),
    'processing',coalesce(max(total)filter(where status='processing'),0),
    'succeeded',coalesce(max(total)filter(where status='succeeded'),0),
    'failed',coalesce(max(total)filter(where status='failed'),0),
    'cancelled',coalesce(max(total)filter(where status='cancelled'),0)
  ) into v_result from public.notification_status_counters;
  return v_result;
end $$;

alter table public.notification_status_counters enable row level security;
revoke all on table public.notification_status_counters from public,anon,authenticated;
revoke all on function public.update_notification_status_counter() from public,anon,authenticated;
