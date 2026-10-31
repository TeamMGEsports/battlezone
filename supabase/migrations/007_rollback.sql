-- Undo 007_trust.sql: back to the 006 views. Run this in Supabase SQL Editor
-- ONLY together with reverting the website change on GitHub. The new columns
-- (payment status, notices, live links) are kept, so re-running 007 brings them back.

drop function if exists site_stats();

drop view if exists matches_public;
create or replace view matches_public as
  select m.id, m.title, m.mode, m.map, m.starts_at, m.max_slots,
         m.prize_pool, m.per_kill, m.rules, m.status,
         (select count(*) from registrations r
           where r.match_id = m.id
             and (r.status = 'confirmed'
                  or (r.status = 'pending' and (r.utr is not null or r.hold_until is null or r.hold_until > now()))))::int as filled,
         m.entry_fee,
         m.reg_close_minutes,
         (select count(*) from registrations r where r.match_id = m.id and r.status = 'waitlist')::int as waitlist,
         m.checkin_required,
         m.prize_1, m.prize_2, m.prize_3, m.prize_mvp,
         m.mvp_ign, m.mvp_kills,
         (select r.team_name from registrations r where r.id = m.mvp_registration_id) as mvp_team,
         m.subscriber_only
  from matches m;

drop view if exists results_public;
create or replace view results_public as
  select x.match_id, r.slot_no, r.team_name, x.placement, x.kills, x.points, x.prize
  from results x join registrations r on r.id = x.registration_id;

grant select on matches_public, results_public to anon, authenticated;
