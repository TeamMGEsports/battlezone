// Data layer. Every page talks to the database only through this file.
// With Supabase configured it uses the real database; otherwise it runs
// against sample data kept in this browser (demo mode).
import { CONFIG } from './config.js';

export const isDemo = !(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

// Keep in sync with placement_points() in supabase/schema.sql
export function placementPoints(p) {
  return { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 }[p] || 0;
}

export const PLAYERS_PER_MODE = { solo: 1, duo: 2, squad: 4 };
const ACTIVE = ['open', 'closed', 'live'];
const RECENT_MS = 3 * 3600e3; // keep a started match on the home page for 3 hours

// A random id kept in this browser, used to allow one registration per device per match.
export function deviceId() {
  try {
    let id = localStorage.getItem('tmg-device');
    if (!id) localStorage.setItem('tmg-device', id = crypto.randomUUID());
    return id;
  } catch { return null; }
}

// Check-in window, keep in sync with checkin_opens/closes() in 004_match_night.sql
export const CHECKIN_OPENS_MIN = 60;
export const CHECKIN_CLOSES_MIN = 20;
export const WAITLIST_MAX = 10;

// Minutes before start that registration closes. With check-in it closes
// no later than check-in does (same rule as registration_open() in the database).
export function regCloseMinutes(m) {
  return Math.max(m.reg_close_minutes ?? 30, m.checkin_required ? CHECKIN_CLOSES_MIN : 0);
}

export function registrationOpen(m) {
  return m.status === 'open' && Date.now() < Date.parse(m.starts_at) - regCloseMinutes(m) * 60e3;
}

// ---------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------

// The pages load the single-file Supabase bundle with a deferred <script>
// tag (much faster than many small module requests). This is a fallback.
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
let sbPromise;
function sb() {
  sbPromise ||= (window.supabase ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SUPABASE_JS;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not connect. Check your internet and refresh the page.'));
    document.head.append(s);
  })).then(() => window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey));
  return sbPromise;
}

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

