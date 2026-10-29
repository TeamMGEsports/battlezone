import { api } from '../api.js';
import { $, esc, initShell, dayLabel, fmtTime, MODE, resultsTable, mvpLine, showError } from '../ui.js';

initShell('results');

async function loadBoard(days) {
  const el = $('#board');
  try {
    const since = days ? new Date(Date.now() - days * 864e5).toISOString() : '2000-01-01T00:00:00Z';
    const rows = await api.leaderboard(since);
    el.innerHTML = rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Team</th><th class="num hide-sm">Played</th><th class="num">Wins</th><th class="num">MVP</th><th class="num">Kills</th><th class="num">Pts</th></tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr${i === 0 ? ' class="first"' : ''}><td>${i + 1}</td><td>${esc(r.team_name)}</td>
          <td class="num hide-sm">${r.matches}</td><td class="num">${r.wins}</td><td class="num">${r.mvps ?? 0}</td><td class="num">${r.kills}</td>
          <td class="num"><strong>${r.points}</strong></td></tr>`).join('')}
        </tbody>
      </table></div>` : '<p class="empty">No results in this period yet.</p>';
  } catch (err) {
    showError(el, err);
  }
}

$('#period').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  $('#period').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === btn));
  loadBoard(Number(btn.dataset.days));
});
loadBoard(7);

const recent = $('#recent');
try {
  const matches = await api.listMatches('completed');
  recent.innerHTML = matches.length ? matches.map(m => `
    <details class="result" data-id="${m.id}">
      <summary><span><strong>${esc(m.title)}</strong> <span class="meta">· ${MODE[m.mode]} · ${esc(m.map)}</span></span>
      <span class="meta">${esc(dayLabel(m.starts_at))}, ${esc(fmtTime(m.starts_at))}</span></summary>
      <div class="body"><p class="empty" style="padding:1rem">Loading…</p></div>
    </details>`).join('') : '<p class="empty">No completed matches yet.</p>';
  recent.querySelectorAll('details').forEach(d => d.addEventListener('toggle', async () => {
    if (!d.open || d.dataset.loaded) return;
    d.dataset.loaded = '1';
    const body = $('.body', d);
    try {
      const m = matches.find(x => x.id === Number(d.dataset.id));
      const line = mvpLine(m);
      body.innerHTML = (line ? `<div style="padding:.75rem 1rem 0">${line}</div>` : '') + resultsTable(await api.getResults(m.id));
    } catch (err) {
      showError(body, err);
    }
  }));
  recent.querySelector('details')?.setAttribute('open', '');
} catch (err) {
  showError(recent, err);
}
