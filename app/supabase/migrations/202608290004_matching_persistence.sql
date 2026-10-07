alter table public.match_batches
  add column if not exists fingerprint text,
  add column if not exists result jsonb not null default '{"pairs":[],"unmatched":[]}';

create index if not exists match_batches_week_fingerprint_idx
on public.match_batches(week_code,fingerprint);

create or replace function public.save_match_draft(
  p_week_code text,
  p_fingerprint text,
  p_result jsonb,
  p_regenerate boolean default false
) returns table(batch_id uuid,revision int,status text,generated_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_existing public.match_batches%rowtype;v_revision int;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
  if not p_regenerate then
    select m.* into v_existing from public.match_batches m
    where m.week_code=p_week_code and m.fingerprint=p_fingerprint and m.status<>'superseded'
    order by revision desc limit 1;
    if found then return query select v_existing.id,v_existing.revision,v_existing.status,v_existing.generated_at;return;end if;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_week_code));
  select coalesce(max(m.revision),0)+1 into v_revision from public.match_batches m where m.week_code=p_week_code;
  update public.match_batches m set status='superseded' where m.week_code=p_week_code and m.status='draft';
  insert into public.match_batches(week_code,idempotency_key,status,revision,generated_by,fingerprint,result)
  values(p_week_code,p_week_code||':'||v_revision||':'||p_fingerprint,'draft',v_revision,auth.uid(),p_fingerprint,p_result)
  returning id,match_batches.revision,match_batches.status,match_batches.generated_at
  into batch_id,revision,status,generated_at;
  return next;
end $$;

create or replace function public.confirm_match_batch(p_batch_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_batch public.match_batches%rowtype;v_pair jsonb;v_meeting_id uuid;v_a uuid;v_b uuid;v_index int:=0;v_key text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
  select * into v_batch from public.match_batches where id=p_batch_id for update;
  if not found then raise exception 'MATCH_BATCH_NOT_FOUND';end if;
  if v_batch.status='superseded' then raise exception 'MATCH_BATCH_SUPERSEDED';end if;
  if v_batch.status='confirmed' then return;end if;
  for v_pair in select value from jsonb_array_elements(v_batch.result->'pairs')
  loop
    v_index:=v_index+1;v_a:=(v_pair->>'userAId')::uuid;v_b:=(v_pair->>'userBId')::uuid;
    insert into public.meetings(batch_id,week_code,user_a_id,user_b_id,slot_id,status,score,score_explanation,last_resort)
    values(v_batch.id,v_batch.week_code,v_a,v_b,v_pair->'slot'->>'id','confirmed',coalesce((v_pair->>'score')::numeric,0),coalesce(v_pair->'explanation','[]'),coalesce((v_pair->>'lastResort')::boolean,false))
    returning id into v_meeting_id;
    insert into public.meeting_participants(meeting_id,week_code,user_id) values(v_meeting_id,v_batch.week_code,v_a),(v_meeting_id,v_batch.week_code,v_b);
    v_key:='calendar:'||v_meeting_id;insert into public.outbox(kind,payload,idempotency_key) values('calendar',jsonb_build_object('meetingId',v_meeting_id),v_key) on conflict(idempotency_key) do nothing;
    insert into public.outbox(kind,payload,idempotency_key) values('match_whatsapp',jsonb_build_object('meetingId',v_meeting_id,'userId',v_a),'match-whatsapp:'||v_meeting_id||':'||v_a) on conflict(idempotency_key) do nothing;
    insert into public.outbox(kind,payload,idempotency_key) values('match_whatsapp',jsonb_build_object('meetingId',v_meeting_id,'userId',v_b),'match-whatsapp:'||v_meeting_id||':'||v_b) on conflict(idempotency_key) do nothing;
  end loop;
  update public.match_batches set status='confirmed',confirmed_by=auth.uid(),confirmed_at=now() where id=v_batch.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data)
  values(auth.uid(),'match_batch_confirmed','match_batch',v_batch.id::text,jsonb_build_object('weekCode',v_batch.week_code,'pairCount',v_index));
end $$;

revoke all on function public.save_match_draft(text,text,jsonb,boolean) from public;
revoke all on function public.confirm_match_batch(uuid) from public;
grant execute on function public.save_match_draft(text,text,jsonb,boolean) to authenticated;
grant execute on function public.confirm_match_batch(uuid) to authenticated;

create policy "admin contacts"
on public.known_contacts for select
using(public.is_admin());

