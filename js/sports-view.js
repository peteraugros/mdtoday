// js/sports-view.js
//
// Today's Sports view — curated sports events from the iCal feed.
// Hierarchy: home > away, varsity > JV > frosh. Sorted by start time within tier.
// Empty state: if no events today, show the next upcoming game.

import { loadData, FRESHNESS_HORIZON_MS } from './data.js';

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

  sportsHeading: $('sports-heading'),
  sportsList: $('sports-list'),
  sportsEmpty: $('sports-empty'),
  sportsEmptyText: $('sports-empty-text'),
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const HEADER_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric',
});

const SHORT_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric',
});

function formatTimeOfDay(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

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

// ---------------------------------------------------------------------------
// Sports event detection + parsing
// ---------------------------------------------------------------------------

// Patterns that identify a sports event in the iCal feed
const SPORTS_PATTERNS = [
  /^V\s+(Boys|Girls)\s+/i,     // Varsity: "V Boys Basketball @ ..."
  /^JV\s+(Boys|Girls)\s+/i,    // JV: "JV Girls Soccer vs ..."
  /^JV\s+/i,                   // JV without gender
  /^Frosh\s+/i,                // Freshman
  /^(Boys|Girls)\s+.*(@|vs)/i, // Gender-prefixed with game indicator
];

function isSportsEvent(summary) {
  return SPORTS_PATTERNS.some(p => p.test(summary));
}

/**
 * Parse a sports event SUMMARY into structured data.
 *
 * Examples:
 *   "V Boys Basketball @ St. John Bosco"
 *     → { level: 'V', team: 'Boys Basketball', opponent: 'St. John Bosco', home: false }
 *   "JV Girls Soccer vs Servite"
 *     → { level: 'JV', team: 'Girls Soccer', opponent: 'Servite', home: true }
 */
function parseSportsEvent(summary) {
  const result = {
    level: 'V',
    team: summary,
    opponent: '',
    home: false,
    raw: summary,
  };

  // Extract level prefix
  const levelMatch = summary.match(/^(V|JV|Frosh)\s+/i);
  if (levelMatch) {
    result.level = levelMatch[1].toUpperCase();
    summary = summary.slice(levelMatch[0].length);
  }

  // Split on " @ " (away) or " vs " / " vs. " (home)
  const awayMatch = summary.match(/^(.+?)\s+@\s+(.+)$/);
  const homeMatch = summary.match(/^(.+?)\s+vs\.?\s+(.+)$/i);

  if (awayMatch) {
    result.team = awayMatch[1].trim();
    result.opponent = awayMatch[2].trim();
    result.home = false;
  } else if (homeMatch) {
    result.team = homeMatch[1].trim();
    result.opponent = homeMatch[2].trim();
    result.home = true;
  } else {
    result.team = summary;
  }

  return result;
}

/**
 * Sort priority: home first, then by level (V > JV > Frosh), then by time.
 */
function sportsSortKey(event) {
  const homeScore = event.parsed.home ? 0 : 1;
  const levelMap = { V: 0, JV: 1, FROSH: 2 };
  const levelScore = levelMap[event.parsed.level] ?? 3;
  // Time as minutes for sorting (null = end of list)
  const timeScore = event.time ? parseInt(event.time.replace(':', ''), 10) : 9999;
  return homeScore * 10000 + levelScore * 1000 + timeScore;
}

// ---------------------------------------------------------------------------
// Render: validity
// ---------------------------------------------------------------------------

function renderValidity(payload) {
  const el = els.validity;
  el.classList.remove('is-visible', 'is-stale', 'is-assumed', 'is-offline');

  if (!payload || payload.source === 'none') {
    el.classList.add('is-visible', 'is-offline');
    els.validityIcon.textContent = '\u2298';
    els.validityTitle.textContent = 'MD Today is offline';
    els.validityDetail.innerHTML =
      'Check the official site at <a href="https://materdei.org" target="_blank" rel="noopener">materdei.org</a>';
    return;
  }

  const fresh = payload.lastFetch &&
    (Date.now() - new Date(payload.lastFetch).getTime() < FRESHNESS_HORIZON_MS);

  if (!fresh) {
    el.classList.add('is-visible', 'is-stale');
    els.validityIcon.textContent = '\u26A0';
    els.validityTitle.textContent = 'Showing cached data';
    els.validityDetail.textContent = `Last updated ${relativeTimeAgo(payload.lastFetch)}`;
  }
}

// ---------------------------------------------------------------------------
// Render: sports list
// ---------------------------------------------------------------------------

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function renderSports(payload) {
  const todayStr = toDateStr(new Date());
  const events = (payload.events || [])
    .filter(e => e.date === todayStr && isSportsEvent(e.summary))
    .map(e => ({ ...e, parsed: parseSportsEvent(e.summary) }));

  events.sort((a, b) => sportsSortKey(a) - sportsSortKey(b));

  if (events.length > 0) {
    renderEventList(events);
    return;
  }

  // No games today — find the next upcoming game
  const futureEvents = (payload.events || [])
    .filter(e => e.date > todayStr && isSportsEvent(e.summary))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (futureEvents.length > 0) {
    const next = futureEvents[0];
    const parsed = parseSportsEvent(next.summary);
    const dateObj = parseLocalDate(next.date);
    const opponent = parsed.opponent || 'TBD';
    const homeAway = parsed.home ? 'Home' : 'Away';
    els.sportsList.hidden = true;
    els.sportsEmpty.hidden = false;
    els.sportsEmptyText.textContent =
      `No games today \u2014 next: ${SHORT_DATE_FMT.format(dateObj)} vs. ${opponent} (${homeAway})`;
  } else {
    els.sportsList.hidden = true;
    els.sportsEmpty.hidden = false;
    els.sportsEmptyText.textContent = 'No upcoming games on the calendar.';
  }
}

function renderEventList(events) {
  els.sportsEmpty.hidden = true;
  els.sportsList.hidden = false;

  const items = events.map(e => {
    const li = document.createElement('li');
    li.className = 'sports-item';
    if (e.parsed.home) li.classList.add('sports-item--home');

    const teamDiv = document.createElement('div');
    teamDiv.className = 'sports-item__team';
    teamDiv.textContent = `${e.parsed.level} ${e.parsed.team}`;

    const opponentDiv = document.createElement('div');
    opponentDiv.className = 'sports-item__opponent';
    const prefix = e.parsed.home ? 'vs.' : '@';
    opponentDiv.textContent = e.parsed.opponent ? `${prefix} ${e.parsed.opponent}` : '';

    const metaDiv = document.createElement('div');
    metaDiv.className = 'sports-item__meta';
    const parts = [];
    if (e.time) parts.push(formatTimeOfDay(e.time));
    parts.push(e.parsed.home ? 'Home' : 'Away');
    metaDiv.textContent = parts.join(' \u00B7 ');

    li.appendChild(teamDiv);
    li.appendChild(opponentDiv);
    li.appendChild(metaDiv);

    return li;
  });

  els.sportsList.replaceChildren(...items);
}

function parseLocalDate(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  const payload = await loadData();
  const now = new Date();
  els.headerDate.textContent = HEADER_DATE_FMT.format(now);

  renderValidity(payload);

  if (!payload || payload.source === 'none') {
    els.sportsList.hidden = true;
    els.sportsEmpty.hidden = false;
    els.sportsEmptyText.textContent =
      'Sports data unavailable. Check the official site at materdei.org';
    return;
  }

  renderSports(payload);
}

boot();
