// netlify/functions/dismissals.js
// Shared dismissal state backed by Netlify Blobs.
// GET  → returns today's dismissals as JSON array
// POST → adds a dismissal record, returns updated array
// DELETE → removes a dismissal by _id, returns updated array
//
// Blob key: "dismissals-YYYY-MM-DD" (one blob per day).

import { getStore } from '@netlify/blobs';

function todayKey() {
  const now = new Date();
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const y = pacific.getFullYear();
  const m = String(pacific.getMonth() + 1).padStart(2, '0');
  const d = String(pacific.getDate()).padStart(2, '0');
  return `dismissals-${y}-${m}-${d}`;
}

async function readDismissals(store, key) {
  try {
    const data = await store.get(key, { type: 'json' });
    if (!data) return [];
    return data;
  } catch {
    return [];
  }
}

async function writeDismissals(store, key, records) {
  await store.setJSON(key, records);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}

export default async (req, context) => {
  const store = getStore('dismissals');
  const key = todayKey();

  // GET — return today's dismissals, optionally filtered by sport_id
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const sportFilter = url.searchParams.get('sport_id');
    let records = await readDismissals(store, key);
    if (sportFilter) {
      records = records.filter(r => r.sport_id === sportFilter);
    }
    return jsonResponse(records);
  }

  // POST — add a dismissal
  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (!body.sport_id || !body.identity?.value || !body.date) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const records = await readDismissals(store, key);

    // Duplicate guard
    const isDuplicate = records.some(r => {
      if (r.sport_id !== body.sport_id) return false;
      if (r.student_id && body.student_id) return r.student_id === body.student_id;
      if (!r.student_id && !body.student_id) {
        return (r.identity?.value || '').trim().toLowerCase() ===
               (body.identity?.value || '').trim().toLowerCase();
      }
      return false;
    });

    if (isDuplicate) {
      return jsonResponse({ ok: true, duplicate: true, records });
    }

    body._id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    records.push(body);
    await writeDismissals(store, key, records);

    return jsonResponse({ ok: true, duplicate: false, records });
  }

  // DELETE — remove a dismissal by _id
  if (req.method === 'DELETE') {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (!body._id) {
      return jsonResponse({ error: 'Missing _id' }, 400);
    }

    let records = await readDismissals(store, key);
    records = records.filter(r => r._id !== body._id);
    await writeDismissals(store, key, records);

    return jsonResponse({ ok: true, records });
  }

  return new Response('Method not allowed', { status: 405 });
};
