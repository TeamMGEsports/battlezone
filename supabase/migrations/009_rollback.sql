-- Undo 009_team_vs_team.sql: back to the 007 view. Run this in Supabase SQL
-- Editor ONLY together with reverting the website change on GitHub. The format
-- column is kept (unused), so re-running 009 brings it back.

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
         m.subscriber_only,
         m.notice, m.live_url,
         m.mvp_paid_at, m.mvp_paid_ref
  from matches m;

grant select on matches_public to anon, authenticated;
