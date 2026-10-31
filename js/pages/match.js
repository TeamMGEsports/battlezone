import { api, PLAYERS_PER_MODE, registrationOpen, regCloseMinutes, CHECKIN_OPENS_MIN, CHECKIN_CLOSES_MIN } from '../api.js';
import { CONFIG } from '../config.js';
import { $, esc, initShell, dayLabel, fmtTime, countdown, MODE, unit, statusLabel, feeLabel, resultsTable, shareLink, showError, hasPrizes, prizeLines, prizeShort, mvpLine, waitlistOpen, ytHandle, ytLink, subBadge } from '../ui.js';

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

// The last team registered on this phone, per mode, so it can be filled in with one tap.
// Stored only in this browser.
const lastKey = mode => `tmg-last-team-${mode}`;
function lastTeam(mode) {
  try { return JSON.parse(localStorage.getItem(lastKey(mode))); } catch { return null; }
}
function rememberTeam(mode, team) {
  try { localStorage.setItem(lastKey(mode), JSON.stringify({ ...lastTeam(mode), ...team })); } catch { /* not critical */ }
}
function fillTeam(form, team) {
  if (form.team_name && team.team_name) form.team_name.value = team.team_name;
  if (form.phone && team.phone) form.phone.value = team.phone;
  if (form.yt_handle && team.yt_handle) form.yt_handle.value = team.yt_handle;
  const igns = form.querySelectorAll('[name="ign"]'), ids = form.querySelectorAll('[name="bgmi_id"]');
  (team.players || []).forEach((p, i) => {
    if (igns[i]) igns[i].value = p.ign;
    if (ids[i]) ids[i].value = p.bgmi_id;
  });
}

