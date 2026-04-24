// netlify/functions/athletics-data.js
// Scheduled daily scraper for materdeiathletics.org.
// Discovers sports dynamically, fetches schedules + rosters, caches to Netlify Blobs.
// Returns JSON on every call (fresh scrape on cron, cached on GET).
// See BUILD.md Step 4 for full contract.

import * as cheerio from 'cheerio';
import { getStore } from '@netlify/blobs';

const SITE = 'https://www.materdeiathletics.org';
const SCHOOL_ID = '289';
/**
 * School year string in "YYYY-YY" format (e.g., "2025-26").
 * Rolls over on July 1 (before fall sports start).
 */
function currentSchoolYear() {
  const now = new Date();
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 6 ? y : y - 1; // month 0-indexed; 6 = July
  const endYear = String(startYear + 1).slice(-2);
  return `${startYear}-${endYear}`;
}
const LEVELS = ['Varsity', 'JV Red', 'JV Gray', 'Freshman'];
const STALE_MS = 36 * 60 * 60 * 1000; // 36 hours

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default async (req, context) => {
  const store = getStore('athletics-data');

  // Scheduled invocation (cron) or manual trigger → scrape fresh
  // GET request → serve from cache (scrape only on cron/trigger)
  const url = new URL(req.url);
  const isCron = context?.schedule;
  const isManualTrigger = url.searchParams.get('scrape') === 'md1950';

  if (isCron || isManualTrigger) {
    // Prevent concurrent scrapes — check if one is already running
    try {
      const lock = await store.get('scrape-lock', { type: 'json' });
      if (lock && Date.now() - lock.started < 180000) {
        console.log('Scrape already in progress, serving cached data');
        return serveCached(store);
      }
    } catch { /* no lock exists, proceed */ }

    // Set lock
    await store.setJSON('scrape-lock', { started: Date.now() });

    try {
      const data = await scrapeAll();
      const payload = { ...data, generated_at: new Date().toISOString() };
      await store.setJSON('latest', payload);
      await store.delete('scrape-lock');
      return respond({ ...payload, source: 'scrape' }, 200, true);
    } catch (err) {
      console.error('Scrape failed, falling back to cache:', { err });
      await store.delete('scrape-lock');
      return serveCached(store, err);
    }
  }

  // Non-cron: serve cached data
  return serveCached(store);
};

async function serveCached(store, err = null) {
  try {
    const cached = await store.get('latest', { type: 'json' });
    if (!cached) {
      return respond({
        games: [], rosters: {}, source: 'fallback',
        error: err ? String(err) : 'No cached data available'
      }, 503);
    }
    const age = Date.now() - new Date(cached.generated_at).getTime();
    const source = age < STALE_MS ? 'cache' : 'fallback';
    return respond({ ...cached, source });
  } catch (blobErr) {
    console.error('Blob read failed:', { blobErr });
    return respond({
      games: [], rosters: {}, source: 'fallback',
      error: err ? String(err) : String(blobErr)
    }, 503);
  }
}

function respond(body, status = 200, noCache = false) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': noCache ? 'no-cache' : 'public, max-age=3600'
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 0 — Dynamic sport discovery
// ---------------------------------------------------------------------------

