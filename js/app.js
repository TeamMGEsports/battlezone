// ===== BattleZone App Logic =====
function $(sel, ctx) { return (ctx || document).querySelector(sel); }
function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

// --- Countdown Timer ---
function getTimeLeft(dateStr) {
  const diff = new Date(dateStr) - new Date();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

function canShowRoom(dateStr) {
  const diff = new Date(dateStr) - new Date();
  return diff <= 15 * 60000; // 15 minutes before
}

function getRoomCountdown(dateStr) {
  const diff = new Date(dateStr) - new Date();
  if (diff <= 0) return "Room open now!";
  const mins = Math.ceil(diff / 60000);
  if (mins <= 15) return `Room opens in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Room opens in ${h}h ${m}m`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// --- Map Emoji ---
function mapIcon(map) {
  const icons = { Erangel: '🏝️', Miramar: '🏜️', Sanhok: '🌴', Vikendi: '❄️', Livik: '🌊' };
  return icons[map] || '🗺️';
}

function modeIcon(mode) {
  const icons = { Solo: '👤', Duo: '👥', Squad: '👥👥' };
  return icons[mode] || '👤';
}

// --- Render Tournament Card ---
function renderCard(t) {
  const slotsPercent = Math.min((t.registeredTeams / t.maxTeams) * 100, 100);
  const slotsFull = t.registeredTeams >= t.maxTeams;
  const timeLeft = t.status === 'upcoming' ? getTimeLeft(t.date) : null;
  const statusClass = `status-${t.status}`;
  const statusText = t.status === 'live' ? '🔴 LIVE' : t.status === 'upcoming' ? 'UPCOMING' : 'COMPLETED';

  return `
    <div class="t-card" onclick="openModal(${t.id})">
      <div class="t-card-header">
        <div class="t-card-title">${t.title}</div>
        <span class="t-card-status ${statusClass}">${statusText}</span>
      </div>
      <div class="t-card-meta">
        <span class="t-meta-item">${mapIcon(t.map)} ${t.map}</span>
        <span class="t-meta-item">${modeIcon(t.mode)} ${t.mode}</span>
        <span class="t-meta-item">🎮 ${t.game}</span>
        <span class="t-meta-item">📅 ${formatDate(t.date)}</span>
        <span class="t-meta-item">🕐 ${formatTime(t.date)}</span>
      </div>
      <div class="t-card-prizes">
        <div class="prize-box">
          <div class="prize-label">Entry</div>
          <div class="prize-value free">${t.entryFee}</div>
        </div>
        <div class="prize-box">
          <div class="prize-label">Prize Pool</div>
          <div class="prize-value">${t.prizePool}</div>
        </div>
        <div class="prize-box">
          <div class="prize-label">Per Kill</div>
          <div class="prize-value">${t.perKillPrize}</div>
        </div>
      </div>
      <div class="t-card-slots">
        <div class="slots-bar-bg"><div class="slots-bar-fill" style="width:${slotsPercent}%"></div></div>
        <div class="slots-info">
          <span>${t.registeredTeams} / ${t.maxTeams} ${t.mode === 'Solo' ? 'Players' : 'Teams'}</span>
          <span>${slotsFull ? '❌ FULL' : '✅ Slots Open'}</span>
        </div>
      </div>
      ${timeLeft ? `<div class="t-card-countdown">⏰ Starts in: ${timeLeft}</div>` : ''}
    </div>
  `;
}

// --- Render All Tournaments ---
let currentFilter = 'all';

function renderTournaments() {
  const grid = $('#tournament-grid');
  if (!grid) return;

  let filtered = TOURNAMENTS;
  if (currentFilter !== 'all') {
    if (['upcoming', 'live', 'completed'].includes(currentFilter)) {
      filtered = TOURNAMENTS.filter(t => t.status === currentFilter);
    } else {
      filtered = TOURNAMENTS.filter(t => t.mode.toLowerCase() === currentFilter);
    }
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>No tournaments found. Check back soon! 🎮</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(renderCard).join('');
}

// --- Filter ---
function setFilter(filter, btn) {
  currentFilter = filter;
  $$('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTournaments();
}

// --- Modal ---
function openModal(id) {
  const t = TOURNAMENTS.find(x => x.id === id);
  if (!t) return;

  const modal = $('#modal');
  const content = $('#modal-content');

  // Room ID section
  let roomSection = '';
  if (t.status === 'completed') {
    roomSection = `<div class="room-locked"><div class="lock-msg">Match completed</div></div>`;
  } else if (!t.roomId) {
    roomSection = `<div class="room-locked"><div style="font-size:1.5rem">🔒</div><div class="lock-msg">Room ID will be added by admin</div></div>`;
  } else if (canShowRoom(t.date)) {
    roomSection = `
      <div class="room-revealed">
        <div style="font-size:.85rem;font-weight:700;color:var(--accent)">🔓 Room is Open!</div>
        <div class="room-id-box">
          <div class="room-field"><label>Room ID</label><span>${t.roomId}</span></div>
          <div class="room-field"><label>Password</label><span>${t.roomPass}</span></div>
        </div>
      </div>`;
  } else {
    roomSection = `
      <div class="room-locked">
        <div style="font-size:1.5rem">🔒</div>
        <div class="lock-msg">Room ID & Password hidden until 15 min before match</div>
        <div class="lock-time">${getRoomCountdown(t.date)}</div>
      </div>`;
  }

  // Results section
  let resultsSection = '';
  if (t.results && t.results.length > 0) {
    resultsSection = `
      <div class="detail-section">
        <h3>🏆 Results</h3>
        <table class="results-table">
          <thead><tr><th>#</th><th>Team</th><th>Kills</th><th>Points</th><th>Prize</th></tr></thead>
          <tbody>
            ${t.results.map((r, i) => `
              <tr class="${i === 0 ? 'winner' : ''}">
                <td>${r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</td>
                <td>${r.team}</td>
                <td>${r.kills}</td>
                <td>${r.points}</td>
                <td class="prize-col">${r.prize || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Points system
  const ps = t.pointsSystem;
  const pointsSection = `
    <div class="detail-section">
      <h3>📊 Points System</h3>
      <table class="points-table">
        <thead><tr><th>Position</th><th>Points</th></tr></thead>
        <tbody>
          <tr><td>🥇 Chicken Dinner</td><td>${ps.chickenDinner}</td></tr>
          <tr><td>🥈 2nd Place</td><td>${ps.secondPlace}</td></tr>
          <tr><td>🥉 3rd Place</td><td>${ps.thirdPlace}</td></tr>
          <tr><td>Per Kill</td><td>+${ps.kill}</td></tr>
        </tbody>
      </table>
    </div>`;

  // WhatsApp register link
  const slotsAvailable = t.registeredTeams < t.maxTeams && t.status === 'upcoming';
  const teamType = t.mode === 'Solo' ? 'Player' : t.mode === 'Duo' ? 'Duo' : 'Squad';
  const waMsg = encodeURIComponent(`Hi! I want to register for: ${t.title}\n\nTeam Name: \nCaptain IGN: \nCharacter ID: \n${t.mode !== 'Solo' ? 'Teammate IGNs: \n' : ''}`);
  const waLink = `https://wa.me/${SITE_CONFIG.adminContact}?text=${waMsg}`;

  content.innerHTML = `
    <div class="modal-close"><button onclick="closeModal()">✕</button></div>
    <h2>${t.title}</h2>
    <div class="detail-meta">
      <span class="badge">${t.game}</span>
      <span class="badge">${t.mode}</span>
      <span class="badge">${mapIcon(t.map)} ${t.map}</span>
      <span class="badge badge-green">${t.entryFee}</span>
    </div>
    <div class="t-card-prizes" style="margin-bottom:1rem">
      <div class="prize-box"><div class="prize-label">Prize Pool</div><div class="prize-value">${t.prizePool}</div></div>
      <div class="prize-box"><div class="prize-label">Per Kill</div><div class="prize-value">${t.perKillPrize}</div></div>
      <div class="prize-box"><div class="prize-label">Date & Time</div><div class="prize-value" style="font-size:.75rem">${formatDate(t.date)}, ${formatTime(t.date)}</div></div>
    </div>
    <div class="t-card-slots" style="margin-bottom:1rem">
      <div class="slots-bar-bg"><div class="slots-bar-fill" style="width:${Math.min((t.registeredTeams / t.maxTeams) * 100, 100)}%"></div></div>
      <div class="slots-info">
        <span>${t.registeredTeams} / ${t.maxTeams} ${t.mode === 'Solo' ? 'Players' : 'Teams'} Registered</span>
        <span>${t.registeredTeams >= t.maxTeams ? '❌ FULL' : '✅ Open'}</span>
      </div>
    </div>

    <div class="detail-section">
      <h3>🔑 Room Details</h3>
      ${roomSection}
    </div>

    <div class="detail-section">
      <h3>📜 Rules</h3>
      <ul class="rules-list">
        ${t.rules.map(r => `<li>${r}</li>`).join('')}
      </ul>
    </div>

    ${pointsSection}
    ${resultsSection}

    <div class="cta-row">
      ${slotsAvailable ? `<a href="${waLink}" target="_blank" class="btn btn-whatsapp btn-block">📲 Register on WhatsApp</a>` : ''}
      <a href="${SITE_CONFIG.whatsappGroup}" target="_blank" class="btn btn-outline btn-block">💬 Join Group</a>
    </div>
  `;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('#modal').classList.remove('open');
  document.body.style.overflow = '';
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// --- Countdown auto-refresh ---
setInterval(() => {
  $$('.t-card-countdown').forEach((el, i) => {
    const t = TOURNAMENTS.filter(t => t.status === 'upcoming')[i];
    if (t) {
      const tl = getTimeLeft(t.date);
      if (tl) el.textContent = `⏰ Starts in: ${tl}`;
      else el.textContent = '🔴 Starting Now!';
    }
  });
}, 1000);

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  renderTournaments();
});