const remote = {
  async listMatches(kind) {
    let q = (await sb()).from('matches_public').select('*');
    if (kind === 'upcoming') {
      q = q.in('status', ACTIVE)
        .gte('starts_at', new Date(Date.now() - RECENT_MS).toISOString())
        .order('starts_at');
    } else if (kind === 'completed') {
      q = q.eq('status', 'completed').order('starts_at', { ascending: false }).limit(30);
    } else {
      q = q.order('starts_at', { ascending: false }).limit(60);
    }
    return unwrap(await q);
  },
  async getMatch(id) {
    const c = await sb();
    // Releases no-shows and fills slots from the waitlist. Not awaited: player
    // actions settle on the server anyway, this just keeps counts fresh.
    c.rpc('settle_match', { p_match_id: id }).then(() => {}, () => {});
    return unwrap(await c.from('matches_public').select('*').eq('id', id).maybeSingle());
  },
  async listRegistrations(matchId) {
    return unwrap(await (await sb()).from('registrations_public')
      .select('*').eq('match_id', matchId).order('slot_no'));
  },
  async register(matchId, { team_name, phone, players, yt_handle }) {
    const res = unwrap(await (await sb()).rpc('register_team', {
      p_match_id: matchId, p_team_name: team_name, p_phone: phone, p_players: players, p_device: deviceId(),
      ...(yt_handle ? { p_yt_handle: yt_handle } : {}),
    }));
    // Before migration 002 the database returns just the slot number.
    return typeof res === 'number' ? { slot: res, status: 'confirmed' } : res;
  },
  async submitUtr(token, utr) {
    unwrap(await (await sb()).rpc('submit_utr', { p_token: token, p_utr: utr }));
  },
  async registrationStatus(token) {
    const rows = unwrap(await (await sb()).rpc('registration_status', { p_token: token }));
    return rows[0] || null;
  },
  async getRoom(matchId, token) {
    const rows = unwrap(await (await sb()).rpc('get_room', { p_match_id: matchId, p_token: token || null }));
    return rows[0] || null;
  },
  async editRegistration(token, { team_name, players }) {
    unwrap(await (await sb()).rpc('edit_registration', { p_token: token, p_team_name: team_name, p_players: players }));
  },
  async cancelRegistration(token) {
    unwrap(await (await sb()).rpc('cancel_registration', { p_token: token }));
  },
  async checkIn(token) {
    unwrap(await (await sb()).rpc('check_in', { p_token: token }));
  },
  async findRegistration(matchId, phone, bgmiId) {
    return unwrap(await (await sb()).rpc('find_registration', { p_match_id: matchId, p_phone: phone, p_bgmi_id: bgmiId }));
  },
  async getResults(matchId) {
    return unwrap(await (await sb()).from('results_public')
      .select('*').eq('match_id', matchId).order('placement'));
  },
  async leaderboard(since, mode) {
    return unwrap(await (await sb()).rpc('leaderboard', { p_since: since, p_mode: mode || null }));
  },

  // --- admin ---
  async signIn(email, password) {
    unwrap(await (await sb()).auth.signInWithPassword({ email, password }));
  },
  async signOut() {
    await (await sb()).auth.signOut();
  },
  async isAdmin() {
    const c = await sb();
    const { data } = await c.auth.getSession();
    if (!data.session) return false;
    return unwrap(await c.rpc('is_admin'));
  },
  async getRoomAdmin(matchId) {
    return unwrap(await (await sb()).from('match_rooms').select('*').eq('match_id', matchId).maybeSingle());
  },
  async saveMatch(match, room) {
    const c = await sb();
    const { id, ...fields } = match;
    const saved = id
      ? unwrap(await c.from('matches').update(fields).eq('id', id).select().single())
      : unwrap(await c.from('matches').insert(fields).select().single());
    unwrap(await c.from('match_rooms').upsert({ match_id: saved.id, ...room }));
    return saved.id;
  },
  async deleteMatch(id) {
    unwrap(await (await sb()).from('matches').delete().eq('id', id));
  },
  async adminRegistrations(matchId) {
    await (await sb()).rpc('settle_match', { p_match_id: matchId });
    return unwrap(await (await sb()).from('registrations')
      .select('*, players:registration_players(ign, bgmi_id), result:results(placement, kills, points, prize)')
      .eq('match_id', matchId).order('slot_no'));
  },
  async setRegistrationStatus(id, status) {
    unwrap(await (await sb()).from('registrations').update({ status }).eq('id', id));
  },
  async listBans() {
    return unwrap(await (await sb()).from('bans').select('*').order('created_at', { ascending: false }));
  },
  // Every table, in pages of 1000 rows (the API's maximum per request).
  async backup() {
    const c = await sb();
    const all = async (table, order) => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = unwrap(await c.from(table).select('*').order(order).range(from, from + 999));
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    };
    return {
      Matches: await all('matches', 'id'),
      Rooms: await all('match_rooms', 'match_id'),
      Registrations: await all('registrations', 'id'),
      Players: await all('registration_players', 'id'),
      Results: await all('results', 'registration_id'),
      Bans: await all('bans', 'id'),
    };
  },
  async addBans(entries) {
    unwrap(await (await sb()).from('bans').upsert(entries, { onConflict: 'kind,value', ignoreDuplicates: true }));
  },
  async removeBan(id) {
    unwrap(await (await sb()).from('bans').delete().eq('id', id));
  },
  async saveResults(matchId, rows, mvp) {
    const c = await sb();
    unwrap(await c.from('results').delete().eq('match_id', matchId));
    if (rows.length) {
      unwrap(await c.from('results').insert(rows.map(r => ({ ...r, match_id: matchId }))));
    }
    unwrap(await c.from('matches').update({
      status: 'completed',
      mvp_registration_id: mvp?.registration_id ?? null, mvp_ign: mvp?.ign ?? null, mvp_kills: mvp?.kills ?? null,
    }).eq('id', matchId));
  },
};

// ---------------------------------------------------------------
// Demo mode: same behaviour as the database, stored in localStorage
// ---------------------------------------------------------------

const DEMO_KEY = 'tmg-demo-v5';
const HOLD_MS = 15 * 60e3; // keep in sync with register_team() in 002_paid_entry.sql

function istAt(dayOffset, time) {
  const day = new Date(Date.now() + dayOffset * 864e5)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return new Date(`${day}T${time}:00+05:30`).toISOString();
}

