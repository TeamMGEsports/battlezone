import { api, isDemo, placementPoints, resetDemo } from '../api.js';
import { CONFIG } from '../config.js';
import { registrationPost, checkinPost, roomPost, resultsPost, tonightPost, leaderboardPost } from '../posts.js';
import { $, esc, initShell, dayLabel, fmtTime, countdown, MODE, statusLabel, feeLabel, showError, shareLink, hasPrizes } from '../ui.js';

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
        <button class="btn" id="post-tonight">Post: tonight</button>
        <button class="btn" id="post-board">Post: weekly top 10</button>
        <button class="btn" id="bans">Bans</button>
        <button class="btn btn-primary" id="new">New match</button>
      </div>
    </div>
    <div id="msg"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Match</th><th>Slots</th><th>Status</th><th></th></tr></thead>
      <tbody>${matches.map(m => `
        <tr>
          <td>${esc(dayLabel(m.starts_at))}<br><span class="meta">${esc(fmtTime(m.starts_at))}</span></td>
          <td>${esc(m.title)}<br><span class="meta">${MODE[m.mode]} · ${esc(m.map)} · ${feeLabel(m)}</span></td>
          <td>${m.filled}/${m.max_slots}${m.waitlist ? `<br><span class="meta">+${m.waitlist} waiting</span>` : ''}</td>
          <td>${statusLabel(m)[0]}</td>
          <td><div class="actions">
            <button class="btn btn-small" data-act="edit" data-id="${m.id}">Edit</button>
            <button class="btn btn-small" data-act="copy" data-id="${m.id}">Copy +1 day</button>
            <button class="btn btn-small" data-act="teams" data-id="${m.id}">Teams</button>
            <button class="btn btn-small" data-act="check" data-id="${m.id}">Room check</button>
            <button class="btn btn-small" data-act="posts" data-id="${m.id}">WhatsApp</button>
            <button class="btn btn-small" data-act="results" data-id="${m.id}">Results</button>
          </div></td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">No matches yet.</td></tr>'}
      </tbody>
    </table></div>`;
  $('#new').addEventListener('click', guard(() => showEditor(null, matches[0])));
  $('#reset')?.addEventListener('click', guard(async () => { resetDemo(); await showList(); }));
  $('#bans').addEventListener('click', guard(showBans));
  $('#post-tonight').addEventListener('click', guard(async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const tonight = (await api.listMatches('upcoming'))
      .filter(m => new Date(m.starts_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today);
    if (!tonight.length) throw new Error('No matches scheduled for today.');
    showPosts('Tonight’s matches', [['Tonight’s matches', tonightPost(tonight)]]);
  }));
  $('#post-board').addEventListener('click', guard(async () => {
    const rows = await api.leaderboard(new Date(Date.now() - 7 * 864e5).toISOString());
    if (!rows.length) throw new Error('No results in the last 7 days.');
    showPosts('Weekly leaderboard', [['Weekly top 10', leaderboardPost(rows)]]);
  }));
  el.querySelector('tbody').addEventListener('click', guard(async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const m = matches.find(x => x.id === Number(btn.dataset.id));
    if (btn.dataset.act === 'edit') return showEditor(m);
    if (btn.dataset.act === 'copy') return showEditor(null, m, 1);
    if (btn.dataset.act === 'teams') return showTeams(m);
    if (btn.dataset.act === 'check') return showRoomCheck(m);
    if (btn.dataset.act === 'posts') return showMatchPosts(m);
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
      <fieldset>
        <legend>Prizes in ₹ (leave empty if none)</legend>
        <div class="row">
          <label>1st<input name="prize_1" type="number" min="0" max="100000" value="${src.prize_1 ?? ''}"></label>
          <label>2nd<input name="prize_2" type="number" min="0" max="100000" value="${src.prize_2 ?? ''}"></label>
        </div>
        <div class="row">
          <label>3rd<input name="prize_3" type="number" min="0" max="100000" value="${src.prize_3 ?? ''}"></label>
          <label>MVP (most kills)<input name="prize_mvp" type="number" min="0" max="100000" value="${src.prize_mvp ?? ''}"></label>
        </div>
        <label>Per kill (optional)<input name="per_kill" value="${esc(src.per_kill || '')}" placeholder="₹10"></label>
      </fieldset>
      <div class="row">
        <label>Entry fee in ₹ (0 = free)<input name="entry_fee" type="number" min="0" max="10000" required value="${src.entry_fee ?? 0}"></label>
        <label>Status<select name="status">${options(STATUSES, m ? m.status : 'open', v => v[0].toUpperCase() + v.slice(1))}</select></label>
      </div>
      ${CONFIG.upiId ? '' : '<p class="meta">Paid matches need your UPI ID in js/config.js before players can pay.</p>'}
      <label>Registration closes this many minutes before start<input name="reg_close_minutes" type="number" min="0" max="600" required value="${src.reg_close_minutes ?? 30}"></label>
      <label class="check"><input type="checkbox" name="checkin_required"${src.checkin_required ? ' checked' : ''}>
        Require check-in (60 to 20 minutes before start). Teams that don’t check in lose their slot to the waitlist.</label>
      <label>Rules<textarea name="rules">${esc(src.rules ?? DEFAULT_RULES)}</textarea></label>
      <fieldset>
        <legend>Room (hidden from players until reveal time)</legend>
        <div class="row">
          <label>Room ID<input name="room_id" value="${esc(room.room_id || '')}" autocomplete="off"></label>
          <label>Password<input name="room_pass" value="${esc(room.room_pass || '')}" autocomplete="off"></label>
        </div>
        <label>Show to confirmed teams this many minutes before start<input name="reveal_minutes" type="number" min="0" max="120" value="${room.reveal_minutes ?? 15}"></label>
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
    const num = v => v === '' ? null : Number(v);
    const prizes = {
      prize_1: num(f.prize_1.value), prize_2: num(f.prize_2.value),
      prize_3: num(f.prize_3.value), prize_mvp: num(f.prize_mvp.value),
    };
    await api.saveMatch({
      ...(m ? { id: m.id } : {}),
      title: f.title.value.trim(), mode: f.mode.value, map: f.map.value,
      starts_at: fromInput(f.starts_at.value), max_slots: Number(f.max_slots.value),
      per_kill: f.per_kill.value.trim() || null,
      ...prizes, prize_pool: hasPrizes(prizes) ? null : src.prize_pool ?? null,
      checkin_required: f.checkin_required.checked,
      status: f.status.value, rules: f.rules.value.trim() || null, entry_fee: Number(f.entry_fee.value || 0),
      reg_close_minutes: Number(f.reg_close_minutes.value || 0),
    }, {
      room_id: f.room_id.value.trim() || null, room_pass: f.room_pass.value.trim() || null,
      reveal_minutes: Number(f.reveal_minutes.value || 15),
    });
    await showList();
  }));
}

