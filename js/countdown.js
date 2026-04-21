// js/countdown.js
//
// Tick timer for the temporal layer of the Now view.
//
// Pure time source — does NOT touch the DOM. The caller passes in a tickFn
// that receives a Date and is responsible for re-rendering the temporal
// region only. The validity and deviation regions stay mounted and stable.
//
// Visibility-aware:
//   - When the tab is hidden, the interval is cleared (saves battery).
//   - When the tab becomes visible again, the interval resumes.
//   - If the tab was hidden for longer than LONG_RESUME_MS, the optional
//     onLongResume callback fires instead of (before) a normal resume —
//     the caller should re-run loadData + renderStable in that case because
//     the cached payload may now be stale.
//
// See claude.md → "Core Modules → js/countdown.js".

const TICK_MS = 1000;
const LONG_RESUME_MS = 60 * 60 * 1000; // 1 hour

let intervalId = null;
let tickFn = null;
let onLongResume = null;
let hiddenAt = null;
let visibilityHandlerAttached = false;

function startInterval() {
  if (intervalId !== null) return;
  // Fire once immediately so the temporal region is current after resume,
  // then tick on the second boundary.
  tickFn(new Date());
  intervalId = setInterval(() => tickFn(new Date()), TICK_MS);
}

function stopInterval() {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopInterval();
    hiddenAt = Date.now();
    return;
  }

  // Tab is visible again.
  const wasHiddenMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;

  if (wasHiddenMs >= LONG_RESUME_MS && typeof onLongResume === 'function') {
    // Let the caller refresh data first; they are responsible for calling
    // startCountdown again (or leaving it started — we're still stopped here).
    // We do NOT restart the interval ourselves in this branch.
    onLongResume();
    return;
  }

  startInterval();
}

/**
 * Start ticking. Safe to call multiple times — subsequent calls replace the
 * previous tickFn/onLongResume and reset the interval.
 *
 * @param {(now: Date) => void} fn         Called every second with a fresh Date.
 * @param {() => void} [longResumeFn]      Called on resume after >1h hidden,
 *                                          instead of resuming the interval.
 */
export function startCountdown(fn, longResumeFn) {
  if (typeof fn !== 'function') {
    throw new Error('startCountdown requires a tick function');
  }

  tickFn = fn;
  onLongResume = typeof longResumeFn === 'function' ? longResumeFn : null;

  if (!visibilityHandlerAttached) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    visibilityHandlerAttached = true;
  }

  stopInterval();
  hiddenAt = null;

  // If we're starting while the tab is already hidden (unlikely but possible),
  // don't run the interval — the visibility handler will start it on focus.
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }

  startInterval();
}

/**
 * Stop ticking and detach the visibility handler. Call on navigation or
 * teardown if needed.
 */
export function stopCountdown() {
  stopInterval();
  if (visibilityHandlerAttached) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    visibilityHandlerAttached = false;
  }
  tickFn = null;
  onLongResume = null;
  hiddenAt = null;
}
