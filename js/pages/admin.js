import { api, isDemo, placementPoints, resetDemo } from '../api.js';
import { $, esc, initShell, dayLabel, fmtTime, MODE, statusLabel, showError } from '../ui.js';

initShell('admin');

const el = $('#admin');
const MAPS = ['Erangel', 'Miramar', 'Sanhok', 'Vikendi', 'Livik', 'Karakin', 'Nusa', 'Rondo'];
const STATUSES = ['open', 'closed', 'live', 'completed', 'cancelled'];
const DEFAULT_RULES = 'No emulators.\nNo teaming with other squads.\nJoin the room 5 minutes before start.\nCaptain posts the result screenshot in the WhatsApp group.';

// datetime-local inputs are always read and written in IST
const toInput = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16).replace(' ', 'T');
const fromInput = v => new Date(`${v}:00+05:30`).toISOString();
const options = (list, cur, label = x => x) => list.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${label(v)}</option>`).join('');

function guard(fn) {
  return (...args) => fn(...args).catch(err => {
    const box = $('#msg') || el;
    showError(box, err);
  });
}

// ---------- sign in ----------
async function start() {
  if (await api.isAdmin()) return showList();
  el.innerHTML = `
    <form id="login" class="panel" style="max-width:360px">
      <h1>Organizer sign in</h1>
      ${isDemo ? '<p class="meta">Demo mode: any email and password works.</p>' : ''}
      <label>Email<input name="email" type="email" required autocomplete="username"></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn btn-primary">Sign in</button>
      <div id="msg"></div>
    </form>`;
  $('#login').addEventListener('submit', guard(async e => {
    e.preventDefault();
    await api.signIn(e.target.email.value, e.target.password.value);
    if (!(await api.isAdmin())) {
      await api.signOut();
      throw new Error('This account is not an organizer.');
    }
    showList();
  }));
}

$('#signout').addEventListener('click', guard(async e => {
  e.preventDefault();
  await api.signOut();
  $('#signout').hidden = true;
  start();
}));

// ---------- match list ----------
async function showList() {
  $('#signout').hidden = false;
  const matches = await api.listMatches('all');
  el.innerHTML = `
    <div class="actions" style="justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h1 style="margin:0">Matches</h1>
      <div class="actions">
        ${isDemo ? '<button class="btn" id="reset">Reset demo data</button>' : ''}
        <button class="btn btn-primary" id="new">New match</button>
      </div>
    </div>
    <div id="msg"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Match</th><th>Slots</th><th>Status</th><th></th></tr></thead>
      <tbody>${matches.map(m => `
        <tr>
          <td>${esc(dayLabel(m.starts_at))}<br><span class="meta">${esc(fmtTime(m.starts_at))}</span></td>
          <td>${esc(m.title)}<br><span class="meta">${MODE[m.mode]} · ${esc(m.map)}</span></td>
          <td>${m.filled}/${m.max_slots}</td>
          <td>${statusLabel(m)[0]}</td>
          <td><div class="actions">
            <button class="btn btn-small" data-act="edit" data-id="${m.id}">Edit</button>
            <button class="btn btn-small" data-act="copy" data-id="${m.id}">Copy +1 day</button>
            <button class="btn btn-small" data-act="teams" data-id="${m.id}">Teams</button>
            <button class="btn btn-small" data-act="results" data-id="${m.id}">Results</button>
          </div></td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">No matches yet.</td></tr>'}
      </tbody>
    </table></div>`;
  $('#new').addEventListener('click', guard(() => showEditor(null, matches[0])));
  $('#reset')?.addEventListener('click', guard(async () => { resetDemo(); await showList(); }));
  el.querySelector('tbody').addEventListener('click', guard(async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const m = matches.find(x => x.id === Number(btn.dataset.id));
    if (btn.dataset.act === 'edit') return showEditor(m);
    if (btn.dataset.act === 'copy') return showEditor(null, m, 1);
    if (btn.dataset.act === 'teams') return showTeams(m);
    if (btn.dataset.act === 'results') return showResults(m);
  }));
}

