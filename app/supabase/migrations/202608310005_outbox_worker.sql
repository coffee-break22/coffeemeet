create or replace function public.claim_outbox_job()
returns setof public.outbox language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select id into v_id from public.outbox where status in('pending','failed') and next_attempt_at<=now() and attempt_count<8 order by next_attempt_at,created_at for update skip locked limit 1;
 if v_id is null then return;end if;
 return query update public.outbox set status='processing',attempt_count=attempt_count+1 where id=v_id returning *;
end $$;
create or replace function public.complete_outbox_job(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 update public.outbox set status='succeeded',processed_at=now(),last_error=null where id=p_id and status='processing';
end $$;
create or replace function public.fail_outbox_job(p_id uuid,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare v_attempt int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select attempt_count into v_attempt from public.outbox where id=p_id for update;
 update public.outbox set status=case when v_attempt>=8 then 'cancelled'::public.job_status else 'failed'::public.job_status end,last_error=left(p_error,1000),next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,greatest(v_attempt-1,0))::int)) where id=p_id;
end $$;
revoke all on function public.claim_outbox_job(),public.complete_outbox_job(uuid),public.fail_outbox_job(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_outbox_job(),public.complete_outbox_job(uuid),public.fail_outbox_job(uuid,text) to service_role;