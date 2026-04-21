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
import { resolveDay } from './resolve.js';
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

  dayLabel: $('day-label'),
  countdownText: $('countdown-text'),

  blocksList: $('blocks-list'),
  nowEmpty: $('now-empty'),
  nowEmptyText: $('now-empty-text'),

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
 * Extract block number from block_name (e.g., "Block 1" → "1", "Upper Lunch" → null).
 */
function extractBlockNumber(blockName) {
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

function renderValidity(resolved, payload) {
  const el = els.validity;
  el.classList.remove('is-visible', 'is-stale', 'is-assumed', 'is-offline');

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
// Render: block list
// ---------------------------------------------------------------------------

// Stored references for tick updates
let blockElements = []; // { block, element }

function renderBlocks(template, personal) {
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

    const blockNum = extractBlockNumber(block.block_name);
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

  // Day-off or no template — static display, no tick updates needed
  if (currentResolved.isDayOff || !currentResolved.template) {
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

    if (totalSeconds < 300) {
      // Under 5 minutes — show minutes and seconds
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      const timeStr = m > 0
        ? `${m}m ${String(s).padStart(2, '0')}s`
        : `${s}s`;
      els.countdownText.textContent = `${timeStr} ${suffix}`;
    } else {
      const mins = Math.ceil(totalSeconds / 60);
      els.countdownText.textContent = `${mins} minutes ${suffix}`;
    }
    els.countdownText.classList.add('now-header__countdown--active');
  }
}

// ---------------------------------------------------------------------------
// Top-level state + render
// ---------------------------------------------------------------------------

let currentPayload = null;
let currentResolved = null;

function renderStable(now) {
  els.headerDate.textContent = DATE_FMT.format(now);
  currentResolved = resolveDay(currentPayload, now);

  renderValidity(currentResolved, currentPayload);
  renderDeviation(currentResolved);

  // Day-off state
  if (currentResolved.isDayOff) {
    els.dayLabel.textContent = currentResolved.dayOffLabel || 'No school today';
    els.blocksList.innerHTML = '';
    blockElements = [];
    showEmpty('No school today.');
    els.personalizeSection.hidden = true;
    return;
  }

  // Offline / no template
  if (!currentResolved.template) {
    const label = currentResolved.dayLabel || '';
    els.dayLabel.textContent = label;
    els.blocksList.innerHTML = '';
    blockElements = [];
    if (currentResolved.trustState === 'offline') {
      showEmpty('Schedule unavailable. Check the official site at materdei.org');
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
  renderBlocks(currentResolved.template, personal);
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
      renderBlocks(currentResolved.template, loadPersonalSchedule());
      tickTemporal(new Date());
    }
  });

  panel.querySelector('.edit-panel__reset').addEventListener('click', () => {
    savePersonalSchedule(null);
    panel.remove();
    if (currentResolved && currentResolved.template) {
      renderBlocks(currentResolved.template, null);
      tickTemporal(new Date());
    }
  });

  panel.querySelector('.edit-panel__cancel').addEventListener('click', () => {
    panel.remove();
  });

  els.personalizeSection.parentNode.insertBefore(panel, els.personalizeSection);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  currentPayload = await loadData();
  const now = new Date();
  renderStable(now);
  tickTemporal(now);
  startCountdown(tickTemporal, onLongResume);
  initEditPanel();
}

async function onLongResume() {
  currentPayload = await loadData();
  const now = new Date();
  renderStable(now);
  tickTemporal(now);
  startCountdown(tickTemporal, onLongResume);
}

boot();
