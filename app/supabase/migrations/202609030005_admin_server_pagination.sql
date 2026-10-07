create index if not exists registry_name_prefix_idx on public.alumni_registry(lower(full_name) text_pattern_ops);
create index if not exists registry_email_prefix_idx on public.alumni_registry(normalized_email text_pattern_ops);
create index if not exists registry_phone_prefix_idx on public.alumni_registry(normalized_phone text_pattern_ops);
create index if not exists profiles_name_prefix_idx on public.profiles(lower(full_name) text_pattern_ops);
create index if not exists profiles_email_prefix_idx on public.profiles(lower(email) text_pattern_ops);

create or replace function public.get_admin_registry_page(p_query text default '',p_school text default null,p_active boolean default null,p_year int default null,p_page int default 1,p_page_size int default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 with filtered as(
  select r.* from public.alumni_registry r where
   (trim(coalesce(p_query,''))='' or lower(r.full_name)like v_query or coalesce(r.normalized_email,'')like v_query or coalesce(r.normalized_phone,'')like v_query)
   and(p_school is null or r.school::text=p_school) and(p_active is null or r.active=p_active) and(p_year is null or r.graduation_year=p_year)
 ),page_rows as(select * from filtered order by updated_at desc,id limit v_size offset(v_page-1)*v_size),summary as(
  select count(*) total,count(*)filter(where active) active,count(*)filter(where not active) inactive,count(*)filter(where source='csv') imported from public.alumni_registry
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.updated_at desc)from page_rows x),'[]'::jsonb),'total',(select count(*)from filtered),'counts',jsonb_build_object('all',s.total,'active',s.active,'inactive',s.inactive,'imported',s.imported)) into v_result from summary s;
 return v_result;
end $$;

create or replace function public.search_admin_registry(p_query text,p_limit int default 20)
returns setof public.alumni_registry language plpgsql security definer set search_path=public as $$
declare v_query text:=lower(trim(coalesce(p_query,'')))||'%';begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 return query select r.* from public.alumni_registry r where r.active and(trim(coalesce(p_query,''))='' or lower(r.full_name)like v_query or coalesce(r.normalized_email,'')like v_query or coalesce(r.normalized_phone,'')like v_query) order by r.full_name limit least(greatest(p_limit,1),50);
end $$;

create or replace function public.get_admin_verification_page(p_query text default '',p_status text default null,p_page int default 1,p_page_size int default 10)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_status is not null and p_status not in('pending','approved','rejected') then raise exception 'INVALID_VERIFICATION_STATUS';end if;
 with filtered as(
  select r.*,p.full_name,p.email,p.alumni_email,p.phone,p.school,p.graduation_year
  from public.verification_requests r join public.profiles p on p.id=r.user_id left join public.admin_users a on a.user_id=r.user_id
  where a.user_id is null and(p_status is null or r.status::text=p_status)
   and(trim(coalesce(p_query,''))='' or lower(p.full_name)like v_query or lower(coalesce(p.email,''))like v_query or lower(coalesce(p.alumni_email,''))like v_query or coalesce(p.phone,'')like v_query)
 ),page_rows as(select * from filtered order by updated_at desc,id limit v_size offset(v_page-1)*v_size)
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'userId',x.user_id,'registryId',x.registry_id,'status',x.status,'matchBasis',x.match_basis,'notes',x.notes,'decidedBy',x.decided_by,'decidedAt',x.decided_at,'createdAt',x.created_at,'updatedAt',x.updated_at,'fullName',x.full_name,'email',x.email,'alumniEmail',x.alumni_email,'phone',x.phone,'school',x.school,'graduationYear',x.graduation_year)order by x.updated_at desc)from page_rows x),'[]'::jsonb),
  'total',(select count(*)from filtered),'pendingTotal',(select count(*)from public.verification_requests r left join public.admin_users a on a.user_id=r.user_id where a.user_id is null and r.status='pending')) into v_result;
 return v_result;
end $$;

revoke all on function public.get_admin_registry_page(text,text,boolean,int,int,int),public.search_admin_registry(text,int),public.get_admin_verification_page(text,text,int,int) from public,anon;
grant execute on function public.get_admin_registry_page(text,text,boolean,int,int,int),public.search_admin_registry(text,int),public.get_admin_verification_page(text,text,int,int) to authenticated;
