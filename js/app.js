// js/app.js — v2
//
// Now view orchestration. The Now view IS the schedule view.
// Layout (top to bottom):
//   1. Announcement banner (if present)
//   2. Template name + countdown timer
//   3. Full day's schedule blocks (current highlighted, past dimmed)
//
// Personal schedule overlay reads from localStorage and applies automatically.

import { loadData, isFresh } from './data.js';
import { resolveDay, resolveNowState } from './resolve.js';
import { getCurrentStatus } from './schedule.js';
import { startCountdown } from './countdown.js';

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

  deviation: $('deviation'),
  deviationText: $('deviation-text'),

  nowHeader: $('now-header'),
  dayLabel: $('day-label'),
  countdownText: $('countdown-text'),

  blocksList: $('blocks-list'),
  nowEmpty: $('now-empty'),
  nowEmptyText: $('now-empty-text'),

  nowOffday: $('now-offday'),
  offdayEmoji: $('offday-emoji'),
  offdayMessage: $('offday-message'),
  offdayPreview: $('offday-preview'),
  offdayDemoted: $('offday-demoted'),

  personalizeSection: $('personalize-section'),
  personalizeBtn: $('personalize-btn'),
};

// ---------------------------------------------------------------------------
// Personal schedule — localStorage
// ---------------------------------------------------------------------------

const PERSONAL_KEY = 'mdtoday_personal_schedule';

