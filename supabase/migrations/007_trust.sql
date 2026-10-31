-- 007: trust. Run once in Supabase SQL Editor after 006. Safe to re-run.
--
-- * Prize payments: organizers mark each prize as paid (with the last 4
--   digits of the UPI reference); players see "Paid" on the results page.
-- * Site stats for the home page: matches hosted, winners paid, amount paid.
-- * A short notice per match (e.g. "Delayed by 10 min") and an optional
--   YouTube live link per match.
-- No data is deleted; this only adds columns and replaces two views.

alter table results add column if not exists paid_at     timestamptz;
alter table results add column if not exists paid_ref    text check (paid_ref ~ '^[0-9A-Za-z]{0,4}$');
alter table results add column if not exists paid_amount int  check (paid_amount >= 0);

alter table matches add column if not exists notice   text check (length(notice) <= 120);
alter table matches add column if not exists live_url text check (live_url ~ '^https://');
alter table matches add column if not exists mvp_paid_at     timestamptz;
alter table matches add column if not exists mvp_paid_ref    text check (mvp_paid_ref ~ '^[0-9A-Za-z]{0,4}$');
alter table matches add column if not exists mvp_paid_amount int  check (mvp_paid_amount >= 0);

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

create or replace view results_public as
  select x.match_id, r.slot_no, r.team_name, x.placement, x.kills, x.points, x.prize,
         x.paid_at, x.paid_ref
  from results x join registrations r on r.id = x.registration_id;

create or replace function site_stats()
returns table (matches_hosted int, players int, winners_paid int, amount_paid int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from matches where status = 'completed')::int,
    (select count(distinct bgmi_id) from registration_players)::int,
    ((select count(*) from results where paid_at is not null)
      + (select count(*) from matches where mvp_paid_at is not null))::int,
    (coalesce((select sum(paid_amount) from results where paid_at is not null), 0)
      + coalesce((select sum(mvp_paid_amount) from matches where mvp_paid_at is not null), 0))::int
$$;

revoke execute on function site_stats() from public;
grant execute on function site_stats() to anon, authenticated;
grant select on matches_public, results_public to anon, authenticated;
