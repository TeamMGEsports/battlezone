# TeamMG Esports — BGMI matches

A minimal site for free nightly BGMI matches: schedule, online registration, room details at match time, results and a leaderboard. Hosted free on GitHub Pages, data stored free on Supabase.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Upcoming matches with slots filled |
| `match.html?id=…` | Match details, registration form, registered teams, room ID/password (shown only near start time), results |
| `results.html` | Weekly / 30-day / all-time leaderboard and past match results |
| `rules.html` | General rules and points table |
| `admin.html` | Organizer sign-in: create matches, manage teams, enter results |

No build step. Plain HTML, CSS and JavaScript modules.

## Demo mode

Until Supabase is connected, the site runs on sample data stored in your own browser. Any email and password works on the admin page. Nothing is shared between visitors in demo mode.

## Going live with Supabase (one-time, about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com). Choose the Mumbai region.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql` and click **Run**. Then do the same with each file in `supabase/migrations/`, in order.
3. Turn off public sign-ups: **Authentication → Sign In / Providers → Allow new users to sign up: off**.
4. Add each organizer: **Authentication → Users → Add user** (email and password). Copy the user's UID and run in the SQL Editor:
   ```sql
   insert into admins (user_id) values ('paste-the-uid-here');
   ```
5. Copy **Project URL** and the **anon public** key from **Project Settings → API** into `js/config.js`. Both are safe to publish. The database rules decide who can see what.
6. Commit and push. GitHub Pages updates in a minute or two.

## Running the nightly matches

1. **Admin → New match** (or **Copy +1 day** on yesterday's match). Add the room ID and password whenever you have them; players only see them 15 minutes before start.
2. Share the match link in the WhatsApp group (there is a share button on every match page).
3. **Teams** shows phone numbers and BGMI IDs, lets you remove fake entries, and copies the slot list for WhatsApp.
4. After the match, **Results**: enter placement and kills from the end screen. Points are calculated automatically, and the match is marked completed.

## Paid matches (optional, UPI)

Every match has an **Entry fee** field. Leave it at 0 for free matches (they work exactly as before). Set an amount to turn on UPI payment for that match:

1. The player registers, and their slot is held for 15 minutes.
2. They pay with the "Pay with UPI app" button, by scanning the QR code, or by paying your UPI ID manually. The payment note is `MG<match>-S<slot>`.
3. They enter the 12-digit UTR (UPI reference number) from their payment app.
4. In **Admin → Teams**, check each UTR against your UPI app and tap **Confirm** or **Reject**.

Unpaid holds expire after 15 minutes and free up the slot. Each UTR can only be used once.

**One-time setup:**
1. Run `supabase/migrations/002_paid_entry.sql` in the Supabase SQL Editor.
2. Put your UPI ID in `upiId` in `js/config.js`. A free UPI business ID (PhonePe Business, Paytm for Business, Google Pay for Business) works best, because some apps limit pay links to personal UPI IDs.

Check the legal position for paid entry and cash prizes in India before using this.

## Fair play

- **Room details** go only to confirmed teams, on the phone they registered with. Teammates can see them on their own phone with **Find my registration** (captain's WhatsApp number + their own BGMI ID). Post "room is open" in WhatsApp, not the ID and password.
- **Admin → Room check** lists slot → team → players and BGMI IDs. Before starting, compare the room lobby with it and remove anyone who isn't listed or is in the wrong slot.
- **Registration closes** 30 minutes before start by default (changeable per match). Until then captains can edit or cancel their team. Paid, confirmed teams can only be cancelled by organizers.
- **One registration per phone per match**, plus unique WhatsApp number, team name and BGMI IDs.
- **Bans:** Admin → Teams → **Ban** blocks a team's WhatsApp number and BGMI IDs from all matches. Manage them in Admin → **Bans**.
- The public team list shows only slot number and team name.

## Match night

- **Prizes:** set 1st, 2nd, 3rd and MVP amounts per match. The total shows on the home page, and each place's prize fills in automatically when you enter results.
- **MVP:** in Results, pick the player with the most kills (solo matches pick it automatically). It shows on the match page, the results page and as a leaderboard column.
- **Check-in (optional per match):** opens 60 minutes before start and closes 20 minutes before. Teams that don't check in lose their slot, and the room is only shown to checked-in teams. With check-in on, registration closes no later than check-in does.
- **Waitlist (free matches):** when slots are full, up to 10 teams can join the waitlist. A cancelled, removed or no-show slot goes to the next team automatically, keeping the same slot number. Admins can also tap **Give slot**.
- **WhatsApp posts:** Admin → **WhatsApp** on a match gives ready messages for registration open, check-in open, room open and results. **Post: tonight** and **Post: weekly top 10** are at the top of the matches list.

## Subscriber-only matches (YouTube)

Tick **Subscribers only** when creating a match. It's pinned to the top of the home page with a red glow and a "Subscribers only" badge.

1. The captain registers with their YouTube handle (they can paste their channel link; it becomes `@handle`). The slot is held as "waiting for verification".
2. In **Admin → Teams**, open each handle's channel → **Subscriptions**, or check **YouTube Studio → Subscribers**. Tap **Verify ✓** or **Reject**.
3. Players must keep their subscriptions public until verified (YouTube → Settings → Privacy).

A YouTube handle can only be used once per match. Waitlisted teams that get a slot also wait for verification. Teams verified after check-in closes count as checked in.

**One-time setup:** run `supabase/migrations/005_subscriber_matches.sql`, and put your channel link in `youtubeChannel` in `js/config.js` so players get a **Subscribe on YouTube** button.

## Undoing an update

Each database update in `supabase/migrations/` has a matching `_rollback.sql`. To undo one: click **Revert** on the merged pull request on GitHub, merge the revert, then run the rollback file in the Supabase SQL Editor. No match, team or result data is lost.

## Results and leaderboard

- **Admin → Results:** pick the 🥇 1st, 🥈 2nd and 🥉 3rd teams and the ⭐ MVP with their kills. Prizes fill in from the match's prize amounts. **Full standings** (other places, team kills, custom prizes) is optional.
- Kills don't earn points. The leaderboard ranks teams by **wins, then 2nd places, then 3rd places, then MVPs**. An MVP counts even when their team finished outside the top 3.
- Database update: `supabase/migrations/006_quick_results.sql`.

## Registering faster

After a captain registers, their phone remembers the team (per mode: solo, duo, squad). Next time a **Use my last team** button fills in everything. It is stored only in that phone's browser, not in the database.

## Backups

**Admin → Download backup** saves everything (matches, rooms, teams, players, results, bans) as one Excel file. The free Supabase plan has no backups you can restore yourself, so download one every week. The file contains phone numbers: keep it private.

## Releasing an update

Browsers keep copies of the site's files. Each page loads its files with a version number (`?v=...`), so after changing any CSS or JavaScript run:

```
python3 scripts/release.py
```

and commit. Every phone then loads the new files straight away.

## Privacy & safety

- Phone numbers and BGMI IDs are only readable by organizers.
- Room details are only returned by the database once the reveal time has passed, so they are never in the page source early.
- Registration checks run in the database: slot limit, one entry per phone, team name and BGMI ID per match.

## Files

```
index.html  match.html  results.html  rules.html  admin.html
css/style.css
js/config.js        site name, WhatsApp link, Supabase keys
js/api.js           all data access (Supabase or demo)
js/ui.js            shared formatting helpers
js/pages/*.js       one script per page
supabase/schema.sql database tables, security rules and functions
```
