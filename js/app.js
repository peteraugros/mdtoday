// js/app.js
//
// View orchestration — mounts the three DOM regions on first load, then hands
// each region to its renderer. The countdown tick (later step) updates only
// the temporal region; validity and deviation stay mounted and stable.
//
// See claude.md → "Core Modules → js/app.js".

import { loadData, isFresh } from './data.js';
import { resolveDay } from './resolve.js';
import { getCurrentStatus } from './schedule.js';

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

  temporal: $('temporal'),
  dayLabel: $('day-label'),
  statusText: $('status-text'),
  countdownText: $('countdown-text'),

  tracks: $('tracks'),
  trackUpperBlock: $('track-upper-block'),
  trackUpperTime: $('track-upper-time'),
  trackLowerBlock: $('track-lower-block'),
  trackLowerTime: $('track-lower-time'),

  nextSlot: $('next-slot'),
  nextBlockName: $('next-block-name'),
  nextBlockTime: $('next-block-time'),

  deviation: $('deviation'),
  deviationText: $('deviation-text'),
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric',
});

function formatSeconds(seconds) {
  if (seconds == null || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${String(mm).padStart(2, '0')}m`;
}

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
      els.validityIcon.textContent = '⚠';
      els.validityTitle.textContent = 'Showing cached schedule';
      els.validityDetail.textContent = `Last updated ${relativeTimeAgo(payload.lastFetch)}`;
      return;

    case 'assumed':
      el.classList.add('is-visible', 'is-assumed');
      els.validityIcon.textContent = '?';
      els.validityTitle.textContent = 'Schedule assumed';
      els.validityDetail.textContent = 'No matching event for today — confirm with your teacher.';
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
// Render: deviation region (announcement)
// ---------------------------------------------------------------------------

function renderDeviation(resolved) {
  const el = els.deviation;
  if (resolved.announcement) {
    el.classList.add('is-visible');
    els.deviationText.textContent = resolved.announcement;
  } else {
    el.classList.remove('is-visible');
    els.deviationText.textContent = '';
  }
}

// ---------------------------------------------------------------------------
// Render: temporal region
// ---------------------------------------------------------------------------

function renderTemporal(resolved, status) {
  els.dayLabel.textContent = resolved.dayLabel || '';

  if (resolved.isDayOff) {
    els.statusText.textContent = 'No school today';
    els.statusText.classList.add('temporal__status--muted');
    els.countdownText.textContent = resolved.dayOffLabel || '';
    els.tracks.hidden = true;
    els.nextSlot.hidden = true;
    els.temporal.classList.remove('temporal--branched');
    return;
  }

  if (!resolved.template) {
    els.statusText.textContent = 'Schedule unavailable';
    els.statusText.classList.add('temporal__status--muted');
    els.countdownText.textContent = '';
    els.tracks.hidden = true;
    els.nextSlot.hidden = true;
    els.temporal.classList.remove('temporal--branched');
    return;
  }

  els.statusText.classList.remove('temporal__status--muted');

  switch (status.status) {
    case 'before':
      els.statusText.textContent = 'Before school';
      els.countdownText.textContent =
        `Starts in ${formatSeconds(status.secondsToNextTransition)}`;
      els.tracks.hidden = true;
      els.temporal.classList.remove('temporal--branched');
      showNext(status.nextBlock);
      break;

    case 'after':
      els.statusText.textContent = 'School\'s out';
      els.statusText.classList.add('temporal__status--muted');
      els.countdownText.textContent = '';
      els.tracks.hidden = true;
      els.nextSlot.hidden = true;
      els.temporal.classList.remove('temporal--branched');
      break;

    case 'passing':
      els.statusText.textContent = 'Passing period';
      els.countdownText.textContent =
        `Next in ${formatSeconds(status.secondsToNextTransition)}`;
      els.tracks.hidden = true;
      els.temporal.classList.remove('temporal--branched');
      showNext(status.nextBlock);
      break;

    case 'period':
      if (status.currentTracks) {
        els.statusText.textContent = 'Lunch window';
        els.countdownText.textContent =
          `Next change in ${formatSeconds(status.secondsToNextTransition)}`;
        els.tracks.hidden = false;
        els.temporal.classList.add('temporal--branched');

        els.trackUpperBlock.textContent = status.currentTracks.upper.block_name;
        els.trackUpperTime.textContent =
          `${formatTimeOfDay(status.currentTracks.upper.start_time)} – ${formatTimeOfDay(status.currentTracks.upper.end_time)}`;

        els.trackLowerBlock.textContent = status.currentTracks.lower.block_name;
        els.trackLowerTime.textContent =
          `${formatTimeOfDay(status.currentTracks.lower.start_time)} – ${formatTimeOfDay(status.currentTracks.lower.end_time)}`;

        showNext(status.nextBlock);
      } else {
        els.statusText.textContent = status.currentBlock.block_name;
        els.countdownText.textContent =
          `Ends in ${formatSeconds(status.secondsToNextTransition)}`;
        els.tracks.hidden = true;
        els.temporal.classList.remove('temporal--branched');
        showNext(status.nextBlock);
      }
      break;
  }
}

function showNext(nextBlock) {
  if (!nextBlock) {
    els.nextSlot.hidden = true;
    return;
  }
  els.nextSlot.hidden = false;
  els.nextBlockName.textContent = nextBlock.block_name;
  els.nextBlockTime.textContent = ` · ${formatTimeOfDay(nextBlock.start_time)}`;
}

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------

let currentPayload = null;
let currentResolved = null;

function renderAll() {
  const now = new Date();
  els.headerDate.textContent = DATE_FMT.format(now);

  currentResolved = resolveDay(currentPayload, now);
  const status = currentResolved.template
    ? getCurrentStatus(currentResolved.template, now)
    : { status: 'after', currentBlock: null, currentTracks: null, nextBlock: null, secondsToNextTransition: null };

  renderValidity(currentResolved, currentPayload);
  renderTemporal(currentResolved, status);
  renderDeviation(currentResolved);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  currentPayload = await loadData();
  renderAll();
}

boot();