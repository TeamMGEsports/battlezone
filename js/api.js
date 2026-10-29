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

export function registrationOpen(m) {
  return m.status === 'open' && Date.now() < Date.parse(m.starts_at) - (m.reg_close_minutes ?? 30) * 60e3;
}

// ---------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------

let sbPromise;
function sb() {
  sbPromise ||= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')
    .then(({ createClient }) => createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey));
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
    return unwrap(await (await sb()).from('matches_public').select('*').eq('id', id).maybeSingle());
  },
  async listRegistrations(matchId) {
    return unwrap(await (await sb()).from('registrations_public')
      .select('*').eq('match_id', matchId).order('slot_no'));
  },
  async register(matchId, { team_name, phone, players }) {
    const res = unwrap(await (await sb()).rpc('register_team', {
      p_match_id: matchId, p_team_name: team_name, p_phone: phone, p_players: players, p_device: deviceId(),
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
  async findRegistration(matchId, phone, bgmiId) {
    return unwrap(await (await sb()).rpc('find_registration', { p_match_id: matchId, p_phone: phone, p_bgmi_id: bgmiId }));
  },
  async getResults(matchId) {
    return unwrap(await (await sb()).from('results_public')
      .select('*').eq('match_id', matchId).order('points', { ascending: false }));
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
  async addBans(entries) {
    unwrap(await (await sb()).from('bans').upsert(entries, { onConflict: 'kind,value', ignoreDuplicates: true }));
  },
  async removeBan(id) {
    unwrap(await (await sb()).from('bans').delete().eq('id', id));
  },
  async saveResults(matchId, rows) {
    const c = await sb();
    unwrap(await c.from('results').delete().eq('match_id', matchId));
    if (rows.length) {
      unwrap(await c.from('results').insert(rows.map(r => ({ ...r, match_id: matchId }))));
    }
    unwrap(await c.from('matches').update({ status: 'completed' }).eq('id', matchId));
  },
};

// ---------------------------------------------------------------
// Demo mode: same behaviour as the database, stored in localStorage
// ---------------------------------------------------------------

const DEMO_KEY = 'tmg-demo-v3';
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
  db.matches.forEach(m => { m.entry_fee = 0; m.reg_close_minutes = 30; });
  db.matches.push({ id: 5, title: 'Paid Solo Cup', mode: 'solo', map: 'Erangel', starts_at: istAt(1, '22:30'), max_slots: 50, prize_pool: '₹800', per_kill: '₹10', rules, status: 'open', entry_fee: 20, reg_close_minutes: 30 });
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
const holdsSlot = r => r.status === 'confirmed'
  || (r.status === 'pending' && (r.utr || Date.parse(r.hold_until) > Date.now()));
const active = matchId => db.registrations.filter(r => r.match_id === matchId && holdsSlot(r));
const withFilled = m => ({ ...m, filled: active(m.id).length });
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
  if (!r || !['pending', 'confirmed'].includes(r.status)) throw new Error('Registration not found');
  return r;
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
    const m = db.matches.find(x => x.id === id);
    return m ? clone(withFilled(m)) : null;
  },
  async listRegistrations(matchId) {
    return clone(confirmed(matchId).map(r => ({
      id: r.id, match_id: r.match_id, slot_no: r.slot_no, team_name: r.team_name, igns: [],
    })));
  },
  async register(matchId, { team_name, phone, players }) {
    const m = db.matches.find(x => x.id === matchId);
    if (!m) throw new Error('Match not found');
    if (!registrationOpen(m)) throw new Error('Registration is closed for this match');
    team_name = checkTeam(m, team_name, players);
    if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter a valid 10-digit WhatsApp number');
    if (db.bans.some(b => b.kind === 'phone' && b.value === phone)) throw new Error('This number is not allowed to register. Contact the organizers.');
    db.registrations = db.registrations.filter(r =>
      !(r.match_id === matchId && r.status === 'pending' && !r.utr && Date.parse(r.hold_until) <= Date.now()));
    if (active(matchId).length >= m.max_slots) throw new Error('All slots are full');
    const device = deviceId();
    const all = db.registrations.filter(r => r.match_id === matchId);
    if (device && all.some(r => r.device_id === device)) throw new Error('This phone has already registered a team for this match');
    if (all.some(r => r.phone === phone)) throw new Error('This WhatsApp number is already registered for this match');
    checkDuplicates(all, team_name, players);
    const slot_no = Math.max(0, ...all.map(r => r.slot_no)) + 1;
    const paid = m.entry_fee > 0;
    const reg = {
      id: ++db.seq, match_id: matchId, slot_no, team_name, phone, status: paid ? 'pending' : 'confirmed',
      created_at: new Date().toISOString(), pay_token: crypto.randomUUID(), utr: null, device_id: device,
      hold_until: paid ? new Date(Date.now() + HOLD_MS).toISOString() : null,
      players: players.map(p => ({ ign: p.ign.trim(), bgmi_id: p.bgmi_id })),
    };
    db.registrations.push(reg);
    persist();
    return { slot: slot_no, token: reg.pay_token, fee: m.entry_fee, status: reg.status };
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
    if (!registrationOpen(m)) throw new Error('Registration has closed. Contact the organizers to cancel.');
    if (r.status === 'confirmed' && m.entry_fee > 0) throw new Error('Paid registrations can only be cancelled by the organizers');
    db.registrations = db.registrations.filter(x => x !== r);
    persist();
  },
  async findRegistration(matchId, phone, bgmiId) {
    const r = db.registrations.find(x => x.match_id === matchId && x.phone === phone.trim()
      && ['pending', 'confirmed'].includes(x.status) && x.players.some(p => p.bgmi_id === bgmiId.trim()));
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
    const r = db.registrations.find(x => x.pay_token === token);
    return r ? clone({
      match_id: r.match_id, slot_no: r.slot_no, status: r.status, utr: r.utr, hold_until: r.hold_until,
      team_name: r.team_name, players: r.players,
    }) : null;
  },
  async getRoom(matchId, token) {
    const m = db.matches.find(x => x.id === matchId);
    const r = db.rooms[matchId];
    if (!m || !r || !ACTIVE.includes(m.status)) return null;
    const revealAt = Date.parse(m.starts_at) - r.reveal_minutes * 60e3;
    const ok = Date.now() >= revealAt
      && db.registrations.some(x => x.match_id === matchId && x.pay_token === token && x.status === 'confirmed');
    return { room_id: ok ? r.room_id : null, room_pass: ok ? r.room_pass : null, reveal_at: new Date(revealAt).toISOString() };
  },
  async getResults(matchId) {
    return clone(db.results.filter(x => x.match_id === matchId).map(x => {
      const r = db.registrations.find(y => y.id === x.registration_id);
      return { ...withPoints(x), slot_no: r.slot_no, team_name: r.team_name };
    }).sort((a, b) => b.points - a.points));
  },
  async leaderboard(since, mode) {
    const rows = new Map();
    for (const x of db.results) {
      const m = db.matches.find(y => y.id === x.match_id);
      if (m.starts_at < since || (mode && m.mode !== mode)) continue;
      const r = db.registrations.find(y => y.id === x.registration_id);
      const key = r.team_name.toLowerCase();
      const row = rows.get(key) || { team_name: r.team_name, matches: 0, wins: 0, kills: 0, points: 0 };
      row.matches++;
      row.wins += x.placement === 1 ? 1 : 0;
      row.kills += x.kills;
      row.points += withPoints(x).points;
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.points - a.points || b.kills - a.kills).slice(0, 50);
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
    return clone(db.registrations.filter(r => r.match_id === matchId)
      .sort((a, b) => a.slot_no - b.slot_no)
      .map(r => {
        const x = db.results.find(y => y.registration_id === r.id);
        return { ...r, result: x ? withPoints(x) : null };
      }));
  },
  async setRegistrationStatus(id, status) {
    db.registrations.find(r => r.id === id).status = status;
    persist();
  },
  async listBans() { return clone(db.bans); },
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
  async saveResults(matchId, rows) {
    db.results = db.results.filter(x => x.match_id !== matchId)
      .concat(rows.map(r => ({ ...r, match_id: matchId })));
    db.matches.find(m => m.id === matchId).status = 'completed';
    persist();
  },
};

export const api = isDemo ? demo : remote;

export function resetDemo() {
  db = seed();
  persist();
}
