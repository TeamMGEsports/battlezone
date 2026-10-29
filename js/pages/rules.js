import { placementPoints } from '../api.js';
import { $, initShell } from '../ui.js';

initShell('rules');

const rows = [1, 2, 3, 4, 5, 6, 7, 8].map(p =>
  `<tr><td>${p}${['st', 'nd', 'rd'][p - 1] || 'th'}</td><td class="num">${placementPoints(p)}</td></tr>`);
$('#points').innerHTML = `
  <div class="table-wrap"><table>
    <thead><tr><th>Placement</th><th class="num">Points</th></tr></thead>
    <tbody>${rows.join('')}<tr><td>9th and below</td><td class="num">0</td></tr>
    <tr><td>Each kill</td><td class="num">+1</td></tr></tbody>
  </table></div>`;
