-- 002: optional paid entry via UPI.
-- Run once in Supabase SQL Editor (after schema.sql). Safe to re-run.
--
-- entry_fee = 0 → free match, registration is confirmed instantly (as before).
-- entry_fee > 0 → registration starts as 'pending' and holds the slot for
-- 15 minutes; the player pays by UPI and submits the 12-digit UTR; an
-- organizer checks UPI and confirms or rejects it.

alter table matches add column if not exists entry_fee int not null default 0 check (entry_fee >= 0);

alter table registrations add column if not exists utr        text;
alter table registrations add column if not exists pay_token  uuid not null default gen_random_uuid();
alter table registrations add column if not exists hold_until timestamptz;
create unique index if not exists registrations_utr_uq   on registrations (utr) where utr is not null;
create unique index if not exists registrations_token_uq on registrations (pay_token);
alter table registrations drop constraint if exists registrations_status_check;
alter table registrations add constraint registrations_status_check
  check (status in ('pending', 'confirmed', 'rejected'));

-- A registration holds a slot when it is confirmed, or pending with a UTR
-- submitted, or pending and still inside its payment window.
create or replace view matches_public as
  select m.id, m.title, m.mode, m.map, m.starts_at, m.max_slots,
         m.prize_pool, m.per_kill, m.rules, m.status,
         (select count(*) from registrations r
           where r.match_id = m.id
             and (r.status = 'confirmed'
                  or (r.status = 'pending' and (r.utr is not null or r.hold_until > now()))))::int as filled,
         m.entry_fee
  from matches m;

drop function if exists register_team(bigint, text, text, jsonb);
create function register_team(
  p_match_id bigint, p_team_name text, p_phone text, p_players jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m        matches;
  needed   int;
  filled   int;
  slot     int;
  reg_id   bigint;
  token    uuid;
  paid     boolean;
  pl       jsonb;
begin
  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'open' or now() >= m.starts_at then
    raise exception 'Registration is closed for this match';
  end if;
  paid := m.entry_fee > 0;

  needed := case m.mode when 'solo' then 1 when 'duo' then 2 else 4 end;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) <> needed then
    raise exception 'This match needs % player(s)', needed;
  end if;

  p_team_name := btrim(p_team_name);
  if length(p_team_name) not between 2 and 30 then
    raise exception 'Team name must be 2–30 characters';
  end if;
  if p_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit WhatsApp number';
  end if;

  -- Free up slots whose payment window ran out without a UTR.
  delete from registrations
   where match_id = p_match_id and status = 'pending' and utr is null and hold_until <= now();

  select count(*) into filled from registrations r
   where r.match_id = p_match_id
     and (r.status = 'confirmed' or (r.status = 'pending' and (r.utr is not null or r.hold_until > now())));
  if filled >= m.max_slots then raise exception 'All slots are full'; end if;

  select coalesce(max(slot_no), 0) + 1 into slot from registrations where match_id = p_match_id;

  begin
    insert into registrations (match_id, slot_no, team_name, phone, status, hold_until)
    values (p_match_id, slot, p_team_name, p_phone,
            case when paid then 'pending' else 'confirmed' end,
            case when paid then now() + interval '15 minutes' end)
    returning id, pay_token into reg_id, token;

    for pl in select * from jsonb_array_elements(p_players) loop
      if coalesce(btrim(pl->>'ign'), '') = '' or (pl->>'bgmi_id') !~ '^[0-9]{6,12}$' then
        raise exception 'Each player needs an in-game name and a valid BGMI ID';
      end if;
      insert into registration_players (registration_id, match_id, ign, bgmi_id)
      values (reg_id, p_match_id, btrim(pl->>'ign'), pl->>'bgmi_id');
    end loop;
  exception when unique_violation then
    raise exception 'This team name, phone number or BGMI ID is already registered for this match';
  end;

  return jsonb_build_object(
    'slot', slot, 'token', token, 'fee', m.entry_fee,
    'status', case when paid then 'pending' else 'confirmed' end);
end $$;

create or replace function submit_utr(p_token uuid, p_utr text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r registrations;
begin
  select * into r from registrations where pay_token = p_token for update;
  if not found then raise exception 'Registration not found. Please register again.'; end if;
  if r.status <> 'pending' then raise exception 'This registration is already %', r.status; end if;
  if r.utr is null and r.hold_until <= now() then
    raise exception 'Your 15-minute payment window has ended. Please register again.';
  end if;
  p_utr := btrim(p_utr);
  if p_utr !~ '^[0-9]{12}$' then raise exception 'UTR / transaction ID must be 12 digits'; end if;
  begin
    update registrations set utr = p_utr where id = r.id;
  exception when unique_violation then
    raise exception 'This UTR has already been used';
  end;
end $$;

-- Lets a player check their own registration with the private token
-- stored in their browser after registering.
create or replace function registration_status(p_token uuid)
returns table (match_id bigint, slot_no int, status text, utr text, hold_until timestamptz)
language sql stable security definer set search_path = public as $$
  select match_id, slot_no, status, utr, hold_until from registrations where pay_token = p_token
$$;

revoke execute on function register_team(bigint, text, text, jsonb) from public;
revoke execute on function submit_utr(uuid, text) from public;
revoke execute on function registration_status(uuid) from public;
grant execute on function register_team(bigint, text, text, jsonb) to anon, authenticated;
grant execute on function submit_utr(uuid, text) to anon, authenticated;
grant execute on function registration_status(uuid) to anon, authenticated;
grant select on matches_public to anon, authenticated;