function seed() {
  const rules = 'No emulators.\nNo teaming with other squads.\nJoin the room 5 minutes before start.\nCaptain posts the result screenshot in the WhatsApp group.';
  const db = {
    seq: 100,
    matches: [
      { id: 1, title: 'Night Squad #1', mode: 'squad', map: 'Erangel', starts_at: istAt(0, '21:00'), max_slots: 25, prize_pool: '₹500', per_kill: '₹10', rules, status: 'open' },
      { id: 2, title: 'Night Solo #1', mode: 'solo', map: 'Livik', starts_at: istAt(0, '22:30'), max_slots: 100, prize_pool: '₹300', per_kill: '₹5', rules, status: 'open' },
      { id: 3, title: 'Night Squad #1', mode: 'squad', map: 'Miramar', starts_at: istAt(1, '21:00'), max_slots: 25, prize_pool: '₹500', per_kill: '₹10', rules, status: 'open' },
      { id: 4, title: 'Night Squad #1', mode: 'squad', map: 'Sanhok', starts_at: istAt(-1, '21:00'), max_slots: 25, prize_pool: '₹500', per_kill: '₹10', rules, status: 'completed' },
    ],
    rooms: { 1: { room_id: '4821937', room_pass: 'mg21', reveal_minutes: 15 } },
    registrations: [],
    results: [],
    bans: [],
  };
  db.matches.forEach(m => Object.assign(m, {
    entry_fee: 0, reg_close_minutes: 30, checkin_required: false,
    prize_1: 250, prize_2: 150, prize_3: 75, prize_mvp: 50, prize_pool: null, per_kill: null,
  }));
  Object.assign(db.matches[0], { checkin_required: true });
  db.matches.push({ id: 6, title: 'Subscriber Squad Cup', mode: 'squad', map: 'Erangel', starts_at: istAt(1, '20:00'), max_slots: 20, prize_pool: null, per_kill: null, rules, status: 'open', entry_fee: 0, reg_close_minutes: 30, checkin_required: false, prize_1: 500, prize_2: 300, prize_3: 150, prize_mvp: 100, subscriber_only: true });
  db.matches.push({ id: 5, title: 'Paid Solo Cup', mode: 'solo', map: 'Erangel', starts_at: istAt(1, '22:30'), max_slots: 50, prize_pool: null, per_kill: null, rules, status: 'open', entry_fee: 20, reg_close_minutes: 30, checkin_required: false, prize_1: 400, prize_2: 200, prize_3: 100, prize_mvp: 100 });
  const teams = ['Clutch Gods', 'Rush Mode', 'Silent Snipers', 'Zone Kings', 'Last Circle', 'Hot Drop', 'Pan Masters', 'Red Zone'];
  let bgmi = 5100000000;
  for (const matchId of [1, 4]) {
    teams.forEach((name, i) => {
      const id = ++db.seq;
      db.registrations.push({
        id, match_id: matchId, slot_no: i + 1, team_name: name, phone: `98765${String(43210 + i)}`,
        status: 'confirmed', created_at: new Date().toISOString(), pay_token: crypto.randomUUID(), utr: null, hold_until: null,
        players: [1, 2, 3, 4].map(n => ({ ign: `${name.split(' ')[0]}${n}`, bgmi_id: String(bgmi++) })),
      });
      if (matchId === 4) {
        const placement = i + 1;
        const kills = [14, 9, 11, 6, 4, 7, 2, 3][i];
        db.results.push({ registration_id: id, match_id: 4, placement, kills, prize: ['₹250', '₹150', '₹100'][i] || null });
      }
    });
  }
  const mvp = db.registrations.find(r => r.match_id === 4 && r.slot_no === 1);
  Object.assign(db.matches[3], { mvp_registration_id: mvp.id, mvp_ign: mvp.players[0].ign, mvp_kills: 8 });
  return db;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY));
    if (saved) return saved;
  } catch { /* fall through to fresh sample data */ }
  return seed();
}
let db = load();
function persist() {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch { /* demo only */ }
}

