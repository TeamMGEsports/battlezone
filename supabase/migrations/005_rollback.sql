-- Undo 005_subscriber_matches.sql: back to the 004 behaviour. Run this in
-- Supabase SQL Editor ONLY together with reverting the website change on GitHub.
-- The new columns are kept (unused), so re-running 005 later brings everything back.

-- Teams waiting for YouTube verification have no place in the 004 version.
update registrations set status = 'rejected'
 where status = 'pending' and utr is null and hold_until is null;

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

create or replace function duplicate_message(p_constraint text) returns text
language sql immutable as $$
  select case p_constraint
    when 'registrations_device_uq' then 'This phone has already registered a team for this match'
    when 'registrations_match_id_phone_key' then 'This WhatsApp number is already registered for this match'
    when 'registrations_team_name_uq' then 'This team name is already taken for this match'
    when 'registration_players_match_id_bgmi_id_key' then 'One of these BGMI IDs is already registered for this match'
    else 'This team is already registered for this match' end
$$;

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

drop function if exists register_team(bigint, text, text, jsonb, uuid, text);
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

drop view if exists matches_public;
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

revoke execute on function register_team(bigint, text, text, jsonb, uuid) from public;
revoke execute on function registration_status(uuid) from public;
grant execute on function register_team(bigint, text, text, jsonb, uuid) to anon, authenticated;
grant execute on function registration_status(uuid) to anon, authenticated;
grant select on matches_public to anon, authenticated;
