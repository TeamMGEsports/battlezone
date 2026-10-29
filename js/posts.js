// Ready-to-paste WhatsApp messages for the admin page.
import { CONFIG } from './config.js';
import { CHECKIN_OPENS_MIN, CHECKIN_CLOSES_MIN, regCloseMinutes } from './api.js';
import { dayLabel, fmtTime, fmtDate, MODE, prizeLines, hasPrizes } from './ui.js';

const base = () => new URL('.', location.href).href;
export const matchUrl = m => `${base()}match.html?id=${m.id}`;
const minsBefore = (m, mins) => new Date(Date.parse(m.starts_at) - mins * 60e3).toISOString();
const prizeText = m => hasPrizes(m) ? prizeLines(m).join(' · ') : m.prize_pool || '';

export function registrationPost(m) {
  return [
    `🎮 *${m.title}*: ${MODE[m.mode]} · ${m.map}`,
    `🕘 ${dayLabel(m.starts_at)}, ${fmtTime(m.starts_at)} IST`,
    `💰 Entry: ${m.entry_fee > 0 ? `₹${m.entry_fee}` : 'Free'}`,
    prizeText(m) ? `🏆 ${prizeText(m)}` : null,
    m.per_kill ? `🔫 Per kill: ${m.per_kill}` : null,
    `👥 ${m.filled}/${m.max_slots} slots filled`,
    m.checkin_required ? `✅ Check-in required between ${fmtTime(minsBefore(m, CHECKIN_OPENS_MIN))} and ${fmtTime(minsBefore(m, CHECKIN_CLOSES_MIN))} IST` : null,
    `⏳ Registration closes at ${fmtTime(minsBefore(m, regCloseMinutes(m)))} IST`,
    '',
    `Register: ${matchUrl(m)}`,
  ].filter(l => l !== null).join('\n');
}

export function checkinPost(m) {
  return [
    `✅ *Check-in is open: ${m.title}*`,
    `Confirmed teams: open the match page and tap “Check in” before ${fmtTime(minsBefore(m, CHECKIN_CLOSES_MIN))} IST.`,
    'Teams that don’t check in lose their slot to the waitlist.',
    '',
    matchUrl(m),
  ].join('\n');
}

export function roomPost(m) {
  return [
    `🔓 *Room is open: ${m.title}*`,
    'Confirmed teams: open the match page on the phone you registered with to see the Room ID and password.',
    'Teammates: use “Find my registration” with your captain’s number and your BGMI ID.',
    'Join your own slot number. Players not on the slot list will be removed.',
    '',
    matchUrl(m),
  ].join('\n');
}

export function resultsPost(m, results) {
  const medals = ['🥇', '🥈', '🥉'];
  const prizes = [m.prize_1, m.prize_2, m.prize_3];
  const top = results.slice(0, 3).map((r, i) =>
    `${medals[i]} ${r.team_name}: ${r.points} pts (${r.kills} kills)${r.prize ? ` · ${r.prize}` : prizes[i] ? ` · ₹${prizes[i]}` : ''}`);
  return [
    `🏆 *Results: ${m.title}* (${fmtDate(m.starts_at)})`,
    ...top,
    m.mvp_ign && `⭐ MVP: ${m.mvp_ign}${m.mvp_team ? ` (${m.mvp_team})` : ''}, ${m.mvp_kills ?? 0} kills${m.prize_mvp ? ` · ₹${m.prize_mvp}` : ''}`,
    '',
    'Congratulations! Prizes are sent by UPI within 24 hours.',
    `Full results: ${base()}results.html`,
  ].filter(Boolean).join('\n');
}

export function tonightPost(matches) {
  const lines = matches.map((m, i) =>
    `${i + 1}. ${fmtTime(m.starts_at)}: *${m.title}* (${MODE[m.mode]}, ${m.map}) · ${m.entry_fee > 0 ? `₹${m.entry_fee}` : 'Free'}${hasPrizes(m) ? ` · Prizes ₹${(m.prize_1 || 0) + (m.prize_2 || 0) + (m.prize_3 || 0) + (m.prize_mvp || 0)}` : ''} · ${m.filled}/${m.max_slots} filled\n   ${matchUrl(m)}`);
  return [`📅 *Tonight’s matches* (${fmtDate(new Date().toISOString())})`, '', ...lines, '', `All matches: ${base()}`].join('\n');
}

export function leaderboardPost(rows) {
  return [
    '📊 *Weekly leaderboard* (last 7 days)',
    ...rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.team_name}: ${r.points} pts · ${r.wins} wins · ${r.kills} kills${r.mvps ? ` · ${r.mvps} MVP` : ''}`),
    '',
    `Full leaderboard: ${base()}results.html`,
    `${CONFIG.siteName}`,
  ].join('\n');
}