const confirmed = matchId => db.registrations.filter(r => r.match_id === matchId && r.status === 'confirmed');
// Pending with no deadline = waiting for YouTube verification, keeps its slot.
const holdsSlot = r => r.status === 'confirmed'
  || (r.status === 'pending' && (r.utr || !r.hold_until || Date.parse(r.hold_until) > Date.now()));
const active = matchId => db.registrations.filter(r => r.match_id === matchId && holdsSlot(r));
const withFilled = m => {
  const r = db.registrations.find(x => x.id === m.mvp_registration_id);
  return {
    ...m, filled: active(m.id).length, mvp_team: r?.team_name ?? null,
    waitlist: db.registrations.filter(x => x.match_id === m.id && x.status === 'waitlist').length,
  };
};
const withPoints = x => ({ ...x, points: placementPoints(x.placement) + x.kills });
const clone = v => JSON.parse(JSON.stringify(v));

// Same checks as check_team() and the unique rules in the database.
function checkTeam(m, team_name, players) {
  const needed = PLAYERS_PER_MODE[m.mode];
  if (players.length !== needed) throw new Error(`This match needs ${needed} player(s)`);
  team_name = team_name.trim();
  if (team_name.length < 2 || team_name.length > 30) throw new Error('Team name must be 2–30 characters');
  for (const p of players) {
    if (!p.ign.trim() || !/^[0-9]{6,12}$/.test(p.bgmi_id)) throw new Error('Each player needs an in-game name and a valid BGMI ID');
    if (db.bans.some(b => b.kind === 'bgmi_id' && b.value === p.bgmi_id)) throw new Error(`BGMI ID ${p.bgmi_id} is not allowed to register. Contact the organizers.`);
  }
  return team_name;
}
function checkDuplicates(others, team_name, players) {
  if (others.some(r => r.team_name.toLowerCase() === team_name.toLowerCase())) throw new Error('This team name is already taken for this match');
  const ids = new Set(others.flatMap(r => r.players.map(p => p.bgmi_id)));
  if (new Set(players.map(p => p.bgmi_id)).size !== players.length || players.some(p => ids.has(p.bgmi_id))) {
    throw new Error('One of these BGMI IDs is already registered for this match');
  }
}
function ownRegistration(token) {
  const r = db.registrations.find(x => x.pay_token === token);
  if (!r || !['pending', 'confirmed', 'waitlist'].includes(r.status)) throw new Error('Registration not found');
  return r;
}
// Same as the assign_slot() trigger: lowest free number when a team gets a place.
function setStatus(r, status) {
  const m = db.matches.find(x => x.id === r.match_id);
  // Confirmed by an organizer after check-in closed: counts as checked in.
  if (status === 'confirmed' && r.status === 'pending' && m.checkin_required && Date.now() >= checkinCloses(m)) {
    r.checked_in_at ||= new Date().toISOString();
  }
  if (['pending', 'confirmed'].includes(status)) {
    if (r.slot_no == null) {
      const taken = new Set(db.registrations.filter(x => x.match_id === r.match_id && x !== r).map(x => x.slot_no));
      const free = Array.from({ length: m.max_slots }, (_, i) => i + 1).find(n => !taken.has(n));
      if (!free) throw new Error('All slots are full');
      r.slot_no = free;
    }
  } else {
    r.slot_no = null;
  }
  r.status = status;
}
const checkinCloses = m => Date.parse(m.starts_at) - CHECKIN_CLOSES_MIN * 60e3;
// Same as settle_match(): expired holds, no-shows, waitlist promotion.
function settle(matchId) {
  const m = db.matches.find(x => x.id === matchId);
  if (!m || !ACTIVE.includes(m.status)) return;
  const closed = m.checkin_required && Date.now() >= checkinCloses(m);
  db.registrations = db.registrations.filter(r =>
    !(r.match_id === matchId && r.status === 'pending' && !r.utr && Date.parse(r.hold_until) <= Date.now()));
  if (closed) {
    db.registrations.filter(r => r.match_id === matchId && r.status === 'confirmed' && !r.checked_in_at)
      .forEach(r => setStatus(r, 'released'));
  }
  if (!(m.entry_fee > 0) && Date.now() < Date.parse(m.starts_at)) {
    for (const w of db.registrations.filter(r => r.match_id === matchId && r.status === 'waitlist')) {
      if (active(matchId).length >= m.max_slots) break;
      setStatus(w, m.subscriber_only ? 'pending' : 'confirmed');
      w.checked_in_at = closed ? new Date().toISOString() : null;
    }
  }
  persist();
}
let demoAdmin = false;

