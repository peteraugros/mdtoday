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
  pinInput: $('pin-input'),
  pinLabel: $('pin-label'),
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

function showPin() {
  els.pinSection.style.display = '';
  els.dashboard.style.display = 'none';

  els.pinInput.addEventListener('input', () => {
    if (els.pinInput.value.length === PIN_LENGTH) {
      if (els.pinInput.value === PIN_VALUE) {
        trustDevice();
        els.pinInput.disabled = true;
        els.pinLabel.textContent = 'Access granted';
        els.pinInput.classList.add('is-success');
        // Hold 1s, then fade out over 2s, then show dashboard
        setTimeout(() => {
          els.pinSection.classList.add('is-fading');
          els.pinSection.addEventListener('transitionend', () => showDashboard(), { once: true });
        }, 1000);
      } else {
        // Wrong PIN — shake + clear
        els.pinInput.classList.add('is-wrong');
        els.pinInput.addEventListener('animationend', () => {
          els.pinInput.classList.remove('is-wrong');
          els.pinInput.value = '';
        }, { once: true });
      }
    }
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

// ---------------------------------------------------------------------------
// Demo mode — activated via ?demo in the URL
// Injects fake games so the full flow is testable on days with no real games.
// Remove before production launch.
// ---------------------------------------------------------------------------

const DEMO_MODE = new URLSearchParams(window.location.search).has('demo');

function demoGames() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  return {
    games: [
      {
        date: dateStr, sport_slug: 'baseball', sport_name: 'Baseball',
        level: 'Varsity', opponent: 'JSerra Catholic', home_away: 'away',
        game_time: '15:30', dismissal_time: '13:30',
        sport_id: 'baseball_varsity', summary: 'V Baseball @ JSerra',
      },
      {
        date: dateStr, sport_slug: 'soccer-girls', sport_name: 'Soccer, Girls',
        level: 'Varsity', opponent: 'Santa Margarita', home_away: 'home',
        game_time: '17:00', dismissal_time: '15:00',
        sport_id: 'soccer-girls_varsity', summary: 'V Soccer, Girls vs Santa Margarita',
      },
      {
        date: dateStr, sport_slug: 'basketball-boys', sport_name: 'Basketball, Boys',
        level: 'JV Red', opponent: 'St. John Bosco', home_away: 'away',
        game_time: '16:00', dismissal_time: '14:00',
        sport_id: 'basketball-boys_jv_red', summary: 'JV Red Basketball, Boys @ St. John Bosco',
      },
    ],
    getRoster: (sport_id) => {
      const rosters = {
        'baseball_varsity': [
          { display_name: 'Orlando Castano', name_slug: 'orlando-castano', jersey: '12' },
          { display_name: 'Marcus Rivera', name_slug: 'marcus-rivera', jersey: '7' },
          { display_name: 'Jake Thompson', name_slug: 'jake-thompson', jersey: '23' },
          { display_name: 'Ryan Nguyen', name_slug: 'ryan-nguyen', jersey: '4' },
          { display_name: 'Alex Garcia', name_slug: 'alex-garcia', jersey: '15' },
        ],
        'soccer-girls_varsity': [
          { display_name: 'Sofia Martinez', name_slug: 'sofia-martinez', jersey: '10' },
          { display_name: 'Emma Wilson', name_slug: 'emma-wilson', jersey: '3' },
          { display_name: 'Mia Chen', name_slug: 'mia-chen', jersey: '8' },
        ],
        'basketball-boys_jv_red': [
          { display_name: 'Tyler Brooks', name_slug: 'tyler-brooks', jersey: '11' },
          { display_name: 'Daniel Park', name_slug: 'daniel-park', jersey: '22' },
          { display_name: 'Alex Garcia', name_slug: null, jersey: null },
          { display_name: 'Alex Garcia', name_slug: null, jersey: null },
        ],
      };
      return rosters[sport_id] || [];
    },
    isStale: false,
    lastUpdated: new Date().toISOString(),
  };
}

async function showDashboard() {
  els.pinSection.style.display = 'none';
  els.dashboard.style.display = '';

  // Date heading
  const today = new Date();
  els.dashboardDate.textContent = today.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Fetch games (or use demo data)
  const result = DEMO_MODE ? demoGames() : await getTodaysGames();

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

    const demoParam = DEMO_MODE ? '&demo' : '';
    li.innerHTML = `
      <a class="staff-game__link" href="/staff/dismiss.html?sport_id=${encodeURIComponent(sportId)}${demoParam}">
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

