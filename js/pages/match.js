import { api, PLAYERS_PER_MODE } from '../api.js';
import { CONFIG } from '../config.js';
import { $, esc, initShell, dayLabel, fmtTime, countdown, MODE, unit, statusLabel, feeLabel, resultsTable, shareLink, showError } from '../ui.js';

initShell('home');

const id = Number(new URLSearchParams(location.search).get('id'));
const el = $('#match');
const savedKey = `tmg-reg-${id}`;

// The browser remembers this player's registration: { slot, token }.
// Older saves hold just the slot number.
function loadSaved() {
  try {
    const raw = localStorage.getItem(savedKey);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v === 'object' ? v : { slot: v };
  } catch { return null; }
}
function save(v) {
  try { v ? localStorage.setItem(savedKey, JSON.stringify(v)) : localStorage.removeItem(savedKey); } catch { /* not critical */ }
}

function registerForm(m, notice = '') {
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
      ${notice}
      ${m.entry_fee > 0 ? `<p class="meta">Entry fee ₹${m.entry_fee}, paid by UPI. After you register, your slot is held for 15 minutes while you pay.</p>` : ''}
      ${m.mode === 'solo' ? '' : '<label>Team name<input name="team_name" required minlength="2" maxlength="30"></label>'}
      <label>WhatsApp number<input name="phone" required inputmode="tel" pattern="[6-9][0-9]{9}" title="10-digit mobile number" placeholder="10-digit number"></label>
      ${players}
      <p class="meta">Your number is only visible to organizers.</p>
      <button class="btn btn-primary" type="submit">${m.entry_fee > 0 ? 'Register & hold slot' : 'Register'}</button>
      <div id="register-msg" role="status"></div>
    </form>`;
}

function upiLink(m, slot) {
  const params = new URLSearchParams({
    pa: CONFIG.upiId, pn: CONFIG.upiName, am: `${m.entry_fee}.00`, cu: 'INR', tn: `MG${m.id}-S${slot}`,
  });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

function payPanel(m, reg) {
  if (!CONFIG.upiId) {
    return `<div class="panel"><h3>Pay ₹${m.entry_fee} to confirm slot #${reg.slot_no}</h3>
      <p class="error">Payment details are not set up yet. Please contact the organizers in the WhatsApp group.</p></div>`;
  }
  const note = `MG${m.id}-S${reg.slot_no}`;
  return `
    <div class="panel" id="pay">
      <h3>Pay ₹${m.entry_fee} to confirm slot #${reg.slot_no}</h3>
      <p class="meta">Slot held for <strong id="hold-cd">${countdown(reg.hold_until) || '0m'}</strong>. Pay, then enter the UTR below.</p>
      <div class="pay">
        <div class="pay-qr" id="qr" aria-label="UPI QR code"></div>
        <div class="pay-info">
          <a class="btn btn-primary" href="${esc(upiLink(m, reg.slot_no))}">Pay ₹${m.entry_fee} with UPI app</a>
          <p class="meta">Or pay manually to<br><strong class="mono">${esc(CONFIG.upiId)}</strong>
            <button type="button" class="btn btn-small" data-copy="${esc(CONFIG.upiId)}">Copy</button></p>
          <p class="meta">Payment note: <strong class="mono">${note}</strong></p>
        </div>
      </div>
      <form id="utr-form">
        <label>12-digit UTR / UPI reference number
          <input name="utr" required inputmode="numeric" pattern="[0-9]{12}" title="12 digits" autocomplete="off" placeholder="e.g. 412345678901"></label>
        <p class="meta">Find it in your UPI app under the payment details (UPI Ref No. or UTR).</p>
        <button class="btn btn-primary">Submit payment</button>
        <div id="utr-msg" role="status"></div>
      </form>
    </div>`;
}

function regPanel(m, reg) {
  if (!reg) return '';
  if (reg.status === 'confirmed') {
    return `<div class="panel"><strong class="success">You’re registered — slot #${reg.slot_no}.</strong>
      <span class="meta">Come back here 15 minutes before start for the room ID.</span></div>`;
  }
  if (reg.status === 'rejected') {
    return `<div class="panel"><strong class="error">Your registration (slot #${reg.slot_no}) was not accepted.</strong>
      <span class="meta">If you think this is a mistake, message the organizers in the WhatsApp group.</span></div>`;
  }
  if (reg.utr) {
    return `<div class="panel"><strong>Payment submitted for slot #${reg.slot_no}.</strong>
      <p class="meta">UTR ${esc(reg.utr)}. Waiting for an organizer to confirm it.</p>
      <button type="button" class="btn btn-small" id="recheck">Check again</button></div>`;
  }
  return payPanel(m, reg);
}

async function myRegistration() {
  const saved = loadSaved();
  if (!saved) return [null, null];
  if (!saved.token) return [saved, { slot_no: saved.slot, status: 'confirmed' }]; // older free registration
  const reg = await api.registrationStatus(saved.token);
  if (!reg) { save(null); return [null, null]; }
  if (reg.status === 'pending' && !reg.utr && !countdown(reg.hold_until)) {
    save(null);
    return [null, 'expired'];
  }
  return [saved, reg];
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
  const [teams, results, room, [saved, reg]] = await Promise.all([
    api.listRegistrations(id),
    done ? api.getResults(id) : [],
    done ? null : api.getRoom(id),
    myRegistration(),
  ]);
  const expired = reg === 'expired';
  const mine = expired ? null : reg;
  const shareText = `${m.title} (${MODE[m.mode]}, ${m.map}, ${feeLabel(m)}) — ${dayLabel(m.starts_at)} ${fmtTime(m.starts_at)} IST. Register here: ${location.href}`;

  el.innerHTML = `
    <p class="meta"><a href="index.html">← All matches</a></p>
    <h1>${esc(m.title)} <span class="tag tag-${tone}">${label}</span></h1>
    <p class="lead">${esc(dayLabel(m.starts_at))}, ${esc(fmtTime(m.starts_at))} IST${!started && !done ? ` · starts in <span id="cd">${countdown(m.starts_at)}</span>` : ''}</p>
    <div class="facts">
      <div class="fact"><span>Mode</span><strong>${MODE[m.mode]}</strong></div>
      <div class="fact"><span>Map</span><strong>${esc(m.map)}</strong></div>
      <div class="fact"><span>Entry</span><strong>${m.entry_fee > 0 ? `₹${m.entry_fee}` : 'Free'}</strong></div>
      <div class="fact"><span>Prize pool</span><strong>${esc(m.prize_pool || '–')}</strong></div>
      <div class="fact"><span>Per kill</span><strong>${esc(m.per_kill || '–')}</strong></div>
      <div class="fact"><span>Slots</span><strong>${m.filled}/${m.max_slots}</strong></div>
    </div>
    ${done ? `<h2>Results</h2>${resultsTable(results)}` : ''}
    ${room ? `<div class="panel" id="room">${roomHtml(room)}</div>` : ''}
    ${regPanel(m, mine)}
    ${canRegister && !mine ? registerForm(m, expired ? '<p class="error">Your 15-minute payment window ended, so the slot was released. You can register again.</p>' : '') : ''}
    <div class="actions"><a class="btn" href="${shareLink(shareText)}" target="_blank" rel="noopener">Share on WhatsApp</a></div>
    ${m.rules ? `<h2>Rules</h2><p class="rules">${esc(m.rules)}</p>` : ''}
    <h2>Registered ${unit(m.mode, 2)} (${teams.length})</h2>
    ${teams.length ? `<ol class="teams">${teams.map(t => `<li>${esc(t.team_name)}${m.mode === 'solo' ? '' : ` <span class="meta">${esc(t.igns.join(', '))}</span>`}</li>`).join('')}</ol>` : '<p class="empty">No confirmed registrations yet. Be the first.</p>'}`;

  $('#register')?.addEventListener('submit', e => submit(e, m));
  $('#utr-form')?.addEventListener('submit', e => submitUtr(e, saved));
  $('#recheck')?.addEventListener('click', () => render().catch(err => showError(el, err)));
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; } catch { /* ignore */ }
  }));
  if ($('#qr')) drawQr($('#qr'), upiLink(m, mine.slot_no));
  tick(m, room, mine);
}

async function drawQr(box, text) {
  try {
    const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    box.remove();
  }
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
function tick(m, room, mine) {
  clearInterval(timer);
  timer = setInterval(() => {
    const rerender = () => { clearInterval(timer); render().catch(err => showError(el, err)); };
    const cd = $('#cd');
    if (cd) cd.textContent = countdown(m.starts_at) || 'now';
    if (room && !room.room_id) {
      const left = countdown(room.reveal_at);
      if (left) { const rc = $('#room-cd'); if (rc) rc.textContent = left; } else return rerender();
    }
    const hold = $('#hold-cd');
    if (hold && mine?.hold_until) {
      const left = countdown(mine.hold_until);
      if (left) hold.textContent = left; else return rerender();
    }
  }, 1000);
}

function readPlayers(form) {
  const igns = [...form.querySelectorAll('[name="ign"]')].map(i => i.value.trim());
  const ids = [...form.querySelectorAll('[name="bgmi_id"]')].map(i => i.value.trim());
  return igns.map((ign, i) => ({ ign, bgmi_id: ids[i] }));
}

async function submit(e, m) {
  e.preventDefault();
  const form = e.target;
  const msg = $('#register-msg');
  const btn = form.querySelector('button');
  const players = readPlayers(form);
  btn.disabled = true;
  msg.innerHTML = '';
  try {
    const res = await api.register(m.id, {
      team_name: m.mode === 'solo' ? players[0].ign : form.team_name.value,
      phone: form.phone.value.trim(),
      players,
    });
    save({ slot: res.slot, token: res.token });
    await render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError(msg, err);
    btn.disabled = false;
  }
}

async function submitUtr(e, saved) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    await api.submitUtr(saved.token, form.utr.value);
    await render();
  } catch (err) {
    showError($('#utr-msg'), err);
    btn.disabled = false;
  }
}

if (!id) el.innerHTML = '<h1>Match not found</h1><p><a href="index.html">See all matches</a></p>';
else render().catch(err => showError(el, err));
