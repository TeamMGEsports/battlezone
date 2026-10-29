-- TeamMG Esports — database schema for Supabase
-- Run this once in Supabase: SQL Editor → New query → paste → Run.
-- Safe to re-run on an empty project. See README.md for the full setup.

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------

create table if not exists matches (
  id          bigint generated always as identity primary key,
  title       text not null,
  mode        text not null check (mode in ('solo', 'duo', 'squad')),
  map         text not null default 'Erangel',
  starts_at   timestamptz not null,
  max_slots   int  not null check (max_slots between 1 and 100),
  prize_pool  text,
  per_kill    text,
  rules       text,
  status      text not null default 'open'
              check (status in ('open', 'closed', 'live', 'completed', 'cancelled')),
  created_at  timestamptz not null default now()
);
create index if not exists matches_starts_at_idx on matches (starts_at);

-- Room details live in their own table so players can never read them
-- directly. They are only handed out by get_room() near match time.
create table if not exists match_rooms (
  match_id        bigint primary key references matches on delete cascade,
  room_id         text,
  room_pass       text,
  reveal_minutes  int not null default 15
);

create table if not exists registrations (
  id          bigint generated always as identity primary key,
  match_id    bigint not null references matches on delete cascade,
  slot_no     int  not null,
  team_name   text not null,
  phone       text not null,
  status      text not null default 'confirmed' check (status in ('confirmed', 'rejected')),
  created_at  timestamptz not null default now(),
  unique (match_id, slot_no),
  unique (match_id, phone)
);
create unique index if not exists registrations_team_name_uq
  on registrations (match_id, lower(team_name));

create table if not exists registration_players (
  id               bigint generated always as identity primary key,
  registration_id  bigint not null references registrations on delete cascade,
  match_id         bigint not null references matches on delete cascade,
  ign              text not null,
  bgmi_id          text not null,
  unique (match_id, bgmi_id)
);

-- Placement points. Edit the numbers here to change the scoring system.
create or replace function placement_points(p int) returns int
language sql immutable as $$
  select case p
    when 1 then 10 when 2 then 6 when 3 then 5 when 4 then 4
    when 5 then 3  when 6 then 2 when 7 then 1 when 8 then 1
    else 0 end
$$;

create table if not exists results (
  registration_id  bigint primary key references registrations on delete cascade,
  match_id         bigint not null references matches on delete cascade,
  placement        int not null check (placement >= 1),
  kills            int not null default 0 check (kills >= 0),
  points           int generated always as (placement_points(placement) + kills) stored,
  prize            text
);
create index if not exists results_match_idx on results (match_id);

create table if not exists admins (
  user_id uuid primary key references auth.users on delete cascade
);

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------
-- Public read models (no phone numbers, no BGMI IDs)
-- ---------------------------------------------------------------

create or replace view matches_public as
  select m.id, m.title, m.mode, m.map, m.starts_at, m.max_slots,
         m.prize_pool, m.per_kill, m.rules, m.status,
         (select count(*) from registrations r
           where r.match_id = m.id and r.status = 'confirmed')::int as filled
  from matches m;

create or replace view registrations_public as
  select r.id, r.match_id, r.slot_no, r.team_name,
         coalesce((select jsonb_agg(p.ign order by p.id)
                     from registration_players p
                    where p.registration_id = r.id), '[]'::jsonb) as igns
  from registrations r
  where r.status = 'confirmed';

create or replace view results_public as
  select x.match_id, r.slot_no, r.team_name, x.placement, x.kills, x.points, x.prize
  from results x join registrations r on r.id = x.registration_id;

-- ---------------------------------------------------------------
-- Player actions (called from the website)
-- ---------------------------------------------------------------

create or replace function register_team(
  p_match_id bigint, p_team_name text, p_phone text, p_players jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  m        matches;
  needed   int;
  filled   int;
  slot     int;
  reg_id   bigint;
  pl       jsonb;
begin
  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'open' or now() >= m.starts_at then
    raise exception 'Registration is closed for this match';
  end if;

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

  select count(*) into filled from registrations
   where match_id = p_match_id and status = 'confirmed';
  if filled >= m.max_slots then raise exception 'All slots are full'; end if;

  select coalesce(max(slot_no), 0) + 1 into slot from registrations where match_id = p_match_id;

  begin
    insert into registrations (match_id, slot_no, team_name, phone)
    values (p_match_id, slot, p_team_name, p_phone)
    returning id into reg_id;

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

  return slot;
end $$;

-- Room details: only returned once the reveal window has started.
create or replace function get_room(p_match_id bigint)
returns table (room_id text, room_pass text, reveal_at timestamptz)
language sql stable security definer set search_path = public as $$
  select case when now() >= m.starts_at - make_interval(mins => r.reveal_minutes) then r.room_id end,
         case when now() >= m.starts_at - make_interval(mins => r.reveal_minutes) then r.room_pass end,
         m.starts_at - make_interval(mins => r.reveal_minutes)
  from matches m join match_rooms r on r.match_id = m.id
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

-- ---------------------------------------------------------------
-- Row level security: players read public views only; admins do the rest
-- ---------------------------------------------------------------

alter table matches              enable row level security;
alter table match_rooms          enable row level security;
alter table registrations        enable row level security;
alter table registration_players enable row level security;
alter table results              enable row level security;
alter table admins               enable row level security;

drop policy if exists admin_all on matches;
drop policy if exists admin_all on match_rooms;
drop policy if exists admin_all on registrations;
drop policy if exists admin_all on registration_players;
drop policy if exists admin_all on results;
create policy admin_all on matches              for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on match_rooms          for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on registrations        for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on registration_players for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on results              for all to authenticated using (is_admin()) with check (is_admin());

-- Explicit grants, so this works with "Automatically expose new tables" off.
-- Signed-in users get table access, but the policies above limit it to admins.
revoke all on matches, match_rooms, registrations, registration_players, results, admins from anon;
grant select, insert, update, delete on matches, match_rooms, registrations, registration_players, results to authenticated;
grant select on matches_public, registrations_public, results_public to anon, authenticated;
grant execute on function placement_points(int) to authenticated;
revoke execute on function register_team(bigint, text, text, jsonb) from public;
revoke execute on function get_room(bigint) from public;
revoke execute on function leaderboard(timestamptz, text) from public;
grant execute on function register_team(bigint, text, text, jsonb) to anon, authenticated;
grant execute on function get_room(bigint) to anon, authenticated;
grant execute on function leaderboard(timestamptz, text) to anon, authenticated;
grant execute on function is_admin() to authenticated;
