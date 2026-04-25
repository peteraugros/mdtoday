// js/resolve.js
//
// The resolution pipeline — takes raw data from loadData() plus a date,
// returns a resolved view of that day with a trust state.
//
// See claude.md → "Core Modules → js/resolve.js" for the architectural
// contract, and → "Template Catalog → Monday Homeroom — resolver logic"
// for the Monday substitution rule.

import { isFresh } from './data.js';

// ---------------------------------------------------------------------------
// Constants — day-off detection
// ---------------------------------------------------------------------------
//
// Phrases in an event SUMMARY that indicate "school is not in session today."
// Matching is case-insensitive. Order matters only for the first match.
//
// Keep this list strict. False positives here (marking a real school day as
// a day off) are much worse than false negatives (a true day off leaking
// through and showing as Assumed, which is already a safe state).
//
// History: 'holiday' was removed 2026-04-20 because it matched sport events
// like "V Girls Basketball @ Portland Holiday Classic" and "V Girls Water
// Polo @ Holiday Cup" as false-positive day-offs. Every legitimate day-off
// in the Mater Dei feed is already covered by 'no school' or 'break', so
// 'holiday' was redundant as well as noisy. If a future school year adds
// day-off SUMMARYs that rely on 'holiday' alone, re-add it with a tighter
// pattern (e.g., /\bschool holiday\b/i).

const DAY_OFF_KEYWORDS = [
  'break',         // "Thanksgiving Break", "Winter Break", "Spring Break"
  'no school',     // "No School - MLK Day", "No School - MD Holiday"
  'no classes',
  'recess',
  'closed',
];

// ---------------------------------------------------------------------------
// Constants — announcement filtering
// ---------------------------------------------------------------------------
//
// Phrases that qualify an event as a genuine announcement — something that
// changes how a student should behave today compared to a normal day.
// See claude.md → "The announcement_text Rule" for the operational test.

const ANNOUNCEMENT_INCLUDE_KEYWORDS = [
  'mass',
  'rally',
  'exam',
  'testing',
  'dismissal',
  'late start',
  'minimum day',
  'assembly',
  'liturgy',
];

// ---------------------------------------------------------------------------
// Constants — spirit dress detection
// ---------------------------------------------------------------------------
//
// Events matching these patterns are spirit dress days. They are extracted
// (not excluded) and surfaced on the Upcoming view as a dedicated row.
// They remain excluded from announcements (see ANNOUNCEMENT_EXCLUDE_PATTERNS).

const SPIRIT_DRESS_PATTERNS = [
  /spirit (week|day|bottoms|dress)/i,  // "Spirit Day - Hawaiian", "Spirit Week", "Spirit Bottoms"
  /^Special Dress/i,                    // "Special Dress - Red, White & Blue"
];

/**
 * Clean a spirit dress SUMMARY into just the theme.
 *
 * Examples:
 *   "Special Dress - Red, White & Blue"  → "Red, White & Blue"
 *   "Spirit Day - Hawaiian"              → "Hawaiian"
 *   "Spirit Week - Pajama Day"           → "Pajama Day"
 *   "Spirit Bottoms"                     → "Spirit Bottoms"  (no dash → keep as-is)
 */
function cleanSpiritDressTheme(summary) {
  // Strip prefix up to and including " - " or " — "
  const dashIdx = summary.search(/\s[-\u2014]\s/);
  if (dashIdx !== -1) {
    return summary.slice(dashIdx).replace(/^\s[-\u2014]\s/, '').trim();
  }
  return summary.trim();
}

