-- Undo 002_paid_entry.sql: puts registration back to the original free-only
-- version. Run this in Supabase SQL Editor ONLY if you also revert the
-- website change on GitHub. Payment columns and data are kept (unused),
-- so re-running 002 later brings everything back.

drop function if exists submit_utr(uuid, text);
drop function if exists registration_status(uuid);
drop function if exists register_team(bigint, text, text, jsonb);

drop view if exists matches_public;
create or replace view matches_public as
  select m.id, m.title, m.mode, m.map, m.starts_at, m.max_slots,
         m.prize_pool, m.per_kill, m.rules, m.status,
         (select count(*) from registrations r
           where r.match_id = m.id and r.status = 'confirmed')::int as filled
  from matches m;

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

-- Pending (unpaid) registrations no longer apply in the free-only version.
update registrations set status = 'rejected' where status = 'pending';

revoke execute on function register_team(bigint, text, text, jsonb) from public;
grant execute on function register_team(bigint, text, text, jsonb) to anon, authenticated;
grant select on matches_public to anon, authenticated;
