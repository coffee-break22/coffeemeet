create or replace function public.enqueue_weekly_outcome_notifications()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_item jsonb;v_user uuid;v_reason text;v_kind text;v_send_at timestamptz;
begin
 if old.status='confirmed' or new.status<>'confirmed' then return new;end if;
 v_send_at:=(public.week_monday(new.week_code)::text||' 11:00:00')::timestamp at time zone 'America/Bogota';
 for v_item in select value from jsonb_array_elements(coalesce(new.result->'unmatched','[]'::jsonb)) loop
  v_user:=(v_item->>'userId')::uuid;v_reason:=v_item->>'reason';
  if v_reason='holiday_only' then v_kind:='weekly_holiday';
  elsif v_reason in('known_contacts','no_compatible_availability','odd_compatible_pool') then v_kind:='weekly_no_match';
  else continue;end if;
  if not exists(select 1 from public.weekly_participations where user_id=v_user and week_code=new.week_code and status='confirmed') then continue;end if;
  insert into public.outbox(kind,payload,idempotency_key,next_attempt_at)
  values(v_kind,jsonb_build_object('userId',v_user,'weekCode',new.week_code,'reason',v_reason,'detail',coalesce(v_item->>'detail','')),v_kind||':'||new.week_code||':'||v_user,greatest(now(),v_send_at))
  on conflict(idempotency_key) do nothing;
 end loop;
 return new;
end $$;
drop trigger if exists enqueue_weekly_outcomes on public.match_batches;
create trigger enqueue_weekly_outcomes after update of status on public.match_batches for each row when(new.status='confirmed') execute function public.enqueue_weekly_outcome_notifications();