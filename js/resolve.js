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
    return `Homeroom Day \u2014 ${color} Day`;
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

  const dateStr = toLocalDateString(date);
  const themes = [];
  for (const event of data.events) {
    if (event.date !== dateStr) continue;
    if (SPIRIT_DRESS_PATTERNS.some(p => p.test(event.summary))) {
      themes.push(cleanSpiritDressTheme(event.summary));
    }
  }
  return themes;
}

// ---------------------------------------------------------------------------
// Now-state resolver — base state + override (see state_spec.md)
// ---------------------------------------------------------------------------
//
// Base states: SCHOOL_DAY, WEEKEND, BREAK, SINGLE_HOLIDAY
// Overrides:   TRANSITION (LIVE_EVENT deferred to v2)
//
// Break detection: a non-school stretch with ≥2 weekday day-offs is a BREAK.
// This correctly classifies Thanksgiving (Thu+Fri off), Christmas (multi-week),
// and weekend days sandwiched between holidays, while keeping normal weekends
// and single-day holidays distinct.

/**
 * Determine the base calendar state for a date.
 */
function getBaseState(data, date) {
  const resolved = resolveDay(data, date);
  const dow = date.getDay();
  const isWeekendDay = dow === 0 || dow === 6;

  // Has a schedule event → SCHOOL_DAY
  if (resolved.template) return 'SCHOOL_DAY';

  // Day-off event exists
  if (resolved.isDayOff) {
    return isPartOfBreak(data, date) ? 'BREAK' : 'SINGLE_HOLIDAY';
  }

  // Weekend with no events
  if (isWeekendDay) {
    return isPartOfBreak(data, date) ? 'BREAK' : 'WEEKEND';
  }

  // Weekday, no schedule event, no day-off event → SCHOOL_DAY (assumed state)
  return 'SCHOOL_DAY';
}

/**
 * Check if a date is part of a multi-day non-school stretch.
 *
 * Walks backward and forward from the date, collecting contiguous non-school
 * days (weekends + weekday day-offs). If the stretch contains ≥2 weekday
 * day-offs, everything in the stretch is BREAK.
 *
 * This means:
 * - Fri-off + Sat + Sun + Mon-off → BREAK (sandwiched, 2 weekday day-offs)
 * - Single Tuesday off → SINGLE_HOLIDAY (1 weekday day-off)
 * - Normal Sat + Sun → WEEKEND (0 weekday day-offs)
 * - Thanksgiving Thu+Fri → BREAK (2 weekday day-offs), Sat+Sun also BREAK
 */
function isPartOfBreak(data, date) {
  const events = data.events || [];

  function isNonSchoolDate(d) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return true;
    const ds = toLocalDateString(d);
    return events.some(e => e.date === ds && isDayOffSummary(e.summary));
  }

  function isWeekdayDayOff(d) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return false;
    const ds = toLocalDateString(d);
    return events.some(e => e.date === ds && isDayOffSummary(e.summary));
  }

  let weekdayDayOffs = 0;
  if (isWeekdayDayOff(date)) weekdayDayOffs++;

  // Walk backward (cap at 60 days for safety — summer break)
  const back = new Date(date);
  for (let i = 0; i < 60; i++) {
    back.setDate(back.getDate() - 1);
    if (!isNonSchoolDate(back)) break;
    if (isWeekdayDayOff(back)) weekdayDayOffs++;
  }

  // Walk forward
  const fwd = new Date(date);
  for (let i = 0; i < 60; i++) {
    fwd.setDate(fwd.getDate() + 1);
    if (!isNonSchoolDate(fwd)) break;
    if (isWeekdayDayOff(fwd)) weekdayDayOffs++;
  }

  return weekdayDayOffs >= 2;
}

/**
 * Find the next school day after the given date.
 * Returns null if none found within 30 days.
 */
function getNextSchoolDay(data, date) {
  const summaryMap = data.summaryMap || [];
  const summaryToTemplate = new Map(
    summaryMap.map(row => [row.calendar_summary, row.template_id])
  );

  const cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let i = 0; i < 30; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const dateStr = toLocalDateString(cursor);

    const scheduleEvent = (data.events || []).find(
      e => e.date === dateStr && summaryToTemplate.has(e.summary)
    );

    if (scheduleEvent) {
      const futureDate = new Date(cursor);
      const resolved = resolveDay(data, futureDate);
      const spiritDress = getSpiritDressEvents(data, futureDate);
      return {
        date: futureDate,
        dateStr,
        dayLabel: resolved.dayLabel,
        summary: scheduleEvent.summary,
        spiritDress,
      };
    }
  }

  return null;
}


/**
 * Get the final bell time (end of last block) for a date, in minutes since midnight.
 * Returns null if no template or no blocks.
 */
