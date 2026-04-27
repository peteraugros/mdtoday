// MD Today — PWA install welcome overlay
// Shows on first visit (and every visit until installed) for iPad/iPhone Safari users.
// "Skip for now" button sets a 1-hour cooldown.
// Fires install-prompt-shown and install-prompt-dismissed events via mdTrackEvent (Change A).

(function () {
  'use strict';

  var SKIP_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
  var SKIP_KEY = 'md_today_skip_until';
  var OVERLAY_DELAY_MS = 5 * 1000; // 5 seconds — let the student see the Now view first

  // --- Immediate eligibility checks ---
  // The standalone check happens NOW (not after the delay) so already-installed users
  // never start a 5-second timer just to discover they're already installed.

  // Already installed? (Standalone mode means the PWA is on the home screen.)
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true;
  if (isStandalone) return;

  // --- Detection of device + browser also runs immediately ---
  // No reason to wait 5 seconds before deciding this is a non-iOS or non-Safari user.

  // iPad or iPhone Safari only.
  // Detect iPhone first by explicit UA match. Then iPad — modern iPads report as Mac
  // in UA, so fall back to Mac+touchPoints detection only when iPhone didn't match.
  // Without the !isIPhone guard, iPhones can get misclassified as iPads in some Safari
  // configurations because both have maxTouchPoints > 1.
  var ua = window.navigator.userAgent;
  var isIPhone = /iPhone/.test(ua);
  var isIPad = /iPad/.test(ua) ||
               (!isIPhone && ua.indexOf('Mac') !== -1 && navigator.maxTouchPoints > 1);
  var isIOSDevice = isIPad || isIPhone;
  if (!isIOSDevice) return;

  // Must be Safari, not an in-app browser or Chrome/Firefox on iOS.
  // Safari UA contains "Safari" but not "CriOS" (Chrome iOS), "FxiOS" (Firefox iOS), etc.
  var isSafari = /Safari/.test(ua) &&
                 !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|FBAN|FBAV|Instagram|Snapchat|Line/.test(ua);
  if (!isSafari) return;

  // --- Delayed eligibility checks ---
  // The session/cooldown checks AND the overlay build wait 5 seconds. This way a
  // student who taps Skip and reloads doesn't see a flicker — by the time the
  // delayed code runs, the cooldown is already in place.

  setTimeout(function () {
    // Already tapped "I'll do it now" in this Safari session?
    try {
      if (sessionStorage.getItem('md_today_got_it_session') === '1') return;
    } catch (e) {
      // sessionStorage blocked — proceed.
    }

    // Within the 1-hour skip cooldown?
    try {
      var skipUntil = parseInt(localStorage.getItem(SKIP_KEY) || '0', 10);
      if (skipUntil && Date.now() < skipUntil) return;
    } catch (e) {
      // localStorage blocked — proceed.
    }

    // All eligibility passed — build the overlay.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildOverlay);
    } else {
      buildOverlay();
    }
  }, OVERLAY_DELAY_MS);

  // --- Build overlay ---

  function buildOverlay() {
    var styleEl = document.createElement('style');
    styleEl.textContent = [
      '.md-install-overlay {',
      '  position: fixed; inset: 0; z-index: 99999;',
      '  background: #B71C1C; color: #fff;',
      '  display: flex; flex-direction: column; align-items: center; justify-content: center;',
      '  padding: 32px 24px; text-align: center;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;',
      '  -webkit-tap-highlight-color: transparent;',
      '  animation: md-install-fade-in 0.3s ease-out;',
      '}',
      '@keyframes md-install-fade-in {',
      '  from { opacity: 0; }',
      '  to { opacity: 1; }',
      '}',
      '.md-install-overlay__title {',
      '  font-size: 28px; font-weight: 700; margin: 0 0 8px; line-height: 1.2;',
      '  max-width: 480px;',
      '}',
      '.md-install-overlay__subtitle {',
      '  font-size: 17px; font-weight: 400; opacity: 0.9; margin: 0 0 32px;',
      '  max-width: 420px; line-height: 1.4;',
      '}',
      '.md-install-overlay__steps {',
      '  background: rgba(255,255,255,0.12); border-radius: 16px;',
      '  padding: 24px; margin: 0 0 32px; max-width: 380px; width: 100%;',
      '  display: flex; flex-direction: column; gap: 20px;',
      '}',
      '.md-install-overlay__step {',
      '  display: flex; align-items: center; gap: 16px; text-align: left;',
      '}',
      '.md-install-overlay__step-num {',
      '  flex: 0 0 32px; height: 32px; border-radius: 50%;',
      '  background: #fff; color: #B71C1C;',
      '  display: flex; align-items: center; justify-content: center;',
      '  font-weight: 700; font-size: 16px;',
      '}',
      '.md-install-overlay__step-text {',
      '  font-size: 17px; line-height: 1.3;',
      '}',
      '.md-install-overlay__step-text strong {',
      '  font-weight: 700;',
      '}',
      '.md-install-overlay__share-icon {',
      '  display: inline-block; vertical-align: middle;',
      '  width: 22px; height: 28px; margin: 0 4px;',
      '}',
      '.md-install-overlay__got-it {',
      '  background: #fff; border: none;',
      '  color: #B71C1C; font-size: 18px; font-weight: 700;',
      '  padding: 14px 48px; border-radius: 28px;',
      '  cursor: pointer; -webkit-appearance: none; appearance: none;',
      '  font-family: inherit; margin-bottom: 16px;',
      '  box-shadow: 0 2px 8px rgba(0,0,0,0.15);',
      '}',
      '.md-install-overlay__got-it:active {',
      '  transform: scale(0.97);',
      '  box-shadow: 0 1px 4px rgba(0,0,0,0.15);',
      '}',
      '.md-install-overlay__skip {',
      '  background: transparent; border: none;',
      '  color: rgba(255,255,255,0.7); font-size: 14px; font-weight: 400;',
      '  padding: 8px 16px; text-decoration: underline;',
      '  cursor: pointer; -webkit-appearance: none; appearance: none;',
      '  font-family: inherit;',
      '}',
      '.md-install-overlay__skip:active {',
      '  color: rgba(255,255,255,0.5);',
      '}'
    ].join('\n');
    document.head.appendChild(styleEl);

    var overlay = document.createElement('div');
    overlay.className = 'md-install-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-labelledby', 'md-install-title');

    // iOS Share icon (square with up-arrow) — inline SVG for crisp rendering.
    var shareIcon =
      '<svg class="md-install-overlay__share-icon" viewBox="0 0 22 28" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M11 0L5 6l1.4 1.4L10 3.8V18h2V3.8l3.6 3.6L17 6 11 0z"/>' +
        '<path d="M19 11h-3v2h3v13H3V13h3v-2H3a2 2 0 00-2 2v13a2 2 0 002 2h16a2 2 0 002-2V13a2 2 0 00-2-2z"/>' +
      '</svg>';

    // Share button location differs by device.
    // iPad: top of Safari toolbar. iPhone: bottom of Safari toolbar.
    var shareLocation = isIPad ? 'at the top of Safari' : 'at the bottom of Safari';

    overlay.innerHTML =
      '<h1 class="md-install-overlay__title" id="md-install-title">Add MD Today to your Home Screen</h1>' +
      '<p class="md-install-overlay__subtitle">It opens like a real app, works offline, and is one tap away.</p>' +
      '<div class="md-install-overlay__steps">' +
        '<div class="md-install-overlay__step">' +
          '<div class="md-install-overlay__step-num">1</div>' +
          '<div class="md-install-overlay__step-text">Tap ' + shareIcon + ' <strong>Share</strong> ' + shareLocation + '</div>' +
        '</div>' +
        '<div class="md-install-overlay__step">' +
          '<div class="md-install-overlay__step-num">2</div>' +
          '<div class="md-install-overlay__step-text">Tap <strong>Add to Home Screen</strong></div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="md-install-overlay__got-it">I&rsquo;ll do it now</button>' +
      '<button type="button" class="md-install-overlay__skip">Skip for now</button>';

    document.body.appendChild(overlay);

    // --- Helper: tear down the overlay (used by both buttons) ---
    function dismissOverlay() {
      overlay.parentNode.removeChild(overlay);
      styleEl.parentNode.removeChild(styleEl);
    }

    // --- Wire up "I'll do it now" (primary) ---
    // Dismisses for the current session only. Next fresh visit, overlay returns
    // (because the student hasn't installed yet, so they still need the prompt).
    var gotItBtn = overlay.querySelector('.md-install-overlay__got-it');
    gotItBtn.addEventListener('click', function () {
      try {
        sessionStorage.setItem('md_today_got_it_session', '1');
      } catch (e) {
        // sessionStorage blocked — fail silent.
      }
      // Note: we do NOT fire install-prompt-dismissed for "I'll do it now" because
      // this student is committing to install, not opting out. Tracking this as
      // "dismissed" would muddy the funnel.
      dismissOverlay();
    });

    // --- Wire up "Skip for now" (secondary) ---
    // Sets a 1-hour cooldown. Student is opting out for now.
    var skipBtn = overlay.querySelector('.md-install-overlay__skip');
    skipBtn.addEventListener('click', function () {
      try {
        localStorage.setItem(SKIP_KEY, String(Date.now() + SKIP_COOLDOWN_MS));
      } catch (e) {
        // localStorage blocked — overlay will reappear next load. Acceptable.
      }
      if (typeof window.mdTrackEvent === 'function') {
        window.mdTrackEvent('install-prompt-dismissed');
      }
      dismissOverlay();
    });

    // --- Fire shown event ---
    if (typeof window.mdTrackEvent === 'function') {
      window.mdTrackEvent('install-prompt-shown');
    }
  }

})();
