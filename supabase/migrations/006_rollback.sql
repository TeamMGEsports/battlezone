-- Undo 006_quick_results.sql: back to the 004 leaderboard (ranked by points).
-- Run this in Supabase SQL Editor ONLY together with reverting the website change on GitHub.

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

revoke execute on function leaderboard(timestamptz, text) from public;
grant execute on function leaderboard(timestamptz, text) to anon, authenticated;
