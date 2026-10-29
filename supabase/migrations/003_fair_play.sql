-- 003: fair play. Run once in Supabase SQL Editor after 002. Safe to re-run.
--
-- * Room ID/password only go to confirmed teams (by their private token).
-- * Registration closes N minutes before start (default 30).
-- * One registration per device per match, and an admin ban list.
-- * Captains can find, edit or cancel their own registration until it closes.
-- * The public team list shows slot number and team name only.

alter table matches add column if not exists reg_close_minutes int not null default 30
  check (reg_close_minutes between 0 and 600);

alter table registrations add column if not exists device_id uuid;
create unique index if not exists registrations_device_uq
  on registrations (match_id, device_id) where device_id is not null;

create table if not exists bans (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('phone', 'bgmi_id')),
  value       text not null,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (kind, value)
);
alter table bans enable row level security;
drop policy if exists admin_all on bans;
create policy admin_all on bans for all to authenticated using (is_admin()) with check (is_admin());
revoke all on bans from anon;
grant select, insert, update, delete on bans to authenticated;

-- ---------------------------------------------------------------
-- Shared checks (only called from the functions below)
-- ---------------------------------------------------------------

create or replace function registration_open(m matches) returns boolean
language sql stable as $$
  select m.status = 'open' and now() < m.starts_at - make_interval(mins => m.reg_close_minutes)
$$;

-- Validates team name and players for the match mode, rejects banned
-- players, and returns the cleaned team name.
create or replace function check_team(m matches, p_team_name text, p_players jsonb)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  needed int := case m.mode when 'solo' then 1 when 'duo' then 2 else 4 end;
  pl     jsonb;
begin
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) <> needed then
    raise exception 'This match needs % player(s)', needed;
  end if;
  p_team_name := btrim(p_team_name);
  if length(p_team_name) not between 2 and 30 then
    raise exception 'Team name must be 2–30 characters';
  end if;
  for pl in select * from jsonb_array_elements(p_players) loop
    if coalesce(btrim(pl->>'ign'), '') = '' or (pl->>'bgmi_id') !~ '^[0-9]{6,12}$' then
      raise exception 'Each player needs an in-game name and a valid BGMI ID';
    end if;
    if exists (select 1 from bans where kind = 'bgmi_id' and value = pl->>'bgmi_id') then
      raise exception 'BGMI ID % is not allowed to register. Contact the organizers.', pl->>'bgmi_id';
    end if;
  end loop;
  return p_team_name;
end $$;

