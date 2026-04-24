// netlify/functions/dismissals.js
// Shared dismissal state backed by Netlify Blobs (REST API, no npm package).
// GET  → returns today's dismissals as JSON array
// POST → adds a dismissal record, returns updated array
// DELETE → removes a dismissal by _id, returns updated array
//
// Blob key: "dismissals-YYYY-MM-DD" (one blob per day).

function todayKey() {
  const now = new Date();
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const y = pacific.getFullYear();
  const m = String(pacific.getMonth() + 1).padStart(2, '0');
  const d = String(pacific.getDate()).padStart(2, '0');
  return `dismissals-${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Netlify Blobs REST helpers (no @netlify/blobs package needed)
// Uses NETLIFY_BLOBS_CONTEXT env var injected by Netlify at runtime.
// ---------------------------------------------------------------------------

function getBlobContext() {
  const raw = process.env.NETLIFY_BLOBS_CONTEXT;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function blobUrl(ctx, store, key) {
  return `${ctx.apiURL}/${ctx.siteID}/${store}/${key}`;
}

function blobHeaders(ctx) {
  return {
    Authorization: `Bearer ${ctx.token}`,
    'Content-Type': 'application/json',
  };
}

async function readDismissals(ctx, key) {
  try {
    const res = await fetch(blobUrl(ctx, 'dismissals', key), {
      headers: blobHeaders(ctx),
    });
    if (res.status === 404 || !res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function writeDismissals(ctx, key, records) {
  await fetch(blobUrl(ctx, 'dismissals', key), {
    method: 'PUT',
    headers: blobHeaders(ctx),
    body: JSON.stringify(records),
  });
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
  const ctx = getBlobContext();
  if (!ctx) {
    return jsonResponse({ error: 'Blob store not available' }, 500);
  }

  const key = todayKey();

  // GET — return today's dismissals, optionally filtered by sport_id
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const sportFilter = url.searchParams.get('sport_id');
    let records = await readDismissals(ctx, key);
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

    const records = await readDismissals(ctx, key);

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
    await writeDismissals(ctx, key, records);

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

    let records = await readDismissals(ctx, key);
    records = records.filter(r => r._id !== body._id);
    await writeDismissals(ctx, key, records);

    return jsonResponse({ ok: true, records });
  }

  return new Response('Method not allowed', { status: 405 });
};
