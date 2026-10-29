import { api } from '../api.js';
import { $, initShell, matchRow, showError } from '../ui.js';

initShell('home');

const el = $('#matches');
try {
  const matches = await api.listMatches('upcoming');
  el.innerHTML = matches.length
    ? matches.map(matchRow).join('')
    : '<p class="empty">No matches scheduled yet. Check the WhatsApp group for updates.</p>';
} catch (err) {
  showError(el, err);
}