function loadPersonalSchedule() {
  try {
    const raw = localStorage.getItem(PERSONAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function savePersonalSchedule(data) {
  try {
    if (data && Object.keys(data).length > 0) {
      localStorage.setItem(PERSONAL_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(PERSONAL_KEY);
    }
  } catch (e) {
    console.warn('[app] personal schedule save failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
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

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  return h * 60 + m;
}

/**
 * Extract the active block numbers from a raw SUMMARY string.
 * "RED: B. 1, 3, 5, 7" → ['1','3','5','7']
 * Returns null if no block list found.
 */
function extractActiveBlocks(summary) {
  if (!summary) return null;
  const match = summary.match(/B\.\s*([\d,\s]+)$/);
  if (!match) return null;
  return match[1].split(',').map(s => s.trim());
}

/**
 * Extract block number from block_name (e.g., "Block 1" → "1", "Upper Lunch" → null).
 * For paired blocks like "Block 1/2", picks the number that's in activeBlocks.
 */
function extractBlockNumber(blockName, activeBlocks) {
  // Paired block: "Block 1/2" → pick the active one
  const pairMatch = blockName.match(/^Block\s+(\d)\/(\d)/i);
  if (pairMatch) {
    const [, a, b] = pairMatch;
    if (activeBlocks && activeBlocks.includes(b)) return b;
    if (activeBlocks && activeBlocks.includes(a)) return a;
    return a; // fallback
  }
  const match = blockName.match(/^Block\s+(\d)/i);
  return match ? match[1] : null;
}

/**
 * Enhance day label with block number reinforcement.
 * "Red Day" + "RED: B. 1, 3, 5, 7" → "Red Day (Blocks 1, 3, 5, 7)"
 */
function enhanceDayLabel(label, summary) {
  if (!summary) return label;
  const blockMatch = summary.match(/B\.\s*([\d,\s]+)$/);
  if (blockMatch) {
    const blocks = blockMatch[1].trim();
    return `${label} (Blocks ${blocks})`;
  }
  return label;
}

// ---------------------------------------------------------------------------
// Render: validity region
// ---------------------------------------------------------------------------

function renderValidity(resolved, payload, nowState) {
  const el = els.validity;
  el.classList.remove('is-visible', 'is-stale', 'is-assumed', 'is-offline');

  // Suppress assumed-state banner on non-school days — we know it's not a school day
  if (resolved.trustState === 'assumed' && nowState && nowState.base !== 'SCHOOL_DAY') {
    return;
  }

  switch (resolved.trustState) {
    case 'confirmed':
      return;

    case 'stale':
      el.classList.add('is-visible', 'is-stale');
      els.validityIcon.textContent = '\u26A0';
      els.validityTitle.textContent = 'Showing cached schedule';
      els.validityDetail.textContent = `Last updated ${relativeTimeAgo(payload.lastFetch)}`;
      return;

    case 'assumed':
      el.classList.add('is-visible', 'is-assumed');
      els.validityIcon.textContent = '?';
      els.validityTitle.textContent = 'Schedule assumed';
      els.validityDetail.textContent = 'No matching event for today \u2014 confirm with your teacher.';
      return;

    case 'offline':
      el.classList.add('is-visible', 'is-offline');
      els.validityIcon.textContent = '\u2298';
      els.validityTitle.textContent = 'MD Today is offline';
      els.validityDetail.innerHTML =
        'Check the official site at <a href="https://materdei.org" target="_blank" rel="noopener">materdei.org</a>';
      return;
  }
}

// ---------------------------------------------------------------------------
// Render: deviation (announcement)
// ---------------------------------------------------------------------------

function renderDeviation(resolved) {
  if (resolved.announcement) {
    els.deviation.classList.add('is-visible');
    els.deviationText.textContent = resolved.announcement;
  } else {
    els.deviation.classList.remove('is-visible');
    els.deviationText.textContent = '';
  }
}

// ---------------------------------------------------------------------------
// Render: off-day state (WEEKEND / BREAK / SINGLE_HOLIDAY / TRANSITION)
// ---------------------------------------------------------------------------

const STATE_COPY = {
  WEEKEND:        { emoji: '\uD83C\uDF24\uFE0F', message: 'Enjoy your weekend.' },
  BREAK:          { emoji: '\uD83C\uDF34',       message: 'Enjoy your break.' },
  SINGLE_HOLIDAY: { emoji: '\u2600\uFE0F',       message: 'Enjoy the day off.' },
  TRANSITION:     { emoji: '\uD83C\uDF19',       message: 'Getting ready for tomorrow' },
};

const PREVIEW_DATE_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

function renderOffday(nowState) {
  // Hide school-day content
  els.nowHeader.hidden = true;
  els.blocksList.innerHTML = '';
  blockElements = [];
  els.nowEmpty.hidden = true;
  els.personalizeSection.hidden = true;

  // Show offday section
  els.nowOffday.hidden = false;

  if (nowState.override === 'TRANSITION') {
    // TRANSITION: tomorrow preview is tier1, base warm message demotes to tier2
    const copy = STATE_COPY.TRANSITION;
    const baseCopy = STATE_COPY[nowState.base];

    els.offdayEmoji.textContent = copy.emoji;
    els.offdayMessage.textContent = copy.message;

    renderNextSchoolPreview(nowState.nextSchoolDay, false);

    els.offdayDemoted.textContent = baseCopy.message;
    els.offdayDemoted.hidden = false;
  } else {
    // Base state warm message
    const copy = STATE_COPY[nowState.base];

    els.offdayEmoji.textContent = copy.emoji;
    els.offdayMessage.textContent = copy.message;

    // Tomorrow preview at tier3 — SINGLE_HOLIDAY only (per spec).
    // WEEKEND and BREAK don't show it; TRANSITION promotes it to tier1 above.
    if (nowState.base === 'SINGLE_HOLIDAY' && nowState.nextSchoolDay) {
      renderNextSchoolPreview(nowState.nextSchoolDay, true);
    } else {
      els.offdayPreview.hidden = true;
    }

    els.offdayDemoted.hidden = true;
  }
}

function renderNextSchoolPreview(nextSchool, muted) {
  const preview = els.offdayPreview;
  preview.hidden = false;
  preview.classList.toggle('now-offday__preview--muted', muted);

  const dayName = PREVIEW_DATE_FMT.format(nextSchool.date);

  // Block numbers from raw summary
  let blockInfo = '';
  if (nextSchool.summary) {
    const blockMatch = nextSchool.summary.match(/B\.\s*([\d,\s]+)$/);
    if (blockMatch) blockInfo = ` (Blocks ${blockMatch[1].trim()})`;
  }

  let html = `<div class="now-offday__preview-label">Next up</div>`;
  html += `<div class="now-offday__preview-day">${dayName} \u2014 ${nextSchool.dayLabel}${blockInfo}</div>`;

  if (nextSchool.spiritDress && nextSchool.spiritDress.length > 0) {
    html += `<div class="now-offday__preview-spirit">\uD83D\uDC55 Spirit Dress: ${nextSchool.spiritDress.join(', ')}</div>`;
  }

  preview.innerHTML = html;
}

function showSchoolDay() {
  // Restore school-day content visibility
  els.nowHeader.hidden = false;
  els.nowOffday.hidden = true;
}

// ---------------------------------------------------------------------------
// Render: block list
// ---------------------------------------------------------------------------

// Stored references for tick updates
let blockElements = []; // { block, element }

function renderBlocks(template, personal, activeBlocks) {
  const list = els.blocksList;
  list.innerHTML = '';
  blockElements = [];

  if (!template || !template.blocks || template.blocks.length === 0) return;

  for (const block of template.blocks) {
    const li = document.createElement('li');
    li.className = 'now-block';

    // Time column
    const timeDiv = document.createElement('div');
    timeDiv.className = 'now-block__time';
    timeDiv.textContent = `${formatTimeOfDay(block.start_time)} \u2013 ${formatTimeOfDay(block.end_time)}`;

    // Info column
    const infoDiv = document.createElement('div');
    infoDiv.className = 'now-block__info';

    const blockNum = extractBlockNumber(block.block_name, activeBlocks);
    const personalData = blockNum && personal ? personal[blockNum] : null;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'now-block__name';

    if (personalData && personalData.name) {
      // Personal overlay: class name primary, block + room secondary
      nameDiv.textContent = personalData.name;
      const metaDiv = document.createElement('div');
      metaDiv.className = 'now-block__meta';
      const parts = [`Block ${blockNum}`];
      if (personalData.room) parts.push(`Room ${personalData.room}`);
      metaDiv.textContent = parts.join(' \u00B7 ');
      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(metaDiv);
    } else {
      // Default: block name only
      nameDiv.textContent = block.block_name;
      infoDiv.appendChild(nameDiv);
    }

    // Track label for branched blocks
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

    blockElements.push({ block, element: li });
  }
}

// ---------------------------------------------------------------------------
// Tick: temporal update (every second)
// ---------------------------------------------------------------------------

function tickTemporal(now) {
  if (!currentResolved) return;

  // Auto-detect TRANSITION at 5pm on non-school days
  if (!transitionChecked && currentNowState && currentNowState.base !== 'SCHOOL_DAY'
      && !currentNowState.override && now.getHours() >= 17) {
    transitionChecked = true;
    renderStable(now);
    return;
  }

  // Non-school-day or no template — static display, no tick updates needed
  if (currentNowState && currentNowState.base !== 'SCHOOL_DAY') return;
  if (!currentResolved.template) {
    els.countdownText.textContent = '';
    els.countdownText.classList.remove('now-header__countdown--active');
    return;
  }

  const status = getCurrentStatus(currentResolved.template, now);
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  // Update block highlighting
  for (const { block, element } of blockElements) {
    const start = timeToMinutes(block.start_time);
    const end = timeToMinutes(block.end_time);

    element.classList.remove('is-past', 'is-current');
    if (nowMin >= end) {
      element.classList.add('is-past');
    } else if (nowMin >= start) {
      element.classList.add('is-current');
    }
  }

  // Update countdown
  if (status.status === 'after') {
    els.countdownText.textContent = 'School day complete';
    els.countdownText.classList.remove('now-header__countdown--active');
  } else if (status.secondsToNextTransition != null) {
    const totalSeconds = Math.max(0, Math.ceil(status.secondsToNextTransition));
    const isLastBlock = status.status === 'period' && !status.nextBlock && !status.currentTracks;
    const suffix = isLastBlock ? 'remaining' : 'until next block';

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const timeStr = h > 0
      ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
      : m > 0
        ? `${m}m ${String(s).padStart(2, '0')}s`
        : `${s}s`;
    els.countdownText.textContent = `${timeStr} ${suffix}`;
    els.countdownText.classList.add('now-header__countdown--active');
  }
}

// ---------------------------------------------------------------------------
// Top-level state + render
// ---------------------------------------------------------------------------

let currentPayload = null;
let currentResolved = null;
let currentNowState = null;
let currentActiveBlocks = null;
let transitionChecked = false;

function renderStable(now) {
  els.headerDate.textContent = DATE_FMT.format(now);
  currentResolved = resolveDay(currentPayload, now);
  currentNowState = resolveNowState(currentPayload, now);
  transitionChecked = false;

  renderValidity(currentResolved, currentPayload, currentNowState);
  renderDeviation(currentResolved);

  // Non-school-day states: warm message + optional tomorrow preview
  if (currentNowState.base !== 'SCHOOL_DAY') {
    renderOffday(currentNowState);
    return;
  }

  // SCHOOL_DAY — restore school-day content, hide offday
  showSchoolDay();

  // Offline / no template
  if (!currentResolved.template) {
    const label = currentResolved.dayLabel || '';
    els.dayLabel.textContent = label;
    els.blocksList.innerHTML = '';
    blockElements = [];
    if (currentResolved.trustState === 'offline') {
      showEmpty('Schedule unavailable. Check the official site at materdei.org');
    } else if (currentResolved.isDayOff) {
      els.dayLabel.textContent = currentResolved.dayOffLabel || 'No school today';
      showEmpty('No school today.');
    } else {
      showEmpty('No schedule on file for today.');
    }
    els.personalizeSection.hidden = true;
    return;
  }

  // Normal schedule
  els.nowEmpty.hidden = true;

  // Build enhanced day label
  const rawSummary = currentResolved.unmatchedSummary || findScheduleSummary();
  const label = enhanceDayLabel(
    currentResolved.dayLabel || '',
    rawSummary
  );
  els.dayLabel.textContent = label;

  const personal = loadPersonalSchedule();
  currentActiveBlocks = extractActiveBlocks(rawSummary);
  renderBlocks(currentResolved.template, personal, currentActiveBlocks);
  els.personalizeSection.hidden = false;
}

function showEmpty(message) {
  els.nowEmpty.hidden = false;
  els.nowEmptyText.textContent = message;
  els.blocksList.innerHTML = '';
  blockElements = [];
}

/**
 * Find the raw schedule SUMMARY for today from the payload events.
 * Used for day-label block-number reinforcement.
 */
function findScheduleSummary() {
  if (!currentPayload || !currentPayload.events || !currentPayload.summaryMap) return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  const summarySet = new Set(currentPayload.summaryMap.map(r => r.calendar_summary));
  const event = currentPayload.events.find(e => e.date === todayStr && summarySet.has(e.summary));
  return event ? event.summary : null;
}

// ---------------------------------------------------------------------------
// Edit panel (personalize schedule)
// ---------------------------------------------------------------------------

function initEditPanel() {
  if (!els.personalizeBtn) return;
  els.personalizeBtn.addEventListener('click', toggleEditPanel);
}

function toggleEditPanel() {
  const existing = document.getElementById('edit-panel');
  if (existing) {
    existing.remove();
    return;
  }

  const personal = loadPersonalSchedule() || {};

  const panel = document.createElement('div');
  panel.id = 'edit-panel';
  panel.className = 'edit-panel';

  panel.innerHTML = `
    <h3 class="edit-panel__heading">Personalize Schedule</h3>
    <p class="edit-panel__note">Saved on this device only</p>
    <div class="edit-panel__form">
      ${[1,2,3,4,5,6,7,8].map(i => `
        <div class="edit-panel__row">
          <label class="edit-panel__label">Block ${i}</label>
          <input class="edit-panel__input" type="text" placeholder="Class name"
                 data-block="${i}" data-field="name" value="${personal[i]?.name || ''}">
          <input class="edit-panel__input edit-panel__input--room" type="text" placeholder="Room"
                 data-block="${i}" data-field="room" value="${personal[i]?.room || ''}">
        </div>
      `).join('')}
    </div>
    <div class="edit-panel__actions">
      <button class="edit-panel__save" type="button">Save</button>
      <button class="edit-panel__reset" type="button">Reset Schedule</button>
      <button class="edit-panel__cancel" type="button">Cancel</button>
    </div>
  `;

  panel.querySelector('.edit-panel__save').addEventListener('click', () => {
    const data = {};
    for (let i = 1; i <= 8; i++) {
      const name = panel.querySelector(`[data-block="${i}"][data-field="name"]`).value.trim();
      const room = panel.querySelector(`[data-block="${i}"][data-field="room"]`).value.trim();
      if (name || room) data[i] = { name, room };
    }
    savePersonalSchedule(data);
    panel.remove();
    if (currentResolved && currentResolved.template) {
      renderBlocks(currentResolved.template, loadPersonalSchedule(), currentActiveBlocks);
      tickTemporal(new Date());
    }
  });

  panel.querySelector('.edit-panel__reset').addEventListener('click', () => {
    savePersonalSchedule(null);
    panel.remove();
    if (currentResolved && currentResolved.template) {
      renderBlocks(currentResolved.template, null, currentActiveBlocks);
      tickTemporal(new Date());
    }
  });

  panel.querySelector('.edit-panel__cancel').addEventListener('click', () => {
    panel.remove();
  });

  els.personalizeSection.parentNode.insertBefore(panel, els.personalizeSection);
}

// ---------------------------------------------------------------------------
// Streak — quiet personal reflection, not gamification
// ---------------------------------------------------------------------------

const STREAK_KEY = 'mdtoday_streak_dates';

function recordVisit() {
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;

    const raw = localStorage.getItem(STREAK_KEY);
    const dates = raw ? JSON.parse(raw) : [];
    if (!dates.includes(today)) {
      dates.push(today);
      // Keep last 90 days max
      while (dates.length > 90) dates.shift();
      localStorage.setItem(STREAK_KEY, JSON.stringify(dates));
    }
  } catch { /* private browsing or quota */ }
}

function calculateStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return 0;
    const dates = JSON.parse(raw).sort();
    if (dates.length === 0) return 0;

    // Walk backwards from today, counting consecutive school days visited
    const today = new Date();
    let streak = 0;
    let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Check if today was visited — if not, start from yesterday
    const todayStr = formatDateStr(cursor);
    if (!dates.includes(todayStr)) {
      cursor.setDate(cursor.getDate() - 1);
      // Skip weekend going backward
      while (isWeekend(cursor)) cursor.setDate(cursor.getDate() - 1);
      if (!dates.includes(formatDateStr(cursor))) return 0;
    }

    while (dates.includes(formatDateStr(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
      // Skip weekends — they don't break the streak
      while (isWeekend(cursor)) cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  } catch { return 0; }
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renderStreak() {
  const el = document.getElementById('streak');
  if (!el) return;

  const streak = calculateStreak();
  if (streak < 2) {
    el.style.display = 'none';
    return;
  }

  el.style.display = '';
  const label = streak === 1 ? 'day' : 'days';
  el.textContent = `${streak}-day streak`;
}

// ---------------------------------------------------------------------------
// Dev: ?now= override for visual testing
// ---------------------------------------------------------------------------
//
// Usage: ?now=2025-12-29T09:00  (ISO-like, parsed as local time)
// Pins the resolver to a fake date. The countdown tick still advances in
// real time from the pinned moment. Remove before wider launch or gate
// behind a flag.

const DEV_NOW_PARAM = new URLSearchParams(window.location.search).get('now');
let devBaseTime = null;
let devBaseReal = null;

if (DEV_NOW_PARAM) {
  devBaseTime = new Date(DEV_NOW_PARAM).getTime();
  devBaseReal = Date.now();
  console.info(`[dev] time pinned to ${new Date(devBaseTime).toLocaleString()}`);
}

function getNow() {
  if (devBaseTime != null) {
    // Advance from the pinned moment at real-time speed
    return new Date(devBaseTime + (Date.now() - devBaseReal));
  }
  return new Date();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  currentPayload = await loadData();
  const now = getNow();
  renderStable(now);
  tickTemporal(now);
  startCountdown((tick) => tickTemporal(getNow()), onLongResume);
  initEditPanel();
  recordVisit();
  renderStreak();
}

async function onLongResume() {
  currentPayload = await loadData();
  const now = getNow();
  renderStable(now);
  tickTemporal(now);
  startCountdown((tick) => tickTemporal(getNow()), onLongResume);
}

boot();
