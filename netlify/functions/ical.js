// netlify/functions/ical.js
// Proxies Mater Dei's iCal feed server-side and returns it to the client.
// Same-origin request from the app — no CORS headers needed.
// Replaces corsproxy.io. See claude.md Failure mode 2 + Risk 4.

const ICAL_TARGET = 'https://www.materdei.org/apps/events/ical/?id=33';
const CACHE_TTL_SECONDS = 1800; // 30 min — Mater Dei's feed is hourly-refresh

export default async (request) => {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const upstream = await fetch(ICAL_TARGET);

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, {
        status: 502,
      });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 500 });
  }
};
