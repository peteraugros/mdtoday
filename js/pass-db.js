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

// ---------------------------------------------------------------------------
// Shared state sync (Netlify Blobs via /.netlify/functions/dismissals)
// ---------------------------------------------------------------------------

const DISMISSALS_API = '/.netlify/functions/dismissals';

/**
 * Push a dismissal to the shared store. Updates local Dexie record with the
 * server-assigned _id so un-dismiss can reference it for remote deletion.
 */
export async function syncPushDismissal(record) {
  try {
    const res = await fetch(DISMISSALS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const result = await res.json();

    // Find the server record that matches ours and save its _id locally
    if (result.records) {
      const match = result.records.find(r =>
        r.sport_id === record.sport_id &&
        ((r.student_id && r.student_id === record.student_id) ||
         (!r.student_id && (r.identity?.value || '').trim().toLowerCase() ===
           (record.identity?.value || '').trim().toLowerCase()))
      );
      if (match?._id) {
        // Update the local Dexie record with _remoteId
        const local = await db.dismissals
          .where({ sport_id: record.sport_id, date: record.date })
          .filter(d =>
            (d.student_id && d.student_id === record.student_id) ||
            (!d.student_id && (d.identity?.value || '').trim().toLowerCase() ===
              (record.identity?.value || '').trim().toLowerCase())
          )
          .first();
        if (local) {
          await db.dismissals.update(local.id, { _remoteId: match._id });
        }
      }
    }
  } catch (err) {
    console.warn('[pass-db] Sync push failed (dismissal saved locally):', { err });
  }
}

/**
 * Push a deletion to the shared store. Requires the record's _id (assigned
 * by the server on POST).
 */
export async function syncDeleteDismissal(remoteId) {
  if (!remoteId) return;
  try {
    await fetch(DISMISSALS_API, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: remoteId }),
    });
  } catch (err) {
    console.warn('[pass-db] Sync delete failed:', { err });
  }
}

/**
 * Pull all shared dismissals for a sport and merge into local Dexie.
 * Records from the server that aren't in local Dexie get added.
 * Returns the merged list.
 */
export async function syncPullDismissals(sport_id) {
  try {
    const res = await fetch(`${DISMISSALS_API}?sport_id=${encodeURIComponent(sport_id)}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const remote = await res.json();

    const today = todayString();
    const local = await db.dismissals.where({ sport_id, date: today }).toArray();

    // Index local records by student_id or normalized identity.value
    const localKeys = new Set();
    for (const d of local) {
      if (d.student_id) localKeys.add(d.student_id);
      else localKeys.add((d.identity?.value || '').trim().toLowerCase());
    }

    // Add remote records not in local
    for (const r of remote) {
      const key = r.student_id || (r.identity?.value || '').trim().toLowerCase();
      if (!localKeys.has(key)) {
        // Store the remote _id so we can delete it later
        await db.dismissals.add({ ...r, _remoteId: r._id, id: undefined });
        localKeys.add(key);
      }
    }

    return remote;
  } catch (err) {
    console.warn('[pass-db] Sync pull failed (using local only):', { err });
    return [];
  }
}
