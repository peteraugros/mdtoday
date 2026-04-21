# MD Today — Project Summary

---

## ⚠️ MANDATORY — READ BEFORE EVERY SESSION

**DO NOT write, reconstruct, or overwrite any file from memory or from the spec.**

Before touching any code, ask the user to upload every file that will be modified in the session. Do not begin until those files are in the conversation. This is not optional.

**If a spec or build log says a file exists and is complete — that means the real file is on the user's disk. Ask for it. Do not recreate it.**

Overwriting a working file with a reconstructed one can destroy hours of work with no recovery path.

**After every Claude Code session, before committing, always run:**

```bash
git diff --stat HEAD
```

Verify that no files were deleted. If any `.html`, `.js`, `.ts`, or `.tsx` files appear as deleted, do NOT commit — investigate and restore before proceeding.

---

## What This Product Actually Is

Read this section before writing any code. Every design decision flows from it.

**MD Today is a real-time, offline-tolerant, explicitly self-reporting system of school schedule truth, where every display state includes both the schedule and its confidence level.**

The load-bearing clause is the second half. The schedule itself is table stakes — any app can render times. The product is the **confidence level alongside the schedule**. Without that, it's a schedule app. With it, it's a trust system.

### It is not a schedule app

The mental model of "schedule app" leads to the wrong decisions — feature creep, bulletin-board drift, visual polish for its own sake. The correct mental model is:

**MD Today is a one-tap state awareness system with three secondary lookup views.**

- The **Now view** is the product. Everything else supports it.
- Schedule, Days Off, and any future views are secondary retrieval surfaces.
- If a design decision makes secondary views nicer at the cost of the Now view, it is the wrong decision.

### The trust constraint

In a school context, accuracy is **not linear value. It is binary social permission.** There is no "70% reliable" state in student perception. An app is either the thing students check, or the thing that embarrassed someone last month. One wrong schedule at 8am gets talked about in every classroom by 9am, and "MD Today said…" becomes a punchline.

This reframes the engineering problem. We are not optimizing for accuracy percentage. We are engineering for **the absence of public failure events**. Those are different targets:

- Accuracy optimization says "get it right more often."
- Public-failure-absence optimization says "when you're uncertain, say so loudly enough that nobody is surprised."

The second is more achievable and is the actual product goal.

### The three-layer model (structural requirement for the Now view)

The Now view simultaneously exposes three independent state layers. These are not features. They are the entire product surface.

| Layer | What it shows | Update frequency |
|---|---|---|
| **Temporal state** | Current period, countdown to next transition | Every 1 second |
| **Schedule validity state** | Confirmed / Stale / Assumed (see below) | Every fetch (hourly per calendar refresh hint) |
| **Contextual deviation state** | Today's announcement, if present | Daily (set in morning, static thereafter) |

**Implementation consequence:** These three layers are three discrete DOM regions with independent update lifecycles. The temporal layer re-renders every tick; the validity and deviation layers stay mounted and stable. A naive implementation re-renders everything on the countdown tick and makes the announcement banner flicker every second. Structure this correctly from day one.

**Temporal layer has two rendering modes.** Most of the day, the Now view shows a single "current block" with one countdown. During the Upper/Lower lunch window, it shows both tracks side by side — Upper Lunch / Upper Classes vs Lower Classes / Lower Lunch — each with its own current block and countdown. This branching is a property of Mater Dei's schedule, not a UI choice. See the Template Catalog for why per-student track assignment was rejected.

### The three trust states (first-class visual design)

Every render of the Now view is in exactly one of three states. A student should recognize which state they are looking at in under 1.5 seconds, without reading the label — by color, layout, or icon, not prose.

| State | Condition | Visual treatment |
|---|---|---|
| **Confirmed** | Today has a calendar event whose SUMMARY matches a known template, AND the data was fetched within the freshness horizon (see below) | Normal, full-confidence UI. No warning, no caveat. |
| **Stale** | Showing cached data because the latest network fetch failed OR the cache is older than the freshness horizon | Subtle but visible indicator. "Last updated: [date]". Data still shown. |
| **Assumed** | Today is a weekday in the school year but no matching calendar event was found, or the event's SUMMARY is unknown to the summary map | Clearly marked as assumed. "Schedule assumed — confirm with your teacher." |

These are not fallback afterthoughts. They are the primary UI language of the product.

#### Data freshness horizon

"Fetched recently enough to be Confirmed" must be a named constant, not a vibe. Without it, cached data drifts into pseudo-confidence over time — technically present, practically outdated.

- Constant: `FRESHNESS_HORIZON_MS = 12 * 60 * 60 * 1000` (12 hours)
- Rule: if `Date.now() - data.lastFetch > FRESHNESS_HORIZON_MS`, the app MUST degrade to **Stale**, even if the last fetch technically succeeded and no new fetch has failed.
- 12 hours, not 24: a cache written Friday at 9am should not still read as "Confirmed" at 9am Monday. The horizon should be short enough that it crosses at least one attempted refresh cycle before confidence decays.
- The horizon is enforced at resolve time, not at fetch time. Every `resolveDay()` call rechecks freshness. This is why freshness is a derived state, not a stored flag.

#### Offline vs. trust state (two independent axes)

Transport status and schedule-confidence status are **different axes**. A clean mental separation prevents "let me just add an isOnline flag" drift.

| Transport | Cache state | Resulting trust state |
|---|---|---|
| Fetch succeeded, data fresh | N/A | **Confirmed** (if SUMMARY matches) or **Assumed** (if not) |
| Fetch failed | Cache present | **Stale** |
| Fetch failed | Cache absent | **Offline fallback screen** (not a trust state — the product is non-functional) |
| Fetch succeeded long ago, no recent attempt | Cache older than horizon | **Stale** |

