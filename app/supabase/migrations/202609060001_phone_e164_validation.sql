alter table public.profiles
  drop constraint if exists profiles_normalized_phone_e164_check;
alter table public.profiles
  add constraint profiles_normalized_phone_e164_check
  check(normalized_phone='' or normalized_phone~'^[+][1-9][0-9]{7,14}$') not valid;
