import { api } from '../api.js';
import { $, esc, initShell, matchRow, showError, statsLine, teamForm } from '../ui.js';

initShell('home');

const el = $('#matches');
// Teams to beat this week: the top 3 from the weekly leaderboard.
teamForm().then(({ week }) => {
  const top = week.filter(r => r.wins > 0).slice(0, 3);
  if (!top.length) return;
  $('#to-beat').innerHTML = `<div class="panel to-beat">
    <strong>🔥 Teams to beat this week</strong>
    <ol>${top.map((r, i) => `<li>${i === 0 ? '👑 ' : ''}<strong>${esc(r.team_name)}</strong> <span class="meta">${r.wins} ${r.wins === 1 ? 'win' : 'wins'}${r.mvps ? ` · ${r.mvps} MVP` : ''}</span></li>`).join('')}</ol>
    <a class="meta" href="results.html">Full leaderboard →</a>
  </div>`;
});
// Track record: only shown once there is something to show.
api.siteStats().then(s => {
  if (!s || !s.matches_hosted) return;
  $('#stats').innerHTML = statsLine(s);
}, () => {});
try {
  // Subscriber-only matches are pinned to the top.
  const matches = (await api.listMatches('upcoming')).sort((a, b) => (b.subscriber_only ? 1 : 0) - (a.subscriber_only ? 1 : 0));
  el.innerHTML = matches.length
    ? matches.map(matchRow).join('')
    : '<p class="empty">No matches scheduled yet. Check the WhatsApp group for updates.</p>';
} catch (err) {
  showError(el, err);
}