const demo = {
  async listMatches(kind) {
    const now = Date.now();
    let list = db.matches.map(withFilled);
    if (kind === 'upcoming') {
      list = list.filter(m => ACTIVE.includes(m.status) && Date.parse(m.starts_at) >= now - RECENT_MS)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    } else if (kind === 'completed') {
      list = list.filter(m => m.status === 'completed').sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    } else {
      list.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    }
    return clone(list);
  },
  async getMatch(id) {
    settle(id);
    const m = db.matches.find(x => x.id === id);
    return m ? clone(withFilled(m)) : null;
  },
  async listRegistrations(matchId) {
    return clone(confirmed(matchId).sort((a, b) => a.slot_no - b.slot_no).map(r => ({
      id: r.id, match_id: r.match_id, slot_no: r.slot_no, team_name: r.team_name, igns: [], checked_in: !!r.checked_in_at,
    })));
  },
  async register(matchId, { team_name, phone, players, yt_handle }) {
    settle(matchId);
    const m = db.matches.find(x => x.id === matchId);
    if (!m) throw new Error('Match not found');
    if (!registrationOpen(m)) throw new Error('Registration is closed for this match');
    team_name = checkTeam(m, team_name, players);
    if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter a valid 10-digit WhatsApp number');
    if (db.bans.some(b => b.kind === 'phone' && b.value === phone)) throw new Error('This number is not allowed to register. Contact the organizers.');
    if (m.subscriber_only) {
      yt_handle = (yt_handle || '').trim();
      if (!/^@[A-Za-z0-9._-]{3,30}$/.test(yt_handle)) throw new Error('Enter the captain\'s YouTube handle, like @yourname');
    } else {
      yt_handle = null;
    }
    const paid = m.entry_fee > 0;
    let status = paid || m.subscriber_only ? 'pending' : 'confirmed';
    if (active(matchId).length >= m.max_slots) {
      if (paid) throw new Error('All slots are full');
      if (db.registrations.filter(r => r.match_id === matchId && r.status === 'waitlist').length >= WAITLIST_MAX) {
        throw new Error('All slots and the waitlist are full');
      }
      status = 'waitlist';
    }
    const device = deviceId();
    const all = db.registrations.filter(r => r.match_id === matchId);
    if (device && all.some(r => r.device_id === device)) throw new Error('This phone has already registered a team for this match');
    if (all.some(r => r.phone === phone)) throw new Error('This WhatsApp number is already registered for this match');
    checkDuplicates(all, team_name, players);
    if (yt_handle && all.some(r => r.yt_handle?.toLowerCase() === yt_handle.toLowerCase())) {
      throw new Error('This YouTube handle is already registered for this match');
    }
    const reg = {
      id: ++db.seq, match_id: matchId, slot_no: null, team_name, phone, status: null,
      created_at: new Date().toISOString(), pay_token: crypto.randomUUID(), utr: null, device_id: device,
      hold_until: status === 'pending' && paid ? new Date(Date.now() + HOLD_MS).toISOString() : null, checked_in_at: null, yt_handle,
      players: players.map(p => ({ ign: p.ign.trim(), bgmi_id: p.bgmi_id })),
    };
    setStatus(reg, status);
    db.registrations.push(reg);
    persist();
    return { slot: reg.slot_no, token: reg.pay_token, fee: m.entry_fee, status };
  },
  async editRegistration(token, { team_name, players }) {
    const r = ownRegistration(token);
    const m = db.matches.find(x => x.id === r.match_id);
    if (!registrationOpen(m)) throw new Error('Registration has closed, so changes are locked. Contact the organizers.');
    team_name = checkTeam(m, team_name, players);
    checkDuplicates(db.registrations.filter(x => x.match_id === r.match_id && x !== r), team_name, players);
    r.team_name = team_name;
    r.players = players.map(p => ({ ign: p.ign.trim(), bgmi_id: p.bgmi_id }));
    persist();
  },
  async cancelRegistration(token) {
    const r = ownRegistration(token);
    const m = db.matches.find(x => x.id === r.match_id);
    if (Date.now() >= Date.parse(m.starts_at)) throw new Error('The match has already started');
    if (r.status === 'confirmed' && m.entry_fee > 0) throw new Error('Paid registrations can only be cancelled by the organizers');
    db.registrations = db.registrations.filter(x => x !== r);
    settle(m.id);
  },
  async checkIn(token) {
    const found = db.registrations.find(x => x.pay_token === token);
    if (!found) throw new Error('Registration not found');
    settle(found.match_id);
    const r = db.registrations.find(x => x.pay_token === token);
    const m = db.matches.find(x => x.id === r.match_id);
    if (!m.checkin_required) throw new Error('This match does not need check-in');
    if (r.status !== 'confirmed') throw new Error('Only confirmed teams can check in');
    if (Date.now() < Date.parse(m.starts_at) - CHECKIN_OPENS_MIN * 60e3) throw new Error('Check-in opens 60 minutes before the match');
    if (Date.now() >= checkinCloses(m)) throw new Error('Check-in has closed');
    r.checked_in_at ||= new Date().toISOString();
    persist();
  },
  async findRegistration(matchId, phone, bgmiId) {
    const r = db.registrations.find(x => x.match_id === matchId && x.phone === phone.trim()
      && ['pending', 'confirmed', 'waitlist', 'released'].includes(x.status) && x.players.some(p => p.bgmi_id === bgmiId.trim()));
    if (!r) throw new Error('No registration found with that WhatsApp number and BGMI ID');
    return r.pay_token;
  },
  async submitUtr(token, utr) {
    const r = db.registrations.find(x => x.pay_token === token);
    if (!r) throw new Error('Registration not found. Please register again.');
    if (r.status !== 'pending') throw new Error(`This registration is already ${r.status}`);
    if (!r.utr && Date.parse(r.hold_until) <= Date.now()) throw new Error('Your 15-minute payment window has ended. Please register again.');
    utr = utr.trim();
    if (!/^[0-9]{12}$/.test(utr)) throw new Error('UTR / transaction ID must be 12 digits');
    if (db.registrations.some(x => x.utr === utr && x !== r)) throw new Error('This UTR has already been used');
    r.utr = utr;
    persist();
  },
  async registrationStatus(token) {
    const found = db.registrations.find(x => x.pay_token === token);
    if (!found) return null;
    settle(found.match_id);
    const r = db.registrations.find(x => x.pay_token === token);
    if (!r) return null;
    const queue = db.registrations.filter(x => x.match_id === r.match_id && x.status === 'waitlist');
    return clone({
      match_id: r.match_id, slot_no: r.slot_no, status: r.status, utr: r.utr, hold_until: r.hold_until,
      team_name: r.team_name, players: r.players, checked_in_at: r.checked_in_at ?? null,
      waitlist_position: r.status === 'waitlist' ? queue.indexOf(r) + 1 : null, yt_handle: r.yt_handle ?? null,
    });
  },
  async getRoom(matchId, token) {
    settle(matchId);
    const m = db.matches.find(x => x.id === matchId);
    const r = db.rooms[matchId];
    if (!m || !r || !ACTIVE.includes(m.status)) return null;
    const revealAt = Date.parse(m.starts_at) - r.reveal_minutes * 60e3;
    const ok = Date.now() >= revealAt
      && db.registrations.some(x => x.match_id === matchId && x.pay_token === token && x.status === 'confirmed'
        && (!m.checkin_required || x.checked_in_at));
    return { room_id: ok ? r.room_id : null, room_pass: ok ? r.room_pass : null, reveal_at: new Date(revealAt).toISOString() };
  },
  async getResults(matchId) {
    return clone(db.results.filter(x => x.match_id === matchId).map(x => {
      const r = db.registrations.find(y => y.id === x.registration_id);
      return { ...withPoints(x), slot_no: r.slot_no, team_name: r.team_name };
    }).sort((a, b) => a.placement - b.placement));
  },
  async leaderboard(since, mode) {
    const rows = new Map();
    for (const x of db.results) {
      const m = db.matches.find(y => y.id === x.match_id);
      if (m.starts_at < since || (mode && m.mode !== mode)) continue;
      const r = db.registrations.find(y => y.id === x.registration_id);
      const key = r.team_name.toLowerCase();
      const row = rows.get(key) || { team_name: r.team_name, matches: 0, wins: 0, seconds: 0, thirds: 0, kills: 0, points: 0, mvps: 0 };
      row.matches++;
      row.wins += x.placement === 1 ? 1 : 0;
      row.seconds += x.placement === 2 ? 1 : 0;
      row.thirds += x.placement === 3 ? 1 : 0;
      row.kills += x.kills;
      row.points += withPoints(x).points;
      rows.set(key, row);
    }
    // Same as leaderboard() in 006: MVPs count even outside the top 3.
    for (const m of db.matches) {
      const r = db.registrations.find(y => y.id === m.mvp_registration_id);
      if (!r || m.starts_at < since || (mode && m.mode !== mode)) continue;
      const key = r.team_name.toLowerCase();
      const row = rows.get(key) || { team_name: r.team_name, matches: 0, wins: 0, seconds: 0, thirds: 0, kills: 0, points: 0, mvps: 0 };
      row.mvps++;
      rows.set(key, row);
    }
    return [...rows.values()]
      .sort((a, b) => b.wins - a.wins || b.seconds - a.seconds || b.thirds - a.thirds || b.mvps - a.mvps || b.kills - a.kills)
      .slice(0, 50);
  },

  async signIn() { demoAdmin = true; },
  async signOut() { demoAdmin = false; },
  async isAdmin() { return demoAdmin; },
  async getRoomAdmin(matchId) { return clone(db.rooms[matchId] || null); },
  async saveMatch(match, room) {
    let id = match.id;
    if (id) Object.assign(db.matches.find(m => m.id === id), match);
    else db.matches.push({ ...match, id: id = ++db.seq });
    db.rooms[id] = room;
    persist();
    return id;
  },
  async deleteMatch(id) {
    db.matches = db.matches.filter(m => m.id !== id);
    db.registrations = db.registrations.filter(r => r.match_id !== id);
    db.results = db.results.filter(x => x.match_id !== id);
    delete db.rooms[id];
    persist();
  },
  async adminRegistrations(matchId) {
    settle(matchId);
    return clone(db.registrations.filter(r => r.match_id === matchId)
      .sort((a, b) => (a.slot_no ?? 999) - (b.slot_no ?? 999) || a.id - b.id)
      .map(r => {
        const x = db.results.find(y => y.registration_id === r.id);
        return { ...r, result: x ? withPoints(x) : null };
      }));
  },
  async setRegistrationStatus(id, status) {
    setStatus(db.registrations.find(r => r.id === id), status);
    persist();
  },
  async listBans() { return clone(db.bans); },
  async backup() {
    return clone({
      Matches: db.matches,
      Rooms: Object.entries(db.rooms).map(([match_id, r]) => ({ match_id: Number(match_id), ...r })),
      Registrations: db.registrations.map(({ players, ...r }) => r),
      Players: db.registrations.flatMap(r => r.players.map(p => ({ registration_id: r.id, match_id: r.match_id, ...p }))),
      Results: db.results.map(withPoints),
      Bans: db.bans,
    });
  },
  async addBans(entries) {
    for (const e of entries) {
      if (!db.bans.some(b => b.kind === e.kind && b.value === e.value)) {
        db.bans.unshift({ id: ++db.seq, created_at: new Date().toISOString(), reason: null, ...e });
      }
    }
    persist();
  },
  async removeBan(id) {
    db.bans = db.bans.filter(b => b.id !== id);
    persist();
  },
  async saveResults(matchId, rows, mvp) {
    db.results = db.results.filter(x => x.match_id !== matchId)
      .concat(rows.map(r => ({ ...r, match_id: matchId })));
    Object.assign(db.matches.find(m => m.id === matchId), {
      status: 'completed',
      mvp_registration_id: mvp?.registration_id ?? null, mvp_ign: mvp?.ign ?? null, mvp_kills: mvp?.kills ?? null,
    });
    persist();
  },
};

export const api = isDemo ? demo : remote;

export function resetDemo() {
  db = seed();
  persist();
}