Offline is a transport failure, not a schedule judgment. If we have cache, we render Stale. If we don't, we show the dedicated offline screen. Do not conflate these.

### Time-to-decision, not speed-to-answer

The Now view optimization target is **cognitive compression per second of attention**, not visual polish and not raw render speed. A student in a hallway, walking, holding a backpack strap, has about 1.5 seconds to make a behavioral decision before putting the phone away. Every pixel should move them one step closer to that decision. Elements that don't serve a decision are noise.

Rule: If a design choice improves speed but hides uncertainty, it is the wrong choice.

### The Now view acceptance test

This is the single test that determines whether the Now view is done. It supersedes any individual feature-level ship criterion.

**A student opens the Now view mid-transition. In under 1.5 seconds, without reading any sentences, they can answer:**

1. **Where am I?** (period / passing / before school / after school)
2. **How long do I have?** (countdown to next transition)
3. **Can I trust this?** (visual trust state — Confirmed / Stale / Assumed — read by color and iconography, not text)
4. **Is today unusual?** (announcement present or absent, visible at a glance)

If answering any of these requires reading a full sentence, the Now view has missed the bar and is not done. This test is non-negotiable. Use it on real students in real hallway conditions — not at a desk with a coffee.

---

## Philosophy

MD Today is **not** Day & Knight. Day & Knight is a multi-tenant SaaS platform with auth, realtime sockets, payments, and video. MD Today is a **read-only information display** for a single school. The architecture must reflect that.

**Bulletproof = boring.** Every dependency is a failure mode. Every build step is a thing that can break on a Monday morning. Every server is a thing that can go down during homeroom. The app must work when the school WiFi is flaky, when the maintainer is asleep, and when something goes wrong three months from now and nobody remembers how it was built.

**Five principles for MD Today:**

1. **No backend.** The school's published iCal feed + a Google Sheet of bell templates are the backend. Period.
2. **No framework lock-in.** A student with basic HTML/CSS/JS skills should be able to read the entire codebase.
3. **Offline-first.** The app must render a useful screen with zero network requests on second load.
4. **One file per view.** No build step in v1. Drop on any static host.
5. **Graceful degradation.** If the sources are unreachable, show cached data. If the cache is empty, show a clear fallback. Never show a blank screen.

---

## Data Sources (the big architectural decision)

MD Today rides on **two data sources with clearly separated responsibilities**:

### Source 1: Mater Dei's published iCal feed (authoritative for dates)

The school publishes their full academic calendar as a standard iCal (`.ics`) feed through their Edlio CMS. This feed contains ~1,500 events per school year including every day-type assignment, mass, rally, exam, break, and school event.

The feed is:
- **Structured** (standard iCal format, unambiguous to parse)
- **Officially maintained** by the school — when a schedule changes, the school updates this calendar for their own operational reasons
- **Hourly-refreshable** (the feed explicitly sets `REFRESH-INTERVAL:PT1H`)
- **Year-scoped** — the URL changes each school year but the format is consistent year-over-year

Critical properties:
- Each event's `SUMMARY` string uses a controlled vocabulary like `"RED: B. 1, 3, 5, 7"`, `"GRAY (Late Start): B. 2, 4, 6, 8"`, `"RED (Mass Schedule): B. 1, 3, 5, 7"`. This is the day-type assignment.
- Non-schedule events also appear in the same feed (`"All School Mass - Ash Wednesday"`, `"Homecoming Rally"`, `"AP Biology Exam"`). These become announcement candidates.
- Date-only events use `DTSTART;VALUE=DATE:YYYYMMDD` — no time zone games needed for most entries.

**We do not maintain this data. The school does, for their own reasons.** That's the biggest trust upgrade the architecture has: an authoritative source we don't own.

### Live URLs (v1)

These are the exact URLs the app fetches. They live in `js/data.js` as constants and in `README.md` for human reference.

- **iCal feed:** `https://www.materdei.org/apps/events/ical/?id=33`
- **Templates CSV:** `https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=0&single=true&output=csv`
- **Summary Map CSV:** `https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=504710999&single=true&output=csv`

The two CSV URLs share the same document ID (`2PACX-1vRomv...`) and differ only in `gid` — each tab of the sheet has its own `gid`. The `Automatically republish when changes are made` setting is enabled on the sheet, so edits propagate to these URLs within a minute or two.

The iCal URL is year-scoped — Mater Dei publishes a new feed for each school year (`id=33` is the 2025–2026 identifier). Expect to update this constant each June.

### Source 2: Google Sheet (authoritative for bell-time templates)

The Sheet's only job is to define **bell-time templates** and a **summary map** that translates calendar SUMMARY strings into template IDs.

Two tabs:

**Tab 1: `templates`** — bell-time block definitions

| template_id | block_order | block_name | start_time | end_time | track |
|---|---|---|---|---|---|
| red_regular | 1 | Block 1 | 08:00 | 09:15 | |
| red_regular | 2 | Block 3 | 09:20 | 10:45 | |
| red_regular | 3 | Block 5 (Lower Class) | 10:50 | 12:05 | lower |
| red_regular | 3 | Upper Lunch | 10:50 | 11:30 | upper |
| red_regular | 4 | Upper Classes | 11:35 | 12:50 | upper |
| red_regular | 4 | Lower Lunch | 12:10 | 12:50 | lower |
| red_regular | 5 | Block 7 | 12:55 | 14:10 | |
| ... | ... | ... | ... | ... | |

The `track` column encodes the Upper/Lower lunch split. Most blocks apply to all students — these rows have a blank `track`. During the lunch window, the schedule branches into two parallel tracks that run simultaneously:

