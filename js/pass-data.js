// js/pass-data.js — Fetch athletics-data JSON + Sheet overrides, merge, in-memory cache
// See BUILD.md Step 2 for full contract.

import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import { loadData } from './data.js';
import { todayString } from './pass-db.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ATHLETICS_DATA_URL = '/.netlify/functions/athletics-data';

// Google Sheet override tabs — update gid values when tabs are created
// These use the same Sheet as MD Today's schedule data, just different tabs.
const SPORT_DEFAULTS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=1365459934&single=true&output=csv';
const MANUAL_ROSTERS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=567893210&single=true&output=csv';
const GAME_OVERRIDES_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=1944365028&single=true&output=csv';

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000; // 36 hours

// ---------------------------------------------------------------------------
// iCal SUMMARY → scraper sport_slug mapping
// ---------------------------------------------------------------------------
// The iCal feed uses short-form SUMMARY prefixes like "V Baseball @ JSerra".
// The scraper uses URL slugs like "baseball". This table bridges the two.
// Translation lives HERE, not in the scraper (BUILD.md LOCK).
//
// Build by grepping: grep "SUMMARY:" calendar.ics | sort -u
// Only sports with possible dismissals need mapping.

const SUMMARY_TO_SLUG = {
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
  'V Cross Country, Boys':      'cross-country-boys',
  'V Cross Country, Girls':     'cross-country-girls',
  'V Football':                 'football',
  'JV Red Football':            'football',
  'JV Gray Football':           'football',
  'FR Football':                'football',
  'V Golf, Boys':               'golf-boys',
  'V Golf, Girls':              'golf-girls',
  'V Lacrosse, Boys':           'lacrosse-boys',
  'JV Red Lacrosse, Boys':      'lacrosse-boys',
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
  'V Swimming, Boys':           'swimming-boys',
  'V Swimming, Girls':          'swimming-girls',
  'V Tennis, Boys':             'tennis-boys',
  'V Tennis, Girls':            'tennis-girls',
  'V Track & Field, Boys':      'track-field-boys',
  'V Track & Field, Girls':     'track-field-girls',
  'V Volleyball, Boys':         'volleyball-boys',
  'JV Red Volleyball, Boys':    'volleyball-boys',
  'V Volleyball, Girls':        'volleyball-girls',
  'JV Red Volleyball, Girls':   'volleyball-girls',
  'JV Gray Volleyball, Girls':  'volleyball-girls',
  'V Water Polo, Boys':         'water-polo-boys',
  'JV Red Water Polo, Boys':    'water-polo-boys',
  'V Water Polo, Girls':        'water-polo-girls',
  'JV Red Water Polo, Girls':   'water-polo-girls',
  'V Wrestling':                'wrestling',
  'V Beach Volleyball':         'beach-volleyball',
  'V Flag Football':            'flag-football',
  'V Competitive Cheer':        'competitive-cheer',
  'V Boys Rugby':               'rugby',
};

// Reverse: extract level from iCal SUMMARY prefix
function extractLevel(summary) {
  if (/^V\s/i.test(summary)) return 'Varsity';
  if (/^JV Red\s/i.test(summary)) return 'JV Red';
  if (/^JV Gray\s/i.test(summary)) return 'JV Gray';
  if (/^FR\s/i.test(summary)) return 'Freshman';
  return 'Varsity'; // default
}

// Match iCal SUMMARY prefix to SUMMARY_TO_SLUG key
function summaryToSlug(summary) {
  // Try longest-prefix match: strip everything after @ or vs
  const core = summary.replace(/\s*[@(].*$/, '').replace(/\s+vs\.?\s+.*$/i, '').trim();
  if (SUMMARY_TO_SLUG[core]) return SUMMARY_TO_SLUG[core];

  // Fallback: try progressively shorter prefixes
  for (const [prefix, slug] of Object.entries(SUMMARY_TO_SLUG)) {
    if (core.startsWith(prefix)) return slug;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation gates — prevents poisoning UI with malformed Sheet rows
// ---------------------------------------------------------------------------

const isValidSportDefaultsRow = r => !!(r.sport_slug && r.level && r.default_dismissal_time);
const isValidManualRosterRow  = r => !!(r.sport_slug && r.level && r.display_name);
const isValidGameOverrideRow  = r => !!(r.date && r.sport_slug && r.dismissal_time);

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchAthleticsData() {
  const cacheKey = 'pass_athletics_data_cache';
  try {
    const res = await fetch(ATHLETICS_DATA_URL);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, fetchedAt: new Date().toISOString() }));
    } catch (e) { /* quota — non-fatal */ }
    return data;
  } catch (err) {
    console.warn('[pass-data] Athletics data fetch failed, using cache:', { err });
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached?.data) return { ...cached.data, _fromCache: true };
    } catch (e) { /* parse failure */ }
    return { games: [], rosters: {}, generated_at: null, source: 'fallback' };
  }
}

async function fetchSheetTab(url, validator) {
  const cacheKey = `pass_sheet_${url.match(/gid=([^&]+)/)?.[1] || 'unknown'}_cache`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const all = parsed.data || [];
    const valid = all.filter(validator);

    // If more than half the rows are invalid, something is wrong — use cache
    if (all.length > 0 && valid.length / all.length < 0.5) {
      console.warn(`[pass-data] Sheet tab has >50% invalid rows (${valid.length}/${all.length}), using cache`);
      throw new Error('Too many invalid rows');
    }

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data: valid, fetchedAt: new Date().toISOString() }));
    } catch (e) { /* quota */ }
    return { data: valid, fromCache: false };
  } catch (err) {
    console.warn(`[pass-data] Sheet tab fetch failed, using cache:`, { err });
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached?.data) return { data: cached.data, fromCache: true };
    } catch (e) { /* parse failure */ }
    return { data: [], fromCache: true };
  }
}

