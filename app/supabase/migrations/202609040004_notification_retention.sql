create or replace function public.cleanup_operational_notifications()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_notifications int;v_surveys int;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 delete from public.outbox
 where (status in('succeeded','cancelled') and coalesce(processed_at,created_at)<now()-interval '90 days')
    or (status='failed' and created_at<now()-interval '180 days');
 get diagnostics v_notifications=row_count;
 delete from public.survey_sessions where step='completed' and updated_at<now()-interval '90 days';
 get diagnostics v_surveys=row_count;
 return jsonb_build_object('notifications',v_notifications,'surveys',v_surveys);
end $$;
revoke all on function public.cleanup_operational_notifications() from public,anon,authenticated;
grant execute on function public.cleanup_operational_notifications() to service_role;

create index if not exists outbox_retention_idx on public.outbox(status,processed_at,created_at);
create index if not exists survey_sessions_retention_idx on public.survey_sessions(step,updated_at);
