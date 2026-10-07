
create or replace function public.get_admin_confirmed_previous_week_page(
 p_week_code text,p_query text default '',p_filter text default null,p_page int default 1,p_page_size int default 20
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_prev_week text;v_cutoff timestamptz;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_filter is not null and p_filter not in('confirmed','not_confirmed','withdrawn') then raise exception 'INVALID_FILTER';end if;
 v_prev_week:=to_char(public.week_monday(p_week_code)-7,'IYYY-"W"IW');
 v_cutoff:=public.weekly_confirmation_cutoff(v_prev_week);
 with eligible as(
  select p.id,p.full_name,p.email,p.phone,p.school,p.linkedin_url,wp.confirmed_at,
   case coalesce(wp.status,'pending') when 'confirmed' then 'confirmed' when 'withdrawn' then 'withdrawn' else 'not_confirmed' end status
  from public.profiles p
   left join public.admin_users a on a.user_id=p.id
   join public.verification_requests r on r.user_id=p.id and r.status='approved'
   left join public.weekly_participations wp on wp.user_id=p.id and wp.week_code=v_prev_week
  where a.user_id is null and p.verification_status='approved' and r.decided_at<=v_cutoff
 ),filtered as(
  select * from eligible where
   (trim(coalesce(p_query,''))='' or lower(full_name)like v_query or lower(coalesce(email,''))like v_query or coalesce(phone,'')like v_query)
   and(p_filter is null or status=p_filter)
 ),page_rows as(select * from filtered order by full_name limit v_size offset(v_page-1)*v_size),
 counts as(
  select count(*)filter(where status='confirmed') confirmed,
   count(*)filter(where status='not_confirmed') not_confirmed,
   count(*)filter(where status='withdrawn') withdrawn
  from eligible
 )
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'fullName',x.full_name,'email',x.email,'phone',x.phone,'school',x.school,'linkedin',x.linkedin_url,'status',x.status,'confirmedAt',x.confirmed_at)order by x.full_name)from page_rows x),'[]'::jsonb),
  'total',(select count(*)from filtered),
  'previousWeekCode',v_prev_week,
  'previousWeekMonday',public.week_monday(v_prev_week),
  'counts',jsonb_build_object('confirmed',c.confirmed,'notConfirmed',c.not_confirmed,'withdrawn',c.withdrawn)
 ) into v_result from counts c;
 return v_result;
end $$;
revoke all on function public.get_admin_confirmed_previous_week_page(text,text,text,int,int) from public,anon;
grant execute on function public.get_admin_confirmed_previous_week_page(text,text,text,int,int) to authenticated;

create or replace function public.get_admin_live_confirmations_page(
 p_week_code text,p_query text default '',p_page int default 1,p_page_size int default 20
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_cutoff timestamptz;v_open_from timestamptz;v_window_open boolean;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_cutoff:=public.weekly_confirmation_cutoff(p_week_code);
 v_open_from:=((public.week_monday(p_week_code)-1)::text||' 19:00:00')::timestamp at time zone 'America/Bogota';
 v_window_open:=now()>=v_open_from and now()<v_cutoff;
 if not v_window_open then
  return jsonb_build_object('windowOpen',false,'items','[]'::jsonb,'total',0,'counts',jsonb_build_object('confirmed',0,'pending',0,'withdrawn',0),'opensAt',v_open_from,'closesAt',v_cutoff);
 end if;
 with eligible as(
  select p.id,p.full_name,p.email,p.phone,p.school,wp.confirmed_at,
   coalesce(wp.status,'pending') status
  from public.profiles p
   left join public.admin_users a on a.user_id=p.id
   left join public.weekly_participations wp on wp.user_id=p.id and wp.week_code=p_week_code
  where a.user_id is null and p.verification_status='approved'
 ),filtered as(
  select * from eligible where
   trim(coalesce(p_query,''))='' or lower(full_name)like v_query or lower(coalesce(email,''))like v_query or coalesce(phone,'')like v_query
 ),page_rows as(select * from filtered order by full_name limit v_size offset(v_page-1)*v_size),
 counts as(
  select count(*)filter(where status='confirmed') confirmed,
   count(*)filter(where status='pending') pending,
   count(*)filter(where status='withdrawn') withdrawn
  from eligible
 )
 select jsonb_build_object(
  'windowOpen',true,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'fullName',x.full_name,'email',x.email,'phone',x.phone,'school',x.school,'status',x.status,'confirmedAt',x.confirmed_at)order by x.full_name)from page_rows x),'[]'::jsonb),
  'total',(select count(*)from filtered),
  'counts',jsonb_build_object('confirmed',c.confirmed,'pending',c.pending,'withdrawn',c.withdrawn),
  'opensAt',v_open_from,'closesAt',v_cutoff
 ) into v_result from counts c;
 return v_result;
end $$;
revoke all on function public.get_admin_live_confirmations_page(text,text,int,int) from public,anon;
grant execute on function public.get_admin_live_confirmations_page(text,text,int,int) to authenticated;

create or replace function public.admin_withdraw_weekly_participation(p_user_id uuid,p_week_code text)
returns void language plpgsql security definer set search_path=public as $$
declare v_cutoff timestamptz;v_open_from timestamptz;
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_cutoff:=public.weekly_confirmation_cutoff(p_week_code);
 v_open_from:=((public.week_monday(p_week_code)-1)::text||' 19:00:00')::timestamp at time zone 'America/Bogota';
 if now()<v_open_from or now()>=v_cutoff then raise exception 'CONFIRMATION_WINDOW_CLOSED';end if;
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at)
  values(p_user_id,p_week_code,'withdrawn',null,now())
  on conflict(user_id,week_code) do update set status='withdrawn',confirmed_at=null,updated_at=now();
end $$;
revoke all on function public.admin_withdraw_weekly_participation(uuid,text) from public,anon;
grant execute on function public.admin_withdraw_weekly_participation(uuid,text) to authenticated;
