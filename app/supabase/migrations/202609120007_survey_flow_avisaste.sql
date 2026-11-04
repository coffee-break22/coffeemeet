alter table public.survey_sessions drop constraint if exists survey_sessions_step_check;
alter table public.survey_sessions add constraint survey_sessions_step_check
 check(step in('awaiting_occurred','awaiting_self','awaiting_partner_arrived','awaiting_partner_notice','awaiting_self_notice','awaiting_comment','completed'));
