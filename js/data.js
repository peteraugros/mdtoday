// js/data.js
//
// Responsibilities:
//   - Fetch the Mater Dei iCal feed, parse with ical.js
//   - Fetch the two published Google Sheet CSVs, parse with PapaParse
//   - Run sanitize + validate pipelines on each source
//   - Cache to localStorage on success; read from localStorage on failure
//   - Return a normalized data object tagged with a trust state
//
// See claude.md → "Data Sources" and "Core Modules → js/data.js"
// for the architectural contract.

// ---------------------------------------------------------------------------
// CDN imports
// ---------------------------------------------------------------------------
// PapaParse for CSV parsing (45KB, handles escaped quotes + commas correctly)
// ical.js for iCal parsing (handles timezones, escapes, folded lines, RRULEs)

import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import ICAL from 'https://cdn.jsdelivr.net/npm/ical.js@1.5.0/+esm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Data source URLs
// See claude.md → "Data Sources → Live URLs (v1)"
//
// NOTE: The iCal URL is year-scoped. Check each June whether Mater Dei has
// rolled over to the next school year's calendar (id may change).
export const ICAL_URL = 'https://www.materdei.org/apps/events/ical/?id=33';

export const TEMPLATES_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=0&single=true&output=csv';

export const SUMMARY_MAP_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=504710999&single=true&output=csv';

// localStorage key for the cached parsed payload
const CACHE_KEY = 'mdtoday_data_v1';

// Freshness horizon — data older than this forces Stale trust state at resolve time,
// even if the fetch technically succeeded. See claude.md → "Data freshness horizon".
export const FRESHNESS_HORIZON_MS = 12 * 60 * 60 * 1000; // 12 hours

// ---------------------------------------------------------------------------
// Freshness helper
// ---------------------------------------------------------------------------

export function isFresh(lastFetchISO) {
  if (!lastFetchISO) return false;
  const age = Date.now() - new Date(lastFetchISO).getTime();
  return age < FRESHNESS_HORIZON_MS;
}

// ---------------------------------------------------------------------------
// Sanitizers (protect UX — normalize human inconsistency, cannot fail)
// ---------------------------------------------------------------------------

// TODO: sanitizeSummary, sanitizeTemplates, sanitizeSummaryMap

// ---------------------------------------------------------------------------
// Validators (protect system — throw on structural errors)
// ---------------------------------------------------------------------------

// TODO: validateSheet

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// TODO: loadData()