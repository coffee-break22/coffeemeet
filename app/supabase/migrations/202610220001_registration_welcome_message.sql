create or replace function public.enqueue_registration_welcome()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.verification_status='approved' and old.verification_status is distinct from 'approved' then
    insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
    values(
      'registration_welcome',
      jsonb_build_object('userId',new.id),
      'registration-welcome:'||new.id,
      public.app_now()
    )
    on conflict(idempotency_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists profiles_registration_welcome on public.profiles;
create trigger profiles_registration_welcome
after update of verification_status on public.profiles
for each row execute function public.enqueue_registration_welcome();