- `track = upper` — students with Upper Lunch (eat first, then class)
- `track = lower` — students with Lower Lunch (class first, then eat)
- blank — applies to everyone (used for all non-lunch blocks, plus for Mass/Rally where every student is in the same place)

The same `block_order` value appears on both track rows in the lunch window. This is intentional: it means "same slot in the sequence, two parallel tracks." The resolver filters rows by current time and returns one row (blank track) or two rows (upper + lower) for the Now view to render.

**Why this design:** a student's lunch assignment is a property of the class they're enrolled in during the lunch window, not a property of the student. A student might be Upper on Red days and Lower on Gray days because their 5th and 6th period classes are different courses. Self-classification per student would silently lie; rendering both tracks during the ambiguous window is honest.

**Tab 2: `summary_map`** — calendar SUMMARY → template_id

| calendar_summary | template_id |
|---|---|
| RED: B. 1, 3, 5, 7 | red_regular |
| GRAY: B. 2, 4, 6, 8 | gray_regular |
| RED (Late Start): B. 1, 3, 5, 7 | late_start |
| GRAY (Late Start): B. 2, 4, 6, 8 | late_start |
| RED (Mass Schedule): B. 1, 3, 5, 7 | mass |
| GRAY (Mass Schedule): B. 2, 4, 6, 8 | mass |
| RED (Rally Schedule): B. 1, 3, 5, 7 | rally |
| GRAY (Rally Schedule): B. 2, 4, 6, 8 | rally |
| RED (Pair Day - Early Dismissal): B. 1, 3, 5, 7 | pair_early |
| GRAY (Pair Day - Early Dismissal): B. 2, 4, 6, 8 | pair_early |
| GRAY (Pair Day - Late Start): B. 2, 4, 6, 8 | pair_late |
| RED (Special Schedule) | fallback |
| GRAY (Special Schedule) | fallback |
| RED (Special Schedule): B. 1, 3, 5, 7 | fallback |
| GRAY (Special Schedule): B. 2, 4, 6, 8 | fallback |
| RED (Special Rally Schedule) | fallback |
| RED (Special Mass Schedule - Early Dismissal): B. 3, 4, 5, 6 | fallback |
| GRAY (Special Mass Schedule) | fallback |
| Special Online Schedule: B. 1, 2, 7, 8 | fallback |

These are the actual rows present in the live sheet as of the 2025–2026 school year. Nineteen distinct SUMMARY strings, ten template_ids referenced. When Mater Dei adds a new schedule variant to their calendar, it appears as an unmapped SUMMARY (triggering Assumed state) until a row is added here.

Both tabs publish to CSV. The app fetches both, plus the iCal feed, and does the join client-side.

**Why this split:** The calendar owns "what kind of day is it." The sheet owns "what does that kind of day look like block-by-block." Those are two different kinds of data maintained by two different kinds of authority, and mixing them is what made the original Sheet-only design fragile.

### Source 3: Nothing else

There is no database, no backend API, no authentication system, no CMS. The entire data layer is two CSV URLs and one iCal URL.

---

## Template Catalog (v1 — 2025–2026)

The populated sheet contains **10 templates** covering every bell schedule Mater Dei runs:

| template_id | rows | block duration | description |
|---|---|---|---|
| `red_regular` | 8 | 75 min | Regular Red Day (Blocks 1, 3, 5, 7) |
| `gray_regular` | 8 | 75 min | Regular Gray Day (Blocks 2, 4, 6, 8) |
| `monday_homeroom` | 9 | 75 min | Monday schedule with Homeroom & Announcements block |
| `late_start` | 8 | 75 min | Wednesday Late Start (8:45 start, faculty PLC first) |
| `mass` | 9 | 60 min | Mass Schedule (Mass 10:30–11:55 replaces Block 5/6 position) |
| `rally` | 9 | 60 min | Rally Schedule (Rally 10:30–11:35, shorter than Mass) |
| `pair_early` | 8 | 60 min | Pair Day Early Dismissal (out at 13:20) |
| `pair_late` | 8 | 60 min | Pair Day Late Start (9:00 start) |
| `minimum_day` | 5 | 60 min | Minimum Day (dismissed 12:45, no lunch block, shared Nutrition break) |
| `fallback` | 1 | — | Placeholder for Special Schedule variants where bell times are unknown |

### The `fallback` template convention

When a calendar SUMMARY matches but the bell times can't be pre-specified (e.g., Mater Dei's various `Special Schedule`, `Special Mass Schedule`, `Special Rally Schedule`, `Special Online Schedule` variants — these are announced ad-hoc), the sheet maps them all to `fallback`.

`fallback` is a single-row template whose `block_name` is the student-facing message: "Special Schedule — check with your teacher." It renders from 08:00–15:00 as a single all-day placeholder.

This gives us three honest states:
- **Matched template with known times** → normal render, Confirmed state
- **Matched template with unknown times** (maps to `fallback`) → placeholder render, Confirmed state ("we recognize today is weird, and we're telling you we don't know the details")
- **Unmatched SUMMARY** → Assumed state ("we don't recognize today at all")

These are meaningfully different situations and the app communicates each one distinctly.

### Monday Homeroom — resolver logic, not data

The iCal feed does **not** distinguish Monday Red Days from Tuesday or Friday Red Days — they all carry the SUMMARY `"RED: B. 1, 3, 5, 7"`. But Mater Dei runs the Monday Homeroom schedule on every Monday that school is in session.

This is handled in `resolve.js`, not in the sheet. The resolver applies the following rule:

> If today is a Monday AND the matched template is `red_regular` or `gray_regular`, substitute `monday_homeroom` instead.