async function discoverSports() {
  const res = await fetch(SITE);
  console.log(`Homepage fetch: ${res.status} ${res.statusText}, content-length: ${res.headers.get('content-length')}`);
  const html = await res.text();
  console.log(`Homepage HTML length: ${html.length}, first 200 chars: ${html.substring(0, 200)}`);
  const $ = cheerio.load(html);
  const seen = new Set();
  const sports = [];

  // Extract sport slugs from nav links to schedule-results pages
  $('a[href*="/varsity/"][href*="/schedule-results"]').each((_, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\/varsity\/([^/]+)\/schedule-results/);
    if (!match) return;
    const slug = match[1];
    if (seen.has(slug)) return;
    seen.add(slug);
    sports.push({ slug, name: $(el).text().trim() });
  });

  console.log(`Sport discovery found ${sports.length} sports: ${sports.map(s => s.slug).join(', ')}`);

  // For each sport, fetch its schedule page to get sportID + nonce
  const results = [];
  for (const sport of sports) {
    try {
      const pageHtml = await fetch(
        `${SITE}/varsity/${sport.slug}/schedule-results?hl=0`
      ).then(r => r.text());

      // sportID from the iCal subscribe link: sport_ids=21_0 → 21
      const idMatch = pageHtml.match(/sport_ids=(\d+)/);
      // sportID fallback from inline JS: '&sportID=' + "21"
      const idFallback = pageHtml.match(/sportID[^"]*"(\d+)"/);
      // Nonce from AJAX config
      const nonceMatch = pageHtml.match(/_ajax_nonce=([a-f0-9]+)/);

      const id = idMatch?.[1] || idFallback?.[1];
      const nonce = nonceMatch?.[1];

      if (id && nonce) {
        results.push({ slug: sport.slug, name: sport.name, id, nonce });
        console.log(`Discovered ${sport.slug}: sportID=${id}, nonce=${nonce}`);
      } else {
        console.warn(`Sport discovery: missing id/nonce for ${sport.slug}`, {
          id, nonce
        });
      }
    } catch (err) {
      console.warn(`Sport discovery: failed to fetch ${sport.slug}:`, { err });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Phase 1 — Schedule + dismissal times
// ---------------------------------------------------------------------------

async function fetchSchedule(sport, level) {
  const url = new URL(`${SITE}/wp-admin/admin-ajax.php`);
  url.searchParams.set('action', 'load_schedule_results_full');
  url.searchParams.set('level', level);
  url.searchParams.set('sportID', sport.id);
  url.searchParams.set('showRecord', 'yes');
  url.searchParams.set('school_id', SCHOOL_ID);
  url.searchParams.set('year', currentSchoolYear());
  url.searchParams.set('endpoint', 'https://www.homecampus.com/api');
  url.searchParams.set('show_team_events', '');
  url.searchParams.set('_ajax_nonce', sport.nonce);

  const res = await fetch(url.toString());
  const html = await res.text();

  // WordPress returns '0' or '-1' on auth/nonce failure
  if (!html || html.trim() === '0' || html.trim() === '-1') {
    console.warn(`AJAX nonce failure for ${sport.slug}/${level}: response="${html?.trim()}", nonce=${sport.nonce}`);
    return [];
  }

  // Log HTML length for debugging empty responses
  const parsed = parseScheduleHTML(html, sport, level);
  if (parsed.length === 0 && html.length > 100) {
    console.warn(`${sport.slug}/${level}: HTML returned (${html.length} chars) but 0 games parsed`);
  }
  return parsed;
}

function parseScheduleHTML(html, sport, level) {
  const $ = cheerio.load(html);
  const games = [];

  $('li[data-date]').each((_, el) => {
    const $li = $(el);
    const date = $li.attr('data-date');
    if (!date) return;

    const opponent = $li.find('.school p').first().text().trim();
    const vsText = $li.find('.vs').text().trim().toLowerCase();
    const home_away = vsText.startsWith('at') ? 'away' : 'home';
    const game_time = $li.find('.time strong').first().text().trim();

    // Dismissal time lives in the hoverModal div for this game
    let dismissal_time = null;
    const modalEl = $li.find('[id^="hoverModal_"]');
    if (modalEl.length) {
      const modalText = modalEl.text();
      const match = modalText.match(/Dismissal Time:\s*([0-9: APMapm]+)/i);
      if (match) dismissal_time = normalizeTime(match[1].trim());
    }

    games.push({
      date,
      sport_slug: sport.slug,
      sport_name: sport.name,
      level,
      opponent,
      home_away,
      game_time: normalizeTime(game_time),
      dismissal_time
    });
  });

  return games;
}

// ---------------------------------------------------------------------------
// Phase 2 — Rosters
// ---------------------------------------------------------------------------

async function fetchRoster(sport, level) {
  const levelPath = level.toLowerCase().replace(/\s+/g, '-');
  const url = `${SITE}/${levelPath}/${sport.slug}/roster`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const html = await res.text();
  return parseRosterHTML(html);
}

function parseRosterHTML(html) {
  const $ = cheerio.load(html);
  const players = [];
  const seenSlugs = new Set();

  $('a[href^="/player/"]').each((_, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\/player\/([^?]+)/);
    if (!match) return;

    let slug = match[1];

    // Filter WordPress soft-deletes
    if (slug.endsWith('__trashed')) return;

    // Dedupe by slug
    if (seenSlugs.has(slug)) return;
    seenSlugs.add(slug);

    const display_name = slugToName(slug);
    const jersey = $(el).find('p').first().text().trim() || null;

    players.push({ name_slug: slug, display_name, jersey });
  });

  return players;
}

function slugToName(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// iCal feed → today's sport slugs
// ---------------------------------------------------------------------------

const ICAL_URL = 'https://www.materdei.org/apps/events/ical/?id=33';

// Maps iCal SUMMARY prefixes to athletics site slugs.
// The core prefix (before @ or vs) determines the sport.
const ICAL_PREFIX_TO_SLUG = {
  'V Baseball':                 'baseball',
  'JV Red Baseball':            'baseball',
  'JV Gray Baseball':           'baseball',
  'FR Baseball':                'baseball',
  'V Basketball, Boys':         'basketball-boys',
  'JV Red Basketball, Boys':    'basketball-boys',
  'JV Gray Basketball, Boys':   'basketball-boys',
  'FR Basketball, Boys':        'basketball-boys',
  'V Basketball, Girls':        'basketball-girls',
  'JV Red Basketball, Girls':   'basketball-girls',
  'JV Gray Basketball, Girls':  'basketball-girls',
  'V Cross Country, Boys':      'cross-country-boys-2',
  'V Cross Country, Girls':     'cross-country-boys-2',
  'V Football':                 'football',
  'JV Red Football':            'football',
  'JV Gray Football':           'football',
  'FR Football':                'football',
  'V Golf, Boys':               'golf-boys',
  'V Golf, Girls':              'golf-girls',
  'V Lacrosse, Boys':           'lacrosse-boys-2',
  'JV Red Lacrosse, Boys':      'lacrosse-boys-2',
  'V Lacrosse, Girls':          'lacrosse-girls',
  'JV Red Lacrosse, Girls':     'lacrosse-girls',
  'V Soccer, Boys':             'soccer-boys',
  'JV Red Soccer, Boys':        'soccer-boys',
  'JV Gray Soccer, Boys':       'soccer-boys',
  'V Soccer, Girls':            'soccer-girls',
  'JV Red Soccer, Girls':       'soccer-girls',
  'JV Gray Soccer, Girls':      'soccer-girls',
  'V Softball':                 'softball',
  'JV Red Softball':            'softball',
  'V Swimming, Boys':           'swimming-diving-boys-3',
  'V Swimming, Girls':          'swimming-diving-girls',
  'V Tennis, Boys':              'tennis-boys',
  'V Tennis, Girls':             'tennis-girls',
  'V Track & Field, Boys':      'track-field-boys-3',
  'V Track & Field, Girls':     'track-field-boys-3',
  'V Volleyball, Boys':         'volleyball-boys',
  'JV Red Volleyball, Boys':    'volleyball-boys',
  'V Volleyball, Girls':        'volleyball-girls',
  'JV Red Volleyball, Girls':   'volleyball-girls',
  'JV Gray Volleyball, Girls':  'volleyball-girls',
  'V Water Polo, Boys':         'water-polo-boys',
  'JV Red Water Polo, Boys':    'water-polo-boys',
  'V Water Polo, Girls':        'water-polo-girls',
  'JV Red Water Polo, Girls':   'water-polo-girls',
  'V Wrestling':                'wrestling-boys',
  'V Beach Volleyball':         'beach-volleyball-girls',
  'V Flag Football':            'flag-football-girls',
  'V Competitive Cheer':        'traditional-competitive-cheer',
};

function icalPrefixToSlug(summary) {
  const core = summary.replace(/\s*[@(].*$/, '').replace(/\s+vs\.?\s+.*$/i, '').trim();
  if (ICAL_PREFIX_TO_SLUG[core]) return ICAL_PREFIX_TO_SLUG[core];
  for (const [prefix, slug] of Object.entries(ICAL_PREFIX_TO_SLUG)) {
    if (core.startsWith(prefix)) return slug;
  }
  return null;
}

/**
 * Fetch today's iCal events and return the set of sport slugs that have games.
 * Uses simple text parsing — no ical.js dependency needed server-side.
 */
async function getTodaysSportSlugs() {
  try {
    const res = await fetch(ICAL_URL);
    if (!res.ok) throw new Error(`iCal fetch: ${res.status}`);
    const text = await res.text();

    // Get today's date in YYYYMMDD format (Pacific time)
    const now = new Date();
    const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const y = pacific.getFullYear();
    const m = String(pacific.getMonth() + 1).padStart(2, '0');
    const d = String(pacific.getDate()).padStart(2, '0');
    const todayStr = `${y}${m}${d}`;

    // Simple line-by-line parse: find events with DTSTART matching today
    const slugs = new Set();
    const lines = text.split('\n');
    let currentSummary = null;
    let currentDateMatch = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('BEGIN:VEVENT')) {
        currentSummary = null;
        currentDateMatch = false;
      }
      if (trimmed.startsWith('DTSTART') && trimmed.includes(todayStr)) {
        currentDateMatch = true;
      }
      if (trimmed.startsWith('SUMMARY:')) {
        currentSummary = trimmed.slice(8).trim();
      }
      if (trimmed === 'END:VEVENT' && currentDateMatch && currentSummary) {
        const slug = icalPrefixToSlug(currentSummary);
        if (slug) slugs.add(slug);
      }
    }

    console.log(`iCal: found ${slugs.size} sports with games today: ${[...slugs].join(', ')}`);
    return slugs;
  } catch (err) {
    console.warn('iCal fetch failed, scraping all sports:', { err });
    return null; // null = scrape everything as fallback
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scrapeAll() {
  const todaySlugs = await getTodaysSportSlugs();
  const allSports = await discoverSports();
  console.log(`Discovered ${allSports.length} sports`);

  // Filter to only sports with games today (if iCal succeeded)
  const sports = todaySlugs
    ? allSports.filter(s => todaySlugs.has(s.slug))
    : allSports;
  console.log(`Scraping ${sports.length} sports${todaySlugs ? ' (filtered by iCal)' : ' (all — iCal unavailable)'}`);

  const games = [];
  const rosters = {};

  for (const sport of sports) {
    for (const level of LEVELS) {
      try {
        const schedule = await fetchSchedule(sport, level);
        if (schedule.length > 0) {
          console.log(`${sport.slug}/${level}: ${schedule.length} games`);
        }
        games.push(...schedule);

        // Only fetch roster if this level has games (saves requests)
        try {
          const roster = await fetchRoster(sport, level);
          if (roster.length > 0) {
            const key = `${sport.slug}_${level.toLowerCase().replace(/\s+/g, '_')}`;
            rosters[key] = roster;
          }
        } catch (err) {
          console.warn(`Roster fetch failed: ${sport.slug}/${level}`, { err });
        }
      } catch (err) {
        console.warn(`Schedule fetch failed: ${sport.slug}/${level}`, { err });
      }
    }
    await sleep(2000); // 2s pause between sports to avoid rate limiting
  }

  console.log(`Scraped ${games.length} games, ${Object.keys(rosters).length} rosters`);
  return { games, rosters, generated_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTime(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let [, h, min, period] = m;
  h = parseInt(h, 10);
  if (period?.toUpperCase() === 'PM' && h < 12) h += 12;
  if (period?.toUpperCase() === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}
