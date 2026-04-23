// js/pass-dismiss.js — /staff/dismiss.html entry point (roster + dismiss flow)
// See BUILD.md Step 8 for full contract.
//
// UI state reflects Dexie. Always. Every render of ACTIVE and DISMISSED lists
// derives from a live Dexie query. Never from component-local state.

import { isTrusted } from './pass-trust.js';
import { db, todayString, addDismissal, deleteDismissal, liveTodaysDismissals } from './pass-db.js';
import { getTodaysGames } from './pass-data.js';

// ---------------------------------------------------------------------------
// Demo mode — mirrors pass-staff.js demo data. Remove before production.
// ---------------------------------------------------------------------------

const DEMO_MODE = new URLSearchParams(window.location.search).has('demo');

const DEMO_ROSTERS = {
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

const DEMO_GAMES = {
  'baseball_varsity': { sport_name: 'Baseball', dismissal_time: '13:30' },
  'soccer-girls_varsity': { sport_name: 'Soccer, Girls', dismissal_time: '15:00' },
  'basketball-boys_jv_red': { sport_name: 'Basketball, Boys', dismissal_time: '14:00' },
};

// ---------------------------------------------------------------------------
// Guard: untrusted devices go back to /staff/
// ---------------------------------------------------------------------------

if (!isTrusted()) {
  window.location.replace('/staff/');
}

// Preserve ?demo on back link
if (DEMO_MODE) {
  const backLink = document.getElementById('back-link');
  if (backLink) backLink.href = '/staff/?demo';
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);
const els = {
  sport: $('dismiss-sport'),
  time: $('dismiss-time'),
  activeList: $('active-list'),
  dismissedList: $('dismissed-list'),
  dismissedCount: $('dismissed-count'),
  offrosterInput: $('offroster-input'),
  offrosterBtn: $('offroster-btn'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const sport_id = params.get('sport_id');
let roster = [];         // enriched roster rows with _key
let dismissedKeys = new Set();  // UI-layer perf optimization
// Toast removed — tap-on-dismissed-name is the only undo mechanism.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// ---------------------------------------------------------------------------
// Roster key assignment (LOCK — see BUILD.md Step 8)
// ---------------------------------------------------------------------------

function assignKeys(rosterRows, sportId) {
  const counts = {};
  return rosterRows.map(r => {
    const base = `${r.display_name}__${sportId}`;
    counts[base] = (counts[base] || 0) + 1;
    return {
      ...r,
      _key: r.name_slug || `${base}__${counts[base]}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Render (driven by live query — LOCK)
// ---------------------------------------------------------------------------

function render(dismissals) {
  // Build dismissed set
  dismissedKeys = new Set(
    dismissals
      .filter(d => d.identity.type === 'roster')
      .map(d => d.student_id)
  );
  // Also track free-text dismissed names (normalized)
  const dismissedFreeText = new Set(
    dismissals
      .filter(d => d.identity.type === 'free_text')
      .map(d => d.identity.value.trim().toLowerCase())
  );

  // ACTIVE list — roster rows not dismissed
  const active = roster.filter(r => !dismissedKeys.has(r._key));
  els.activeList.innerHTML = '';
  for (const row of active) {
    const li = document.createElement('li');
    li.className = 'staff-player';
    li.innerHTML = `
      <span class="staff-player__name">${row.display_name}</span>
      ${row.jersey ? `<span class="staff-player__jersey">#${row.jersey}</span>` : ''}
    `;
    li.addEventListener('click', () => dismissRoster(row));
    els.activeList.appendChild(li);
  }

  // DISMISSED list — all dismissals, sorted by timestamp desc
  const sorted = [...dismissals].sort((a, b) => b.timestamp - a.timestamp);
  els.dismissedList.innerHTML = '';
  for (const d of sorted) {
    const li = document.createElement('li');
    li.className = 'staff-player staff-player--dismissed';
    const time = new Date(d.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
    li.innerHTML = `
      <span class="staff-player__name">${d.identity.value}</span>
      <span class="staff-player__meta">
        ${d.identity.type === 'free_text' ? '<span class="staff-player__offroster" title="Not on roster">&#x26A0;</span>' : ''}
        <span class="staff-player__time">${time}</span>
      </span>
    `;
    // Un-dismiss: tap dismissed name → hard delete → returns to active via live query
    li.addEventListener('click', () => deleteDismissal(d.id));
    els.dismissedList.appendChild(li);
  }

  els.dismissedCount.textContent = sorted.length > 0 ? `(${sorted.length})` : '';
  // Hint: tap name to undo
  const hint = document.getElementById('dismissed-hint');
  if (hint) hint.hidden = sorted.length === 0;
}

// ---------------------------------------------------------------------------
// Dismiss actions
// ---------------------------------------------------------------------------

async function dismissRoster(row) {
  // UI-layer duplicate guard (LOCK)
  if (dismissedKeys.has(row._key)) return;

  const record = {
    sport_id,
    sport_name: els.sport.textContent,
    date: todayString(),
    identity: { type: 'roster', value: row.display_name },
    student_id: row._key,
    roster_match: true,
    timestamp: Date.now(),
    dismissed_by: 'teacher',
  };

  await addDismissal(record);
}

async function dismissFreeText() {
  const name = els.offrosterInput.value.trim();
  if (!name) return;

  const record = {
    sport_id,
    sport_name: els.sport.textContent,
    date: todayString(),
    identity: { type: 'free_text', value: name },
    student_id: null,
    roster_match: false,
    timestamp: Date.now(),
    dismissed_by: 'teacher',
  };

  await addDismissal(record);
  els.offrosterInput.value = '';
}

// ---------------------------------------------------------------------------
// Off-roster input
// ---------------------------------------------------------------------------

els.offrosterBtn.addEventListener('click', dismissFreeText);
els.offrosterInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') dismissFreeText();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  if (!sport_id) {
    els.sport.textContent = 'No sport selected';
    return;
  }

  // Fetch game data + roster (or use demo data)
  let game, rawRoster;

  if (DEMO_MODE) {
    const demoGame = DEMO_GAMES[sport_id];
    game = demoGame ? { sport_name: demoGame.sport_name, dismissal_time: demoGame.dismissal_time } : null;
    rawRoster = DEMO_ROSTERS[sport_id] || [];
  } else {
    const result = await getTodaysGames();
    game = result.games.find(g => {
      const gId = g.sport_id ||
        `${g.sport_slug}_${g.level.toLowerCase().replace(/\s+/g, '_')}`;
      return gId === sport_id;
    });
    rawRoster = result.getRoster(sport_id);
  }

  // Header
  els.sport.textContent = game?.sport_name || sport_id;
  if (game?.dismissal_time) {
    els.time.textContent = `Dismiss at ${formatTime12(game.dismissal_time)}`;
  }

  // Roster with keys
  roster = assignKeys(rawRoster, sport_id);

  // Subscribe to live query — this drives all rendering
  const observable = liveTodaysDismissals(sport_id);
  observable.subscribe({
    next: render,
    error: err => console.error('[pass-dismiss] liveQuery error:', { err }),
  });
}

boot();
