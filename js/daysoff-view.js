// js/daysoff-view.js
//
// Entry point for daysoff.html — renders upcoming day-off events as a
// static list. No countdown subscription, no tick — paints once on load.
//
// See claude.md → "Phase 5: Days Off + polish" for the contract.
//
// Design (per Phase 5 plan):
//   - Static render only. Same discipline as the Schedule view.
//   - Trust state banner reused from the other views.
//   - Filters to future day-offs only (date >= today).
//   - Groups consecutive same-SUMMARY day-offs into date ranges.
//     Weekend-aware: a Sat/Sun gap between two runs of the same SUMMARY
//     (e.g., "No School - Christmas Break" Dec 22–26 + Dec 29) does NOT
//     split the group — weekends are treated as already-not-school.
//   - Single-day events render without a range.
//
// The day-off keyword list mirrors DAY_OFF_KEYWORDS in resolve.js. They
// must stay in sync — if this list changes, update resolve.js (and vice
// versa). A shared constants module is logged as a v2 dedupe candidate.

import { loadData } from './data.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const els = {
  headerDate: $('header-date'),

  validity: $('validity'),
  validityIcon: $('validity-icon'),
  validityTitle: $('validity-title'),
  validityDetail: $('validity-detail'),

  daysoffList: $('daysoff-list'),
  daysoffEmpty: $('daysoff-empty'),
  daysoffEmptyText: $('daysoff-empty-text'),
};

// ---------------------------------------------------------------------------
// Constants — day-off detection (mirrors resolve.js)
// ---------------------------------------------------------------------------
//
// MUST stay identical to DAY_OFF_KEYWORDS in resolve.js. See the history
// note in that file — 'holiday' was removed 2026-04-20 due to sport-event
// false positives ("Holiday Cup", "Holiday Classic").

const DAY_OFF_KEYWORDS = [
  'break',
  'no school',
  'no classes',
  'recess',
  'closed',
];

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const HEADER_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric',
});

// "Mon, Nov 24"
const SHORT_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric',
});

// "Nov 24" (for range endpoints where weekday is redundant)
const NO_WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric',
});