// ---------- create / edit ----------
async function showEditor(m, template, dayShift = 0) {
  const src = m || template || {};
  const room = m ? (await api.getRoomAdmin(m.id)) || {} : {};
  const starts = src.starts_at
    ? new Date(Date.parse(src.starts_at) + dayShift * 864e5).toISOString()
    : fromInput(`${toInput(new Date().toISOString()).slice(0, 10)}T21:00`);
  el.innerHTML = `
    <p class="meta"><a href="#" id="back">← Matches</a></p>
    <form id="edit" class="panel">
      <h1>${m ? 'Edit match' : 'New match'}</h1>
      <label>Title<input name="title" required maxlength="60" value="${esc(src.title || '')}" placeholder="Night Squad #1"></label>
      <div class="row">
        <label>Mode<select name="mode">${options(Object.keys(MODE), src.mode || 'squad', v => MODE[v])}</select></label>
        <label>Map<select name="map">${options(MAPS, src.map || 'Erangel')}</select></label>
      </div>
      <div class="row">
        <label>Start (IST)<input name="starts_at" type="datetime-local" required value="${toInput(starts)}"></label>
        <label>Max slots<input name="max_slots" type="number" min="1" max="100" required value="${src.max_slots || 25}"></label>
      </div>
      <div class="row">
        <label>Prize pool<input name="prize_pool" value="${esc(src.prize_pool || '')}" placeholder="₹500"></label>
        <label>Per kill<input name="per_kill" value="${esc(src.per_kill || '')}" placeholder="₹10"></label>
      </div>
      <label>Status<select name="status">${options(STATUSES, m ? m.status : 'open', v => v[0].toUpperCase() + v.slice(1))}</select></label>
      <label>Rules<textarea name="rules">${esc(src.rules ?? DEFAULT_RULES)}</textarea></label>
      <fieldset>
        <legend>Room (hidden from players until reveal time)</legend>
        <div class="row">
          <label>Room ID<input name="room_id" value="${esc(room.room_id || '')}" autocomplete="off"></label>
          <label>Password<input name="room_pass" value="${esc(room.room_pass || '')}" autocomplete="off"></label>
        </div>
        <label>Show to players this many minutes before start<input name="reveal_minutes" type="number" min="0" max="120" value="${room.reveal_minutes ?? 15}"></label>
      </fieldset>
      <div class="actions">
        <button class="btn btn-primary">Save</button>
        ${m ? '<button class="btn" type="button" id="delete">Delete match</button>' : ''}
      </div>
      <div id="msg"></div>
    </form>`;
  $('#back').addEventListener('click', guard(async e => { e.preventDefault(); await showList(); }));
  $('#delete')?.addEventListener('click', guard(async () => {
    if (!confirm(`Delete "${m.title}" with all its registrations and results? This cannot be undone.`)) return;
    await api.deleteMatch(m.id);
    await showList();
  }));
  $('#edit').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const f = e.target;
    await api.saveMatch({
      ...(m ? { id: m.id } : {}),
      title: f.title.value.trim(), mode: f.mode.value, map: f.map.value,
      starts_at: fromInput(f.starts_at.value), max_slots: Number(f.max_slots.value),
      prize_pool: f.prize_pool.value.trim() || null, per_kill: f.per_kill.value.trim() || null,
      status: f.status.value, rules: f.rules.value.trim() || null,
    }, {
      room_id: f.room_id.value.trim() || null, room_pass: f.room_pass.value.trim() || null,
      reveal_minutes: Number(f.reveal_minutes.value || 15),
    });
    await showList();
  }));
}

