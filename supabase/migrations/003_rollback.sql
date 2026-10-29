-- Undo 003_fair_play.sql: back to the 002 behaviour. Run this in Supabase
-- SQL Editor ONLY together with reverting the website change on GitHub.
-- The bans table and new columns are kept (unused), so re-running 003
-- later brings everything back.

drop function if exists edit_registration(uuid, text, jsonb);
drop function if exists cancel_registration(uuid);
drop function if exists find_registration(bigint, text, text);
drop function if exists register_team(bigint, text, text, jsonb, uuid);
drop function if exists registration_status(uuid);
drop function if exists get_room(bigint, uuid);
drop function if exists check_team(matches, text, jsonb);
drop function if exists add_players(bigint, bigint, jsonb);
drop function if exists registration_open(matches);
drop function if exists duplicate_message(text);

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

create or replace function registration_status(p_token uuid)
returns table (match_id bigint, slot_no int, status text, utr text, hold_until timestamptz)
language sql stable security definer set search_path = public as $$
  select match_id, slot_no, status, utr, hold_until from registrations where pay_token = p_token
$$;

create or replace function get_room(p_match_id bigint)
returns table (room_id text, room_pass text, reveal_at timestamptz)
language sql stable security definer set search_path = public as $$
  select case when now() >= m.starts_at - make_interval(mins => r.reveal_minutes) then r.room_id end,
         case when now() >= m.starts_at - make_interval(mins => r.reveal_minutes) then r.room_pass end,
         m.starts_at - make_interval(mins => r.reveal_minutes)
  from matches m join match_rooms r on r.match_id = m.id
  where m.id = p_match_id and m.status in ('open', 'closed', 'live')
$$;

drop view if exists registrations_public;
create or replace view registrations_public as
  select r.id, r.match_id, r.slot_no, r.team_name,
         coalesce((select jsonb_agg(p.ign order by p.id)
                     from registration_players p
                    where p.registration_id = r.id), '[]'::jsonb) as igns
  from registrations r
  where r.status = 'confirmed';

revoke execute on function register_team(bigint, text, text, jsonb) from public;
revoke execute on function registration_status(uuid) from public;
revoke execute on function get_room(bigint) from public;
grant execute on function register_team(bigint, text, text, jsonb) to anon, authenticated;
grant execute on function registration_status(uuid) to anon, authenticated;
grant execute on function get_room(bigint) to anon, authenticated;
grant select on registrations_public to anon, authenticated;
