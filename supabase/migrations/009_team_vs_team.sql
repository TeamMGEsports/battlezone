-- 009: Team vs Team format (e.g. BGMI WOW modes). Run once in Supabase SQL
-- Editor after 008. Safe to re-run.
--
-- A match's format is 'br' (normal battle royale lobby) or 'tvt' (two teams
-- face each other; the winner takes the prize). Team size still comes from the
-- mode: solo = 1v1, duo = 2v2, squad = 4v4. Registration, payments, rooms and
-- results work as for any other match. No data is deleted.

alter table matches add column if not exists format text not null default 'br'
  check (format in ('br', 'tvt'));

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
         m.mvp_paid_at, m.mvp_paid_ref,
         m.format
  from matches m;

grant select on matches_public to anon, authenticated;