// Registration form. With `current` it edits that team instead (no phone field).
function registerForm(m, notice = '', current = null) {
  const n = PLAYERS_PER_MODE[m.mode];
  const players = Array.from({ length: n }, (_, i) => {
    const p = current?.players[i] || {};
    return `
    <fieldset>
      <legend>${n === 1 ? 'Player' : i === 0 ? 'Player 1 (captain)' : `Player ${i + 1}`}</legend>
      <div class="row">
        <label>In-game name<input name="ign" required maxlength="20" autocomplete="off" value="${esc(p.ign || '')}"></label>
        <label>BGMI character ID<input name="bgmi_id" required inputmode="numeric" pattern="[0-9]{6,12}" title="6–12 digits" autocomplete="off" value="${esc(p.bgmi_id || '')}"></label>
      </div>
    </fieldset>`;
  }).join('');
  return `
    <form id="register" class="panel"${current ? ' data-edit="1"' : ''}>
      <h3>${current ? `Edit slot #${current.slot_no}` : 'Register'}</h3>
      ${notice}
      ${!current && lastTeam(m.mode) ? `<button type="button" class="btn btn-last" id="use-last">↺ Use my last team: <strong>${esc(lastTeam(m.mode).team_name)}</strong></button>` : ''}
      ${!current && m.entry_fee > 0 ? `<p class="meta">Entry fee ₹${m.entry_fee}, paid by UPI. After you register, your slot is held for 15 minutes while you pay.</p>` : ''}
      ${!current && m.filled >= m.max_slots ? `<p class="meta">All ${m.max_slots} slots are taken. Join the waitlist: if a team cancels or doesn’t check in, the next team on the waitlist gets their slot automatically.</p>` : ''}
      ${m.subscriber_only && !current ? `
      <label>Captain’s YouTube handle<input name="yt_handle" required placeholder="@yourname" autocomplete="off" maxlength="80"></label>
      <p class="meta">Must be subscribed to ${channelLink()}. Keep your subscriptions public until we verify: YouTube → Settings → Privacy → turn off “Keep all my subscriptions private”.</p>` : ''}
      ${m.mode === 'solo' ? '' : `<label>Team name<input name="team_name" required minlength="2" maxlength="30" value="${esc(current?.team_name || '')}"></label>`}
      ${current ? '' : `<label>WhatsApp number<input name="phone" required inputmode="tel" pattern="[6-9][0-9]{9}" title="10-digit mobile number" placeholder="10-digit number"></label>
      <p class="meta">Your number is only visible to organizers. Room details will show on this phone.</p>`}
      ${players}
      <div class="actions">
        <button class="btn btn-primary" type="submit">${current ? 'Save changes' : m.filled >= m.max_slots ? 'Join waitlist' : m.entry_fee > 0 ? 'Register & hold slot' : 'Register'}</button>
        ${current ? '<button class="btn" type="button" id="edit-cancel">Back</button>' : ''}
      </div>
      <div id="register-msg" role="status"></div>
    </form>`;
}

function channelLink() {
  return CONFIG.youtubeChannel
    ? `<a href="${esc(CONFIG.youtubeChannel)}" target="_blank" rel="noopener">our YouTube channel</a>`
    : 'our YouTube channel';
}

function subscriberBanner(m) {
  return `<div class="panel yt-banner">
    <strong>Subscribers-only match</strong>
    <p class="meta">Only for subscribers of ${channelLink()}. Register with the captain’s YouTube handle, then we verify the subscription and confirm your slot.</p>
    ${CONFIG.youtubeChannel ? `<a class="btn btn-yt" href="${esc(CONFIG.youtubeChannel)}" target="_blank" rel="noopener">Subscribe on YouTube</a>` : ''}
  </div>`;
}

function findForm() {
  return `
    <details class="panel find">
      <summary>Already registered? Find my registration</summary>
      <form id="find">
        <p class="meta">Use the captain’s WhatsApp number and the BGMI ID of any player in the team. Teammates can use this to see the room details on their own phone.</p>
        <div class="row">
          <label>Captain’s WhatsApp number<input name="phone" required inputmode="tel" pattern="[6-9][0-9]{9}" title="10-digit mobile number"></label>
          <label>Your BGMI ID<input name="bgmi_id" required inputmode="numeric" pattern="[0-9]{6,12}" title="6–12 digits"></label>
        </div>
        <button class="btn">Find</button>
        <div id="find-msg" role="status"></div>
      </form>
    </details>`;
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

function teamActions(m, reg) {
  if (!registrationOpen(m)) return '';
  const canCancel = !(reg.status === 'confirmed' && m.entry_fee > 0);
  return `<div class="actions" style="margin-top:.75rem">
    <button type="button" class="btn btn-small" id="edit-team">Edit team</button>
    ${canCancel ? '<button type="button" class="btn btn-small" id="cancel-reg">Cancel registration</button>' : ''}
  </div>`;
}

function regPanel(m, reg) {
  if (!reg) return '';
  if (reg.status === 'confirmed') {
    return `<div class="panel"><strong class="success">You’re registered — slot #${reg.slot_no}${reg.team_name ? `, ${esc(reg.team_name)}` : ''}.</strong>
      ${m.checkin_required ? checkinHtml(m, reg) : '<span class="meta">Room details appear on this page before the match. Share them only with your team.</span>'}
      ${teamActions(m, reg)}</div>`;
  }
  if (reg.status === 'waitlist') {
    return `<div class="panel"><strong>You’re #${reg.waitlist_position} on the waitlist${reg.team_name ? ` (${esc(reg.team_name)})` : ''}.</strong>
      <p class="meta">If a team cancels${m.checkin_required ? ' or doesn’t check in' : ''}, the next team on the waitlist gets their slot automatically. Keep this page open or check back before the match.</p>
      <button type="button" class="btn btn-small" id="recheck">Check again</button>${teamActions(m, reg)}</div>`;
  }
  if (reg.status === 'released') {
    return `<div class="panel"><strong class="error">Your slot was released because your team didn’t check in before ${esc(fmtTime(checkinTimes(m).closes))} IST.</strong>
      <span class="meta">It went to the next team on the waitlist.</span></div>`;
  }
  if (reg.status === 'rejected') {
    return `<div class="panel"><strong class="error">Your registration (slot #${reg.slot_no}) was not accepted.</strong>
      <span class="meta">If you think this is a mistake, message the organizers in the WhatsApp group.</span></div>`;
  }
  if (reg.status === 'pending' && !(m.entry_fee > 0)) {
    return `<div class="panel"><strong>Slot #${reg.slot_no} is held: waiting for YouTube verification.</strong>
      <p class="meta">We’ll check that <a href="${esc(ytLink(reg.yt_handle || ''))}" target="_blank" rel="noopener">${esc(reg.yt_handle || 'your channel')}</a> is subscribed to ${channelLink()}, then confirm your slot. Keep your subscriptions public until then.</p>
      <button type="button" class="btn btn-small" id="recheck">Check again</button>${teamActions(m, reg)}</div>`;
  }
  if (reg.utr) {
    return `<div class="panel"><strong>Payment submitted for slot #${reg.slot_no}.</strong>
      <p class="meta">UTR ${esc(reg.utr)}. Waiting for an organizer to confirm it.</p>
      <button type="button" class="btn btn-small" id="recheck">Check again</button>${teamActions(m, reg)}</div>`;
  }
  return payPanel(m, reg) + teamActions(m, reg);
}

function checkinTimes(m) {
  const start = Date.parse(m.starts_at);
  return {
    opens: new Date(start - CHECKIN_OPENS_MIN * 60e3).toISOString(),
    closes: new Date(start - CHECKIN_CLOSES_MIN * 60e3).toISOString(),
  };
}

function checkinHtml(m, reg) {
  const { opens, closes } = checkinTimes(m);
  if (reg.checked_in_at) {
    return '<p class="success">✓ Checked in. Room details appear on this page before the match. Share them only with your team.</p>';
  }
  if (Date.now() < Date.parse(opens)) {
    return `<p class="meta"><strong>Check-in required:</strong> come back between ${esc(fmtTime(opens))} and ${esc(fmtTime(closes))} IST and tap “Check in”, or your slot goes to the waitlist.</p>`;
  }
  return `<p><strong>Check in now</strong> <span class="meta">(closes ${esc(fmtTime(closes))} IST, in <span id="ci-cd">${countdown(closes)}</span>)</span></p>
    <button type="button" class="btn btn-primary" id="check-in">Check in</button> <span id="ci-msg"></span>`;
}

async function myRegistration() {
  const saved = loadSaved();
  if (!saved) return [null, null];
  if (!saved.token) { save(null); return [null, null]; } // older save without a token: use "Find my registration"
  const reg = await api.registrationStatus(saved.token);
  if (!reg) { save(null); return [null, null]; }
  if (reg.status === 'pending' && !reg.utr && reg.hold_until && !countdown(reg.hold_until)) {
    save(null);
    return [null, 'expired'];
  }
  return [saved, reg];
}

async function render() {
  // Everything in one round trip; results and room are simply empty when not relevant.
  const [m, teams, results, room, [saved, reg]] = await Promise.all([
    api.getMatch(id),
    api.listRegistrations(id),
    api.getResults(id),
    api.getRoom(id, loadSaved()?.token),
    myRegistration(),
  ]);
  if (!m) {
    el.innerHTML = '<h1>Match not found</h1><p><a href="index.html">See all matches</a></p>';
    return;
  }
  document.title = `${m.title} — ${document.title.split(' — ').pop()}`;
  const [label, tone] = statusLabel(m);
  const started = Date.parse(m.starts_at) <= Date.now();
  const regOpen = registrationOpen(m);
  const canRegister = regOpen && (m.filled < m.max_slots || waitlistOpen(m));
  const closesAt = new Date(Date.parse(m.starts_at) - regCloseMinutes(m) * 60e3).toISOString();
  const done = m.status === 'completed';
  const expired = reg === 'expired';
  const mine = expired ? null : reg;
  const shareText = `${m.title} (${MODE[m.mode]}, ${m.map}, ${feeLabel(m)}${prizeShort(m) ? `, ${prizeShort(m)}` : ''}) — ${dayLabel(m.starts_at)} ${fmtTime(m.starts_at)} IST. Register here: ${location.href}`;
  const prizeFacts = hasPrizes(m)
    ? prizeLines(m).map(l => { const [k, v] = l.split(' '); return `<div class="fact"><span>${k} prize</span><strong>${v}</strong></div>`; }).join('')
    : `<div class="fact"><span>Prize pool</span><strong>${esc(m.prize_pool || '–')}</strong></div>`;

  el.innerHTML = `
    <p class="meta"><a href="index.html">← All matches</a></p>
    <h1>${esc(m.title)} <span class="tag tag-${tone}">${label}</span>${m.subscriber_only ? ` ${subBadge}` : ''}</h1>
    <p class="lead">${esc(dayLabel(m.starts_at))}, ${esc(fmtTime(m.starts_at))} IST${!started && !done ? ` · starts in <span id="cd">${countdown(m.starts_at)}</span>` : ''}
      ${m.status === 'open' && !started ? `<br><span class="meta">Registration ${regOpen ? 'closes' : 'closed'} at ${esc(fmtTime(closesAt))} IST.</span>` : ''}</p>
    <div class="facts">
      <div class="fact"><span>Mode</span><strong>${MODE[m.mode]}</strong></div>
      <div class="fact"><span>Map</span><strong>${esc(m.map)}</strong></div>
      <div class="fact"><span>Entry</span><strong>${m.entry_fee > 0 ? `₹${m.entry_fee}` : 'Free'}</strong></div>
      ${prizeFacts}
      ${m.per_kill ? `<div class="fact"><span>Per kill</span><strong>${esc(m.per_kill)}</strong></div>` : ''}
      <div class="fact"><span>Slots</span><strong>${m.filled}/${m.max_slots}${m.waitlist && !done ? ` <span class="meta">+${m.waitlist} waiting</span>` : ''}</strong></div>
    </div>
    ${m.subscriber_only && !done ? subscriberBanner(m) : ''}
    ${m.checkin_required && !done ? `<p class="meta">Check-in required: confirmed teams must check in on this page between ${esc(fmtTime(checkinTimes(m).opens))} and ${esc(fmtTime(checkinTimes(m).closes))} IST.</p>` : ''}
    ${done ? `<h2>Results</h2>${mvpLine(m)}${resultsTable(results)}` : ''}
    ${room ? `<div class="panel" id="room">${roomHtml(room, mine, m)}</div>` : ''}
    <div id="mine">${regPanel(m, mine)}</div>
    ${canRegister && !mine ? registerForm(m, expired ? '<p class="error">Your 15-minute payment window ended, so the slot was released. You can register again.</p>' : '') : ''}
    ${!mine && !done && m.status !== 'cancelled' ? findForm() : ''}
    <div class="actions"><a class="btn" href="${shareLink(shareText)}" target="_blank" rel="noopener">Share on WhatsApp</a></div>
    ${m.rules ? `<h2>Rules</h2><p class="rules">${esc(m.rules)}</p>` : ''}
    <h2>Registered ${unit(m.mode, 2)} (${teams.length})</h2>
    ${teams.length ? `<ul class="teams">${teams.map(t => `<li><span class="slot">#${t.slot_no}</span> ${esc(t.team_name)}${m.checkin_required && t.checked_in ? ' <span class="success" title="Checked in">✓</span>' : ''}</li>`).join('')}</ul>` : '<p class="empty">No confirmed registrations yet. Be the first.</p>'}
    ${m.waitlist && !done ? `<p class="meta">${m.waitlist} team(s) on the waitlist.</p>` : ''}`;

  $('#register')?.addEventListener('submit', e => submit(e, m));
  $('#use-last')?.addEventListener('click', e => {
    fillTeam($('#register'), lastTeam(m.mode));
    e.currentTarget.remove();
  });
  $('#find')?.addEventListener('submit', e => find(e, m));
  $('#edit-team')?.addEventListener('click', () => {
    $('#mine').innerHTML = registerForm(m, '', mine);
    $('#register').addEventListener('submit', e => saveEdit(e, m, saved));
    $('#edit-cancel').addEventListener('click', () => render().catch(err => showError(el, err)));
  });
  $('#cancel-reg')?.addEventListener('click', async () => {
    if (!confirm(`Cancel your registration for slot #${mine.slot_no}? Your slot will be given to someone else.`)) return;
    try {
      await api.cancelRegistration(saved.token);
      save(null);
      await render();
    } catch (err) {
      alert(err.message);
    }
  });
  $('#utr-form')?.addEventListener('submit', e => submitUtr(e, saved));
  $('#check-in')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      await api.checkIn(saved.token);
      await render();
    } catch (err) {
      showError($('#ci-msg'), err);
      e.target.disabled = false;
    }
  });
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

