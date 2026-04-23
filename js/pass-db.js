// js/pass-db.js — Dexie setup, schema, typed read/write helpers
// See BUILD.md Step 1 for full contract.

import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.mjs';

export const db = new Dexie('mdtoday_pass');

db.version(1).stores({
  dismissals: '++id, sport_id, date, timestamp'
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Local-date YYYY-MM-DD string from device timezone (never UTC).
 * A dismissal at 11:55 PM Pacific must not record as the next day's UTC date.
 */
export function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Normalize free-text names so "John Smith", "john smith", " John Smith " collapse. */
const normalize = s => String(s || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Write a dismissal record to Dexie after a DB-layer uniqueness check.
 * Returns { id, isNew } so the caller can distinguish real writes from
 * duplicate-guard hits.
 */
export async function addDismissal(record) {
  // Defensive assertion — roster dismissals MUST carry student_id (the _key).
  if (record.identity.type === 'roster' && !record.student_id) {
    console.error('Roster dismissal missing student_id — refusing write', { record });
    return { id: null, isNew: false };
  }

  // DB-layer uniqueness guard — protects against rapid taps across page refreshes,
  // race conditions with liveQuery settling, and any UI-layer bypass.
  const existing = await db.dismissals
    .where({ sport_id: record.sport_id, date: record.date })
    .filter(d =>
      (d.student_id && record.student_id && d.student_id === record.student_id) ||
      (!d.student_id && !record.student_id &&
        normalize(d.identity.value) === normalize(record.identity.value))
    )
    .first();

  if (existing) return { id: existing.id, isNew: false };

  const id = await db.dismissals.add(record);
  return { id, isNew: true };
}

/**
 * Hard-delete a dismissal by id. No soft-delete, no reversed_at.
 * See BUILD.md "Mental Model: Dexie Is Current Truth, Not a Log".
 */
export async function deleteDismissal(id) {
  await db.dismissals.delete(id);
}

/**
 * Get today's dismissals for a specific sport.
 */
export async function getTodaysDismissals(sport_id) {
  return db.dismissals.where({ sport_id, date: todayString() }).toArray();
}

/**
 * Live query wrapper — returns a Dexie.liveQuery observable.
 */
export function liveTodaysDismissals(sport_id) {
  return Dexie.liveQuery(() => getTodaysDismissals(sport_id));
}
