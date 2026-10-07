create or replace function public.get_admin_notification_page(p_status text default null,p_page int default 1,p_page_size int default 20)
returns table(id uuid,kind text,status text,attempt_count int,next_attempt_at timestamptz,last_error text,created_at timestamptz,processed_at timestamptz,payload jsonb,destination_name text,destination_phone text,total_count bigint)
language plpgsql security definer set search_path=public as $$
declare v_page int:=greatest(coalesce(p_page,1),1);v_size int:=least(greatest(coalesce(p_page_size,20),1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_status is not null and p_status not in('pending','processing','succeeded','failed','cancelled') then raise exception 'INVALID_NOTIFICATION_STATUS';end if;
 return query with filtered as(
  select o.*,case when nullif(o.payload->>'userId','') is not null then(o.payload->>'userId')::uuid when o.kind='meeting_cancelled' and m.id is not null then case when m.user_a_id=(o.payload->>'cancelled_by')::uuid then m.user_b_id else m.user_a_id end else null end destination_id
  from public.outbox o left join public.meetings m on m.id=case when nullif(o.payload->>'meetingId','') is not null then(o.payload->>'meetingId')::uuid else null end
  where p_status is null or o.status::text=p_status)
 select f.id,f.kind,f.status::text,f.attempt_count,f.next_attempt_at,f.last_error,f.created_at,f.processed_at,f.payload,p.full_name,p.phone,count(*)over()
 from filtered f left join public.profiles p on p.id=f.destination_id order by f.created_at desc limit v_size offset(v_page-1)*v_size;
end $$;

create or replace function public.get_admin_notification_summary() returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 select jsonb_build_object('pending',count(*)filter(where status='pending'),'processing',count(*)filter(where status='processing'),'succeeded',count(*)filter(where status='succeeded'),'failed',count(*)filter(where status='failed'),'cancelled',count(*)filter(where status='cancelled')) into v_result from public.outbox;
 return v_result;
end $$;

revoke all on function public.get_admin_notification_page(text,int,int),public.get_admin_notification_summary() from public,anon;
grant execute on function public.get_admin_notification_page(text,int,int),public.get_admin_notification_summary() to authenticated;
