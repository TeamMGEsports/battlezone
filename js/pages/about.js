import { api } from '../api.js';
import { CONFIG } from '../config.js';
import { $, esc, initShell, statsLine } from '../ui.js';

initShell('about');

const contact = $('#contact');
if (CONFIG.adminWhatsApp) {
  contact.insertAdjacentHTML('afterbegin',
    `<a class="btn btn-primary" href="https://wa.me/${esc(CONFIG.adminWhatsApp)}" target="_blank" rel="noopener">Message an organizer</a>`);
}
if (CONFIG.youtubeChannel) {
  contact.insertAdjacentHTML('beforeend',
    `<a class="btn btn-yt" href="${esc(CONFIG.youtubeChannel)}" target="_blank" rel="noopener">YouTube channel</a>`);
}

api.siteStats().then(s => {
  if (!s || !s.matches_hosted) return;
  $('#stats').innerHTML = statsLine(s);
}, () => {});
