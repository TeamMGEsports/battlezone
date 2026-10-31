// Shared helpers for all pages.
import { CONFIG } from './config.js';
import { isDemo, WAITLIST_MAX, registrationOpen } from './api.js';

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
        <div class="match-title">${esc(m.title)} <span class="tag tag-${tone}">${label}</span>${m.subscriber_only ? ` ${subBadge}` : ''}</div>
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
          <td class="num">${esc(r.prize || '–')}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

export function mvpLine(m) {
  if (!m.mvp_ign) return '';
  return `<p class="mvp"><span class="tag tag-ok">MVP</span> <strong>${esc(m.mvp_ign)}</strong>${m.mvp_team ? ` <span class="meta">(${esc(m.mvp_team)})</span>` : ''} · ${m.mvp_kills ?? 0} kills${m.prize_mvp ? ` · ₹${m.prize_mvp}` : ''}</p>`;
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
