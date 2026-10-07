create or replace function public.get_admin_registry_page(p_query text default '',p_school text default null,p_active boolean default null,p_year int default null,p_page int default 1,p_page_size int default 20,p_registered boolean default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;v_query text:=lower(trim(coalesce(p_query,'')))||'%';v_page int:=greatest(p_page,1);v_size int:=least(greatest(p_page_size,1),100);
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 with filtered as(
  select r.*,(
   exists(select 1 from public.verification_requests vr where vr.registry_id=r.id)
   or(r.normalized_email is not null and r.normalized_email<>'' and exists(select 1 from public.profiles p where p.normalized_email=r.normalized_email))
   or(r.normalized_phone is not null and r.normalized_phone<>'' and exists(select 1 from public.profiles p where p.normalized_phone=r.normalized_phone))
  ) registered
  from public.alumni_registry r where
   (trim(coalesce(p_query,''))='' or lower(r.full_name)like v_query or coalesce(r.normalized_email,'')like v_query or coalesce(r.normalized_phone,'')like v_query)
   and(p_school is null or r.school::text=p_school) and(p_active is null or r.active=p_active) and(p_year is null or r.graduation_year=p_year)
 ),scoped as(
  select * from filtered where p_registered is null or registered=p_registered
 ),page_rows as(select * from scoped order by updated_at desc,id limit v_size offset(v_page-1)*v_size),summary as(
  select count(*) total,count(*)filter(where active) active,count(*)filter(where not active) inactive,count(*)filter(where source='csv') imported from public.alumni_registry
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.updated_at desc)from page_rows x),'[]'::jsonb),'total',(select count(*)from scoped),'counts',jsonb_build_object('all',s.total,'active',s.active,'inactive',s.inactive,'imported',s.imported)) into v_result from summary s;
 return v_result;
end $$;
