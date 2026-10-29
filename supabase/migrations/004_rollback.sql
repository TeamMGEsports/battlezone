-- Undo 004_match_night.sql: back to the 003 behaviour. Run this in Supabase
-- SQL Editor ONLY together with reverting the website change on GitHub.
-- New columns are kept (unused), so re-running 004 later brings everything back.

drop trigger if exists registrations_assign_slot on registrations;
drop function if exists check_in(uuid);
drop function if exists registration_status(uuid);
drop function if exists get_room(bigint, uuid);
drop function if exists leaderboard(timestamptz, text);

-- Waitlisted and released teams have no place in the 003 version.
update registrations set status = 'rejected' where status in ('waitlist', 'released');
-- Give any team holding a place without a number the next free number.
update registrations r set slot_no = n.slot
from (select id, (select coalesce(max(slot_no), 0) from registrations x where x.match_id = r2.match_id)
                 + row_number() over (partition by match_id order by id) as slot
        from registrations r2 where status in ('pending', 'confirmed') and slot_no is null) n
where r.id = n.id;

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

create function registration_status(p_token uuid)
returns table (match_id bigint, slot_no int, status text, utr text, hold_until timestamptz,
               team_name text, players jsonb)
language sql stable security definer set search_path = public as $$
  select r.match_id, r.slot_no, r.status, r.utr, r.hold_until, r.team_name,
         coalesce((select jsonb_agg(jsonb_build_object('ign', p.ign, 'bgmi_id', p.bgmi_id) order by p.id)
                     from registration_players p where p.registration_id = r.id), '[]'::jsonb)
  from registrations r where r.pay_token = p_token
$$;

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

create or replace function leaderboard(p_since timestamptz, p_mode text default null)
returns table (team_name text, matches int, wins int, kills int, points int)
language sql stable security definer set search_path = public as $$
  select min(r.team_name), count(*)::int,
         count(*) filter (where x.placement = 1)::int,
         sum(x.kills)::int, sum(x.points)::int
  from results x
  join registrations r on r.id = x.registration_id
  join matches m on m.id = x.match_id
  where m.starts_at >= p_since and (p_mode is null or m.mode = p_mode)
  group by lower(r.team_name)
  order by 5 desc, 4 desc
  limit 50
$$;

create or replace function registration_open(m matches) returns boolean
language sql stable as $$
  select m.status = 'open' and now() < m.starts_at - make_interval(mins => m.reg_close_minutes)
$$;

drop function if exists settle_match(bigint);
drop function if exists assign_slot();

drop view if exists matches_public;
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

drop view if exists registrations_public;
create view registrations_public as
  select r.id, r.match_id, r.slot_no, r.team_name, '[]'::jsonb as igns
  from registrations r
  where r.status = 'confirmed';

revoke execute on function register_team(bigint, text, text, jsonb, uuid) from public;
revoke execute on function edit_registration(uuid, text, jsonb) from public;
revoke execute on function cancel_registration(uuid) from public;
revoke execute on function find_registration(bigint, text, text) from public;
revoke execute on function registration_status(uuid) from public;
revoke execute on function get_room(bigint, uuid) from public;
revoke execute on function leaderboard(timestamptz, text) from public;
grant execute on function register_team(bigint, text, text, jsonb, uuid) to anon, authenticated;
grant execute on function edit_registration(uuid, text, jsonb) to anon, authenticated;
grant execute on function cancel_registration(uuid) to anon, authenticated;
grant execute on function find_registration(bigint, text, text) to anon, authenticated;
grant execute on function registration_status(uuid) to anon, authenticated;
grant execute on function get_room(bigint, uuid) to anon, authenticated;
grant execute on function leaderboard(timestamptz, text) to anon, authenticated;
grant select on matches_public, registrations_public to anon, authenticated;
