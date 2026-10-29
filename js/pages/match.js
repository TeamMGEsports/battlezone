import { api, PLAYERS_PER_MODE } from '../api.js';
import { $, esc, initShell, dayLabel, fmtTime, countdown, MODE, unit, statusLabel, resultsTable, shareLink, showError } from '../ui.js';

initShell('home');

const id = Number(new URLSearchParams(location.search).get('id'));
const el = $('#match');
const savedKey = `tmg-reg-${id}`;

function savedSlot() {
  try { return localStorage.getItem(savedKey); } catch { return null; }
}

function registerForm(m) {
  const n = PLAYERS_PER_MODE[m.mode];
  const players = Array.from({ length: n }, (_, i) => `
    <fieldset>
      <legend>${n === 1 ? 'Player' : i === 0 ? 'Player 1 (captain)' : `Player ${i + 1}`}</legend>
      <div class="row">
        <label>In-game name<input name="ign" required maxlength="20" autocomplete="off"></label>
        <label>BGMI character ID<input name="bgmi_id" required inputmode="numeric" pattern="[0-9]{6,12}" title="6–12 digits" autocomplete="off"></label>
      </div>
    </fieldset>`).join('');
  return `
    <form id="register" class="panel">
      <h3>Register</h3>
      ${m.mode === 'solo' ? '' : '<label>Team name<input name="team_name" required minlength="2" maxlength="30"></label>'}
      <label>WhatsApp number<input name="phone" required inputmode="tel" pattern="[6-9][0-9]{9}" title="10-digit mobile number" placeholder="10-digit number"></label>
      ${players}
      <p class="meta">Your number is only visible to organizers.</p>
      <button class="btn btn-primary" type="submit">Register</button>
      <div id="register-msg" role="status"></div>
    </form>`;
}

async function render() {
  const m = await api.getMatch(id);
  if (!m) {
    el.innerHTML = '<h1>Match not found</h1><p><a href="index.html">See all matches</a></p>';
    return;
  }
  document.title = `${m.title} — ${document.title.split(' — ').pop()}`;
  const [label, tone] = statusLabel(m);
  const started = Date.parse(m.starts_at) <= Date.now();
  const canRegister = m.status === 'open' && !started && m.filled < m.max_slots;
  const done = m.status === 'completed';
  const [teams, results, room] = await Promise.all([
    api.listRegistrations(id),
    done ? api.getResults(id) : [],
    done ? null : api.getRoom(id),
  ]);
  const slot = savedSlot();
  const shareText = `${m.title} (${MODE[m.mode]}, ${m.map}) — ${dayLabel(m.starts_at)} ${fmtTime(m.starts_at)} IST. Free entry, register here: ${location.href}`;

  el.innerHTML = `
    <p class="meta"><a href="index.html">← All matches</a></p>
    <h1>${esc(m.title)} <span class="tag tag-${tone}">${label}</span></h1>
    <p class="lead">${esc(dayLabel(m.starts_at))}, ${esc(fmtTime(m.starts_at))} IST${!started && !done ? ` · starts in <span id="cd">${countdown(m.starts_at)}</span>` : ''}</p>
    <div class="facts">
      <div class="fact"><span>Mode</span><strong>${MODE[m.mode]}</strong></div>
      <div class="fact"><span>Map</span><strong>${esc(m.map)}</strong></div>
      <div class="fact"><span>Prize pool</span><strong>${esc(m.prize_pool || '–')}</strong></div>
      <div class="fact"><span>Per kill</span><strong>${esc(m.per_kill || '–')}</strong></div>
      <div class="fact"><span>Slots</span><strong>${m.filled}/${m.max_slots}</strong></div>
    </div>
    ${done ? `<h2>Results</h2>${resultsTable(results)}` : ''}
    ${room ? `<div class="panel" id="room">${roomHtml(room)}</div>` : ''}
    ${slot ? `<div class="panel"><strong class="success">You’re registered — slot #${esc(slot)}.</strong> <span class="meta">Come back here 15 minutes before start for the room ID.</span></div>` : ''}
    ${canRegister && !slot ? registerForm(m) : ''}
    <div class="actions"><a class="btn" href="${shareLink(shareText)}" target="_blank" rel="noopener">Share on WhatsApp</a></div>
    ${m.rules ? `<h2>Rules</h2><p class="rules">${esc(m.rules)}</p>` : ''}
    <h2>Registered ${unit(m.mode, 2)} (${teams.length})</h2>
    ${teams.length ? `<ol class="teams">${teams.map(t => `<li>${esc(t.team_name)}${m.mode === 'solo' ? '' : ` <span class="meta">${esc(t.igns.join(', '))}</span>`}</li>`).join('')}</ol>` : '<p class="empty">No registrations yet. Be the first.</p>'}`;

  $('#register')?.addEventListener('submit', e => submit(e, m));
  if (!started && !done) tick(m, room);
}

function roomHtml(room) {
  if (room.room_id) {
    return `<h3>Room details</h3><div class="room">
      <div><span class="meta">Room ID</span><br><strong>${esc(room.room_id)}</strong></div>
      <div><span class="meta">Password</span><br><strong>${esc(room.room_pass)}</strong></div></div>`;
  }
  return `<h3>Room details</h3><p class="meta">Shown here at ${esc(fmtTime(room.reveal_at))} IST (in <span id="room-cd">${countdown(room.reveal_at)}</span>).</p>`;
}

let timer;
function tick(m, room) {
  clearInterval(timer);
  timer = setInterval(() => {
    const cd = $('#cd');
    if (cd) cd.textContent = countdown(m.starts_at) || 'now';
    if (room && !room.room_id) {
      const left = countdown(room.reveal_at);
      if (left) { const rc = $('#room-cd'); if (rc) rc.textContent = left; }
      else { clearInterval(timer); render().catch(err => showError(el, err)); }
    }
  }, 1000);
}

async function submit(e, m) {
  e.preventDefault();
  const form = e.target;
  const msg = $('#register-msg');
  const btn = form.querySelector('button');
  const igns = [...form.querySelectorAll('[name="ign"]')].map(i => i.value.trim());
  const ids = [...form.querySelectorAll('[name="bgmi_id"]')].map(i => i.value.trim());
  const players = igns.map((ign, i) => ({ ign, bgmi_id: ids[i] }));
  btn.disabled = true;
  msg.innerHTML = '';
  try {
    const slot = await api.register(m.id, {
      team_name: m.mode === 'solo' ? igns[0] : form.team_name.value,
      phone: form.phone.value.trim(),
      players,
    });
    try { localStorage.setItem(savedKey, slot); } catch { /* not critical */ }
    await render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError(msg, err);
    btn.disabled = false;
  }
}

if (!id) el.innerHTML = '<h1>Match not found</h1><p><a href="index.html">See all matches</a></p>';
else render().catch(err => showError(el, err));
