// netlify/functions/sheets.js
// Proxies Google Sheet CSV tabs server-side.
// Eliminates client-side dependency on docs.google.com being reachable.

const SHEETS = {
  templates: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=0&single=true&output=csv',
  summary_map: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=504710999&single=true&output=csv',
  sport_defaults: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=1365459934&single=true&output=csv',
  manual_rosters: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=567893210&single=true&output=csv',
  game_overrides: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=1944365028&single=true&output=csv',
};

export default async (request) => {
  const url = new URL(request.url);
  const tab = url.searchParams.get('tab');

  if (!tab || !SHEETS[tab]) {
    return new Response(JSON.stringify({ error: 'Invalid tab. Use: ' + Object.keys(SHEETS).join(', ') }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const upstream = await fetch(SHEETS[tab], {
      headers: { 'User-Agent': 'Mozilla/5.0 MDToday/1.0' },
      redirect: 'follow',
    });
    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
    }
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 500 });
  }
};
