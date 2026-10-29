-- Antes: registrarse dejaba la participación en 'confirmed' de una vez, sin
-- pasar por el aviso de domingo (CLAUDE.md §4) — el cliente pidió que
-- incluso la primera semana de alguien pase por ese mismo aviso y exija
-- responder, en vez de darlo por confirmado automáticamente.
-- 'on conflict do nothing' además evita que editar la disponibilidad más
-- adelante reviva o resetee una confirmación que ya existía.
create or replace function public.submit_weekly_registration_v2(p_full_name text,p_contact_email text,p_alumni_email text,p_phone text,p_linkedin_url text,p_school text,p_graduation_year int,p_city text,p_only_new_people boolean,p_week_code text,p_slot_ids text[],p_known_phones text[],p_known_emails text[]) returns public.verification_status language plpgsql security definer set search_path=public as $$
declare v_status public.verification_status;v_alumni text:=lower(trim(coalesce(p_alumni_email,'')));v_contact text:=lower(trim(coalesce(p_contact_email,'')));
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;if public.is_admin() then raise exception 'ADMIN_CANNOT_PARTICIPATE';end if;
 if public.app_now()>=public.weekly_confirmation_cutoff(p_week_code) then raise exception 'WEEKLY_CONFIRMATION_CLOSED';end if;if v_alumni='' then raise exception 'ALUMNI_EMAIL_REQUIRED';end if;if v_contact='' then raise exception 'CONTACT_EMAIL_REQUIRED';end if;
 select public.submit_weekly_registration(p_full_name,v_alumni,p_phone,p_linkedin_url,p_school,p_graduation_year,p_city,p_only_new_people,p_week_code,p_slot_ids,p_known_phones,p_known_emails) into v_status;
 update public.profiles set email=v_contact,normalized_email=v_contact,alumni_email=v_alumni,normalized_alumni_email=v_alumni,updated_at=now() where id=auth.uid();
 insert into public.weekly_participations(user_id,week_code,status,confirmed_at,updated_at) values(auth.uid(),p_week_code,'pending',null,now()) on conflict(user_id,week_code) do nothing;return v_status;
end $$;