// ---------- registrations ----------
function regState(r) {
  if (r.status === 'confirmed') return ['Confirmed', 'ok'];
  if (r.status === 'waitlist') return ['Waitlist', 'muted'];
  if (r.status === 'released') return ['No check-in', 'muted'];
  if (r.status === 'rejected') return ['Removed', 'muted'];
  if (r.utr) return ['Paid? check UTR', 'live'];
  const left = countdown(r.hold_until);
  return left ? [`Awaiting payment (${left})`, 'muted'] : ['Hold expired', 'muted'];
}

async function showTeams(m) {
  const regs = await api.adminRegistrations(m.id);
  const ok = regs.filter(r => r.status === 'confirmed');
  const toCheck = regs.filter(r => r.status === 'pending' && r.utr).length;
  const listText = `${m.title} — ${dayLabel(m.starts_at)} ${fmtTime(m.starts_at)}\n` +
    ok.sort((a, b) => a.slot_no - b.slot_no).map(r => `${r.slot_no}. ${r.team_name}`).join('\n');
  const button = (r, to, text) => `<button class="btn btn-small" data-id="${r.id}" data-to="${to}">${text}</button>`;
  el.innerHTML = `
    <p class="meta"><a href="#" id="back">← Matches</a></p>
    <h1>${esc(m.title)}: ${ok.length}/${m.max_slots} confirmed</h1>
    ${m.entry_fee > 0 ? `<p class="lead">₹${m.entry_fee} entry. ${toCheck ? `<strong>${toCheck} payment(s) to check.</strong> ` : ''}Match each UTR against your UPI app before confirming.</p>` : ''}
    <div class="actions" style="margin-bottom:1rem"><button class="btn" id="copy">Copy slot list for WhatsApp</button></div>
    <div id="msg"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Slot</th><th>Team</th><th>Players (IGN · BGMI ID)</th><th>WhatsApp</th><th>Status</th><th></th></tr></thead>
      <tbody>${regs.map(r => {
        const [state, tone] = regState(r);
        return `
        <tr${['rejected', 'released'].includes(r.status) ? ' style="opacity:.5"' : ''}>
          <td>${r.slot_no ?? '–'}</td><td>${esc(r.team_name)}</td>
          <td>${r.players.map(p => `${esc(p.ign)} · <span class="meta">${esc(p.bgmi_id)}</span>`).join('<br>')}</td>
          <td><a href="https://wa.me/91${esc(r.phone)}" target="_blank" rel="noopener">${esc(r.phone)}</a></td>
          <td><span class="tag tag-${tone}">${state}</span>${r.utr ? `<br><span class="mono">${esc(r.utr)}</span>` : ''}
            ${m.checkin_required && r.status === 'confirmed' ? `<br><span class="meta">${r.checked_in_at ? '✓ checked in' : 'not checked in'}</span>` : ''}</td>
          <td><div class="actions">
            ${r.status === 'pending' && r.utr ? button(r, 'confirmed', 'Confirm') : ''}
            ${r.status === 'waitlist' ? button(r, 'confirmed', 'Give slot') : ''}
            ${['rejected', 'released'].includes(r.status) ? button(r, m.entry_fee > 0 && !r.utr ? 'pending' : 'confirmed', 'Restore') : button(r, 'rejected', r.status === 'pending' ? 'Reject' : 'Remove')}
            <button class="btn btn-small" data-ban="${r.id}">Ban</button>
          </div></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">No registrations yet.</td></tr>'}
      </tbody>
    </table></div>`;
  $('#back').addEventListener('click', guard(async e => { e.preventDefault(); await showList(); }));
  $('#copy').addEventListener('click', guard(async () => {
    await navigator.clipboard.writeText(listText);
    $('#msg').innerHTML = '<p class="success">Copied.</p>';
  }));
  el.querySelector('tbody').addEventListener('click', guard(async e => {
    const ban = e.target.closest('button[data-ban]');
    if (ban) {
      const r = regs.find(x => x.id === Number(ban.dataset.ban));
      const reason = prompt(`Ban ${r.team_name}? Their WhatsApp number and all ${r.players.length} BGMI ID(s) will be blocked from registering for any match.\n\nReason (optional):`);
      if (reason === null) return;
      await api.addBans([{ kind: 'phone', value: r.phone }, ...r.players.map(p => ({ kind: 'bgmi_id', value: p.bgmi_id }))]
        .map(b => ({ ...b, reason: reason.trim() || null })));
      if (r.status !== 'rejected') await api.setRegistrationStatus(r.id, 'rejected');
      return showTeams((await api.listMatches('all')).find(x => x.id === m.id));
    }
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    await api.setRegistrationStatus(Number(btn.dataset.id), btn.dataset.to);
    await showTeams((await api.listMatches('all')).find(x => x.id === m.id));
  }));
}

// ---------- room check (for the room host) ----------
async function showRoomCheck(m) {
  const regs = (await api.adminRegistrations(m.id)).filter(r => r.status === 'confirmed');
  const text = `${m.title} — slot list\n` + regs.map(r =>
    `${r.slot_no}. ${r.team_name}: ${r.players.map(p => `${p.ign} (${p.bgmi_id})`).join(', ')}`).join('\n');
  el.innerHTML = `
    <p class="meta"><a href="#" id="back">← Matches</a></p>
    <h1>Room check: ${esc(m.title)}</h1>
    <p class="lead">Compare the room lobby with this list before starting. Remove anyone who isn’t listed, or who is in the wrong slot.</p>
    <div class="actions" style="margin-bottom:1rem"><button class="btn" id="copy">Copy list</button></div>
    <div id="msg"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Slot</th><th>Team</th><th>Players (IGN · BGMI ID)</th></tr></thead>
      <tbody>${regs.map(r => `
        <tr><td><strong>${r.slot_no}</strong></td><td>${esc(r.team_name)}</td>
        <td>${r.players.map(p => `${esc(p.ign)} · <span class="meta mono">${esc(p.bgmi_id)}</span>`).join('<br>')}</td></tr>`).join('')
        || '<tr><td colspan="3" class="empty">No confirmed teams.</td></tr>'}
      </tbody>
    </table></div>`;
  $('#back').addEventListener('click', guard(async e => { e.preventDefault(); await showList(); }));
  $('#copy').addEventListener('click', guard(async () => {
    await navigator.clipboard.writeText(text);
    $('#msg').innerHTML = '<p class="success">Copied.</p>';
  }));
}

// ---------- WhatsApp posts ----------
function showPosts(title, posts) {
  el.innerHTML = `
    <p class="meta"><a href="#" id="back">← Matches</a></p>
    <h1>WhatsApp: ${esc(title)}</h1>
    <p class="lead">Copy a message, or open it straight in WhatsApp and pick your group.</p>
    ${posts.map(([name, text], i) => `
      <div class="panel">
        <h3>${esc(name)}</h3>
        <textarea class="post" id="post-${i}" rows="${Math.min(14, text.split('\n').length + 1)}">${esc(text)}</textarea>
        <div class="actions">
          <button class="btn btn-small" data-copy="${i}">Copy</button>
          <a class="btn btn-small" data-open="${i}" href="${shareLink(text)}" target="_blank" rel="noopener">Open in WhatsApp</a>
        </div>
      </div>`).join('')}`;
  $('#back').addEventListener('click', guard(async e => { e.preventDefault(); await showList(); }));
  el.querySelectorAll('textarea.post').forEach((t, i) => t.addEventListener('input', () => {
    el.querySelector(`[data-open="${i}"]`).href = shareLink(t.value);
  }));
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', guard(async () => {
    await navigator.clipboard.writeText($(`#post-${b.dataset.copy}`).value);
    b.textContent = 'Copied';
  })));
}

