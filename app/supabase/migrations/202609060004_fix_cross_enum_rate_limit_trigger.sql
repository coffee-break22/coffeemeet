create or replace function public.limit_sensitive_writes()
returns trigger
language plpgsql
security definer
set search_path=public
as $cm$
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name='match_batches' then
    perform public.consume_action_rate_limit('matching_batch',20,600);
  elsif tg_table_name='second_chances' then
    perform public.consume_action_rate_limit('second_chance',20,3600);
  elsif tg_table_name='verification_requests'
    and old.status::text is distinct from new.status::text then
    perform public.consume_action_rate_limit('verification_decision',60,3600);
  elsif tg_table_name='meetings'
    and new.status::text in('cancelled_on_time','late_cancellation')
    and old.status::text is distinct from new.status::text then
    perform public.consume_action_rate_limit('meeting_cancellation',10,3600);
  end if;
  return new;
end $cm$;

revoke all on function public.limit_sensitive_writes() from public,anon,authenticated;
