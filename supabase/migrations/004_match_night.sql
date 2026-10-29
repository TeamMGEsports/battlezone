-- 004: match night. Run once in Supabase SQL Editor after 003. Safe to re-run.
--
-- * Prizes for 1st, 2nd, 3rd and MVP, and the MVP of each match.
-- * Optional check-in: opens 60 min before start, closes 20 min before.
--   Teams that don't check in lose their slot at close.
-- * Waitlist for free matches (up to 10 teams). Freed slots go to the next
--   waitlisted team automatically.
-- * Slot numbers always stay within 1..max_slots; freed numbers are reused.

alter table matches add column if not exists prize_1   int check (prize_1 >= 0);
alter table matches add column if not exists prize_2   int check (prize_2 >= 0);
alter table matches add column if not exists prize_3   int check (prize_3 >= 0);
alter table matches add column if not exists prize_mvp int check (prize_mvp >= 0);
alter table matches add column if not exists mvp_registration_id bigint references registrations on delete set null;
alter table matches add column if not exists mvp_ign   text;
alter table matches add column if not exists mvp_kills int check (mvp_kills >= 0);
alter table matches add column if not exists checkin_required boolean not null default false;

alter table registrations add column if not exists checked_in_at timestamptz;
alter table registrations alter column slot_no drop not null;
alter table registrations drop constraint if exists registrations_status_check;
alter table registrations add constraint registrations_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'waitlist', 'released'));
-- Only teams holding a place keep a slot number.
update registrations set slot_no = null where status not in ('pending', 'confirmed') and slot_no is not null;

-- ---------------------------------------------------------------
-- Slot numbers: lowest free number, assigned whenever a team gets a place
-- ---------------------------------------------------------------

create or replace function assign_slot() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mx int;
begin
  if new.status in ('pending', 'confirmed') then
    if new.slot_no is null then
      select max_slots into mx from matches where id = new.match_id;
      select min(s) into new.slot_no from generate_series(1, mx) s
       where not exists (select 1 from registrations r
                          where r.match_id = new.match_id and r.slot_no = s and r.id <> new.id);
      if new.slot_no is null then raise exception 'All slots are full'; end if;
    end if;
  else
    new.slot_no := null;
  end if;
  return new;
end $$;

drop trigger if exists registrations_assign_slot on registrations;
create trigger registrations_assign_slot
  before insert or update of status on registrations
  for each row execute function assign_slot();

-- ---------------------------------------------------------------
-- Check-in window and settling (expired holds, no-shows, waitlist)
-- ---------------------------------------------------------------

create or replace function checkin_opens(m matches) returns timestamptz
language sql immutable as $$ select m.starts_at - interval '60 minutes' $$;
create or replace function checkin_closes(m matches) returns timestamptz
language sql immutable as $$ select m.starts_at - interval '20 minutes' $$;

-- With check-in, registration must close by the time check-in closes,
-- otherwise a late team would be confirmed and released straight away.
create or replace function registration_open(m matches) returns boolean
language sql stable as $$
  select m.status = 'open'
     and now() < m.starts_at - make_interval(mins => greatest(m.reg_close_minutes, case when m.checkin_required then 20 else 0 end))
$$;
revoke execute on function registration_open(matches) from public;

