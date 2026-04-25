// js/schedule-view.js
//
// Entry point for schedule.html — renders today's resolved template as a
// static table. No countdown subscription, no tick — paints once on load.
//
// See claude.md → "Phase 3: Schedule view" for the contract.
//
// Design choices (per Phase 3 plan):
//   - Static render only. The Now view owns "where am I in the day"; this
//     view is a reference table.
//   - Trust state banner reused from Now view (same CSS classes, same rules).
//   - Day-off, Assumed, and Offline each get their own empty-state copy.
//   - Simple one-row-per-block table. Track column is blank for shared blocks,
//     "Upper" / "Lower" for split ones.

import { loadData } from './data.js';
import { resolveDay } from './resolve.js';

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

  dayLabel: $('day-label'),
  scheduleTable: $('schedule-table'),
  scheduleTableBody: $('schedule-table-body'),
  scheduleEmpty: $('schedule-empty'),
  scheduleEmptyText: $('schedule-empty-text'),
};

// ---------------------------------------------------------------------------
// Formatters (duplicated from app.js — see claude.md notes on this)
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

function formatTrackLabel(track) {
  if (!track) return '';
  if (track === 'upper') return 'Upper';
  if (track === 'lower') return 'Lower';
  return track;
}

// ---------------------------------------------------------------------------
// Render: validity region (reused from Now view — same CSS, same rules)
// ---------------------------------------------------------------------------

function renderValidity(resolved, payload) {
  const el = els.validity;
  el.classList.remove('is-visible', 'is-stale', 'is-assumed', 'is-offline');

  switch (resolved.trustState) {
    case 'confirmed':
      return;

    case 'stale':
      el.classList.add('is-visible', 'is-stale');
      els.validityIcon.textContent = '⚠';
      els.validityTitle.textContent = 'Showing cached schedule';
      els.validityDetail.textContent = `Last updated ${relativeTimeAgo(payload.lastFetch)}`;
      return;

    case 'assumed':
      el.classList.add('is-visible', 'is-assumed');
      els.validityIcon.textContent = '?';
      els.validityTitle.textContent = 'Schedule assumed';
      els.validityDetail.innerHTML =
        'No matching event for today \u2014 check <a href="https://materdei.org" target="_blank" rel="noopener">materdei.org</a> for details.';
      return;

    case 'offline':
      el.classList.add('is-visible', 'is-offline');
      els.validityIcon.textContent = '⊘';
      els.validityTitle.textContent = 'MD Today is offline';
      els.validityDetail.textContent = 'Check with the front office for today\'s schedule.';
      return;
  }
}

// ---------------------------------------------------------------------------
// Render: schedule card
// ---------------------------------------------------------------------------

function renderSchedule(resolved) {
  // --- Day-off state: no table, muted message with the day-off label ---
  if (resolved.isDayOff) {
    els.dayLabel.textContent = resolved.dayOffLabel || 'No school today';
    showEmpty('No school today.');
    return;
  }

  // --- Offline state: no table, offline message ---
  if (resolved.trustState === 'offline') {
    els.dayLabel.textContent = '';
    showEmpty('Schedule unavailable. Check with the front office.');
    return;
  }

  // --- Assumed state: no template, explain why ---
  if (!resolved.template) {
    els.dayLabel.textContent = resolved.dayLabel || '';
    showEmpty('No schedule on file for today. Check <a href="https://materdei.org" target="_blank" rel="noopener">materdei.org</a> for details.');
    return;
  }

  // --- Template present: render the table ---
  els.dayLabel.textContent = resolved.dayLabel || '';
  renderTable(resolved.template.blocks);
}

function showEmpty(message) {
  els.scheduleTable.hidden = true;
  els.scheduleEmpty.hidden = false;
  els.scheduleEmptyText.textContent = message;
}

function renderTable(blocks) {
  els.scheduleEmpty.hidden = true;
  els.scheduleTable.hidden = false;

  // Build rows. Blocks already sorted by (block_order, track) in resolve.js.
  const rows = blocks.map(block => {
    const tr = document.createElement('tr');
    tr.className = block.track ? `schedule-row schedule-row--${block.track}` : 'schedule-row';

    const timeCell = document.createElement('td');
    timeCell.className = 'schedule-table__time';
    timeCell.textContent = `${formatTimeOfDay(block.start_time)} – ${formatTimeOfDay(block.end_time)}`;

    const blockCell = document.createElement('td');
    blockCell.className = 'schedule-table__block';
    if (/check with your teacher/i.test(block.block_name)) {
      blockCell.innerHTML = 'Special Schedule \u2014 see <a href="https://materdei.org" target="_blank" rel="noopener">materdei.org</a> for details';
    } else {
      blockCell.textContent = block.block_name;
    }

    const trackCell = document.createElement('td');
    trackCell.className = 'schedule-table__track';
    trackCell.textContent = formatTrackLabel(block.track);

    tr.appendChild(timeCell);
    tr.appendChild(blockCell);
    tr.appendChild(trackCell);
    return tr;
  });

  // Replace body contents atomically
  els.scheduleTableBody.replaceChildren(...rows);
}

// ---------------------------------------------------------------------------
// Boot — load once, render once, done.
// ---------------------------------------------------------------------------

async function boot() {
  const payload = await loadData();
  const now = new Date();
  els.headerDate.textContent = DATE_FMT.format(now);

  const resolved = resolveDay(payload, now);
  renderValidity(resolved, payload);
  renderSchedule(resolved);
}

boot();
