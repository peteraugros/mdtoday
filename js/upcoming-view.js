// js/upcoming-view.js
//
// Upcoming view — 5–7 day forward-looking list.
// Each row: day name, template name (full), announcement if present.
// Today is omitted. Tap a row to drill into that day's full schedule.
// Drill-in reuses the Now view's block-list layout with personal overlay.

import { loadData, isFresh, FRESHNESS_HORIZON_MS } from './data.js';
import { resolveDay, getSpiritDressEvents } from './resolve.js';
import { formatBlockLine } from './format.js';

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

  listSection: $('upcoming-list-section'),
  upcomingList: $('upcoming-list'),
  upcomingEmpty: $('upcoming-empty'),
  upcomingEmptyText: $('upcoming-empty-text'),

  detailSection: $('upcoming-detail'),
  detailBack: $('detail-back'),
  detailDayLabel: $('detail-day-label'),
  detailDayBlocks: $('detail-day-blocks'),
  detailBlocksList: $('detail-blocks-list'),
  detailEmpty: $('detail-empty'),
  detailEmptyText: $('detail-empty-text'),
};

// ---------------------------------------------------------------------------
// Personal schedule
// ---------------------------------------------------------------------------

const PERSONAL_KEY = 'mdtoday_personal_schedule';

function loadPersonalSchedule() {
  try {
    const raw = localStorage.getItem(PERSONAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const HEADER_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric',
});

const DAY_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric',
});

const DETAIL_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric',
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

function extractBlockNumber(blockName) {
  const match = blockName.match(/^Block\s+(\d)/i);
  return match ? match[1] : null;
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
    els.validityTitle.textContent = 'Showing cached schedule';
    els.validityDetail.textContent = `Last updated ${relativeTimeAgo(payload.lastFetch)}`;
  }
}

// ---------------------------------------------------------------------------
// Build upcoming days
// ---------------------------------------------------------------------------

