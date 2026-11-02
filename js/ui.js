// Shared helpers for all pages.
import { CONFIG } from './config.js';
import { api, isDemo, WAITLIST_MAX, registrationOpen, PLAYERS_PER_MODE } from './api.js';

export const $ = (sel, ctx = document) => ctx.querySelector(sel);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

const TZ = 'Asia/Kolkata';
export const fmtTime = iso => new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const fmtDate = iso => new Date(iso).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const istDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

export function dayLabel(iso) {
  const day = istDay(iso);
  if (day === istDay(Date.now())) return 'Today';
  if (day === istDay(Date.now() + 864e5)) return 'Tomorrow';
  if (day === istDay(Date.now() - 864e5)) return 'Yesterday';
  return fmtDate(iso);
}

export function countdown(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor(ms % 3600e3 / 60e3);
  const s = Math.floor(ms % 60e3 / 1e3);
  return h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

export const feeLabel = m => m.entry_fee > 0 ? `₹${m.entry_fee} entry` : 'Free entry';

// Prizes: 1st/2nd/3rd/MVP amounts when set, otherwise the older free-text prize pool.
export const hasPrizes = m => [m.prize_1, m.prize_2, m.prize_3, m.prize_mvp].some(v => v > 0);
export const prizeTotal = m => (m.prize_1 || 0) + (m.prize_2 || 0) + (m.prize_3 || 0) + (m.prize_mvp || 0);
export function prizeLines(m) {
  return [['1st', m.prize_1], ['2nd', m.prize_2], ['3rd', m.prize_3], ['MVP', m.prize_mvp]]
    .filter(([, v]) => v > 0).map(([k, v]) => `${k} ₹${v}`);
}
export const prizeShort = m => hasPrizes(m) ? `Prizes ₹${prizeTotal(m)}` : m.prize_pool ? `Prize ${m.prize_pool}` : '';
// Accepts "@name", "name" or a youtube.com/@name link and returns "@name".
export function ytHandle(input) {
  const v = (input || '').trim().replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, '').split(/[/?#]/)[0];
  return v ? (v.startsWith('@') ? v : `@${v}`) : '';
}
export const ytLink = handle => `https://www.youtube.com/${encodeURIComponent(handle).replace('%40', '@')}`;
// "Watch live" shows from 15 minutes before start until 3 hours after.
export function liveNow(m) {
  const start = Date.parse(m.starts_at);
  return Boolean(m.live_url || CONFIG.youtubeChannel) && !['cancelled', 'completed'].includes(m.status)
    && Date.now() >= start - 15 * 60e3 && Date.now() <= start + 3 * 3600e3;
}
export const liveUrl = m => m.live_url || `${CONFIG.youtubeChannel.replace(/\/$/, '')}/live`;
export const noticeHtml = m => m.notice ? `<div class="notice">${esc(m.notice)}</div>` : '';
const fmtDay = iso => new Date(iso).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' });
export const paidTag = (at, ref) => at
  ? ` <span class="paid" title="Paid ${esc(fmtDay(at))}${ref ? `, UPI ref …${esc(ref)}` : ''}">✓ Paid</span>` : '';

// "214 matches hosted · 650 players · ₹18,400 paid to 126 winners"
export function statsLine(s) {
  const n = (v, one, many) => `<strong>${v.toLocaleString('en-IN')}</strong> ${v === 1 ? one : many}`;
  return `${n(s.matches_hosted, 'match hosted', 'matches hosted')} · ${n(s.players, 'player', 'players')}`
    + (s.winners_paid ? ` · <strong>₹${s.amount_paid.toLocaleString('en-IN')}</strong> paid to ${s.winners_paid} ${s.winners_paid === 1 ? 'winner' : 'winners'}` : '');
}

// Squads may add one substitute (the 5th player). Keep in sync with check_team() in 008.
export const SUBS = { squad: 1 };

// Player name + BGMI ID fields for a team, prefilled from `players` when editing.
export function playerFieldsets(mode, players = []) {
  const n = PLAYERS_PER_MODE[mode];
  return Array.from({ length: n + (SUBS[mode] || 0) }, (_, i) => {
    const p = players[i] || {};
    const sub = i >= n;
    const legend = sub ? 'Substitute (optional)' : n === 1 ? 'Player' : i === 0 ? 'Player 1 (captain)' : `Player ${i + 1}`;
    return `
    <fieldset${sub ? ' class="sub"' : ''}>
      <legend>${legend}</legend>
      <div class="row">
        <label>In-game name<input name="ign"${sub ? '' : ' required'} maxlength="20" autocomplete="off" value="${esc(p.ign || '')}"></label>
        <label>BGMI character ID<input name="bgmi_id"${sub ? '' : ' required'} inputmode="numeric" pattern="[0-9]{6,12}" title="6–12 digits" autocomplete="off" value="${esc(p.bgmi_id || '')}"></label>
      </div>
    </fieldset>`;
  }).join('');
}

// Reads the player fields. An empty substitute is left out; a half-filled one is an error.
export function readPlayers(form, mode) {
  const n = PLAYERS_PER_MODE[mode];
  const igns = [...form.querySelectorAll('[name="ign"]')].map(i => i.value.trim());
  const ids = [...form.querySelectorAll('[name="bgmi_id"]')].map(i => i.value.trim());
  return igns.map((ign, i) => ({ ign, bgmi_id: ids[i] })).filter((p, i) => {
    if (i < n) return true;
    if (!p.ign && !p.bgmi_id) return false;
    if (!p.ign || !p.bgmi_id) throw new Error('The substitute needs both an in-game name and a BGMI ID');
    return true;
  });
}

export const subMark = p => p.is_sub ? ' <span class="tag tag-muted">Sub</span>' : '';

// Team form from the leaderboard: wins in the last 30 days, and the #1 team
// of the last 7 days. Fetched once per page; empty if it can't load.
let formPromise;
export function teamForm() {
  const since = days => new Date(Date.now() - days * 864e5).toISOString();
  formPromise ||= Promise.all([api.leaderboard(since(30)), api.leaderboard(since(7))])
    .then(([month, week]) => ({
      wins: Object.fromEntries(month.map(r => [r.team_name.toLowerCase(), r.wins])),
      champion: week[0]?.wins > 0 ? week[0].team_name.toLowerCase() : null,
      week,
    }))
    .catch(() => ({ wins: {}, champion: null, week: [] }));
  return formPromise;
}
export function formBadges(form, name) {
  const key = (name || '').toLowerCase();
  const wins = form.wins[key] || 0;
  return (form.champion === key ? ' <span class="badge-champ">👑 Champion of the week</span>' : '')
    + (wins >= 2 ? ` <span class="badge-wins">🏆 ${wins} wins</span>` : '');
}
// Registered teams worth calling out: the weekly champion or 2+ wins in 30 days.
export function teamsToBeat(form, names) {
  return names
    .map(n => ({ name: n, wins: form.wins[n.toLowerCase()] || 0, champ: form.champion === n.toLowerCase() }))
    .filter(t => t.champ || t.wins >= 2)
    .sort((a, b) => b.champ - a.champ || b.wins - a.wins)
    .slice(0, 3);
}

export const subBadge = '<span class="tag tag-yt">Subscribers only</span>';

export const waitlistOpen = m => !(m.entry_fee > 0) && (m.waitlist || 0) < WAITLIST_MAX;

export const MODE = { solo: 'Solo', duo: 'Duo', squad: 'Squad' };
export const unit = (mode, n) => mode === 'solo' ? (n === 1 ? 'player' : 'players') : (n === 1 ? 'team' : 'teams');

export function statusLabel(m) {
  if (m.status === 'open' && Date.parse(m.starts_at) <= Date.now()) return ['Started', 'muted'];
  if (m.status === 'open' && m.filled >= m.max_slots) return waitlistOpen(m) ? ['Waitlist', 'muted'] : ['Full', 'muted'];
  if (m.status === 'open' && !registrationOpen(m)) return ['Reg. closed', 'muted'];
  return {
    open: ['Open', 'ok'], closed: ['Closed', 'muted'], live: ['Live', 'live'],
    completed: ['Completed', 'muted'], cancelled: ['Cancelled', 'muted'],
  }[m.status];
}

export function matchRow(m) {
  const [label, tone] = statusLabel(m);
  const pct = Math.min(100, Math.round(m.filled / m.max_slots * 100));
  return `
    <a class="match${m.subscriber_only ? ' match-sub' : ''}" href="match.html?id=${m.id}">
      <div class="match-time">
        <span class="match-day">${esc(dayLabel(m.starts_at))}</span>
        <strong>${esc(fmtTime(m.starts_at))}</strong>
      </div>
      <div class="match-body">
        <div class="match-title">${esc(m.title)} <span class="tag tag-${tone}">${label}</span>${m.subscriber_only ? ` ${subBadge}` : ''}${liveNow(m) ? ' <span class="tag tag-yt">● Live</span>' : ''}</div>
        ${m.notice ? `<div class="meta notice-line">${esc(m.notice)}</div>` : ''}
        <div class="meta">${MODE[m.mode]} · ${esc(m.map)} · ${feeLabel(m)}${prizeShort(m) ? ` · ${esc(prizeShort(m))}` : ''}</div>
        <div class="bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <div class="meta">${m.filled}/${m.max_slots} ${unit(m.mode, m.max_slots)}${m.waitlist ? ` · ${m.waitlist} on waitlist` : ''}</div>
      </div>
    </a>`;
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Results in finishing order. Kills only show when they were entered.
export function resultsTable(rows) {
  if (!rows.length) return '<p class="empty">Results not posted yet.</p>';
  rows = [...rows].sort((a, b) => a.placement - b.placement);
  const kills = rows.some(r => r.kills > 0);
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Place</th><th>Team</th>${kills ? '<th class="num">Kills</th>' : ''}<th class="num">Prize</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr${r.placement === 1 ? ' class="first"' : ''}>
          <td>${MEDAL[r.placement] || r.placement}</td><td>${esc(r.team_name)}</td>
          ${kills ? `<td class="num">${r.kills}</td>` : ''}
          <td class="num">${esc(r.prize || '–')}${paidTag(r.paid_at, r.paid_ref)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

export function mvpLine(m) {
  if (!m.mvp_ign) return '';
  return `<p class="mvp"><span class="tag tag-ok">MVP</span> <strong>${esc(m.mvp_ign)}</strong>${m.mvp_team ? ` <span class="meta">(${esc(m.mvp_team)})</span>` : ''} · ${m.mvp_kills ?? 0} kills${m.prize_mvp ? ` · ₹${m.prize_mvp}` : ''}${paidTag(m.mvp_paid_at, m.mvp_paid_ref)}</p>`;
}

export function shareLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// Fills in the parts every page has: nav highlight, WhatsApp links, demo notice.
export function initShell(active) {
  document.querySelectorAll('[data-nav]').forEach(a => {
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page');
  });
  document.querySelectorAll('[data-wa-group]').forEach(a => { a.href = CONFIG.whatsappGroup; });
  document.querySelectorAll('[data-yt]').forEach(a => {
    if (CONFIG.youtubeChannel) { a.href = CONFIG.youtubeChannel; a.hidden = false; }
  });
  document.querySelectorAll('[data-site-name]').forEach(el => { el.textContent = CONFIG.siteName; });
  if (isDemo) {
    const note = document.createElement('div');
    note.className = 'demo-note';
    note.textContent = 'Demo mode: sample data, stored only in this browser. Connect Supabase in js/config.js to go live.';
    document.body.prepend(note);
  }
}

export function showError(el, err) {
  el.innerHTML = `<p class="error">${esc(err.message || err)}</p>`;
}
