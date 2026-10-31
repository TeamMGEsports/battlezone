import { api } from '../api.js';
import { $, initShell, matchRow, showError, statsLine } from '../ui.js';

initShell('home');

const el = $('#matches');
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