async function showMatchPosts(m) {
  const posts = [['Registration open', registrationPost(m)]];
  if (m.checkin_required) posts.push(['Check-in open', checkinPost(m)]);
  posts.push(['Room open', roomPost(m)]);
  if (m.status === 'completed') posts.push(['Results', resultsPost(m, await api.getResults(m.id))]);
  showPosts(m.title, posts);
}

// ---------- bans ----------
async function showBans() {
  const bans = await api.listBans();
  el.innerHTML = `
    <p class="meta"><a href="#" id="back">← Matches</a></p>
    <h1>Bans</h1>
    <p class="lead">Banned WhatsApp numbers and BGMI IDs can’t register for any match. Ban a whole team from its Teams page, or add one here.</p>
    <form id="add-ban" class="panel">
      <div class="row">
        <label>Type<select name="kind"><option value="phone">WhatsApp number</option><option value="bgmi_id">BGMI ID</option></select></label>
        <label>Value<input name="value" required inputmode="numeric" pattern="[0-9]{6,12}"></label>
      </div>
      <label>Reason (optional)<input name="reason" maxlength="100"></label>
      <button class="btn btn-primary">Add ban</button>
    </form>
    <div id="msg"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Type</th><th>Value</th><th>Reason</th><th>Since</th><th></th></tr></thead>
      <tbody>${bans.map(b => `
        <tr><td>${b.kind === 'phone' ? 'WhatsApp' : 'BGMI ID'}</td><td class="mono">${esc(b.value)}</td>
        <td>${esc(b.reason || '–')}</td><td>${esc(dayLabel(b.created_at))}</td>
        <td><button class="btn btn-small" data-unban="${b.id}">Unban</button></td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">No bans.</td></tr>'}
      </tbody>
    </table></div>`;
  $('#back').addEventListener('click', guard(async e => { e.preventDefault(); await showList(); }));
  $('#add-ban').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const f = e.target;
    await api.addBans([{ kind: f.kind.value, value: f.value.value.trim(), reason: f.reason.value.trim() || null }]);
    await showBans();
  }));
  el.querySelector('tbody').addEventListener('click', guard(async e => {
    const btn = e.target.closest('button[data-unban]');
    if (!btn) return;
    await api.removeBan(Number(btn.dataset.unban));
    await showBans();
  }));
}

// ---------- results ----------
async function showResults(m) {
  const regs = (await api.adminRegistrations(m.id)).filter(r => r.status === 'confirmed')
    .sort((a, b) => a.slot_no - b.slot_no);
  const placePrize = { 1: m.prize_1, 2: m.prize_2, 3: m.prize_3 };
  const players = regs.flatMap(r => r.players.map(p => ({ reg: r, ign: p.ign })));
  const mvpValue = (regId, ign) => `${regId}|${ign}`;
  const curMvp = m.mvp_ign ? mvpValue(m.mvp_registration_id ?? regs.find(r => r.team_name === m.mvp_team)?.id, m.mvp_ign) : '';
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
            <td><input name="prize" style="width:6rem" value="${esc(r.result?.prize || '')}" placeholder="₹" data-auto="${r.result?.prize ? '' : '1'}"></td>
          </tr>`).join('') || '<tr><td colspan="6" class="empty">No confirmed teams.</td></tr>'}
        </tbody>
      </table></div>
      <fieldset style="margin-top:1rem">
        <legend>MVP (player with the most kills)${m.prize_mvp ? `: ₹${m.prize_mvp}` : ''}</legend>
        <div class="row">
          <label>Player<select name="mvp"><option value="">No MVP</option>
            ${players.map(p => `<option value="${esc(mvpValue(p.reg.id, p.ign))}"${mvpValue(p.reg.id, p.ign) === curMvp ? ' selected' : ''}>${esc(p.ign)} (${esc(p.reg.team_name)})</option>`).join('')}
          </select></label>
          <label>MVP kills<input name="mvp_kills" type="number" min="0" max="99" value="${m.mvp_kills ?? ''}"></label>
        </div>
        ${m.mode === 'solo' ? '<p class="meta">For solo matches the player with the most kills is picked automatically. You can change it.</p>' : '<p class="meta">Pick the player with the most kills from the end-of-match screen.</p>'}
      </fieldset>
      <div class="actions"><button class="btn btn-primary">Save results &amp; mark completed</button></div>
      <div id="msg"></div>
    </form>`;
  const form = $('#results');
  const rows = () => [...form.querySelectorAll('tbody tr[data-id]')];
  let mvpTouched = Boolean(curMvp);
  const update = () => {
    rows().forEach(tr => {
      const p = Number(tr.querySelector('[name=placement]').value);
      const k = Number(tr.querySelector('[name=kills]').value || 0);
      tr.querySelector('.pts').textContent = p ? placementPoints(p) + k : '–';
      const prize = tr.querySelector('[name=prize]');
      if (prize.dataset.auto) prize.value = placePrize[p] ? `₹${placePrize[p]}` : '';
    });
    // Solo: the player with the most kills is the MVP, unless the admin picked one.
    if (m.mode === 'solo' && !mvpTouched) {
      const best = rows().map(tr => ({ tr, k: Number(tr.querySelector('[name=kills]').value || 0) }))
        .sort((a, b) => b.k - a.k)[0];
      if (best?.k > 0) {
        const r = regs.find(x => x.id === Number(best.tr.dataset.id));
        form.mvp.value = mvpValue(r.id, r.players[0].ign);
        form.mvp_kills.value = best.k;
      }
    }
  };
  form.addEventListener('input', e => {
    if (e.target.name === 'prize') delete e.target.dataset.auto;
    if (e.target.name === 'mvp' || e.target.name === 'mvp_kills') mvpTouched = true;
    update();
  });
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
    let mvp = null;
    if (form.mvp.value) {
      const [regId, ...ign] = form.mvp.value.split('|');
      mvp = { registration_id: Number(regId), ign: ign.join('|'), kills: Number(form.mvp_kills.value || 0) };
    }
    await api.saveResults(m.id, data, mvp);
    $('#msg').innerHTML = '<p class="success">Saved. Results are now live on the Results page.</p>';
  }));
}

start().catch(err => showError(el, err));