// ---------- registrations ----------
async function showTeams(m) {
  const regs = await api.adminRegistrations(m.id);
  const ok = regs.filter(r => r.status === 'confirmed');
  const listText = `${m.title} — ${dayLabel(m.starts_at)} ${fmtTime(m.starts_at)}\n` +
    ok.map(r => `${r.slot_no}. ${r.team_name}`).join('\n');
  el.innerHTML = `
    <p class="meta"><a href="#" id="back">← Matches</a></p>
    <h1>${esc(m.title)}: ${ok.length}/${m.max_slots} registered</h1>
    <div class="actions" style="margin-bottom:1rem"><button class="btn" id="copy">Copy slot list for WhatsApp</button></div>
    <div id="msg"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Slot</th><th>Team</th><th>Players (IGN · BGMI ID)</th><th>WhatsApp</th><th></th></tr></thead>
      <tbody>${regs.map(r => `
        <tr${r.status === 'rejected' ? ' style="opacity:.5"' : ''}>
          <td>${r.slot_no}</td><td>${esc(r.team_name)}</td>
          <td>${r.players.map(p => `${esc(p.ign)} · <span class="meta">${esc(p.bgmi_id)}</span>`).join('<br>')}</td>
          <td><a href="https://wa.me/91${esc(r.phone)}" target="_blank" rel="noopener">${esc(r.phone)}</a></td>
          <td><button class="btn btn-small" data-id="${r.id}" data-to="${r.status === 'confirmed' ? 'rejected' : 'confirmed'}">
            ${r.status === 'confirmed' ? 'Remove' : 'Restore'}</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">No registrations yet.</td></tr>'}
      </tbody>
    </table></div>`;
  $('#back').addEventListener('click', guard(async e => { e.preventDefault(); await showList(); }));
  $('#copy').addEventListener('click', guard(async () => {
    await navigator.clipboard.writeText(listText);
    $('#msg').innerHTML = '<p class="success">Copied.</p>';
  }));
  el.querySelector('tbody').addEventListener('click', guard(async e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    await api.setRegistrationStatus(Number(btn.dataset.id), btn.dataset.to);
    await showTeams((await api.listMatches('all')).find(x => x.id === m.id));
  }));
}

// ---------- results ----------
async function showResults(m) {
  const regs = (await api.adminRegistrations(m.id)).filter(r => r.status === 'confirmed');
  el.innerHTML = `
    <p class="meta"><a href="#" id="back">← Matches</a></p>
    <h1>Results: ${esc(m.title)}</h1>
    <p class="lead">Enter placement and kills from the end-of-match screen. Points are calculated automatically. Leave placement empty for teams that didn’t play.</p>
    <form id="results">
      <div class="table-wrap"><table>
        <thead><tr><th>Slot</th><th>Team</th><th>Place</th><th>Kills</th><th class="num">Pts</th><th>Prize</th></tr></thead>
        <tbody>${regs.map(r => `
          <tr data-id="${r.id}">
            <td>${r.slot_no}</td><td>${esc(r.team_name)}</td>
            <td><input name="placement" type="number" min="1" max="100" value="${r.result?.placement ?? ''}"></td>
            <td><input name="kills" type="number" min="0" max="99" value="${r.result?.kills ?? ''}"></td>
            <td class="num pts">–</td>
            <td><input name="prize" style="width:6rem" value="${esc(r.result?.prize || '')}" placeholder="₹"></td>
          </tr>`).join('') || '<tr><td colspan="6" class="empty">No confirmed teams.</td></tr>'}
        </tbody>
      </table></div>
      <div class="actions"><button class="btn btn-primary">Save results &amp; mark completed</button></div>
      <div id="msg"></div>
    </form>`;
  const form = $('#results');
  const rows = () => [...form.querySelectorAll('tbody tr[data-id]')];
  const update = () => rows().forEach(tr => {
    const p = Number(tr.querySelector('[name=placement]').value);
    const k = Number(tr.querySelector('[name=kills]').value || 0);
    tr.querySelector('.pts').textContent = p ? placementPoints(p) + k : '–';
  });
  form.addEventListener('input', update);
  update();
  $('#back').addEventListener('click', guard(async e => { e.preventDefault(); await showList(); }));
  form.addEventListener('submit', guard(async e => {
    e.preventDefault();
    const data = rows()
      .map(tr => ({
        registration_id: Number(tr.dataset.id),
        placement: Number(tr.querySelector('[name=placement]').value),
        kills: Number(tr.querySelector('[name=kills]').value || 0),
        prize: tr.querySelector('[name=prize]').value.trim() || null,
      }))
      .filter(r => r.placement);
    const places = data.map(r => r.placement);
    if (new Set(places).size !== places.length) throw new Error('Two teams have the same placement.');
    await api.saveResults(m.id, data);
    $('#msg').innerHTML = '<p class="success">Saved. Results are now live on the Results page.</p>';
  }));
}

start().catch(err => showError(el, err));