function getUpcomingDays(payload, count = 7) {
  const days = [];
  const now = new Date();
  const cursor = new Date(now);
  cursor.setDate(cursor.getDate() + 1); // start from tomorrow

  for (let i = 0; i < count; i++) {
    const date = new Date(cursor);
    const resolved = resolveDay(payload, date);
    const spiritDress = getSpiritDressEvents(payload, date);
    days.push({ date, resolved, spiritDress });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

/**
 * Find the raw schedule SUMMARY for a date.
 */
function findScheduleSummary(payload, date) {
  if (!payload || !payload.events || !payload.summaryMap) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const summarySet = new Set(payload.summaryMap.map(r => r.calendar_summary));
  const event = payload.events.find(e => e.date === dateStr && summarySet.has(e.summary));
  return event ? event.summary : null;
}

// ---------------------------------------------------------------------------
// Render: upcoming list
// ---------------------------------------------------------------------------

let currentPayload = null;

function renderList(days) {
  if (days.length === 0) {
    els.upcomingList.hidden = true;
    els.upcomingEmpty.hidden = false;
    els.upcomingEmptyText.textContent = 'No upcoming schedule data.';
    return;
  }

  els.upcomingEmpty.hidden = true;
  els.upcomingList.hidden = false;

  const items = days.map(({ date, resolved, spiritDress }) => {
    const li = document.createElement('li');
    li.className = 'upcoming-item';

    // Day/date label
    const dayDiv = document.createElement('div');
    dayDiv.className = 'upcoming-item__day';
    dayDiv.textContent = DAY_FMT.format(date);

    // Template name
    const templateDiv = document.createElement('div');
    templateDiv.className = 'upcoming-item__template';
    if (resolved.isDayOff) {
      templateDiv.textContent = resolved.dayOffLabel || 'No school';
      templateDiv.classList.add('upcoming-item__template--dayoff');
    } else if (resolved.dayLabel) {
      templateDiv.textContent = resolved.dayLabel;
    } else {
      templateDiv.textContent = 'No schedule';
      templateDiv.classList.add('upcoming-item__template--none');
    }

    li.appendChild(dayDiv);
    li.appendChild(templateDiv);

    // Announcement if present
    if (resolved.announcement) {
      const annDiv = document.createElement('div');
      annDiv.className = 'upcoming-item__announcement';
      annDiv.textContent = resolved.announcement;
      li.appendChild(annDiv);
    }

    // Spirit dress row
    if (spiritDress.length > 0) {
      const spiritDiv = document.createElement('div');
      spiritDiv.className = 'upcoming-item__spirit';
      spiritDiv.textContent = `\uD83D\uDC55 Spirit Dress: ${spiritDress.join(', ')}`;
      li.appendChild(spiritDiv);
    }

    // Tap to drill in (only if there's a schedule to show)
    if (resolved.template) {
      li.classList.add('upcoming-item--tappable');
      li.addEventListener('click', () => showDetail(date, resolved));
    }

    return li;
  });

  els.upcomingList.replaceChildren(...items);
}

// ---------------------------------------------------------------------------
// Render: drill-in detail
// ---------------------------------------------------------------------------

function showDetail(date, resolved) {
  els.listSection.hidden = true;
  els.detailSection.hidden = false;

  // Day label — no date prefix, blocks on separate line
  els.detailDayLabel.textContent = resolved.dayLabel || '';
  const rawSummary = findScheduleSummary(currentPayload, date);
  const blockLine = formatBlockLine(rawSummary);
  if (blockLine && els.detailDayBlocks) {
    els.detailDayBlocks.textContent = blockLine;
    els.detailDayBlocks.hidden = false;
  } else if (els.detailDayBlocks) {
    els.detailDayBlocks.hidden = true;
  }

  if (!resolved.template) {
    els.detailBlocksList.innerHTML = '';
    els.detailEmpty.hidden = false;
    els.detailEmptyText.textContent = 'No schedule available.';
    return;
  }

  els.detailEmpty.hidden = true;
  const personal = loadPersonalSchedule();
  renderDetailBlocks(resolved.template, personal);
}

function renderDetailBlocks(template, personal) {
  const list = els.detailBlocksList;
  list.innerHTML = '';

  for (const block of template.blocks) {
    const li = document.createElement('li');
    li.className = 'now-block';

    const timeDiv = document.createElement('div');
    timeDiv.className = 'now-block__time';
    timeDiv.textContent = `${formatTimeOfDay(block.start_time)} \u2013 ${formatTimeOfDay(block.end_time)}`;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'now-block__info';

    const blockNum = extractBlockNumber(block.block_name);
    const personalData = blockNum && personal ? personal[blockNum] : null;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'now-block__name';

    if (personalData && personalData.name) {
      nameDiv.textContent = personalData.name;
      const metaDiv = document.createElement('div');
      metaDiv.className = 'now-block__meta';
      const parts = [`Block ${blockNum}`];
      if (personalData.room) parts.push(`Room ${personalData.room}`);
      metaDiv.textContent = parts.join(' \u00B7 ');
      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(metaDiv);
    } else if (/check with your teacher/i.test(block.block_name)) {
      nameDiv.innerHTML = 'Special Schedule \u2014 see <a href="https://materdei.org" target="_blank" rel="noopener">materdei.org</a> for details';
      infoDiv.appendChild(nameDiv);
    } else {
      nameDiv.textContent = block.block_name;
      infoDiv.appendChild(nameDiv);
    }

    if (block.track) {
      li.classList.add(`now-block--${block.track}`);
      const trackDiv = document.createElement('div');
      trackDiv.className = 'now-block__track';
      trackDiv.textContent = block.track === 'upper' ? 'Upper' : 'Lower';
      infoDiv.appendChild(trackDiv);
    }

    li.appendChild(timeDiv);
    li.appendChild(infoDiv);
    list.appendChild(li);
  }
}

function hideDetail() {
  els.detailSection.hidden = true;
  els.listSection.hidden = false;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  currentPayload = await loadData();
  const now = new Date();
  els.headerDate.textContent = HEADER_DATE_FMT.format(now);

  renderValidity(currentPayload);

  if (!currentPayload || currentPayload.source === 'none') {
    els.upcomingList.hidden = true;
    els.upcomingEmpty.hidden = false;
    els.upcomingEmptyText.textContent = 'Schedule unavailable. Check the official site at materdei.org';
    return;
  }

  const days = getUpcomingDays(currentPayload, 7);
  renderList(days);

  els.detailBack.addEventListener('click', hideDetail);
}

boot();
