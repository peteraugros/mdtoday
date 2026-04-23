// js/pass-dismiss.js — /staff/dismiss.html entry point (roster + dismiss flow)
// See BUILD.md Step 8 for full contract.
//
// UI state reflects Dexie. Always. Every render of ACTIVE and DISMISSED lists
// derives from a live Dexie query. Never from component-local state.

import { isTrusted } from './pass-trust.js';
import { db, todayString, addDismissal, deleteDismissal, liveTodaysDismissals } from './pass-db.js';
import { getTodaysGames } from './pass-data.js';

// ---------------------------------------------------------------------------
// Guard: untrusted devices go back to /staff/
// ---------------------------------------------------------------------------

if (!isTrusted()) {
  window.location.replace('/staff/');
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
  toast: $('toast'),
  toastUndo: $('toast-undo'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const sport_id = params.get('sport_id');
let roster = [];         // enriched roster rows with _key
let dismissedKeys = new Set();  // UI-layer perf optimization
let lastDismissalId = null;
let toastTimer = null;

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

  const { id, isNew } = await addDismissal(record);
  if (isNew) showToast(id);
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

  const { id, isNew } = await addDismissal(record);
  els.offrosterInput.value = '';
  if (isNew) showToast(id);
}

// ---------------------------------------------------------------------------
// Toast / Undo (LOCK — see BUILD.md)
// ---------------------------------------------------------------------------

function showToast(id) {
  lastDismissalId = id;
  els.toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  els.toast.hidden = true;
  lastDismissalId = null;
  clearTimeout(toastTimer);
}

els.toastUndo.addEventListener('click', async () => {
  if (lastDismissalId != null) {
    await deleteDismissal(lastDismissalId);
  }
  hideToast();
});

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

  // Fetch game data + roster
  const result = await getTodaysGames();
  const game = result.games.find(g => {
    const gId = g.sport_id ||
      `${g.sport_slug}_${g.level.toLowerCase().replace(/\s+/g, '_')}`;
    return gId === sport_id;
  });

  // Header
  els.sport.textContent = game?.sport_name || game?.summary || sport_id;
  if (game?.dismissal_time) {
    els.time.textContent = `Dismiss at ${formatTime12(game.dismissal_time)}`;
  }

  // Roster with keys
  const rawRoster = result.getRoster(sport_id);
  roster = assignKeys(rawRoster, sport_id);

  // Subscribe to live query — this drives all rendering
  const observable = liveTodaysDismissals(sport_id);
  observable.subscribe({
    next: render,
    error: err => console.error('[pass-dismiss] liveQuery error:', { err }),
  });
}

boot();