create or replace function add_players(p_reg_id bigint, p_match_id bigint, p_players jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into registration_players (registration_id, match_id, ign, bgmi_id)
  select p_reg_id, p_match_id, btrim(pl->>'ign'), pl->>'bgmi_id'
  from jsonb_array_elements(p_players) pl
$$;

create or replace function duplicate_message(p_constraint text) returns text
language sql immutable as $$
  select case p_constraint
    when 'registrations_device_uq' then 'This phone has already registered a team for this match'
    when 'registrations_match_id_phone_key' then 'This WhatsApp number is already registered for this match'
    when 'registrations_team_name_uq' then 'This team name is already taken for this match'
    when 'registration_players_match_id_bgmi_id_key' then 'One of these BGMI IDs is already registered for this match'
    else 'This team is already registered for this match' end
$$;

-- ---------------------------------------------------------------
-- Player actions
-- ---------------------------------------------------------------

drop function if exists register_team(bigint, text, text, jsonb);
create or replace function register_team(
  p_match_id bigint, p_team_name text, p_phone text, p_players jsonb, p_device uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m      matches;
  filled int;
  slot   int;
  reg_id bigint;
  token  uuid;
  paid   boolean;
  cname  text;
begin
  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if not registration_open(m) then raise exception 'Registration is closed for this match'; end if;
  paid := m.entry_fee > 0;

  p_team_name := check_team(m, p_team_name, p_players);
  if p_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit WhatsApp number';
  end if;
  if exists (select 1 from bans where kind = 'phone' and value = p_phone) then
    raise exception 'This number is not allowed to register. Contact the organizers.';
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
    insert into registrations (match_id, slot_no, team_name, phone, status, hold_until, device_id)
    values (p_match_id, slot, p_team_name, p_phone,
            case when paid then 'pending' else 'confirmed' end,
            case when paid then now() + interval '15 minutes' end,
            p_device)
    returning id, pay_token into reg_id, token;
    perform add_players(reg_id, p_match_id, p_players);
  exception when unique_violation then
    get stacked diagnostics cname = constraint_name;
    raise exception '%', duplicate_message(cname);
  end;

  return jsonb_build_object(
    'slot', slot, 'token', token, 'fee', m.entry_fee,
    'status', case when paid then 'pending' else 'confirmed' end);
end $$;

create or replace function edit_registration(p_token uuid, p_team_name text, p_players jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r     registrations;
  m     matches;
  cname text;
begin
  select * into r from registrations where pay_token = p_token for update;
  if not found or r.status not in ('pending', 'confirmed') then raise exception 'Registration not found'; end if;
  select * into m from matches where id = r.match_id;
  if not registration_open(m) then raise exception 'Registration has closed, so changes are locked. Contact the organizers.'; end if;
  p_team_name := check_team(m, p_team_name, p_players);
  begin
    update registrations set team_name = p_team_name where id = r.id;
    delete from registration_players where registration_id = r.id;
    perform add_players(r.id, r.match_id, p_players);
  exception when unique_violation then
    get stacked diagnostics cname = constraint_name;
    raise exception '%', duplicate_message(cname);
  end;
end $$;

create or replace function cancel_registration(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r registrations;
  m matches;
begin
  select * into r from registrations where pay_token = p_token for update;
  if not found or r.status not in ('pending', 'confirmed') then raise exception 'Registration not found'; end if;
  select * into m from matches where id = r.match_id;
  if not registration_open(m) then raise exception 'Registration has closed. Contact the organizers to cancel.'; end if;
  if r.status = 'confirmed' and m.entry_fee > 0 then
    raise exception 'Paid registrations can only be cancelled by the organizers';
  end if;
  delete from registrations where id = r.id;
end $$;

-- Recover a registration on another phone: the captain's WhatsApp number
-- plus the BGMI ID of any player in that team.
create or replace function find_registration(p_match_id bigint, p_phone text, p_bgmi_id text)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  token uuid;
begin
  select r.pay_token into token
  from registrations r join registration_players p on p.registration_id = r.id
  where r.match_id = p_match_id and r.phone = btrim(p_phone) and p.bgmi_id = btrim(p_bgmi_id)
    and r.status in ('pending', 'confirmed')
  limit 1;
  if token is null then raise exception 'No registration found with that WhatsApp number and BGMI ID'; end if;
  return token;
end $$;

drop function if exists registration_status(uuid);
create function registration_status(p_token uuid)
returns table (match_id bigint, slot_no int, status text, utr text, hold_until timestamptz,
               team_name text, players jsonb)
language sql stable security definer set search_path = public as $$
  select r.match_id, r.slot_no, r.status, r.utr, r.hold_until, r.team_name,
         coalesce((select jsonb_agg(jsonb_build_object('ign', p.ign, 'bgmi_id', p.bgmi_id) order by p.id)
                     from registration_players p where p.registration_id = r.id), '[]'::jsonb)
  from registrations r where r.pay_token = p_token
$$;

-- Room details only for a confirmed team of this match, once the reveal time has passed.
drop function if exists get_room(bigint);
create or replace function get_room(p_match_id bigint, p_token uuid default null)
returns table (room_id text, room_pass text, reveal_at timestamptz)
language sql stable security definer set search_path = public as $$
  select case when ok then r.room_id end, case when ok then r.room_pass end, reveal
  from matches m
  join match_rooms r on r.match_id = m.id
  cross join lateral (select m.starts_at - make_interval(mins => r.reveal_minutes) as reveal) t
  cross join lateral (select now() >= t.reveal and exists (
      select 1 from registrations x
      where x.match_id = m.id and x.pay_token = p_token and x.status = 'confirmed') as ok) a
  where m.id = p_match_id and m.status in ('open', 'closed', 'live')
$$;

-- ---------------------------------------------------------------
-- Public read models
-- ---------------------------------------------------------------

create or replace view matches_public as
  select m.id, m.title, m.mode, m.map, m.starts_at, m.max_slots,
         m.prize_pool, m.per_kill, m.rules, m.status,
         (select count(*) from registrations r
           where r.match_id = m.id
             and (r.status = 'confirmed'
                  or (r.status = 'pending' and (r.utr is not null or r.hold_until > now()))))::int as filled,
         m.entry_fee,
         m.reg_close_minutes
  from matches m;

-- Slot number and team name only. igns is kept (always empty) so older
-- copies of the site keep working while the update rolls out.
drop view if exists registrations_public;
create view registrations_public as
  select r.id, r.match_id, r.slot_no, r.team_name, '[]'::jsonb as igns
  from registrations r
  where r.status = 'confirmed';

-- ---------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------

revoke execute on function registration_open(matches) from public;
revoke execute on function check_team(matches, text, jsonb) from public;
revoke execute on function add_players(bigint, bigint, jsonb) from public;
revoke execute on function register_team(bigint, text, text, jsonb, uuid) from public;
revoke execute on function edit_registration(uuid, text, jsonb) from public;
revoke execute on function cancel_registration(uuid) from public;
revoke execute on function find_registration(bigint, text, text) from public;
revoke execute on function registration_status(uuid) from public;
revoke execute on function get_room(bigint, uuid) from public;
grant execute on function register_team(bigint, text, text, jsonb, uuid) to anon, authenticated;
grant execute on function edit_registration(uuid, text, jsonb) to anon, authenticated;
grant execute on function cancel_registration(uuid) to anon, authenticated;
grant execute on function find_registration(bigint, text, text) to anon, authenticated;
grant execute on function registration_status(uuid) to anon, authenticated;
grant execute on function get_room(bigint, uuid) to anon, authenticated;
grant select on matches_public, registrations_public to anon, authenticated;
