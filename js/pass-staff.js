// js/pass-staff.js — /staff/index.html entry point (dashboard render)
// See BUILD.md Step 6 for full contract.

import { isTrusted, trustDevice, PIN_VALUE, PIN_LENGTH } from './pass-trust.js';
import { getTodaysGames } from './pass-data.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);

const els = {
  pinSection: $('pin-section'),
  pinDisplay: $('pin-display'),
  pinKeypad: $('pin-keypad'),
  dashboard: $('dashboard-section'),
  dashboardDate: $('dashboard-date'),
  gamesList: $('games-list'),
  gamesEmpty: $('games-empty'),
  staleBanner: $('stale-banner'),
  staleText: $('stale-text'),
};

// ---------------------------------------------------------------------------
// PIN entry
// ---------------------------------------------------------------------------

let pinBuffer = '';

function renderPinDots() {
  els.pinDisplay.innerHTML = '';
  for (let i = 0; i < PIN_LENGTH; i++) {
    const dot = document.createElement('span');
    dot.className = 'staff-pin__dot' + (i < pinBuffer.length ? ' is-filled' : '');
    els.pinDisplay.appendChild(dot);
  }
}

function handlePinKey(key) {
  if (key === 'back') {
    pinBuffer = pinBuffer.slice(0, -1);
    renderPinDots();
    return;
  }

  if (pinBuffer.length >= PIN_LENGTH) return;
  pinBuffer += key;
  renderPinDots();

  // Auto-submit at PIN_LENGTH
  if (pinBuffer.length === PIN_LENGTH) {
    if (pinBuffer === PIN_VALUE) {
      trustDevice();
      showDashboard();
    } else {
      // Wrong PIN — shake + clear
      els.pinDisplay.classList.add('is-wrong');
      els.pinDisplay.addEventListener('animationend', () => {
        els.pinDisplay.classList.remove('is-wrong');
        pinBuffer = '';
        renderPinDots();
      }, { once: true });
    }
  }
}

function showPin() {
  els.pinSection.hidden = false;
  els.dashboard.hidden = true;
  renderPinDots();

  els.pinKeypad.addEventListener('click', e => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    handlePinKey(btn.dataset.key);
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function relativeTimeAgo(iso) {
  if (!iso) return 'unknown';
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatTime12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

async function showDashboard() {
  els.pinSection.hidden = true;
  els.dashboard.hidden = false;

  // Date heading
  const today = new Date();
  els.dashboardDate.textContent = today.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Fetch games
  const result = await getTodaysGames();

  // Staleness banner
  if (result.isStale) {
    els.staleBanner.hidden = false;
    els.staleText.textContent = `Data may be stale (last updated ${relativeTimeAgo(result.lastUpdated)})`;
  }

  // Filter to games with dismissal times, sort by dismissal time
  const dismissible = result.games
    .filter(g => g.dismissal_time)
    .sort((a, b) => (a.dismissal_time || '').localeCompare(b.dismissal_time || ''));

  if (dismissible.length === 0) {
    els.gamesEmpty.hidden = false;
    return;
  }

  els.gamesList.innerHTML = '';
  for (const game of dismissible) {
    const li = document.createElement('li');
    li.className = 'staff-game';

    const sportId = game.sport_id ||
      `${game.sport_slug}_${game.level.toLowerCase().replace(/\s+/g, '_')}`;

    li.innerHTML = `
      <a class="staff-game__link" href="/staff/dismiss.html?sport_id=${encodeURIComponent(sportId)}">
        <div class="staff-game__name">${game.sport_name || game.summary || game.sport_slug}</div>
        <div class="staff-game__meta">
          <span>${game.level || ''}</span>
          ${game.opponent ? `<span>vs ${game.opponent}</span>` : ''}
          ${game.home_away === 'away' ? '<span>Away</span>' : ''}
        </div>
        <div class="staff-game__dismiss-time">Dismiss at ${formatTime12(game.dismissal_time)}</div>
      </a>
    `;
    els.gamesList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// "View student schedule" session override
// ---------------------------------------------------------------------------

document.querySelectorAll('[data-staff-to-student]').forEach(a => {
  a.addEventListener('click', () => {
    sessionStorage.setItem('mdt:forceStudent', '1');
    // Native navigation handles the rest
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (isTrusted()) {
  showDashboard();
} else {
  showPin();
}
