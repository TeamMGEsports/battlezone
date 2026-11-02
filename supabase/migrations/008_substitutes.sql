-- 008: substitute player. Run once in Supabase SQL Editor after 007. Safe to re-run.
--
-- Squads can register an optional 5th player as a substitute. Subs follow the
-- same rules as other players: valid BGMI ID, not banned, and not registered
-- in another team for the same match.

alter table registration_players add column if not exists is_sub boolean not null default false;

-- Validates team name and players (plus an optional squad substitute), rejects banned
-- players, and returns the cleaned team name.
create or replace function check_team(m matches, p_team_name text, p_players jsonb)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  needed int := case m.mode when 'solo' then 1 when 'duo' then 2 else 4 end;
  subs   int := case when m.mode = 'squad' then 1 else 0 end;  -- squads may add a 5th player
  pl     jsonb;
begin
  if jsonb_typeof(p_players) <> 'array'
     or jsonb_array_length(p_players) not between needed and needed + subs then
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
  -- Anyone after the players the mode needs is a substitute.
  insert into registration_players (registration_id, match_id, ign, bgmi_id, is_sub)
  select p_reg_id, p_match_id, btrim(pl->>'ign'), pl->>'bgmi_id',
         n > (select case m.mode when 'solo' then 1 when 'duo' then 2 else 4 end from matches m where m.id = p_match_id)
  from jsonb_array_elements(p_players) with ordinality as t(pl, n)
$$;

drop function if exists registration_status(uuid);
create function registration_status(p_token uuid)
returns table (match_id bigint, slot_no int, status text, utr text, hold_until timestamptz,
               team_name text, players jsonb, checked_in_at timestamptz, waitlist_position int,
               yt_handle text)
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
         coalesce((select jsonb_agg(jsonb_build_object('ign', p.ign, 'bgmi_id', p.bgmi_id, 'is_sub', p.is_sub) order by p.id)
                     from registration_players p where p.registration_id = r.id), '[]'::jsonb),
         r.checked_in_at,
         case when r.status = 'waitlist' then
           (select count(*)::int from registrations w
             where w.match_id = r.match_id and w.status = 'waitlist'
               and (w.created_at, w.id) <= (r.created_at, r.id)) end,
         r.yt_handle
  from registrations r where r.pay_token = p_token;
end $$;

revoke execute on function check_team(matches, text, jsonb) from public;
revoke execute on function add_players(bigint, bigint, jsonb) from public;
revoke execute on function registration_status(uuid) from public;
grant execute on function registration_status(uuid) to anon, authenticated;