function relativeTimeAgo(iso) {
  if (!iso) return 'just now';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Parse YYYY-MM-DD as a local-time Date at midnight. iCal date-only events
 * come in as YYYY-MM-DD strings; naive `new Date(str)` parses them as UTC,
 * which shifts a day in the wrong direction west of UTC.
 */
function parseLocalDate(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Format a Date as YYYY-MM-DD using local time. Matches toLocalDateString
 * in resolve.js.
 */
function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return a new Date one day after the given date (local time). Used when
 * walking date ranges to check contiguity.
 */
function nextDay(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * True if a Date falls on Saturday (6) or Sunday (0).
 */
function isWeekend(date) {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

/**
 * Strip any surrounding "No School - " prefix from a SUMMARY for display.
 * Leaves SUMMARYs that don't start with that prefix alone.
 *   "No School - Thanksgiving Break" → "Thanksgiving Break"
 *   "No School - MD Holiday"         → "MD Holiday"
 *   "Winter Break"                   → "Winter Break"
 */
function cleanLabel(summary) {
  return summary.replace(/^No School\s*[-—]\s*/i, '').trim();
}

// ---------------------------------------------------------------------------
// Day-off detection + grouping
// ---------------------------------------------------------------------------

function isDayOffSummary(summary) {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  return DAY_OFF_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Given the full events array, return upcoming day-off runs grouped into
 * ranges. Runs separated only by weekend days are merged into a single
 * range (see module docstring).
 *
 * Each returned group is:
 *   { summary, start: Date, end: Date, count }
 * where `count` is the number of distinct calendar dates covered by the
 * group INCLUDING any weekend days bridged during merging.
 */
function groupUpcomingDaysOff(events, todayStr) {
  // 1. Filter to day-off events on or after today, sorted by date ascending.
  const todayLocal = parseLocalDate(todayStr);

  const items = (events || [])
    .filter(e => e.date && e.date >= todayStr && isDayOffSummary(e.summary))
    .map(e => ({ summary: e.summary, date: parseLocalDate(e.date) }))
    .sort((a, b) => a.date - b.date || a.summary.localeCompare(b.summary));

  if (items.length === 0) return [];

  // 2. Dedupe — an identical (date, summary) pair from RRULE expansion
  //    shouldn't be counted twice.
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const key = `${toLocalDateString(it.date)}::${it.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  // 3. Walk sorted events, grouping contiguous same-SUMMARY runs.
  //    Weekend gaps don't break a group.
  const groups = [];
  let current = null;

  for (const it of deduped) {
    if (!current) {
      current = { summary: it.summary, start: it.date, end: it.date };
      continue;
    }

    const sameSummary = it.summary === current.summary;
    if (!sameSummary) {
      groups.push(current);
      current = { summary: it.summary, start: it.date, end: it.date };
      continue;
    }

    // Same summary — check if this date is contiguous with current.end,
    // allowing weekend bridges.
    let cursor = nextDay(current.end);
    while (cursor < it.date && isWeekend(cursor)) {
      cursor = nextDay(cursor);
    }

    if (cursor.getTime() === it.date.getTime()) {
      // Contiguous (possibly via weekend bridge) — extend the current group.
      current.end = it.date;
    } else {
      // Gap — start a new group.
      groups.push(current);
      current = { summary: it.summary, start: it.date, end: it.date };
    }
  }
  if (current) groups.push(current);

  // 4. Decorate with count (inclusive day count across the range).
  for (const g of groups) {
    const msPerDay = 24 * 60 * 60 * 1000;
    g.count = Math.round((g.end - g.start) / msPerDay) + 1;
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Render: validity region (reused from Schedule view)
// ---------------------------------------------------------------------------

function renderValidity(resolvedLike, payload) {
  const el = els.validity;
  el.classList.remove('is-visible', 'is-stale', 'is-assumed', 'is-offline');

  switch (resolvedLike.trustState) {
    case 'confirmed':
      return;

    case 'stale':
      el.classList.add('is-visible', 'is-stale');
      els.validityIcon.textContent = '⚠';
      els.validityTitle.textContent = 'Showing cached schedule';
      els.validityDetail.textContent = `Last updated ${relativeTimeAgo(payload.lastFetch)}`;
      return;

    case 'offline':
      el.classList.add('is-visible', 'is-offline');
      els.validityIcon.textContent = '⊘';
      els.validityTitle.textContent = 'MD Today is offline';
      els.validityDetail.innerHTML =
        'Check the official site at <a href="https://materdei.org" target="_blank" rel="noopener">materdei.org</a>';
      return;

    // No 'assumed' case for this view — "assumed" is a today-specific
    // concept from resolveDay and doesn't apply to a list of future events.
  }
}

// ---------------------------------------------------------------------------
// Render: days-off list
// ---------------------------------------------------------------------------

function renderList(groups) {
  if (groups.length === 0) {
    els.daysoffList.hidden = true;
    els.daysoffEmpty.hidden = false;
    els.daysoffEmptyText.textContent = 'No upcoming days off.';
    return;
  }

  els.daysoffEmpty.hidden = true;
  els.daysoffList.hidden = false;

  const items = groups.map(g => {
    const li = document.createElement('li');
    li.className = 'daysoff-item';

    const label = document.createElement('div');
    label.className = 'daysoff-item__label';
    label.textContent = cleanLabel(g.summary);

    const meta = document.createElement('div');
    meta.className = 'daysoff-item__meta';

    const sameDay = g.start.getTime() === g.end.getTime();
    if (sameDay) {
      meta.textContent = SHORT_DATE_FMT.format(g.start);
    } else {
      // "Mon, Nov 24 – Fri, Nov 28 · 5 days"
      const startLabel = SHORT_DATE_FMT.format(g.start);
      // If the range spans the same month, drop the month from the end label
      // to reduce noise: "Nov 24 – Nov 28" → "Mon, Nov 24 – Fri 28" is ugly,
      // so keep the full short form on both ends. Readable wins.
      const endLabel = SHORT_DATE_FMT.format(g.end);
      meta.textContent = `${startLabel} – ${endLabel} · ${g.count} days`;
    }

    li.appendChild(label);
    li.appendChild(meta);
    return li;
  });

  els.daysoffList.replaceChildren(...items);
}

// ---------------------------------------------------------------------------
// Boot — load once, group once, render once, done.
// ---------------------------------------------------------------------------

async function boot() {
  const payload = await loadData();
  const now = new Date();
  els.headerDate.textContent = HEADER_DATE_FMT.format(now);

  // Derive a trust-state summary from the payload. We don't need the full
  // resolveDay here — this view is about the future, not today.
  const trustLike = (() => {
    if (!payload || payload.source === 'none') return { trustState: 'offline' };
    // Freshness check mirrors isFresh() from data.js (12h horizon).
    const FRESH_MS = 12 * 60 * 60 * 1000;
    const fresh = payload.lastFetch &&
      (Date.now() - new Date(payload.lastFetch).getTime() < FRESH_MS);
    return { trustState: fresh ? 'confirmed' : 'stale' };
  })();

  renderValidity(trustLike, payload);

  // If fully offline with no cache, don't render a list — the validity
  // banner says it all.
  if (trustLike.trustState === 'offline') {
    els.daysoffList.hidden = true;
    els.daysoffEmpty.hidden = true;
    return;
  }

  const todayStr = (() => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  const groups = groupUpcomingDaysOff(payload.events || [], todayStr);
  renderList(groups);
}

boot();
