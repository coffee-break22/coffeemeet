

alter table public.outbox add column if not exists sent_text text;

create or replace function public.record_outbox_delivery(p_id uuid,p_external_id text,p_text text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 update public.outbox set external_id=coalesce(external_id,nullif(p_external_id,'')),sent_at=coalesce(sent_at,now()),sent_text=coalesce(sent_text,p_text) where id=p_id and status='processing';
end $$;
revoke all on function public.record_outbox_delivery(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_outbox_delivery(uuid,text,text) to service_role;

-- Cambia de firma (agrega p_query) — hay que tumbar la versión vieja de
-- 3 argumentos explícitamente, si no PostgREST no sabe cuál usar.
drop function if exists public.get_admin_notification_page(text,int,int);
create or replace function public.get_admin_notification_page(p_status text default null,p_query text default null,p_page int default 1,p_page_size int default 20)
returns table(id uuid,kind text,status text,attempt_count int,next_attempt_at timestamptz,last_error text,created_at timestamptz,processed_at timestamptz,payload jsonb,sent_text text,destination_name text,destination_phone text,total_count bigint)
language plpgsql security definer set search_path=public as $$
declare v_page int:=greatest(coalesce(p_page,1),1);v_size int:=least(greatest(coalesce(p_page_size,20),1),100);v_query text:=nullif(trim(coalesce(p_query,'')),'');
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_status is not null and p_status not in('pending','processing','succeeded','failed','cancelled') then raise exception 'INVALID_NOTIFICATION_STATUS';end if;
 return query with filtered as(
  select o.*,case when nullif(o.payload->>'userId','') is not null then(o.payload->>'userId')::uuid when o.kind='meeting_cancelled' and m.id is not null then case when m.user_a_id=(o.payload->>'cancelled_by')::uuid then m.user_b_id else m.user_a_id end else null end destination_id
  from public.outbox o left join public.meetings m on m.id=case when nullif(o.payload->>'meetingId','') is not null then(o.payload->>'meetingId')::uuid else null end
  where p_status is null or o.status::text=p_status)
 select f.id,f.kind,f.status::text,f.attempt_count,f.next_attempt_at,f.last_error,f.created_at,f.processed_at,f.payload,f.sent_text,p.full_name,p.phone,count(*)over()
 from filtered f left join public.profiles p on p.id=f.destination_id
 where v_query is null or p.full_name ilike '%'||v_query||'%' or p.phone ilike '%'||v_query||'%'
 order by f.created_at desc limit v_size offset(v_page-1)*v_size;
end $$;
revoke all on function public.get_admin_notification_page(text,text,int,int) from public,anon;
grant execute on function public.get_admin_notification_page(text,text,int,int) to authenticated;

create or replace function public.cleanup_operational_notifications()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_notifications int;v_surveys int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 delete from public.outbox
 where (status in('succeeded','cancelled') and coalesce(processed_at,created_at)<now()-interval '30 days')
    or (status='failed' and created_at<now()-interval '180 days');
 get diagnostics v_notifications=row_count;
 delete from public.survey_sessions where step='completed' and updated_at<now()-interval '90 days';
 get diagnostics v_surveys=row_count;
 return jsonb_build_object('notifications',v_notifications,'surveys',v_surveys);
end $$;
