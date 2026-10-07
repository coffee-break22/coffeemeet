
create or replace function public.enqueue_confirmation_ack()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from 'confirmed') then
    insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
    values(
      'weekly_confirmed_ack',
      jsonb_build_object('userId',new.user_id,'weekCode',new.week_code),
      'weekly-confirmed-ack:'||new.week_code||':'||new.user_id,
      public.app_now()
    )
    on conflict(idempotency_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists weekly_participations_confirmed_ack on public.weekly_participations;
create trigger weekly_participations_confirmed_ack
after insert or update of status on public.weekly_participations
for each row execute function public.enqueue_confirmation_ack();