function roomHtml(room, mine, m) {
  if (room.room_id) {
    return `<h3>Room details</h3><div class="room">
      <div><span class="meta">Room ID</span><br><strong>${esc(room.room_id)}</strong></div>
      <div><span class="meta">Password</span><br><strong>${esc(room.room_pass)}</strong></div></div>`;
  }
  const left = countdown(room.reveal_at);
  if (mine?.status === 'confirmed' && m.checkin_required && !mine.checked_in_at) {
    return `<h3>Room details</h3><p class="meta">Check in first. After check-in the room shows here from ${esc(fmtTime(room.reveal_at))} IST.</p>`;
  }
  if (mine?.status === 'confirmed') {
    return `<h3>Room details</h3><p class="meta">Shown here at ${esc(fmtTime(room.reveal_at))} IST${left ? ` (in <span id="room-cd">${left}</span>)` : ''}.</p>`;
  }
  return `<h3>Room details</h3><p class="meta">Only shown to confirmed teams, on the phone they registered with, from ${esc(fmtTime(room.reveal_at))} IST.</p>`;
}

let timer;
let renderedAt = 0;
const ACTIVE_TEAM = ['confirmed', 'waitlist'];
function tick(m, room, mine) {
  clearInterval(timer);
  renderedAt = Date.now();
  timer = setInterval(() => {
    const rerender = () => { clearInterval(timer); render().catch(err => showError(el, err)); };
    const cd = $('#cd');
    if (cd) cd.textContent = countdown(m.starts_at) || 'now';
    const canSeeRoom = mine?.status === 'confirmed' && (!m.checkin_required || mine.checked_in_at);
    if (room && !room.room_id && canSeeRoom) {
      const left = countdown(room.reveal_at);
      if (left) { const rc = $('#room-cd'); if (rc) rc.textContent = left; } else return rerender();
    }
    // Re-render when check-in opens or closes, so the button appears or the slot settles.
    if (m.checkin_required && ACTIVE_TEAM.includes(mine?.status)) {
      const { opens, closes } = checkinTimes(m);
      if ([opens, closes].some(t => renderedAt < Date.parse(t) && Date.parse(t) <= Date.now())) return rerender();
      const ci = $('#ci-cd');
      if (ci) ci.textContent = countdown(closes) || 'now';
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
  const btn = form.querySelector('button[type=submit]');
  const players = readPlayers(form);
  btn.disabled = true;
  msg.innerHTML = '';
  try {
    const res = await api.register(m.id, {
      team_name: m.mode === 'solo' ? players[0].ign : form.team_name.value,
      phone: form.phone.value.trim(),
      players,
      yt_handle: m.subscriber_only ? ytHandle(form.yt_handle.value) : undefined,
    });
    save({ slot: res.slot, token: res.token });
    rememberTeam(m.mode, {
      team_name: m.mode === 'solo' ? players[0].ign : form.team_name.value.trim(),
      phone: form.phone.value.trim(), players, ...(m.subscriber_only ? { yt_handle: ytHandle(form.yt_handle.value) } : {}),
    });
    await render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError(msg, err);
    btn.disabled = false;
  }
}

async function find(e, m) {
  e.preventDefault();
  const form = e.target;
  try {
    const token = await api.findRegistration(m.id, form.phone.value.trim(), form.bgmi_id.value.trim());
    const reg = await api.registrationStatus(token);
    save({ slot: reg.slot_no, token });
    await render();
  } catch (err) {
    showError($('#find-msg'), err);
  }
}

async function saveEdit(e, m, saved) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  const players = readPlayers(form);
  btn.disabled = true;
  try {
    const team_name = m.mode === 'solo' ? players[0].ign : form.team_name.value.trim();
    await api.editRegistration(saved.token, { team_name, players });
    rememberTeam(m.mode, { team_name, players });
    await render();
  } catch (err) {
    showError($('#register-msg'), err);
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