// Phrases that explicitly disqualify events even if they match an include.
// Applied after includes — an event that matches both is excluded.
const ANNOUNCEMENT_EXCLUDE_PATTERNS = [
  /^V\s+(Boys|Girls)\s+/i,                  // Varsity sports: "V Boys Basketball..."
  /^(Boys|Girls)\s+.*@/i,                   // Sports games
  /^JV\s+/i,
  /banquet/i,
  /fundraiser/i,
  /reunion/i,
  /^Special Dress/i,                        // "Special Dress - Red, White..."
  /spirit (week|day|bottoms)/i,
  /alumni/i,
  /^CIF /i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as YYYY-MM-DD using local time.
 *
 * Important: we use LOCAL date (not UTC) because the school runs on local
 * time and the iCal feed uses local date-only events. Using UTC would put
 * events on the wrong day for anyone west of UTC after 4pm local time.
 */
function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check whether a SUMMARY matches any day-off keyword.
 */
function isDayOffSummary(summary) {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  return DAY_OFF_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Check whether an event SUMMARY qualifies as an announcement.
 *
 * Must match at least one include keyword AND must not match any exclude pattern.
 */
function isAnnouncementSummary(summary) {
  if (!summary) return false;

  // Exclude first — faster short-circuit
  for (const pattern of ANNOUNCEMENT_EXCLUDE_PATTERNS) {
    if (pattern.test(summary)) return false;
  }

  const lower = summary.toLowerCase();
  return ANNOUNCEMENT_INCLUDE_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Build the blocks array for a given template_id from the templates rows.
 * Returns blocks sorted by (block_order, track) for deterministic rendering.
 */
function getBlocksForTemplate(templates, templateId) {
  return templates
    .filter(row => row.template_id === templateId)
    .sort((a, b) => {
      if (a.block_order !== b.block_order) return a.block_order - b.block_order;
      // Within same block_order, put 'upper' before 'lower' before null
      const trackOrder = { upper: 0, lower: 1 };
      const aOrder = trackOrder[a.track] ?? 2;
      const bOrder = trackOrder[b.track] ?? 2;
      return aOrder - bOrder;
    });
}

/**
 * Build a human-readable day label from the original SUMMARY.
 *
 * Examples:
 *   "RED: B. 1, 3, 5, 7"                → "Red Day"
 *   "GRAY (Late Start): B. 2, 4, 6, 8"  → "Gray Day — Late Start"
 *   "RED (Mass Schedule): B. 1, 3, 5, 7" → "Red Day — Mass"
 *
 * Monday-substituted days get "Monday Red" / "Monday Gray".
 */
function buildDayLabel(summary, isMondaySubstitution) {
  if (!summary) return '';

  // Extract color prefix
  const colorMatch = summary.match(/^(RED|GRAY)/i);
  const color = colorMatch ? colorMatch[1].charAt(0).toUpperCase() + colorMatch[1].slice(1).toLowerCase() : null;

  // Extract qualifier in parentheses
  const qualifierMatch = summary.match(/\(([^)]+)\)/);
  const qualifier = qualifierMatch ? qualifierMatch[1].replace(/\s+Schedule$/i, '').trim() : null;

  if (isMondaySubstitution && color) {
    return `Monday ${color}`;
  }
  if (color && qualifier) {
    return `${color} Day — ${qualifier}`;
  }
  if (color) {
    return `${color} Day`;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a day's schedule from the data object.
 *
 * Trust state is determined by this function and this function alone.
 * See claude.md → "The three trust states" for the rules.
 *
 * @param {Object} data     The payload returned by loadData()
 * @param {Date} date       Optional — defaults to now
 * @returns {Object} resolved day object
 */
export function resolveDay(data, date = new Date()) {
  const dateStr = toLocalDateString(date);
  const isMonday = date.getDay() === 1;

  // --- Empty payload → offline ---
  if (!data || data.source === 'none') {
    return {
      template: null,
      templateId: null,
      announcement: null,
      isDayOff: false,
      dayOffLabel: null,
      dayLabel: '',
      trustState: 'offline',
      unmatchedSummary: null,
    };
  }

  // --- Find today's events ---
  const todayEvents = (data.events || []).filter(e => e.date === dateStr);

  // --- Day off detection ---
  const dayOffEvent = todayEvents.find(e => isDayOffSummary(e.summary));
  if (dayOffEvent) {
    return {
      template: null,
      templateId: null,
      announcement: null,
      isDayOff: true,
      dayOffLabel: dayOffEvent.summary,
      dayLabel: dayOffEvent.summary,
      trustState: isFresh(data.lastFetch) ? 'confirmed' : 'stale',
      unmatchedSummary: null,
    };
  }

  // --- Look up the schedule event for today ---
  // A "schedule event" is one whose SUMMARY matches summary_map. There should
  // be at most one per day.
  const summaryMap = data.summaryMap || [];
  const summaryToTemplate = new Map(
    summaryMap.map(row => [row.calendar_summary, row.template_id])
  );

  let scheduleEvent = null;
  let templateId = null;
  let unmatchedSummary = null;

  for (const event of todayEvents) {
    if (summaryToTemplate.has(event.summary)) {
      scheduleEvent = event;
      templateId = summaryToTemplate.get(event.summary);
      break;
    }
  }

  // Nothing matched — but were there events that LOOK like schedule events?
  // Any event with a "RED" or "GRAY" prefix is likely a schedule event we
  // just haven't mapped. Log it so the maintainer can fix summary_map.
  if (!scheduleEvent) {
    const likelyScheduleEvent = todayEvents.find(e =>
      /^(RED|GRAY)/i.test(e.summary)
    );
    if (likelyScheduleEvent) {
      unmatchedSummary = likelyScheduleEvent.summary;
    }
  }

  // --- Apply Monday substitution (see claude.md → Monday Homeroom rule) ---
  let finalTemplateId = templateId;
  let mondaySubstituted = false;
  if (isMonday && (templateId === 'red_regular' || templateId === 'gray_regular')) {
    finalTemplateId = 'monday_homeroom';
    mondaySubstituted = true;
  }

  // --- Resolve announcement (first qualifying non-schedule event) ---
  // Skip ANY event whose SUMMARY is in the summary_map — not just the one
  // we picked as scheduleEvent. On pair days, two schedule events exist for
  // the same date (e.g., pair_early + pair_late). Without this guard, the
  // second schedule event leaks into the announcement banner because its
  // SUMMARY contains keywords like "dismissal" or "late start."
  let announcement = null;
  for (const event of todayEvents) {
    if (summaryToTemplate.has(event.summary)) continue;
    if (isAnnouncementSummary(event.summary)) {
      announcement = event.summary;
      break;
    }
  }

  // --- No schedule event found → Assumed state ---
  if (!scheduleEvent) {
    return {
      template: null,
      templateId: null,
      announcement,
      isDayOff: false,
      dayOffLabel: null,
      dayLabel: '',
      trustState: 'assumed',
      unmatchedSummary,
    };
  }

  // --- Friday: remove Office Hour blocks (never on Fridays) ---
  const isFriday = date.getDay() === 5;

  // --- Build the resolved template ---
  let blocks = getBlocksForTemplate(data.templates || [], finalTemplateId);
  if (isFriday) {
    blocks = blocks.filter(b => !/office\s*hour/i.test(b.block_name));
  }

  if (blocks.length === 0) {
    // summary_map pointed at a template_id that doesn't exist in templates.
    // This is a validation failure that sheet validation should have caught,
    // but degrade gracefully.
    console.warn(`[resolve] template_id '${finalTemplateId}' has no blocks in templates tab`);
    return {
      template: null,
      templateId: finalTemplateId,
      announcement,
      isDayOff: false,
      dayOffLabel: null,
      dayLabel: buildDayLabel(scheduleEvent.summary, mondaySubstituted),
      trustState: 'assumed',
      unmatchedSummary: scheduleEvent.summary,
    };
  }

  // --- Determine trust state ---
  // See claude.md → "Data freshness horizon" + "Offline vs. trust state"
  const trustState = isFresh(data.lastFetch) ? 'confirmed' : 'stale';

  return {
    template: { template_id: finalTemplateId, blocks },
    templateId: finalTemplateId,
    announcement,
    isDayOff: false,
    dayOffLabel: null,
    dayLabel: buildDayLabel(scheduleEvent.summary, mondaySubstituted),
    trustState,
    unmatchedSummary: null,
  };
}

// ---------------------------------------------------------------------------
// Spirit dress extraction (used by upcoming-view.js)
// ---------------------------------------------------------------------------

/**
 * Return cleaned spirit dress themes for a given date.
 *
 * @param {Object} data   The payload from loadData()
 * @param {Date}   date   The date to check
 * @returns {string[]}    Array of cleaned theme strings (empty if none)
 */
export function getSpiritDressEvents(data, date) {
  if (!data || !data.events) return [];

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  const themes = [];
  for (const event of data.events) {
    if (event.date !== dateStr) continue;
    if (SPIRIT_DRESS_PATTERNS.some(p => p.test(event.summary))) {
      themes.push(cleanSpiritDressTheme(event.summary));
    }
  }
  return themes;
}