function getFinalBellMinutes(data, date) {
  const resolved = resolveDay(data, date);
  if (!resolved.template || !resolved.template.blocks || resolved.template.blocks.length === 0) {
    return null;
  }
  let max = 0;
  for (const block of resolved.template.blocks) {
    const [h, m] = block.end_time.split(':').map(Number);
    const mins = h * 60 + m;
    if (mins > max) max = mins;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Marquee event detection — Friday evening Tier A sports
// ---------------------------------------------------------------------------

const MARQUEE_SPORTS = new Map([
  ['football',   '\uD83C\uDFC8'],  // 🏈
  ['baseball',   '\u26BE'],         // ⚾
  ['softball',   '\uD83E\uDD4E'],  // 🥎
  ['basketball', '\uD83C\uDFC0'],  // 🏀
  ['soccer',     '\u26BD'],         // ⚽
  ['lacrosse',   '\uD83E\uDD4D'],  // 🥍
]);

/**
 * Parse a varsity Big Five sports event from a raw SUMMARY.
 * Returns { emoji, sport, sportKey, opponent, home } or null.
 */
function parseMarqueeEvent(summary) {
  if (!summary || !/^V\s/i.test(summary)) return null; // Varsity only

  let rest = summary.replace(/^V\s+/i, '');

  // Extract opponent and home/away
  let teamPart, opponent = '', home = false;
  const awayMatch = rest.match(/^(.+?)\s+@\s+(.+)$/);
  const homeMatch = rest.match(/^(.+?)\s+vs\.?\s+(.+)$/i);

  if (awayMatch) {
    teamPart = awayMatch[1].trim();
    opponent = awayMatch[2].trim();
  } else if (homeMatch) {
    teamPart = homeMatch[1].trim();
    opponent = homeMatch[2].trim();
    home = true;
  } else {
    teamPart = rest;
  }

  // Strip gender prefix to get sport key
  const sportKey = teamPart.replace(/^(Boys|Girls)\s+/i, '').toLowerCase();
  const emoji = MARQUEE_SPORTS.get(sportKey);
  if (!emoji) return null;

  return { emoji, sport: teamPart, sportKey, opponent, home };
}

/**
 * Find marquee (Big Five varsity) sports events for a given date.
 * Sorted by start time descending — latest = primary (index 0).
 */
function getMarqueeEvents(data, date) {
  const dateStr = toLocalDateString(date);
  const marquee = [];

  for (const event of (data.events || [])) {
    if (event.date !== dateStr) continue;
    const info = parseMarqueeEvent(event.summary);
    if (!info) continue;
    marquee.push({ ...info, time: event.time || null, raw: event.summary });
  }

  // Latest start time = primary (index 0)
  marquee.sort((a, b) => {
    const timeA = a.time ? parseInt(a.time.replace(':', ''), 10) : 0;
    const timeB = b.time ? parseInt(b.time.replace(':', ''), 10) : 0;
    return timeB - timeA;
  });

  return marquee;
}

/**
 * Check if the next school day is within a given number of hours from now.
 */
function isNextSchoolWithinHours(nextSchool, date, hours) {
  const nextMidnight = new Date(nextSchool.date);
  nextMidnight.setHours(0, 0, 0, 0);
  const hoursUntil = (nextMidnight.getTime() - date.getTime()) / (1000 * 60 * 60);
  return hoursUntil > 0 && hoursUntil <= hours;
}

/**
 * Resolve the Now view's display state.
 *
 * Returns { base, override, nextSchoolDay, marqueeEvents? } where:
 *   base:          'SCHOOL_DAY' | 'WEEKEND' | 'BREAK' | 'SINGLE_HOLIDAY'
 *   override:      'TRANSITION' | 'POST_SCHOOL' | 'MARQUEE_NIGHT' | null
 *   nextSchoolDay: { date, dateStr, dayLabel, summary, spiritDress } | null
 *   marqueeEvents: Array (only present on Friday WEEKEND)
 *
 * Triggers:
 *   Trigger 1 (non-school-day evenings):
 *     base ∈ {WEEKEND, BREAK, SINGLE_HOLIDAY} AND hour >= 17
 *     AND nextSchoolDay within 18h → TRANSITION
 *
 *   Trigger 2 (weeknight Mon-Thu, 5pm+):
 *     base == SCHOOL_DAY AND hour >= 17 AND not Friday
 *     AND nextSchoolDay within 18h → TRANSITION
 *
 *   Friday evening (after final bell):
 *     base == SCHOOL_DAY AND Friday AND now >= finalBell
 *     → WEEKEND base, MARQUEE_NIGHT if Big Five sports tonight
 *
 * POST_SCHOOL:
 *   base == SCHOOL_DAY AND hour >= 17 AND not Friday
 *   AND (no nextSchoolDay OR nextSchoolDay > 18h)
 */
export function resolveNowState(data, date = new Date()) {
  if (!data || data.source === 'none') {
    return { base: 'SCHOOL_DAY', override: null, nextSchoolDay: null };
  }

  const base = getBaseState(data, date);

  // --- SCHOOL_DAY evening checks ---
  if (base === 'SCHOOL_DAY') {
    const dow = date.getDay();
    const isFriday = dow === 5;
    const nowMinutes = date.getHours() * 60 + date.getMinutes();

    // Friday after final bell → WEEKEND immediately (no 5pm wait)
    if (isFriday) {
      const finalBell = getFinalBellMinutes(data, date);
      if (finalBell && nowMinutes >= finalBell) {
        const nextSchool = getNextSchoolDay(data, date);
        const marqueeEvents = getMarqueeEvents(data, date);
        return {
          base: 'WEEKEND',
          override: marqueeEvents.length > 0 ? 'MARQUEE_NIGHT' : null,
          nextSchoolDay: nextSchool,
          marqueeEvents,
        };
      }
      return { base, override: null, nextSchoolDay: null };
    }

    // Mon-Thu after 5pm → TRANSITION / POST_SCHOOL
    if (date.getHours() >= 17) {
      const nextSchool = getNextSchoolDay(data, date);
      if (nextSchool && isNextSchoolWithinHours(nextSchool, date, 18)) {
        return { base, override: 'TRANSITION', nextSchoolDay: nextSchool };
      }
      return { base, override: 'POST_SCHOOL', nextSchoolDay: null };
    }

    return { base, override: null, nextSchoolDay: null };
  }

  // --- Non-school-day: check for evening TRANSITION (Trigger 1) ---
  const nextSchool = getNextSchoolDay(data, date);

  if (nextSchool && date.getHours() >= 17 && isNextSchoolWithinHours(nextSchool, date, 18)) {
    return { base, override: 'TRANSITION', nextSchoolDay: nextSchool };
  }

  return { base, override: null, nextSchoolDay: nextSchool };
}