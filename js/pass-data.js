// js/pass-data.js — Fetch athletics-data JSON + Sheet overrides, merge, in-memory cache
// See BUILD.md Step 2 for full contract.

import Papa from '../vendor/papaparse.esm.js';
import { loadData } from './data.js';
import { todayString } from './pass-db.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ATHLETICS_DATA_URL = '/.netlify/functions/athletics-data';

// Google Sheet override tabs — update gid values when tabs are created
// These use the same Sheet as MD Today's schedule data, just different tabs.
const SPORT_DEFAULTS_CSV = '/.netlify/functions/sheets?tab=sport_defaults';
const MANUAL_ROSTERS_CSV = '/.netlify/functions/sheets?tab=manual_rosters';
const GAME_OVERRIDES_CSV = '/.netlify/functions/sheets?tab=game_overrides';

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

// Prefix format matches the iCal feed: "V Boys Basketball", "V Girls Soccer", etc.
// Verified against live feed 2026-04-27.
const SUMMARY_TO_SLUG = {
  // Baseball / Softball / Football (no gender word in iCal)
  'V Baseball':                 'baseball',
  'V Softball':                 'softball',
  'V Football':                 'football',
  // Basketball
  'V Boys Basketball':          'basketball-boys',
  'V Girls Basketball':         'basketball-girls',
  // Soccer
  'V Boys Soccer':              'soccer-boys',
  'V Girls Soccer':             'soccer-girls',
  // Lacrosse
  'V Boys Lacrosse':            'lacrosse-boys',
  'V Girls Lacrosse':           'lacrosse-girls',
  // Volleyball
  'V Boys Volleyball':          'volleyball-boys',
  'V Girls Volleyball':         'volleyball-girls',
  // Water Polo
  'V Boys Water Polo':          'water-polo-boys',
  'V Girls Water Polo':         'water-polo-girls',
  // Tennis
  'V Boys Tennis':              'tennis-boys',
  'V Girls Tennis':             'tennis-girls',
  // Golf
  'V Boys Golf':                'golf-boys',
  'V Girls Golf':               'golf-girls',
  // Swimming / Diving
  'V Boys Swim':                'swimming-boys',
  'V Girls Swim':               'swimming-girls',
  'V Boys & Girls Swim':        'swimming-boys',
  'V Boys & Girls Dive':        'swimming-boys',
  'V Girls Dive':               'swimming-girls',
  // Track & Field
  'V Boys Track & Field':       'track-field-boys',
  'V Girls Track & Field':      'track-field-girls',
  'V Track & Field':            'track-field-boys',
  // Cross Country
  'V Cross Country':            'cross-country-boys',
  'V Girls Cross Country':      'cross-country-girls',
  // Wrestling
  'V Boys Wrestling':           'wrestling',
  'V Girls Wrestling':          'wrestling',
  'V Boys & Girls Wrestling':   'wrestling',
  // Beach Volleyball / Flag Football / Cheer
  'V Girls Beach Volleyball':   'beach-volleyball',
  'V Girls Flag Football':      'flag-football',
  'V Cheer':                    'competitive-cheer',
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