// ---------------------------------------------------------------------------
// iCal athletics event extraction
// ---------------------------------------------------------------------------

async function getTodaysAthleticsEvents() {
  const payload = await loadData();
  const today = todayString();
  if (!payload.events) return [];

  return payload.events
    .filter(ev => ev.date === today)
    .filter(ev => {
      // Athletics events match these patterns (from resolve.js exclusions)
      return /^V\s/i.test(ev.summary) ||
             /^JV\s/i.test(ev.summary) ||
             /^FR\s/i.test(ev.summary);
    })
    .map(ev => {
      const slug = summaryToSlug(ev.summary);
      const level = extractLevel(ev.summary);
      return {
        date: ev.date,
        summary: ev.summary,
        sport_slug: slug,
        level,
        sport_id: slug ? `${slug}_${level.toLowerCase().replace(/\s+/g, '_')}` : null,
      };
    });
}

// ---------------------------------------------------------------------------
// Merge logic (LOCK — see BUILD.md "Merge Order")
// ---------------------------------------------------------------------------

function resolveDismissalTime(game, { overrides, scraperGames, defaults }) {
  // 1. Per-game override wins
  const override = overrides.find(o =>
    o.date === game.date && o.sport_slug === game.sport_slug
  );
  if (override?.dismissal_time) return override.dismissal_time;

  // 2. Scraper value
  const scraperMatch = scraperGames.find(g =>
    g.date === game.date && g.sport_slug === game.sport_slug
  );
  if (scraperMatch?.dismissal_time) return scraperMatch.dismissal_time;

  // 3. Sport default
  const fallback = defaults.find(d =>
    d.sport_slug === game.sport_slug && d.level === game.level
  );
  if (fallback?.default_dismissal_time) return fallback.default_dismissal_time;

  // 4. Nothing found
  return null;
}

function attachEnrichment(icalEvent, { scraper, defaults, overrides, today }) {
  const scraperMatch = scraper.games.find(g =>
    g.date === today && g.sport_slug === icalEvent.sport_slug
  );

  return {
    ...icalEvent,
    opponent: scraperMatch?.opponent || '',
    home_away: scraperMatch?.home_away || null,
    game_time: scraperMatch?.game_time || null,
    dismissal_time: resolveDismissalTime(
      { date: today, sport_slug: icalEvent.sport_slug, level: icalEvent.level },
      { overrides, scraperGames: scraper.games, defaults }
    ),
    sport_name: scraperMatch?.sport_name || icalEvent.summary,
  };
}

// ---------------------------------------------------------------------------
// Roster resolution (LOCK — see BUILD.md)
// ---------------------------------------------------------------------------

function resolveRoster(sport_id, { scraper, manualRosters }) {
  // 1. Scraper wins if present
  const scraped = scraper.rosters?.[sport_id];
  if (scraped && scraped.length > 0) return scraped;

  // 2. Manual roster fallback
  if (!sport_id) return [];
  const parts = sport_id.split('_');
  // sport_slug might contain hyphens, level is the last 1-2 parts
  // e.g., "basketball-boys_jv_red" → slug="basketball-boys", level parts=["jv","red"]
  // We need to try different split points
  const manual = manualRosters.filter(r => {
    const rKey = `${r.sport_slug}_${r.level.toLowerCase().replace(/\s+/g, '_')}`;
    return rKey === sport_id;
  });

  if (manual.length > 0) {
    return manual.map(r => ({ display_name: r.display_name, name_slug: null, jersey: null }));
  }

  // 3. Empty
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get today's games with all enrichment merged.
 * Never throws. Returns a result object with staleness info.
 */
export async function getTodaysGames() {
  const [athleticsData, sportDefaults, manualRosters, gameOverrides, icalEvents] =
    await Promise.all([
      fetchAthleticsData(),
      fetchSheetTab(SPORT_DEFAULTS_CSV, isValidSportDefaultsRow),
      fetchSheetTab(MANUAL_ROSTERS_CSV, isValidManualRosterRow),
      fetchSheetTab(GAME_OVERRIDES_CSV, isValidGameOverrideRow),
      getTodaysAthleticsEvents(),
    ]);

  const today = todayString();

  // Merge iCal events with scraper enrichment
  const resolvedGames = icalEvents
    .filter(ev => ev.sport_slug) // skip unmapped sports
    .map(ev => attachEnrichment(ev, {
      scraper: athleticsData,
      defaults: sportDefaults.data,
      overrides: gameOverrides.data,
      today,
    }));

  // Also include scraper-only games not in iCal (scraper may have games iCal doesn't)
  const icalSlugs = new Set(resolvedGames.map(g => g.sport_slug));
  const scraperOnlyGames = (athleticsData.games || [])
    .filter(g => g.date === today && !icalSlugs.has(g.sport_slug))
    .map(g => ({
      ...g,
      sport_id: `${g.sport_slug}_${g.level.toLowerCase().replace(/\s+/g, '_')}`,
      dismissal_time: resolveDismissalTime(
        { date: today, sport_slug: g.sport_slug, level: g.level },
        { overrides: gameOverrides.data, scraperGames: athleticsData.games, defaults: sportDefaults.data }
      ),
    }));

  const allGames = [...resolvedGames, ...scraperOnlyGames];

  // Staleness check
  const staleness = athleticsData.generated_at
    ? Date.now() - new Date(athleticsData.generated_at).getTime()
    : Infinity;

  return {
    games: allGames,
    getRoster: (sport_id) => resolveRoster(sport_id, {
      scraper: athleticsData,
      manualRosters: manualRosters.data,
    }),
    isStale: staleness > STALE_THRESHOLD_MS,
    lastUpdated: athleticsData.generated_at,
  };
}
