create or replace function public.get_admin_notification_monitor(p_status text default null,p_limit int default 200)
returns table(id uuid,kind text,status public.job_status,attempt_count int,next_attempt_at timestamptz,last_error text,created_at timestamptz,processed_at timestamptz,payload jsonb)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 return query select o.id,o.kind,o.status,o.attempt_count,o.next_attempt_at,o.last_error,o.created_at,o.processed_at,o.payload from public.outbox o
 where p_status is null or o.status::text=p_status order by coalesce(o.processed_at,o.next_attempt_at,o.created_at) desc limit least(greatest(p_limit,1),500);
end $$;
create or replace function public.retry_notification(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 update public.outbox set status='pending',attempt_count=0,next_attempt_at=now(),last_error=null,processed_at=null where id=p_id and status in('failed','cancelled');
 if not found then raise exception 'NOTIFICATION_NOT_RETRYABLE';end if;
 insert into public.audit_log(actor_id,action,entity_type,entity_id) values(auth.uid(),'notification.retry','outbox',p_id::text);
end $$;
revoke all on function public.get_admin_notification_monitor(text,int),public.retry_notification(uuid) from public,anon;
grant execute on function public.get_admin_notification_monitor(text,int),public.retry_notification(uuid) to authenticated;