-- Brings a match up to date. Called by every player action, so no
-- background job is needed.
create or replace function settle_match(p_match_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  m      matches;
  closed boolean;
  active int;
  wid    bigint;
begin
  select * into m from matches where id = p_match_id for update;
  if not found or m.status not in ('open', 'closed', 'live') then return; end if;
  closed := m.checkin_required and now() >= checkin_closes(m);

  delete from registrations
   where match_id = m.id and status = 'pending' and utr is null and hold_until <= now();

  if closed then
    update registrations set status = 'released'
     where match_id = m.id and status = 'confirmed' and checked_in_at is null;
  end if;

  if m.entry_fee = 0 and now() < m.starts_at then
    loop
      select count(*) into active from registrations r
       where r.match_id = m.id
         and (r.status = 'confirmed' or (r.status = 'pending' and (r.utr is not null or r.hold_until > now())));
      exit when active >= m.max_slots;
      select id into wid from registrations
       where match_id = m.id and status = 'waitlist' order by created_at, id limit 1;
      exit when wid is null;
      -- Promoted after check-in closed: they are in straight away.
      update registrations set status = 'confirmed', checked_in_at = case when closed then now() end
       where id = wid;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Player actions
-- ---------------------------------------------------------------

create or replace function register_team(
  p_match_id bigint, p_team_name text, p_phone text, p_players jsonb, p_device uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m       matches;
  filled  int;
  waiting int;
  slot    int;
  reg_id  bigint;
  token   uuid;
  paid    boolean;
  st      text;
  cname   text;
begin
  perform settle_match(p_match_id);
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

  select count(*) into filled from registrations r
   where r.match_id = p_match_id
     and (r.status = 'confirmed' or (r.status = 'pending' and (r.utr is not null or r.hold_until > now())));
  if filled < m.max_slots then
    st := case when paid then 'pending' else 'confirmed' end;
  elsif paid then
    raise exception 'All slots are full';
  else
    select count(*) into waiting from registrations where match_id = p_match_id and status = 'waitlist';
    if waiting >= 10 then raise exception 'All slots and the waitlist are full'; end if;
    st := 'waitlist';
  end if;

  begin
    insert into registrations (match_id, team_name, phone, status, hold_until, device_id)
    values (p_match_id, p_team_name, p_phone, st,
            case when st = 'pending' then now() + interval '15 minutes' end, p_device)
    returning id, pay_token, slot_no into reg_id, token, slot;
    perform add_players(reg_id, p_match_id, p_players);
  exception when unique_violation then
    get stacked diagnostics cname = constraint_name;
    raise exception '%', duplicate_message(cname);
  end;

  return jsonb_build_object('slot', slot, 'token', token, 'fee', m.entry_fee, 'status', st);
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
  if not found or r.status not in ('pending', 'confirmed', 'waitlist') then raise exception 'Registration not found'; end if;
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

-- Free teams can cancel until the match starts (the slot goes to the
-- waitlist). Paid, confirmed teams must ask the organizers.
create or replace function cancel_registration(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r registrations;
  m matches;
begin
  select * into r from registrations where pay_token = p_token for update;
  if not found or r.status not in ('pending', 'confirmed', 'waitlist') then raise exception 'Registration not found'; end if;
  select * into m from matches where id = r.match_id;
  if now() >= m.starts_at then raise exception 'The match has already started'; end if;
  if r.status = 'confirmed' and m.entry_fee > 0 then
    raise exception 'Paid registrations can only be cancelled by the organizers';
  end if;
  delete from registrations where id = r.id;
  perform settle_match(m.id);
end $$;

create or replace function check_in(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r registrations;
  m matches;
begin
  select * into r from registrations where pay_token = p_token;
  if not found then raise exception 'Registration not found'; end if;
  perform settle_match(r.match_id);
  select * into r from registrations where id = r.id for update;
  select * into m from matches where id = r.match_id;
  if not m.checkin_required then raise exception 'This match does not need check-in'; end if;
  if r.status <> 'confirmed' then raise exception 'Only confirmed teams can check in'; end if;
  if now() < checkin_opens(m) then raise exception 'Check-in opens 60 minutes before the match'; end if;
  if now() >= checkin_closes(m) then raise exception 'Check-in has closed'; end if;
  update registrations set checked_in_at = coalesce(checked_in_at, now()) where id = r.id;
end $$;

create or replace function find_registration(p_match_id bigint, p_phone text, p_bgmi_id text)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  token uuid;
begin
  select r.pay_token into token
  from registrations r join registration_players p on p.registration_id = r.id
  where r.match_id = p_match_id and r.phone = btrim(p_phone) and p.bgmi_id = btrim(p_bgmi_id)
    and r.status in ('pending', 'confirmed', 'waitlist', 'released')
  limit 1;
  if token is null then raise exception 'No registration found with that WhatsApp number and BGMI ID'; end if;
  return token;
end $$;

drop function if exists registration_status(uuid);
create function registration_status(p_token uuid)
returns table (match_id bigint, slot_no int, status text, utr text, hold_until timestamptz,
               team_name text, players jsonb, checked_in_at timestamptz, waitlist_position int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  mid bigint;
begin
  select r.match_id into mid from registrations r where r.pay_token = p_token;
  if mid is null then return; end if;
  perform settle_match(mid);
  return query
  select r.match_id, r.slot_no, r.status, r.utr, r.hold_until, r.team_name,
         coalesce((select jsonb_agg(jsonb_build_object('ign', p.ign, 'bgmi_id', p.bgmi_id) order by p.id)
                     from registration_players p where p.registration_id = r.id), '[]'::jsonb),
         r.checked_in_at,
         case when r.status = 'waitlist' then
           (select count(*)::int from registrations w
             where w.match_id = r.match_id and w.status = 'waitlist'
               and (w.created_at, w.id) <= (r.created_at, r.id)) end
  from registrations r where r.pay_token = p_token;
end $$;

-- Room details: confirmed (and, if required, checked-in) teams only, after the reveal time.
create or replace function get_room(p_match_id bigint, p_token uuid default null)
returns table (room_id text, room_pass text, reveal_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform settle_match(p_match_id);
  return query
  select case when ok then r.room_id end, case when ok then r.room_pass end, reveal
  from matches m
  join match_rooms r on r.match_id = m.id
  cross join lateral (select m.starts_at - make_interval(mins => r.reveal_minutes) as reveal) t
  cross join lateral (select now() >= t.reveal and exists (
      select 1 from registrations x
      where x.match_id = m.id and x.pay_token = p_token and x.status = 'confirmed'
        and (not m.checkin_required or x.checked_in_at is not null)) as ok) a
  where m.id = p_match_id and m.status in ('open', 'closed', 'live');
end $$;

drop function if exists leaderboard(timestamptz, text);
create function leaderboard(p_since timestamptz, p_mode text default null)
returns table (team_name text, matches int, wins int, kills int, points int, mvps int)
language sql stable security definer set search_path = public as $$
  select min(r.team_name), count(*)::int,
         count(*) filter (where x.placement = 1)::int,
         sum(x.kills)::int, sum(x.points)::int,
         count(*) filter (where m.mvp_registration_id = r.id)::int
  from results x
  join registrations r on r.id = x.registration_id
  join matches m on m.id = x.match_id
  where m.starts_at >= p_since and (p_mode is null or m.mode = p_mode)
  group by lower(r.team_name)
  order by 5 desc, 4 desc
  limit 50
$$;

-- ---------------------------------------------------------------
-- Public read models (new columns are appended)
-- ---------------------------------------------------------------

create or replace view matches_public as
  select m.id, m.title, m.mode, m.map, m.starts_at, m.max_slots,
         m.prize_pool, m.per_kill, m.rules, m.status,
         (select count(*) from registrations r
           where r.match_id = m.id
             and (r.status = 'confirmed'
                  or (r.status = 'pending' and (r.utr is not null or r.hold_until > now()))))::int as filled,
         m.entry_fee,
         m.reg_close_minutes,
         (select count(*) from registrations r where r.match_id = m.id and r.status = 'waitlist')::int as waitlist,
         m.checkin_required,
         m.prize_1, m.prize_2, m.prize_3, m.prize_mvp,
         m.mvp_ign, m.mvp_kills,
         (select r.team_name from registrations r where r.id = m.mvp_registration_id) as mvp_team
  from matches m;

create or replace view registrations_public as
  select r.id, r.match_id, r.slot_no, r.team_name, '[]'::jsonb as igns,
         r.checked_in_at is not null as checked_in
  from registrations r
  where r.status = 'confirmed';

-- ---------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------

revoke execute on function assign_slot() from public;
revoke execute on function checkin_opens(matches) from public;
revoke execute on function checkin_closes(matches) from public;
revoke execute on function settle_match(bigint) from public;
revoke execute on function register_team(bigint, text, text, jsonb, uuid) from public;
revoke execute on function edit_registration(uuid, text, jsonb) from public;
revoke execute on function cancel_registration(uuid) from public;
revoke execute on function check_in(uuid) from public;
revoke execute on function find_registration(bigint, text, text) from public;
revoke execute on function registration_status(uuid) from public;
revoke execute on function get_room(bigint, uuid) from public;
revoke execute on function leaderboard(timestamptz, text) from public;
grant execute on function settle_match(bigint) to anon, authenticated;
grant execute on function register_team(bigint, text, text, jsonb, uuid) to anon, authenticated;
grant execute on function edit_registration(uuid, text, jsonb) to anon, authenticated;
grant execute on function cancel_registration(uuid) to anon, authenticated;
grant execute on function check_in(uuid) to anon, authenticated;
grant execute on function find_registration(bigint, text, text) to anon, authenticated;
grant execute on function registration_status(uuid) to anon, authenticated;
grant execute on function get_room(bigint, uuid) to anon, authenticated;
grant execute on function leaderboard(timestamptz, text) to anon, authenticated;
grant select on matches_public, registrations_public to anon, authenticated;
