-- Al cambiar la semana configurada (adelantar/pausar), cierra lo que haya
-- quedado 'pending' en semanas anteriores y cancela avisos ya encolados
-- para esas semanas abandonadas — de lo contrario quedan disparando solos
-- cuando el reloj (real o simulado) alcanza su fecha original de envío,
-- sin importar que la semana configurada ya sea otra.
create or replace function public.close_stale_weekly_confirmations(p_current_week text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.weekly_participations set status='withdrawn',confirmed_at=null,updated_at=now()
  where week_code<p_current_week and status='pending';
  update public.outbox set status='cancelled',last_error='Cancelado: la semana configurada avanzó antes de que este aviso saliera.'
  where kind in('weekly_confirmation','weekly_reactivation') and status in('pending','failed')
   and coalesce(payload->>'weekCode','')<>'' and (payload->>'weekCode')<p_current_week;
end $$;
revoke all on function public.close_stale_weekly_confirmations(text) from public,anon,authenticated;
grant execute on function public.close_stale_weekly_confirmations(text) to service_role;

create or replace function public.reconcile_availability_after_config_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_old_week text;v_new_week text;
begin
  if new.key='current' and new.value is distinct from old.value then
    perform public.reconcile_current_week_availability();
    v_old_week:=old.value->>'weekCode';
    v_new_week:=new.value->>'weekCode';
    if v_new_week is not null and v_new_week is distinct from v_old_week then
      perform public.close_stale_weekly_confirmations(v_new_week);
    end if;
  end if;
  return new;
end $$;
