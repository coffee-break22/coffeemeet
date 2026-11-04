create or replace function public.get_my_meetings()
returns table(
 id uuid,
 week_code text,
 slot_id text,
 status public.meeting_status,
 meet_link text,
 scheduled_at timestamptz,
 partner_id uuid,
 partner_name text,
 partner_email text,
 partner_phone text,
 partner_linkedin text,
 cancelled_by uuid,
 cancellation_exempt boolean
)
language sql stable security definer set search_path=public as $$
 select m.id,m.week_code,m.slot_id,m.status,m.meet_link,
  case when split_part(m.slot_id,'|',1)='virtual'
   then (split_part(m.slot_id,'|',2)||' '||split_part(m.slot_id,'|',3))::timestamp at time zone 'America/Bogota'
   else (split_part(m.slot_id,'|',3)||' '||split_part(m.slot_id,'|',4))::timestamp at time zone 'America/Bogota'
  end,
  p.id,p.full_name,p.email,p.phone,p.linkedin_url,m.cancelled_by,m.cancellation_exempt
 from public.meetings m
 join public.profiles p on p.id=case when m.user_a_id=auth.uid() then m.user_b_id else m.user_a_id end
 where auth.uid() is not null and auth.uid() in(m.user_a_id,m.user_b_id) and m.status<>'draft'
 order by 6 desc
$$;
revoke all on function public.get_my_meetings() from public,anon;
grant execute on function public.get_my_meetings() to authenticated;