The Red/Gray distinction is preserved for labeling (so students see "Monday Red" not just "Monday"), but the bell times come from `monday_homeroom`. This is a localized resolver convention, not a general pattern — if Mater Dei ever publishes a distinct `MONDAY` SUMMARY in future school years, this rule should be removed in favor of explicit mapping.

---

## Technology Stack (v1)

### Frontend

| Layer | Choice | Why |
|---|---|---|
| Markup | **Vanilla HTML** | No framework to learn, no build step to break, loads instantly |
| Styling | **Vanilla CSS with CSS variables** | Design tokens in `:root`, no Tailwind CLI, no PostCSS |
| Behavior | **Vanilla JavaScript (ES modules)** | Native browser support, no bundler, no transpile step |
| PWA shell | **Service Worker + Web App Manifest** | Offline cache, installable to home screen, no library needed |
| Calendar fetch | **`fetch()` against Mater Dei iCal URL** | Zero config |
| Calendar parse | **[ical.js](https://github.com/kewisch/ical.js/) via CDN** | Official Mozilla-maintained iCal parser, handles all the edge cases (timezones, all-day events, escape sequences) |
| Sheet fetch | **`fetch()` against published Google Sheet CSV** | Zero config, CORS works out of the box |
| CSV parsing | **[PapaParse](https://www.papaparse.com/) via CDN** | 45KB, battle-tested, handles edge cases |
| Date math | **Native `Date`** | Native is enough; dayjs via CDN only if we hit a real need |
| Host | **GitHub Pages, Netlify, or Cloudflare Pages** | Free, instant deploys from git push, no server to maintain |

### What we are explicitly NOT using

| Rejected | Why |
|---|---|
| React / Vue / Svelte | Four static-ish views. Framework cost > benefit. |
| TypeScript + build step | Makes emergency fixes harder. A typo at 7am before school is not the time to debug a Vite config. |
| Tailwind | Four views worth of CSS is under 500 lines. Utility framework adds tooling weight for no payoff at this scale. |
| Any backend framework | Nothing to authenticate. Nothing to persist. Data lives in Mater Dei's calendar + a Sheet. |
| Any database | iCal feed + Sheet are the database. |
| Any auth system | No login. No user accounts. |
| Web scraping of Mater Dei's HTML pages | We have the iCal feed. The HTML pages are never touched. |
| Push notifications | Out of scope for v1. Adds service worker complexity. |
| npm / node_modules | Zero dependencies installed locally. CDN imports only. If CDN dies, vendor the one file. |

**The entire v1 stack is: HTML + CSS + JS + Service Worker + ical.js + PapaParse + an iCal feed + a Google Sheet.** That is the whole thing.

---

## The Resolution Pipeline (core logic)

This is the central algorithm. Given today's date, produce a resolved template with a trust state.

```
1. Fetch iCal feed (cached, hourly TTL)
   → on failure: use cached events, mark trustState = 'stale'

2. Fetch Sheet CSVs (cached, daily TTL)
   → on failure: use cached templates, still usable

3. For today's date, find matching VEVENT(s) from the feed
   → filter: events where DTSTART date equals today in US/Pacific

4. Among today's events, find the SCHEDULE EVENT
   → a schedule event has a SUMMARY that matches a row in summary_map
   → there should be exactly one per school day
   → 0 matches → no schedule event → Assumed state
   → 2+ matches → data inconsistency, log warning, use first match, Stale state

5. Resolve template from matched SUMMARY → template_id → blocks from templates tab
   → if template_id not found in templates tab → Assumed state, log error

6. Collect ANNOUNCEMENT EVENTS from today
   → any other events today whose SUMMARY does NOT appear in summary_map
   → filter for meaningful ones (see announcement rules below)
   → first qualifying announcement becomes the deviation layer content

7. Return { template, announcement, trustState, lastFetch }
```

This pipeline runs once per app load, then the temporal layer ticks off the resolved template without re-running the pipeline. The pipeline re-runs on visibility change (tab becomes active after being hidden for an hour+) and on explicit manual refresh.

---

## Bulletproofing the v1 Build

Bulletproof means the app works on a bad day. The bad day scenarios we design for:

### Failure mode 1: The iCal feed is unreachable

**Cause:** Mater Dei's CMS down, feed URL changed for the new school year and we haven't updated the hardcoded URL, network failure, CORS hiccup.

**Defense:**
- Every successful iCal fetch writes the raw feed text + parsed events to `localStorage` with a timestamp
- On load, the app renders from `localStorage` immediately (instant paint), then fetches fresh data in the background
- If fetch fails, the app enters the **Stale** trust state — cached events remain visible with a "Last updated: [date]" indicator
- If `localStorage` is empty AND fetch fails, show a clear fallback screen: "MD Today is offline. Check with the front office for today's schedule."
- Log the fetch URL and failure reason to console for diagnosis

### Failure mode 2: Mater Dei renames a calendar event

**Cause:** The school changes `"RED: B. 1, 3, 5, 7"` to `"Red Day"` or adds/removes whitespace or punctuation. This is the single most likely real-world failure.

**Defense — two-stage pipeline:**

**`sanitizeSummary()` — protects the user experience**
- Trims leading/trailing whitespace
- Collapses multiple internal spaces to single spaces
- Leaves case intact (the school's summaries are case-consistent — do not lowercase)
- Does NOT decide correctness. Only normalizes human inconsistency.

**`resolveTemplate()` — protects the system**
- Looks up the sanitized SUMMARY in the summary_map
- If not found, the date falls into the **Assumed** trust state
- Logs the unmapped SUMMARY to console so the maintainer can see what to add to the sheet
- Does NOT crash, does NOT silently substitute

**Runtime behavior:**
- Sanitization runs first. It cannot fail — it just cleans.
- Resolution runs second. If it fails, the app falls back to Assumed and continues.

The summary_map is the single bottleneck where all calendar drift is handled. When the school changes a SUMMARY, exactly one row in one sheet needs to be updated.

### Failure mode 3: The Google Sheet has bad data

**Cause:** Typo in a time, missing template reference, blank row, wrong date format, inconsistent time formatting (`8:00` vs `08:00` vs `8:00 AM`).

**Defense:**

**`sanitizeSheet()`** — trims whitespace, coerces time formats to canonical `HH:MM` 24-hour, lowercases/trims `template_id` references, treats empty rows as absent.

**`validateSheet()`** — every `template_id` referenced in `summary_map` exists in `templates`; every `start_time` and `end_time` parses; no duplicate `(template_id, block_order)` pairs; blocks within a template don't overlap.

**Principle: Validation protects the system. Sanitization protects the user experience.** Mindset rule: **assume the sheet is always slightly wrong.** Not maliciously — just human error. Design every parser, every coercion, every lookup with that assumption baked in.

### Failure mode 4: Today has no schedule event at all

**Cause:** School hasn't added next week to the calendar yet, data gap, weekend, holiday, or non-instructional weekday.

**Defense:**
- First, check if today has any event with SUMMARY containing keywords like "Break", "Holiday", "No School" — if so, today is a day off, render the Days Off view or a "No school today" state
- Otherwise, the app enters the **Assumed** trust state
- Renders a fallback template (a neutral "Regular Day" marked as default in the templates sheet)
- The Assumed state is visually distinct and labeled: "Schedule assumed — confirm with your teacher"
- Do not crash, do not show a blank screen, do not silently fake confidence

### Failure mode 5: The iCal URL changes for a new school year

**Cause:** Mater Dei publishes `2026-2027` calendar at a new URL. Known, expected: happens once per year.

**Defense:**
- The feed URL lives in a single constant at the top of `data.js`
- A comment in that file flags it as a once-per-year update
- A reminder in the project README describes how to update it each June
- If the old URL returns an empty feed or 404, the app falls into Stale state with cached data from the previous year — NOT a crash
- Bonus: if the feed's `X-WR-CALNAME` indicates a prior school year relative to today's date, log a console warning prompting the maintainer to update the URL

### Failure mode 6: The service worker caches a broken version

**Cause:** Bad deploy, incomplete cache write, version skew.

**Defense:**
- Service worker uses **stale-while-revalidate** for the app shell
- HTML is always fetched fresh (network-first) so new deploys propagate immediately
- CSS/JS/icons are cache-first with a versioned cache name (`mdtoday-v1.0.3`)
- Bumping the cache version on deploy forces cleanup of old caches
- A visible build version in the footer (`v1.0.3`) so the user can confirm which version is running

### Failure mode 7: Phone clock is wrong

**Cause:** Traveler just landed, date/time set manually wrong.

**Defense:**
- Use the phone's local time for "what period is it now" (no way around this without a backend)
- Display the current date prominently in the header so a mismatch is visible at a glance
- This is a known limitation, documented, not hidden

### Failure mode 8: Student has zero network signal

**Cause:** On the bus, basement classroom, dead zone.

**Defense:**
- PWA shell loads from service worker cache — entire app opens with zero network
- `localStorage` holds the full parsed iCal feed + sheet data from the last successful fetch
- Countdown timer works entirely client-side, no network dependency
- "Now" view is fully functional offline (in Stale trust state if cache isn't fresh)

### Failure mode 9: Event timezone ambiguity

**Cause:** iCal events can use `DTSTART;VALUE=DATE:YYYYMMDD` (all-day, timezone-less) or `DTSTART;TZID=...:YYYYMMDDTHHMMSS` (timed events). Mater Dei's schedule events are all-day; mixing timezone logic wrong can put an event on the wrong day.

**Defense:**
- Use ical.js for parsing — it handles this correctly. Do NOT try to parse iCal by hand.
- For "is this event today," compare the event's date in `US/Pacific` to today's date in `US/Pacific`, using the phone's view of "today" but the school's timezone.
- Write unit tests for the date-matching logic with events around DST boundaries.

---

## File Structure (v1)

```
mdtoday/
├── index.html              ← Home / Now view (default)
├── schedule.html           ← Full template render
├── daysoff.html            ← Upcoming days off
├── css/
│   └── styles.css          ← All styles. Single file. Under 500 lines.
├── js/
│   ├── data.js             ← iCal + Sheet fetch, sanitize, validate, cache
│   ├── resolve.js          ← The resolution pipeline (date → template + announcement + trust state)
│   ├── schedule.js         ← Current period / next period logic
│   ├── countdown.js        ← Tick timer for Now view (temporal layer only)
│   └── app.js              ← View routing + render orchestration
├── sw.js                   ← Service worker (cache strategy)
├── manifest.json           ← PWA manifest (icons, theme color, name)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
└── README.md               ← How to update the sheet, update the iCal URL, deploy
```

**Total file count target: under 15 files.** If you are adding a new file, justify it.

---

## Core Modules

### `js/data.js` — Fetch + sanitize + validate + cache

Responsibilities:
- Fetch the iCal feed, parse with ical.js
- Fetch both Google Sheet CSV tabs, parse with PapaParse
- Run sanitizers on each source
- Run validators on each source
- Write to `localStorage` on success
- Read from `localStorage` on failure
- Return a normalized data object

Constants:
```js
export const FRESHNESS_HORIZON_MS = 12 * 60 * 60 * 1000; // 12 hours
```

Contract:
```js
export async function loadData() {
  // Returns {
  //   events,           // parsed VEVENTs from iCal
  //   templates,        // { template_id: [blocks...] }
  //   summaryMap,       // { "RED: B. 1, 3, 5, 7": "red_regular", ... }
  //   lastFetch,        // ISO string — timestamp of the successful fetch this data came from
  //   source,           // 'network' | 'cache' | 'mixed' | 'none'
  //   warnings          // array of non-fatal issues (e.g. unmapped SUMMARYs)
  // }
  // Never throws. On total failure, returns empty object with source: 'none'
}

export function isFresh(lastFetch) {
  // Returns boolean — called by resolveDay() to decide Confirmed vs Stale
  return Date.now() - new Date(lastFetch).getTime() < FRESHNESS_HORIZON_MS;
}

export function sanitizeSummary(raw) { /* trim, collapse spaces */ }
export function sanitizeSheet(rawParsed) { /* normalize, cannot fail */ }
export function validateSheet(sanitized) { /* throws on structural error */ }
```

### `js/resolve.js` — The resolution pipeline

Given the data from `loadData()` and a date, produce a resolved view of that day. This module owns trust-state determination — it is the only place that decides Confirmed vs Stale vs Assumed. It reads `lastFetch` from the data object and compares against `FRESHNESS_HORIZON_MS` via `isFresh()`.

It also owns the Monday substitution rule: when today is a Monday and the matched template is `red_regular` or `gray_regular`, the resolver substitutes `monday_homeroom` while preserving Red/Gray labeling in the trust-state text. See the Template Catalog section for rationale.

Contract:
```js
export function resolveDay(data, date = new Date()) {
  // Returns {
  //   template,         // { template_id, blocks: [...] } or null
  //   announcement,     // string or null
  //   isDayOff,         // boolean
  //   dayOffLabel,      // string if isDayOff
  //   dayLabel,         // string for UI: "Red Day", "Gray Day", "Monday Red", etc.
  //   trustState,       // 'confirmed' | 'stale' | 'assumed' | 'offline'
  //   unmatchedSummary  // string if today's event SUMMARY wasn't in summary_map (for debugging)
  // }
  //
  // Trust state logic (applied in order):
  //   1. If data.source === 'none' → 'offline'
  //   2. If !isFresh(data.lastFetch) → 'stale' (even if event matches)
  //   3. If no matching event today → 'assumed'
  //   4. If event matched and fresh → 'confirmed'
  //
  // Monday substitution (applied before trust state determination):
  //   If date.getDay() === 1 (Monday) AND matched template_id is 'red_regular' or 'gray_regular':
  //     substitute 'monday_homeroom' as the template
  //     preserve original day-type in dayLabel ("Monday Red" / "Monday Gray")
}
```

### `js/schedule.js` — Current period / next period

Responsibilities:
- Given a resolved template and the current time, return current period + next period
- Handle edge cases: before school, passing period, between blocks, after school, weekend
- Handle the Upper/Lower lunch branch window — during that window, two parallel tracks are active simultaneously

Contract:
```js
export function getCurrentStatus(template, now = new Date()) {
  // Returns {
  //   status,                    // 'before' | 'period' | 'passing' | 'after'
  //   currentBlock,              // for simple (blank-track) blocks: the single current block
  //                              // for the lunch window: null (use currentTracks instead)
  //   currentTracks,             // { upper: block, lower: block } during the lunch window, else null
  //   nextBlock,                 // the next upcoming block (shared blocks) or null during lunch branching
  //   secondsToNextTransition    // number — to whichever transition comes first across tracks
  // }
}
```

**Track branching rule:** during any time window where two `track`-tagged blocks overlap, the resolver returns both as `currentTracks: { upper, lower }` and sets `currentBlock` to null. Outside branching windows, `currentBlock` is populated and `currentTracks` is null. The Now view renders these as two UI paths — one side-by-side branch view, one standard single-block view — selected by which field is populated.

### `js/countdown.js` — Tick timer (temporal layer only)

Responsibilities:
- Re-render **only the temporal DOM region** every 1 second
- Do NOT touch the validity or deviation DOM regions on tick
- Handle tab visibility (pause when hidden, resync on focus)
- On focus after long hiddenness (>1 hour), trigger a data refresh via `data.js`
- Clean shutdown on navigation

This module is scoped to the temporal layer of the three-layer model. If it is re-rendering anything else, it is wrong.

### `js/app.js` — View orchestration

Responsibilities:
- Detect which view is loaded (by filename or hash)
- Call the right render function
- Handle navigation (simple `<a>` links work fine — no SPA routing)
- On Now view: mount the three DOM regions (temporal / validity / deviation) once, then hand each region to its respective renderer

---

## The `announcement_text` Rule (non-negotiable)

Announcements now come from **non-schedule events in the iCal feed** — events whose SUMMARY does not match the summary_map. Examples: `"All School Mass - Ash Wednesday"`, `"Homecoming Rally"`, `"AP Biology Exam"`, `"Back to School Night"`.

The announcement field is **state modification metadata, not content.** It is the retention perturbation mechanism of the product and it works only if the signal stays uncontaminated.

### The operational filter

Before an event becomes an announcement, it must pass a relevance filter: **does this event change how a student should behave today compared to a normal day?**

**Pass automatically** (render as announcement):
- Events containing keywords: `Mass`, `Rally`, `Exam`, `Testing`, `Dismissal`, `Late Start`, `Minimum Day`, `No School`, `Holiday`
- Events that share a date with a known schedule modifier (`Mass Schedule`, `Rally Schedule`, etc.) — in this case, render a shorter version of the non-schedule event name

**Fail automatically** (do NOT render):
- Athletic events (`V Boys Basketball @ ...`)
- Fundraisers, banquets, reunions
- Spirit dress days (these do not change schedule behavior)
- Faculty-only events
- Events outside school hours (evening, weekend)

The keyword and exclusion lists live in `resolve.js` as constants. They are tunable — this is the one area where v1 will need iteration once real announcements start appearing.

### Fallback to manual override (v2)

If the calendar-derived announcement doesn't cover a real-world case (e.g., fog delay announced at 7am), the maintainer can override today's announcement via an `override_announcement` column in a small `overrides` sheet tab. This is an intentional v2 feature, not v1. See Future.

### Why this matters

The announcement introduces controlled entropy into an otherwise deterministic system. That is what keeps students opening the app — not because the schedule changed, but because they don't know whether it changed until they check. If the channel gets polluted with irrelevant school news, it becomes a bulletin board, students learn to ignore it, and when a real schedule change goes there it gets missed.

**MD Today is a schedule truth interface. It is not a bulletin board, a news feed, or a school communication app.**

### Known limitation: announcements communicate, they do not override

An announcement can say "Fog delay — 4th period delayed 20 minutes" but it does not change the countdown logic — the temporal layer still reads the unchanged template. For v1 this is an accepted tradeoff: the announcement tells the student the truth, even if the timer shows the scheduled version. A full structural override layer is logged as a v2 feature.

---

## Design System

### Colors

```css
:root {
  --md-red: #B71C1C;           /* Mater Dei red — verify against brand guide */
  --md-white: #FFFFFF;
  --md-gray-bg: #F5F5F5;
  --md-gray-text: #424242;
  --md-gray-border: #E0E0E0;
  --md-accent: #1A237E;        /* Deep blue accent for announcement banners */
  --md-success: #2E7D32;       /* Confirmed trust state */
  --md-warn: #F57F17;          /* Stale trust state */
  --md-uncertain: #6A1B9A;     /* Assumed trust state — distinct from warn */
}
```

Trust states map to color but must also differ in layout or iconography so color-blind users can distinguish them at a glance.

### Typography

- System font stack — no web font download, zero latency
- `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

### Sizing

- Base font size 18px (readable on a phone at arm's length in a classroom)
- Primary touch targets minimum 48×48px (thumb-friendly)
- Max content width 480px (phone-first; looks fine on desktop but not optimized for it)

---

## Build Order (v1)

### Phase 0: Data sources first, code second — ✅ COMPLETE

1. ✅ iCal feed URL confirmed stable: `https://www.materdei.org/apps/events/ical/?id=33`
2. ✅ Google Sheet `MD Today — Data` created with two tabs: `templates` and `summary_map`
3. ✅ Every schedule SUMMARY from the 2025–2026 feed enumerated and transcribed — 10 templates, 73 rows in `templates` tab
4. ✅ `summary_map` populated with 19 rows covering every schedule-representing SUMMARY
5. ✅ Both tabs published as CSV, URLs recorded in `README.md` and in the Live URLs section of this document
6. ✅ Republish-on-change enabled on the sheet

**Phase 0 outputs:** see the Template Catalog section (above) for the template list, and the Live URLs section for the fetch endpoints.

### Phase 1: Data layer (headless)

1. Build `data.js` — fetch iCal + both CSV tabs, sanitize, validate, cache
2. Build `resolve.js` — the resolution pipeline end-to-end
3. Build `schedule.js` — current period / next period logic
4. Test in browser console: `loadData().then(data => resolveDay(data)).then(console.log)`
5. Write 10-15 edge case assertions in a scratch file:
   - Today is a Red Day → resolves correctly, trustState = Confirmed
   - Today is a Rally Day → resolves with rally template, trustState = Confirmed
   - Today is Thanksgiving → resolves as day off
   - Today has no event → Assumed state
   - Today's SUMMARY isn't in summary_map → Assumed state, unmatchedSummary logged
   - Network failure, cache present → Stale state with cached data
   - Network success, but cache timestamp is older than FRESHNESS_HORIZON_MS → Stale state even though the data matches (freshness enforced at resolve time)
   - Both sources fail, no cache → source = 'none', trustState = Offline
   - Today has a Mass event on a regular Red Day → announcement populated
   - Today has an AP Exam event → announcement populated
   - Today has a basketball game event → announcement NOT populated (excluded by filter)
   - Day crossing midnight DST boundary → correct day resolves

**Ship criterion:** Given any real-world state of the two sources, `loadData()` → `resolveDay()` returns sensible values without crashing, and `trustState` accurately reflects the data situation.

### Phase 2: Now view (three-layer mount)

1. `index.html` mounts three DOM regions: temporal, validity, deviation
2. Each region has its own render function operating on its own slice of state
3. `countdown.js` ticks the temporal region only
4. Validity region renders trust state badge (confirmed / stale / assumed)
5. Deviation region renders the announcement if present, is hidden if empty
6. Works offline after one load

**Ship criterion:** The Now view passes the acceptance test defined in "What This Product Actually Is." All four questions answerable in under 1.5 seconds without reading sentences, tested on a real student in real hallway conditions.

### Phase 3: Schedule view

1. `schedule.html` renders today's template as a clean table
2. One tap from `index.html`
3. Trust state indicator carries over from Now view — if today is Assumed, the schedule view must say so too

### Phase 4: PWA shell

1. `manifest.json` with icons and theme color
2. `sw.js` with stale-while-revalidate for shell, network-first for HTML
3. Test: airplane mode, reload, still works (enters Stale trust state correctly)

**Ship criterion:** Add to home screen on iOS and Android, open without network, usable, trust state reads as Stale.

### Phase 5: Days Off + polish

1. `daysoff.html` — iterate through future events, surface ones matching day-off keywords
2. "Last updated" indicator refinement
3. Fallback screens copy reviewed
4. Verify time-to-decision in hallway-simulation test (walk past the app held in one hand, confirm state is readable in one glance)

### Phase 6: Deploy

1. Push to GitHub
2. Enable GitHub Pages (or Netlify / Cloudflare Pages)
3. Share URL with three students for a week of real-world testing before wider launch
4. Log the iCal URL rotation task: **every June, check if the URL has rolled over to the next school year, and update the constant in `data.js` accordingly.**

---

## Working Rules (inherited from Day & Knight, adapted)

1. **Always request current file before editing.** Never reconstruct from memory.
2. **Surgical fixes only.** Do not "clean up while you're there" without being asked.
3. **After every Claude Code session:** run `git diff --stat HEAD` before committing. No file deletions without an explicit reason.
4. **When debugging, ask for more details first.** Do not guess the cause. Ask for error text, console logs, the specific event SUMMARY, the specific sheet row.
5. **Log full error objects.** Use `console.error('Context:', { err })` not just `console.error(err.message)`.
6. **Commit after every working change.** Small commits, clear messages. Never batch unrelated changes.
7. **If the iCal SUMMARY vocabulary changes, the summary_map changes first, then everything else follows.** Never let code diverge from the sheet silently.
8. **Never parse iCal by hand.** Use ical.js. The edge cases (escapes, folded lines, timezones, RRULEs) are not worth re-implementing.
9. **When in doubt about a design choice, ask: does this make the trust state clearer or muddier?** Muddier is always wrong, even if it looks nicer.
10. **The three-layer model is architectural.** If the temporal tick is re-rendering validity or deviation, it is a bug, not a preference.
11. **Never pollute the announcement channel.** Anything that doesn't change student behavior belongs elsewhere or nowhere.
12. **Update this `claude.md` file at the end of each session** with notable changes, gotchas, and new conventions.
13. **Every implementation decision is either preserving or weakening the core invariant** ("every display state includes both the schedule and its confidence level"). If a change doesn't preserve it, don't make the change — even if it looks nicer, feels cleaner, or saves code. The invariant is load-bearing; the rest is details.

---

## Launch Risk Register

The architecture has eliminated most technical failure modes. What remains are three real risks that cannot be solved by code alone — they require discipline and testing before launch.

### Risk 1: `summary_map` incompleteness at launch

If even one common calendar SUMMARY isn't mapped when the app ships, students will hit the Assumed state on a normal day. Visible uncertainty on day one → perceived unreliability → binary trust failure. The app dies before it starts.

**Mitigation:**
- Before launch, run `grep "SUMMARY:" calendar.ics | sort -u` against the full school-year feed
- Map every SUMMARY that could plausibly represent a schedule day
- For ambiguous SUMMARYs, err on the side of mapping them — an extra row in the sheet costs nothing; a missing one costs the launch
- Run the app against every date in the school year in dev and confirm zero Assumed days on known school days

### Risk 2: Announcement noise drift

If irrelevant events slip through the filter, students stop scanning the banner. The banner is the only change-detection mechanism in the product. Losing it means losing the retention hook and losing the ability to communicate real schedule deviations when they happen.

**Mitigation:**
- Be strict in v1 — the keyword allowlist is small, the exclusion list is explicit
- Review every announcement that fires during the first month of real use
- Loosen the filter only in response to a specific missed event, never preemptively
- Never let the filter drift toward "show more events to be safe" — that's the failure direction

### Risk 3: Visual ambiguity between trust states

If Confirmed / Stale / Assumed look too similar, students won't distinguish them, and the entire trust model collapses. The spec calls for under 1.5 seconds of glance recognition — "tasteful subtle differences" fails this test.

**Mitigation:**
- Trust state differences must be **visually undeniable**, not tasteful — color, iconography, and layout together, not color alone
- Test with real students in real hallway conditions (phone held one-handed, walking, glance of under 2 seconds)
- If a test subject has to look twice, the design has failed — redo it, don't rationalize it
- This is the one area where heavy-handed design is correct

---

## Success Criteria

The app is successful if:

- Students stop asking "What schedule is it today?"
- It becomes the default reference in classrooms
- "Just check MD Today" becomes common language
- It is opened multiple times per day by the same users
- It has not broken during a schedule change for a full semester
- When uncertain, the app said so — and students trusted it anyway because the uncertainty was visible, not hidden
- The summary_map has been updated at most once during a school year (confirming the calendar vocabulary is as stable as it appears)

---

## Future (NOT in v1)

Only port these after v1 has proven adoption and stability:

- **Structural override layer.** The announcement field handles communication of one-off chaos days. An override would handle *structural* schedule changes mid-day (fire drill shifts remaining periods, minimum day announced at 7am). Cleanest design: an `overrides` sheet tab maps dates to ad-hoc templates that take effect from a cutover time onward, bypassing the iCal feed for that date. The distinction is: **announcement = communication, override = structural schedule change.**
- **Manual announcement override.** A sheet column where the maintainer can force-set an announcement for a specific date, overriding whatever the iCal-derived announcement logic would produce.
- **Multi-year iCal feed handling.** Automatic detection of the current year's feed URL so the June rotation is zero-touch.
- **Daily news video embed.** Originally specified as part of the Now module. Deferred because it introduces a content dependency (which platform hosts the video, how embeds behave, whether ads appear) that is orthogonal to the schedule-truth invariant and risks contaminating the Now view's information density. Revisit only after v1 adoption is real and only if students request it.
- Push notifications for schedule changes (requires real backend or FCM setup)
- Per-student schedule (requires login — big scope jump)
- Native home screen widget (iOS requires a real app)
- Teacher-authored announcements (requires auth)
- Migration to a real backend if the sources become a bottleneck

**The temptation to add these during v1 is the single biggest risk to the project. Resist it.**

---

*MD Today — Mater Dei High School, Santa Ana*
