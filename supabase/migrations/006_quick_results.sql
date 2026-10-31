-- 006: quick results. Run once in Supabase SQL Editor after 005. Safe to re-run.
--
-- Prizes go to 1st, 2nd, 3rd and the MVP, and kills don't earn points, so
-- the leaderboard ranks by wins, then 2nd places, then 3rd places, then MVPs.
-- An MVP counts even when their team finished outside the top 3.

drop function if exists leaderboard(timestamptz, text);
create function leaderboard(p_since timestamptz, p_mode text default null)
returns table (team_name text, matches int, wins int, seconds int, thirds int, mvps int, kills int, points int)
language sql stable security definer set search_path = public as $$
  with picked as (
    select m.id from matches m
    where m.starts_at >= p_since and (p_mode is null or m.mode = p_mode)
  ),
  rows as (
    select lower(r.team_name) as k, r.team_name as n, x.placement, x.kills, x.points, 0 as mvp
    from results x
    join registrations r on r.id = x.registration_id
    where x.match_id in (select id from picked)
    union all
    select lower(r.team_name), r.team_name, null, 0, 0, 1
    from matches m
    join registrations r on r.id = m.mvp_registration_id
    where m.id in (select id from picked)
  )
  select min(n), count(placement)::int,
         count(*) filter (where placement = 1)::int,
         count(*) filter (where placement = 2)::int,
         count(*) filter (where placement = 3)::int,
         sum(mvp)::int, sum(kills)::int, sum(points)::int
  from rows
  group by k
  order by 3 desc, 4 desc, 5 desc, 6 desc, 7 desc
  limit 50
$$;

revoke execute on function leaderboard(timestamptz, text) from public;
grant execute on function leaderboard(timestamptz, text) to anon, authenticated;
