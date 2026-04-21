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
//
// These functions do not decide correctness. They just clean up the kinds of
// small human errors that would otherwise make valid data look invalid:
// extra whitespace, mixed time formats, inconsistent casing.
//
// Principle: assume the source is always slightly wrong. Sanitizers make
// those small wrongnesses not matter. Validators catch the ones that do.

/**
 * Normalize an iCal SUMMARY string for use as a summary_map lookup key.
 *
 * The real Mater Dei feed has some SUMMARY values with leading whitespace
 * (`"   RED: B. 1, 3, 5, 7"`). Trimming and collapsing internal whitespace
 * makes these match the sheet rows cleanly.
 *
 * Case is preserved — the summary_map uses the calendar's own casing.
 */
export function sanitizeSummary(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().replace(/\s+/g, ' ');
  }
  
  /**
   * Normalize a time string to canonical `HH:MM` 24-hour form.
   *
   * Accepts: `8:00`, `08:00`, `8:00 AM`, `12:45 PM`, `  9:15 `, etc.
   * Returns: `08:00`, `08:00`, `08:00`, `12:45`, `09:15`
   *
   * Returns null if the input can't be parsed as a time. Callers decide
   * whether null is acceptable or a validation error.
   */
  export function sanitizeTime(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
  
    // Match "H:MM" or "HH:MM" optionally followed by AM/PM (case-insensitive)
    const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return null;
  
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const meridiem = match[3]?.toUpperCase();
  
    if (minute < 0 || minute > 59) return null;
    if (hour < 0 || hour > 23) return null;
  
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  
  /**
   * Clean the raw parsed rows from the templates CSV.
   *
   * Drops rows that are entirely empty. Trims text fields. Normalizes time
   * formats. Lowercases template_id and track (summary_map references are
   * lowercased too, so matching stays consistent).
   *
   * Returns an array of cleaned row objects. Does not validate referential
   * integrity — that's validateSheet's job.
   */
  export function sanitizeTemplatesRows(rows) {
    if (!Array.isArray(rows)) return [];
  
    return rows
      .filter(row => {
        // Drop rows where every field is blank/whitespace
        return Object.values(row).some(v => typeof v === 'string' && v.trim() !== '');
      })
      .map(row => ({
        template_id: (row.template_id || '').trim().toLowerCase(),
        block_order: parseInt(row.block_order, 10),
        block_name: (row.block_name || '').trim(),
        start_time: sanitizeTime(row.start_time),
        end_time: sanitizeTime(row.end_time),
        track: (row.track || '').trim().toLowerCase() || null,
      }));
  }
  
  /**
   * Clean the raw parsed rows from the summary_map CSV.
   *
   * Trims both columns. Preserves case on calendar_summary (the feed's casing
   * is the key — don't lowercase). Lowercases template_id to match the
   * normalized template_id in sanitizeTemplatesRows.
   */
  export function sanitizeSummaryMapRows(rows) {
    if (!Array.isArray(rows)) return [];
  
    return rows
      .filter(row => {
        return Object.values(row).some(v => typeof v === 'string' && v.trim() !== '');
      })
      .map(row => ({
        calendar_summary: sanitizeSummary(row.calendar_summary),
        template_id: (row.template_id || '').trim().toLowerCase(),
      }));
  }

// ---------------------------------------------------------------------------
// Validators (protect system — throw on structural errors)
// ---------------------------------------------------------------------------

// TODO: validateSheet

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// TODO: loadData()