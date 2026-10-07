create or replace function public.advance_weekly_config()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_config jsonb;v_week text;v_monday date;v_days jsonb;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' and not public.is_admin() then raise exception 'ADMIN_OR_SERVICE_ROLE_REQUIRED';end if;
 select value into v_config from public.meeting_config where key='current' for update;
 if v_config is null then raise exception 'MEETING_CONFIG_NOT_FOUND';end if;
 loop
  v_week:=v_config->>'weekCode';
  if v_week is null or v_week!~'^[0-9]{4}-W[0-9]{2}$' then raise exception 'INVALID_WEEK_CODE';end if;
  v_monday:=public.week_monday(v_week);
  select coalesce(jsonb_agg(day||jsonb_build_object(
   'date',(v_monday+(extract(isodow from (day->>'date')::date)::int-1))::text
  ) order by ordinal),'[]'::jsonb) into v_days
  from jsonb_array_elements(v_config->'days') with ordinality as item(day,ordinal);
  v_config:=jsonb_set(v_config,'{days}',v_days);
  exit when now()<public.weekly_confirmation_cutoff(v_week);
  select coalesce(jsonb_agg(day||jsonb_build_object(
   'date',((day->>'date')::date+7)::text,'blocked',false,'reason',''
  ) order by ordinal),'[]'::jsonb) into v_days
  from jsonb_array_elements(v_config->'days') with ordinality as item(day,ordinal);
  v_config:=jsonb_set(jsonb_set(v_config,'{weekCode}',to_jsonb(to_char(v_monday+7,'IYYY-"W"IW'))),'{days}',v_days);
 end loop;
 update public.meeting_config set value=v_config,updated_at=now() where key='current';
 return v_config;
end $$;
revoke all on function public.advance_weekly_config() from public,anon,authenticated;
grant execute on function public.advance_weekly_config() to service_role;
grant execute on function public.advance_weekly_config() to authenticated;
