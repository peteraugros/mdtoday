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

- **iCal feed (direct):** `https://www.materdei.org/apps/events/ical/?id=33`
- **iCal feed (as fetched):** `https://corsproxy.io/?` + url-encoded direct URL
- **Templates CSV:** `https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=0&single=true&output=csv`
- **Summary Map CSV:** `https://docs.google.com/spreadsheets/d/e/2PACX-1vRomv0QyX9GdMNWow7lDTlk6Wg4AjZbgGuGJhmrFu0mFuEFIXbyzCwTn8s5xKYqBcfxzeP21muToXIQ/pub?gid=504710999&single=true&output=csv`

The two CSV URLs share the same document ID (`2PACX-1vRomv...`) and differ only in `gid` — each tab of the sheet has its own `gid`. The `Automatically republish when changes are made` setting is enabled on the sheet, so edits propagate to these URLs within a minute or two.

The iCal URL is year-scoped — Mater Dei publishes a new feed for each school year (`id=33` is the 2025–2026 identifier). Expect to update this constant each June.

#### Why the iCal feed goes through a CORS proxy

Mater Dei's web server does not send the `Access-Control-Allow-Origin` header on iCal responses. Browsers enforce CORS (Cross-Origin Resource Sharing) by refusing to let JavaScript read the response body of a fetch from a different origin unless the server explicitly opts in. Without the header, our `fetch()` call to `www.materdei.org` is blocked — even though `curl` and browser-as-subscriber access both work fine.

The Google Sheet CSV endpoints *do* send proper CORS headers, so those fetches work directly. Only the iCal feed needs the proxy.

**corsproxy.io** is a free public CORS proxy. It fetches the target URL server-to-server (where CORS rules don't apply), then re-emits the response with `Access-Control-Allow-Origin: *`. Our JavaScript sees a CORS-friendly response and the fetch succeeds. The tradeoff: we now depend on a third-party service staying up. See "Failure mode: CORS proxy unavailable" and the Launch Risk Register for mitigation. Migrating to a self-hosted Cloudflare Worker proxy is tracked as a v2 task.

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
| Calendar fetch | **`fetch()` against Mater Dei iCal URL, via corsproxy.io** | Mater Dei's server lacks CORS headers; a public CORS proxy is the v1 workaround. See "Why the iCal feed goes through a CORS proxy" for detail. |
| Calendar parse | **[ical.js](https://github.com/kewisch/ical.js/) via CDN** | Official Mozilla-maintained iCal parser, handles all the edge cases (timezones, all-day events, escape sequences) |
| Sheet fetch | **`fetch()` against published Google Sheet CSV** | Zero config, CORS works out of the box (Google sends the right headers) |
| CSV parsing | **[PapaParse](https://www.papaparse.com/) via CDN** | 45KB, battle-tested, handles edge cases |
| Date math | **Native `Date`** | Native is enough; dayjs via CDN only if we hit a real need |
| CORS proxy | **[corsproxy.io](https://corsproxy.io/) (public, free, no key)** | Third-party dependency. Mitigates Mater Dei's missing CORS headers. Self-hosted proxy is v2. |
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

**The entire v1 stack is: HTML + CSS + JS + Service Worker + ical.js + PapaParse + a CORS proxy + an iCal feed + a Google Sheet.** That is the whole thing.

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

### Failure mode 2: The CORS proxy is unavailable

**Cause:** corsproxy.io experiences an outage, changes its URL format, rate-limits us, or shuts down entirely. This is a real failure mode because the proxy is a third-party service we don't control.

**Defense:**
- The proxy failure surfaces identically to Failure mode 1 (iCal unreachable) — the browser's `fetch()` call fails, the app falls back to cached events in the **Stale** trust state
- The user experience degrades gracefully: cached schedule still renders, trust state communicates staleness honestly
- If no cache exists AND the proxy is down, the user sees the offline fallback screen — same as direct iCal failure
- **Detection:** console logs the proxy URL in the failure message so diagnosis doesn't require guessing whether it was Mater Dei or the proxy that failed
- **Remediation path:** `js/data.js` has a single constant for the proxy URL. If corsproxy.io dies permanently, switching to `api.allorigins.win` or a self-hosted Cloudflare Worker is a one-line change
- Long-term fix tracked as a v2 task: self-hosted proxy eliminates the third-party dependency

**Why we accept this risk in v1:** the alternative is building infrastructure (Cloudflare Worker + deploy pipeline) before the app is even proven. The trust-state architecture means a proxy failure produces honest Stale data, not a visible failure. Acceptable for v1. Not acceptable long-term.

### Failure mode 3: Mater Dei renames a calendar event

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

### Failure mode 4: The Google Sheet has bad data

**Cause:** Typo in a time, missing template reference, blank row, wrong date format, inconsistent time formatting (`8:00` vs `08:00` vs `8:00 AM`).

**Defense:**

**`sanitizeSheet()`** — trims whitespace, coerces time formats to canonical `HH:MM` 24-hour, lowercases/trims `template_id` references, treats empty rows as absent.

**`validateSheet()`** — every `template_id` referenced in `summary_map` exists in `templates`; every `start_time` and `end_time` parses; no duplicate `(template_id, block_order)` pairs; blocks within a template don't overlap.

**Principle: Validation protects the system. Sanitization protects the user experience.** Mindset rule: **assume the sheet is always slightly wrong.** Not maliciously — just human error. Design every parser, every coercion, every lookup with that assumption baked in.

### Failure mode 5: Today has no schedule event at all

**Cause:** School hasn't added next week to the calendar yet, data gap, weekend, holiday, or non-instructional weekday.

**Defense:**
- First, check if today has any event with SUMMARY containing keywords like "Break", "Holiday", "No School" — if so, today is a day off, render the Days Off view or a "No school today" state
- Otherwise, the app enters the **Assumed** trust state
- Renders a fallback template (a neutral "Regular Day" marked as default in the templates sheet)
- The Assumed state is visually distinct and labeled: "Schedule assumed — confirm with your teacher"
- Do not crash, do not show a blank screen, do not silently fake confidence

### Failure mode 6: The iCal URL changes for a new school year

**Cause:** Mater Dei publishes `2026-2027` calendar at a new URL. Known, expected: happens once per year.

**Defense:**
- The feed URL lives in a single constant at the top of `data.js`
- A comment in that file flags it as a once-per-year update
- A reminder in the project README describes how to update it each June
- If the old URL returns an empty feed or 404, the app falls into Stale state with cached data from the previous year — NOT a crash
- Bonus: if the feed's `X-WR-CALNAME` indicates a prior school year relative to today's date, log a console warning prompting the maintainer to update the URL

### Failure mode 7: The service worker caches a broken version

**Cause:** Bad deploy, incomplete cache write, version skew.

**Defense:**
- Service worker uses **stale-while-revalidate** for the app shell
- HTML is always fetched fresh (network-first) so new deploys propagate immediately
- CSS/JS/icons are cache-first with a versioned cache name (`mdtoday-v1.0.3`)
- Bumping the cache version on deploy forces cleanup of old caches
- A visible build version in the footer (`v1.0.3`) so the user can confirm which version is running

### Failure mode 8: Phone clock is wrong

**Cause:** Traveler just landed, date/time set manually wrong.

**Defense:**
- Use the phone's local time for "what period is it now" (no way around this without a backend)
- Display the current date prominently in the header so a mismatch is visible at a glance
- This is a known limitation, documented, not hidden

### Failure mode 9: Student has zero network signal

**Cause:** On the bus, basement classroom, dead zone.

**Defense:**
- PWA shell loads from service worker cache — entire app opens with zero network
- `localStorage` holds the full parsed iCal feed + sheet data from the last successful fetch
- Countdown timer works entirely client-side, no network dependency
- "Now" view is fully functional offline (in Stale trust state if cache isn't fresh)

### Failure mode 10: Event timezone ambiguity

**Cause:** iCal events can use `DTSTART;VALUE=DATE:YYYYMMDD` (all-day, timezone-less) or `DTSTART;TZID=...:YYYYMMDDTHHMMSS` (timed events). Mater Dei's schedule events are all-day; mixing timezone logic wrong can put an event on the wrong day.

**Defense:**
- Use ical.js for parsing — it handles this correctly. Do NOT try to parse iCal by hand.
- For "is this event today," compare the event's date in `US/Pacific` to today's date in `US/Pacific`, using the phone's view of "today" but the school's timezone.
- Write unit tests for the date-matching logic with events around DST boundaries.

### Failure mode 11: Recurring event doesn't expand to today

**Cause:** An iCal VEVENT with an `RRULE` appears in the feed once, but represents many dates. If the fetcher reads only `event.startDate`, every recurrence past the first is invisible and the app reports "no event today" (Assumed state) for days that are actually part of a real break.

**Real example from Mater Dei:** "No School - Thanksgiving Break" is one VEVENT with `DTSTART:20251124` + `RRULE:FREQ=DAILY;COUNT=5`. Dates 11/24 through 11/28 are all supposed to be captured. Without RRULE expansion, only 11/24 is visible to the app.

**Defense:**
- `fetchIcal` uses `event.iterator()` to walk every recurrence instance
- Expansion is bounded to Aug 1 prior year through Jul 31 next year — prevents runaway expansion on unbounded RRULEs (e.g., weekly meetings with no end date)
- Hard safety cap of 1000 iterations per event protects against ical.js producing pathological iterators
- EXDATE (exception dates) are respected automatically by ical.js — excluded dates don't emit events
- Expansion catches every multi-day break uniformly: Thanksgiving, Christmas, Easter, any future-added breaks use the same RRULE pattern

**Verification:** After RRULE expansion, the feed goes from ~1560 VEVENTs to ~1980 date-event instances. If that number drops significantly, check whether iCal.js upgrades changed the iterator API.

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
│   ├── app.js              ← Now view entry point (render orchestration, tick wiring)
│   ├── schedule-view.js    ← Schedule view entry point (static render, no tick)
│   └── daysoff-view.js     ← Days Off view entry point (static list, grouping logic)
├── sw.js                   ← Service worker (cache strategy)
├── manifest.json           ← PWA manifest (icons, theme color, name)
├── icons/
│   ├── apple-touch-icon.png   ← 180×180 Monarch, from materdei.org 2026-04-20. Used as favicon and iOS touch icon.
│   └── md-wordmark.png        ← Mater Dei interlocking-MD wordmark (red on transparent). Used in page header + splash. User-supplied 2026-04-20.
│                              ← icon-192.png and icon-512.png not yet created (manifest icons array is empty)
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
- Fire a caller-supplied tick function every 1 second with a fresh `Date`
- Own no DOM — it is a pure time source. The caller (`app.js`) decides what to render and is responsible for only touching the temporal DOM region on tick.
- Handle tab visibility: pause the interval when hidden, resume on visible
- On resume after ≥1 hour hidden, fire an optional `onLongResume` callback **instead of** silently resuming the interval. The caller uses this to re-run `loadData` + `renderStable` + `tickTemporal` + `startCountdown`, because the cached payload may now be stale.
- Clean shutdown on navigation via `stopCountdown()`

Constants (in the module, tunable by editing source):
```js
const TICK_MS = 1000;
const LONG_RESUME_MS = 60 * 60 * 1000; // 1 hour
```

Contract:
```js
export function startCountdown(tickFn, onLongResume) {
  // Starts a 1s interval. Fires tickFn(new Date()) once immediately, then every
  // TICK_MS. Safe to call multiple times — replaces the previous tickFn and
  // onLongResume, resets the interval. Attaches a visibilitychange listener
  // once per module lifetime.
  //
  // If the tab is hidden at call time, does not start the interval; the
  // visibility handler starts it on focus.
  //
  // tickFn:       required, called as tickFn(new Date())
  // onLongResume: optional, called when tab becomes visible after ≥LONG_RESUME_MS
  //               hidden. When this fires, the interval is NOT auto-resumed —
  //               the caller must call startCountdown again.
}

export function stopCountdown() {
  // Clears the interval, detaches the visibility listener, resets internal
  // state. Call on teardown/navigation.
}
```

This module is scoped to the temporal layer of the three-layer model. It has no knowledge of validity, deviation, `currentResolved`, or any schedule concept. If this module is importing from `data.js`, `resolve.js`, or `schedule.js`, it is wrong.

### `js/app.js` — Now view orchestration

The Now view's entry point. Loaded only by `index.html`.

Responsibilities:
- Load data via `data.js` once at boot
- Mount the three DOM regions (validity / temporal / deviation)
- `renderStable(now)` paints validity + deviation + header date once per data load
- `tickTemporal(now)` paints only the temporal region (called every second by `countdown.js`)
- Wire `startCountdown(tickTemporal, onLongResume)` to start ticking
- `onLongResume` callback: on tab visible after ≥1h hidden, re-run `loadData` + `renderStable` + `tickTemporal` + `startCountdown`

No SPA routing. Navigation to other views is a plain `<a href>` to another HTML file.

### `js/schedule-view.js` — Schedule view orchestration

The Schedule view's entry point. Loaded only by `schedule.html`.

Responsibilities:
- Load data via `data.js` once at boot
- Resolve today via `resolveDay`
- Render the validity banner (same CSS classes as the Now view — trust state carries over per the Phase 3 spec)
- Render either the block table, or a dedicated empty state for day-off / Assumed / Offline
- Paint once. No tick, no subscription to `countdown.js`, no dynamic updates

Intentional duplication from `app.js`: `formatTimeOfDay`, `relativeTimeAgo`, `DATE_FMT`, and the body of `renderValidity` are copy-pasted rather than extracted into a shared `render.js` module. A dedupe refactor is logged as a v2 candidate; the duplication is small, stable, and keeps each view a self-contained entry point.

### `js/daysoff-view.js` — Days Off view orchestration

The Days Off view's entry point. Loaded only by `daysoff.html`.

Responsibilities:
- Load data via `data.js` once at boot
- Filter `data.events` to day-off events on or after today
- Group consecutive same-SUMMARY runs into date ranges
- Render the validity banner (reused — same rules as the other views, minus the `assumed` case which is today-specific)
- Render the grouped list, or a dedicated empty state when none / offline
- Paint once. No tick, no resolveDay call.

Two things this module handles that no other module does:

1. **Day-off filtering.** Uses its own copy of `DAY_OFF_KEYWORDS` that MUST stay identical to `resolve.js`'s copy. If the list changes in either file, it must change in both. A shared constants module is the v2 dedupe. The constant lists match as of 2026-04-20.

2. **Weekend-bridged grouping.** Consecutive dates with identical SUMMARY merge into one range. A Sat/Sun-only gap (e.g., Christmas Break where the feed lists Dec 22–26 Mon–Fri, skips Sat/Sun, then resumes Mon) is bridged: the group extends across the weekend and the rendered range is `Dec 22 – Jan 2 · 12 days`. A gap including any weekday breaks the group. See the audit-verified test cases in the Phase 5 implementation notes.

### Splash + bottom navbar — inline, no JS module

The brand-pass refactor (2026-04-20) added a session-scoped splash screen and a fixed bottom navbar to all three views. Neither has a dedicated JS module:

- **Bottom navbar** is pure HTML+CSS. Three `<a>` tags with inline SVG icons. Active state is set per-HTML-file via the `is-active` class on the matching `<a>` — no JavaScript needed for highlighting. Identical markup in `index.html`, `schedule.html`, `daysoff.html` except for which link carries `is-active` and `aria-current="page"`. This is duplication-by-design — a shared partial would require either a build step (rejected by the spec) or runtime JS to inject the navbar (more code surface than the duplication itself). If the navbar gains a fourth view, this triplication becomes quadruplication; revisit then.

- **Splash gating + dismissal** are two small inline `<script>` tags per HTML file:
  1. **Gate script** lives in `<head>`, runs synchronously before `<body>` parses. Reads `sessionStorage.getItem('mdtoday-splash-shown')` and sets a `splash-skip` class on `<html>` if already shown this session. The class is read by CSS to skip the splash entirely with `display: none`. SessionStorage exceptions (private browsing) fall through to the same skip-path so the splash never hangs.
  2. **Dismissal script** lives as the last `<script>` in `<body>`. After 1600ms hold, adds `is-dismissed` to the splash element (CSS handles the 400ms opacity fade). Tap-anywhere also triggers immediate dismissal. After fade completes, `splash.remove()` takes it out of the DOM entirely so it never intercepts taps post-dismissal.
- **Splash and view rendering run in parallel.** The splash is `position: fixed; z-index: 100`. Module scripts (`app.js` / `schedule-view.js` / `daysoff-view.js`) execute normally during the splash; by the time the splash fades, the underlying view is already populated. The splash never gates data fetching.
- **Why inline rather than a `splash.js` module:** the gate must run blocking-synchronous in `<head>` before `<body>` parses, otherwise a frame of splash content can flash before the JS tells it to skip. Module scripts are deferred by default, which would defeat that requirement. The dismissal script is small enough that an inline tag is cleaner than a one-purpose JS module. If a future refactor extracts to `splash.js`, the gate must remain in `<head>` as a non-module script with `defer` and `async` both off.

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

### Brand & Navigation (added 2026-04-20)

**Header logo.** All three views display the Mater Dei interlocking-MD wordmark (`icons/md-wordmark.png`) to the left of the "MD Today" page title. ~28px tall, decorative (`alt=""`, `aria-hidden`) because the text already conveys meaning to assistive tech.

**Favicon.** Browser tab uses `icons/apple-touch-icon.png` (the Monarch). Square, downscales cleanly.

**Bottom navbar.** Fixed-position bar at the bottom of every view. Three icon-only links (Now / Schedule / Days off) with inline SVG icons. Active view's icon is `--md-red`; inactive icons are `--md-gray-text-muted`. Replaces the previous footer text-link pattern, which was easy to miss on long views (the Days Off list pushed the footer off-screen). Navbar item labels are `sr-only` for assistive tech only — visible-text labels were rejected as visual noise.

**Splash screen.** Once-per-session brand moment. Shows the MD wordmark with a heartbeat-pulse animation (`scale 1 → 1.06 → 1 → 1.04 → 1` over 900ms, infinite) and the "Honor · Glory · Love" tagline in red small caps. Visible 1600ms, then fades 400ms (2000ms total). Tap-anywhere dismisses immediately. Subsequent navigation within the same browser session skips the splash entirely (sessionStorage flag). Reduced-motion users get a still logo with no scale animation.

**The splash is a deliberate trade-off against the time-to-decision invariant.** The product spec optimizes for cognitive compression per second of attention, with a 1.5-second glance-test target. The splash adds 2 seconds to first-of-session load. This is justified for one reason: the cold-launch case is a context where the student is opening the app intentionally, has already committed to a multi-second interaction, and benefits from a brand-identity moment that makes the app feel like a Mater Dei product rather than a generic schedule viewer. The session-scoped gate ensures it does NOT add 2 seconds to the in-hallway "tap-to-check" case — subsequent loads are instant. Tap-to-skip respects the rare student who needs information immediately even on first load. Reduced-motion respects accessibility.

If real-student feedback indicates the splash interferes with the time-to-decision invariant — even on cold load — the right fix is to either (a) shorten it (e.g., to 1s), (b) make it skippable per-device permanently via a settings toggle, or (c) move it to a one-time "first run" experience using localStorage instead of sessionStorage. Do not silently tune duration in production without recording the change here.

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

### Phase 1: Data layer (headless) — ✅ COMPLETE

1. ✅ `data.js` — fetches iCal (via corsproxy.io) + both CSV tabs, runs sanitize + validate pipelines, caches to localStorage, falls back on failure. RRULE-expanded recurrences handle multi-day breaks (Thanksgiving, Christmas, Easter) correctly. End-to-end test against live data confirms: 1984 events (post-RRULE expansion), 73 template rows, 19 summary_map rows, all 10 template_ids present, `source: network`, no warnings.
2. ✅ `resolve.js` — full resolution pipeline including Monday substitution (today → `monday_homeroom`, verified on 2025-08-18 and 2026-04-20), day-off detection (Thanksgiving 2025-11-27 → `isDayOff: true`), announcement filter (Fall Rally populated, sports/banquets correctly excluded), trust state determination across confirmed/stale/assumed/offline.
3. ✅ `schedule.js` — `getCurrentStatus` with track branching verified across 12 wall-clock test points including all three lunch-window sub-phases (upper eating, upper back in class, lower eating). Passing periods, before/after school, and simple blocks all resolve correctly.
4. ✅ Test harness in `index.html` confirms the full pipeline against live data via browser console.
5. ✅ Edge cases tested:
   - Today is a Red Day → resolves correctly, trustState = Confirmed ✓
   - Today is a Rally Day → resolves with rally template ✓
   - Today is Thanksgiving → resolves as day off ✓
   - Today has no event (weekend) → Assumed state ✓
   - Offline payload → source = 'none', trustState = Offline ✓
   - Today has a Rally event → announcement populated ("Fall Rally") ✓
   - Today has a basketball game event → announcement NOT populated (excluded by filter) ✓
   - Monday Red substitution → Monday Homeroom template ✓
   - Lunch-window branching → both tracks returned simultaneously ✓

**Ship criterion:** ✅ MET. Given any real-world state of the two sources, `loadData()` → `resolveDay()` returns sensible values without crashing, and `trustState` accurately reflects the data situation.

### Phase 1 additions not originally specified

These emerged during implementation and are worth logging so future sessions know they exist:

- **CORS proxy dependency** (corsproxy.io) — Mater Dei's server lacks CORS headers; the proxy is the v1 workaround. See Failure mode 2 and Risk 4.
- **RRULE expansion** in `fetchIcal` — iCal feeds encode multi-day breaks as single VEVENTs with `RRULE:FREQ=DAILY;COUNT=N`. The fetcher must walk `event.iterator()` and emit one simplified event per recurrence instance, bounded to Aug 1 prior year through Jul 31 next year to prevent runaway expansion on unbounded RRULEs. Without this, day-off detection fails for every break.
- **Track branching in `getCurrentStatus`** — when both an `upper` and `lower` track row are active at the same time (lunch window), returns `currentTracks: { upper, lower }` with `currentBlock: null`. Outside the branching window, returns `currentBlock` as normal with `currentTracks: null`. The Now view selects its rendering path by which field is populated.
- **Day label construction** — `resolve.js` builds human-readable labels from the raw SUMMARY: "RED: B. 1, 3, 5, 7" → "Red Day", "GRAY (Mass Schedule): B. 2, 4, 6, 8" → "Gray Day — Mass", Monday-substituted → "Monday Red" / "Monday Gray".

### Phase 2: Now view (three-layer mount) — ✅ COMPLETE

1. ✅ `index.html` mounts three DOM regions: temporal, validity, deviation — each with its own `id` for direct reference by renderer functions
2. ✅ Each region has its own render function (`renderValidity`, `renderTemporal`, `renderDeviation`) operating on its own slice of state
3. ✅ `countdown.js` ticks the temporal region only — validity and deviation stay mounted and stable, no flicker
4. ✅ Validity region renders trust state banner (stale / assumed / offline) using color + icon + layout; Confirmed is silent (no banner) — silent-when-healthy pattern
5. ✅ Deviation region renders the announcement if present, is hidden if empty
6. ✅ Lunch-window branching renders both Upper and Lower tracks side-by-side with track-labeled cards; countdown targets the nearer of the two track-ends
7. ✅ Works offline after one load (stale trust state visible, cached schedule still renders)

**Visual verification matrix** — all render paths checked via synthetic "now" override in `boot()`:
| Case | Result |
|---|---|
| Before school (07:30) | "Before school" + "Starts in Xm 00s" + Next: Block 1 ✓ |
| In a regular period (08:30) | "Block 1" + "Ends in 45m 00s" + Next: Block 3 ✓ |
| Passing period (09:17) | "Passing period" + "Next in 3m 00s" + Next: Block 3 ✓ |
| Lunch window (11:00) | "Lunch window" + two track cards + Next: Upper Classes ✓ |
| After school (real evening) | "School's out" (muted), nothing else ✓ |

**Ship criterion:** ✅ MET. The Now view renders correctly across all five temporal states of a Red Day. The 1.5-second glance test passes on the hardest case (lunch-window branching) on first visual inspection — day type, status, both tracks' current state, and next transition are all legible without reading sentences.

### Phase 2 implementation notes

- **Three DOM regions, not one.** `app.js` has two entry points into rendering: `renderStable(now)` paints validity + deviation + the header date (once per data load, stable), and `tickTemporal(now)` paints only the temporal region (every second, from the countdown tick). The countdown tick only ever calls `tickTemporal`, never touches validity or deviation — this is what keeps the page from flickering every second.
- **Countdown is visibility-aware.** `countdown.js` listens for `visibilitychange` and pauses the tick when the tab is hidden (saves battery on backgrounded phones). When the tab returns after <1h absence, the interval simply resumes. When it returns after ≥1h absence, `countdown.js` fires the `onLongResume` callback instead of silently resuming the tick — the caller (`app.js`) uses that to re-run `loadData` + `renderStable` + `tickTemporal` + `startCountdown` before resuming, because the cached payload may now be stale.
- **`tickTemporal` re-uses `currentResolved` across ticks.** The expensive work (resolving the day, fetching data, running sanitizers) happened once at boot. The per-second tick only recomputes `getCurrentStatus` against the new `now` and re-renders the temporal region. One tick costs a few hundred microseconds — negligible.
- **`currentResolved` is module-scoped.** `let currentResolved = null` at top of `app.js`. `renderStable` sets it; `tickTemporal` reads it; `onLongResume` re-sets it via `loadData` → `renderStable`. Simple state flow, no observers, no framework.
- **`countdown.js` has no DOM access.** It's a pure time source exporting `startCountdown(tickFn, onLongResume?)` and `stopCountdown()`. The caller owns every rendering decision. This is what makes the tick safe to test in isolation and safe to restart from inside `onLongResume` without recursion worries.
- **2026-04-20 correction — Phase 2 was marked complete prematurely.** `js/countdown.js` was an empty file; `app.js` called a single `renderAll()` once at boot and never ticked. The "visibility-aware countdown" described in the earlier implementation notes above was specification, not implementation. Fixed in this session by implementing `countdown.js` as described, splitting `renderAll` into `renderStable` + `tickTemporal` in `app.js`, and wiring `startCountdown(tickTemporal, onLongResume)` into `boot()`. Verified via synthetic-time testing across three cases on 2026-04-20:
  - Red Mass Day at 08:15:33 — simple single-block case, countdown ticked, validity silent (Confirmed), deviation rendered "All School Mass" without flicker.
  - Gray Pair-Late Day (`pair_late` template) at 11:45:00 — lunch-window branching, both track cards rendered side by side, countdown targeted the nearer end (Upper Lunch at 12:10), `Next:` slot correctly pointed at Upper Classes.
  - Same template at 12:09:30 — live state transition at 12:10:00 from branching ("Lunch window" + two cards) to single-block ("Block 5/6 (Lower Class)") fired autonomously, countdown reset from 22s → 19m 37s pointing at lower's 12:30 end, day label and validity stayed stable with no repaint or flicker. This was the actual three-layer-separation test and it held.

  **Rule-12 lesson: do not mark a phase complete until the tick survives a state transition in the browser, not just `getCurrentStatus` unit tests. The data layer can be right and the integration seam still be missing.**
- **Known limitation — upper-track passing period is invisible during lunch window.** In templates with a lunch split (e.g., `pair_late`, `red_regular`, `gray_regular`), the upper track's passing period between Upper Lunch and Upper Classes (e.g., 12:10–12:15 on `pair_late`) is not rendered as branching because only one block (the lower class) is active during that window. `getCurrentStatus` correctly returns the single-block case per its contract ("branch only when both tracks are simultaneously active"), so an upper-track student opening the app at 12:12 sees "Block 5/6 (Lower Class) · Ends in 18m" with no indication that their own state (passing period) is different from what's displayed. This is spec-compliant but a real UX asymmetry. Candidate for v1.1 — possible fixes include (a) branch whenever *any* track has a mismatch with another track's state, not just when both are in blocks, or (b) introduce a third "partial-branch" rendering mode. Do not fix in v1 without real-student evidence that it's a problem — the spec explicitly rejects per-student track assignment and any fix here needs to stay compatible with that rejection.
- **Synthetic-time testing pattern.** Override `boot()` with a fake `now` that advances in real time: `const BASE_FAKE = new Date('2025-08-26T11:29:30').getTime(); const BASE_REAL = Date.now(); window.Date = class extends Date { ... }`. Watching the countdown tick through a block-end transition confirms both the tick logic and the `renderTemporal` handling of status changes mid-session.
- **"Block 5 (Lower Class)" reads as redundant.** The track column already carries the Upper/Lower distinction; the `block_name` "Block 5 (Lower Class)" then double-labels. Consider shortening to just "Block 5" in the sheet — v1.1 polish.
- **"Musical Theatre Performance at Disney's California Adventure" is exactly the kind of event that tests announcement_text.** It's not sports/banquet/spirit, but it's also not something a student should "confirm with your teacher" about. The current filter correctly excludes it via absence from the include list. If a real event like this should surface as an announcement in the future, it needs a keyword added.

### Phase 3: Schedule view — ✅ COMPLETE

1. ✅ `schedule.html` renders today's template as a clean table
2. ✅ One tap from `index.html` (`Today's schedule →` link in footer; `← Back to Now` on Schedule view)
3. ✅ Trust state indicator carries over from Now view — Assumed / Stale / Offline all render the same validity banner shape and CSS classes

**Ship criterion:** ✅ MET. Verified on 2026-04-20 across three states: Confirmed render of today's `monday_homeroom` template with all 9 rows including labeled upper/lower tracks; Assumed empty-state on 2026-07-15; day-off empty-state on 2026-02-02 ("NO SCHOOL - MD HOLIDAY").

### Phase 3 implementation notes

- **Static render only.** The Schedule view paints once on load and never updates. No countdown subscription, no tick. The Now view owns "where am I in the day"; this view is a reference table. Separate tools, separate code paths.
- **Dedicated empty states per trust state.** Day-off → "No school today." with the event SUMMARY as the day label. Assumed → "No schedule on file for today. Confirm with your teacher." + visible assumed-state validity banner. Offline → "Schedule unavailable. Check with the front office." + offline-state validity banner. Three distinct renderings so the student can distinguish "school is closed" from "I don't know what school is doing" from "I can't reach my data."
- **Track column is blank for shared blocks, 'Upper' / 'Lower' for split ones.** Matches what the data shape actually tells us and avoids inventing an "All" label that isn't in the source.
- **Known tradeoff — cell wrapping on narrow phones.** "Homeroom & Announcements" wraps onto two lines on sub-400px viewports. Time column `vertical-align: top` keeps the time aligned to the first line. Readable, not fixed in v1. If a real student complains, candidates are: truncate with ellipsis, add a `white-space: nowrap` media query, or rename the block in the sheet.
- **`width: 1%` trick on time and track columns.** Shrinks those columns to their content width and lets the block name column take the remaining space. Standard CSS table technique; looks hacky but is the right tool.
- **Not extracted to a shared module.** `formatTimeOfDay`, `relativeTimeAgo`, `DATE_FMT`, and `renderValidity` are duplicated between `app.js` and `schedule-view.js`. Intentional — see the `schedule-view.js` Core Module note above.

### Phase 4: PWA shell — ✅ COMPLETE

1. ✅ `manifest.json` with theme color, scope, display, icons (icon files referenced but not yet created — tracked as follow-up)
2. ✅ `sw.js` with network-first for HTML, stale-while-revalidate for static same-origin assets
3. ✅ Offline reload works — app shell served from SW cache, `data.js` falls back to `localStorage`, trust state reads as Stale when cache is >12h old

**Ship criterion:** ✅ MET on 2026-04-20. Verified sequence: SW registered and activated (`registration.active === ServiceWorker`), precache populated with 11 entries in `mdtoday-v1.0.0`, offline reload served cached shell and rendered `MONDAY GRAY` from localStorage with Confirmed trust state, offline reload with manually-aged `lastFetch` (13h old) rendered Stale banner with "Last updated 13h ago" exactly as spec'd.

**Not yet done:** icon files (`icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`); iOS Add-to-Home-Screen test (gated on icons existing).

### Phase 4 implementation notes

- **Cache name versioning is the deploy safety mechanism.** `CACHE_NAME = 'mdtoday-v1.0.0'` at the top of `sw.js`. The activate handler deletes any old `mdtoday-*` caches, so bumping this constant on deploy is the one-line fix for Failure mode 7 ("bad deploy cached, now stuck"). **The cache name must be bumped in lockstep with the footer version string in both HTML files** — manual discipline, no automation in v1. Forgetting this means a new deploy reuses the old cache and the fix doesn't propagate.
- **Same-origin only.** The SW's `fetch` handler ignores any request whose `url.origin !== self.location.origin`. This means iCal via corsproxy.io and the Google Sheet CSVs pass through untouched. `data.js` keeps owning its localStorage cache of those responses; doubling up in the SW would create stale-overlapping-stale bugs with two independent TTLs and two independent invalidation rules.
- **`skipWaiting()` + `clients.claim()`** are used so new SW versions activate immediately instead of waiting for all tabs to close. Faster update propagation at the cost of some risk of two controllers racing during activation. Accepted for this app because there's no shared mutable state across tabs.
- **`cache: 'reload'` on install.** `cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' })))` bypasses the browser HTTP cache during the install fetch, so a new SW version doesn't precache stale bytes that the HTTP layer is still within its TTL on.
- **SW registration is deliberately not a module.** The `<script>` block in each HTML file is a plain synchronous script, not `type="module"`. This is because SW registration should work on every browser including ones with flaky ES-module support, and registration has no module dependencies. Keep it that way.
- **The Stale-vs-Confirmed offline distinction is the whole point.** The SW by itself just serves the app shell — it doesn't care about trust state. The trust state is produced by `data.js` + `resolve.js` based on `lastFetch` freshness. Two layers of caching (SW for shell, localStorage for data), each with its own lifecycle. The test that matters is: "offline with stale localStorage cache → Stale banner visible." That's what 2026-04-20's cache-aging shim confirmed.

### Phase 5: Days Off + polish — ✅ BUILD COMPLETE (polish items deferred)

1. ✅ `daysoff.html` — iterates through future day-off events, groups consecutive same-SUMMARY runs into ranges, weekend-aware bridging
2. ⏸ "Last updated" indicator refinement — not addressed in v1; current `relativeTimeAgo` formatter is acceptable
3. ⏸ Fallback screens copy reviewed — current copy ("No school today.", "Schedule assumed — confirm with your teacher.", "MD Today is offline. Check with the front office.") was reviewed informally during build; no changes
4. ⏸ Hallway-simulation test — pending real-student testing in Phase 6

**Ship criterion:** ✅ MET for the Days Off view itself. Verified on 2026-04-20 across two cases:
- Real-time (April 20, no shim): 4 day-offs through end of school year (MD Holiday, Memorial Day, two partial-grade closures), no false positives, no sport-event leakage
- Synthetic 2025-12-01: Christmas Break correctly grouped as `Mon, Dec 22 – Fri, Jan 2 · 12 days` (single row, weekend bridged), Easter Break as `Thu, Apr 2 – Fri, Apr 10 · 9 days` (also bridged)

### Phase 5 implementation notes

- **Bug found and fixed mid-build: `'holiday'` keyword in `DAY_OFF_KEYWORDS` was producing false positives.** First Days Off render under the Dec 1 shim showed sport events ("V Girls Water Polo @ Holiday Cup", "V Girls Basketball @ Portland Holiday Classic") interleaved with real day-offs, AND those interleaved events broke the contiguous-same-SUMMARY grouping logic so Christmas Break split into three rows. Root cause: `'holiday'` matched any SUMMARY containing the substring "holiday" — `'no school'` was already covering every legitimate day-off in the feed, making `'holiday'` redundant as well as noisy. Fix: removed `'holiday'` from `DAY_OFF_KEYWORDS` in both `resolve.js` and `daysoff-view.js`. Side benefit: "No Summer School - 4th of July Holiday" also stops leaking into the Days Off list (it was caught by `'holiday'`; `'no school'` doesn't substring-match through "no summer school"). Pre-launch audit of `DAY_OFF_KEYWORDS` against the live feed should be repeated whenever the keyword list changes.
- **Weekend-bridge rule for grouping.** Two consecutive same-SUMMARY day-offs are merged into one range if the only intervening days are Saturdays and/or Sundays. This handles the common pattern where multi-day breaks (Christmas, Easter) are populated in the feed only on weekdays — the school doesn't bother marking weekends as "No School - X Break" because weekends already aren't school days. Implementation walks `cursor = nextDay(current.end)` skipping weekend days; if `cursor` lands on the next item's date, merge. Any weekday gap (e.g., a Wed-only school day in the middle of a "break") would correctly split the group.
- **Single source of truth for "is this a day-off?" duplicated.** Both `resolve.js` and `daysoff-view.js` carry their own copy of `DAY_OFF_KEYWORDS` and `isDayOffSummary()`. The keyword list change in this phase had to be applied in both places. v2 dedupe refactor: extract to `js/keywords.js` (or similar), import from both. Not done in v1 because the duplication is two short arrays and a 4-line function — the refactor would be more code than the duplication.
- **Cache version bump (v1.0.0 → v1.0.1) was the first real exercise of Failure mode 7's defense.** Two new shell files (`daysoff.html`, `js/daysoff-view.js`) needed precaching, so the cache name had to flip in lockstep with footer version strings in all three HTML files. Discipline followed manually per Working Rule 14-equivalent (cache-name + footer in lockstep). Verified on the dev environment that the new SW activated, old `mdtoday-v1.0.0` cache was cleaned up by the activate handler, and new cache had 13 entries (was 11). The mechanism works.
- **Two new v1.1 candidates surfaced:**
  1. **Partial-grade-closure labels read as full-school closures.** "No School Grades 9-11" and "No School Grade 12" appear as plain rows with no indication that some students are still in school. A grade-12 student looking at the Days Off list on May 26 would see "No School Grades 9-11" and have to mentally check whether that includes them. Same class of issue as the upper/lower lunch-track asymmetry — the spec rejects per-student identity, so the honest fix is probably a clarifying label tweak rather than a filter.
  2. **Days Off list gets long fast.** Dec 1 synthetic showed 9+ entries through end of year. Scrollable, but a student scanning quickly wants the *next* day-off prominent. A "Next day off: X" callout at the top of the list (mirroring the Now view's temporal region but for the future) would help once real-student feedback confirms it's worth doing.

### Brand pass — header logo, navbar, splash (post-Phase-5, 2026-04-20)

After Phase 5 shipped, did a brand+UX refactor across all three views. Not numbered as a new phase because it's polish, not new functionality — but substantial enough to record.

**What changed:**
- Added Mater Dei MD wordmark (`icons/md-wordmark.png`) to the page header in all three views
- Added favicon link (`apple-touch-icon.png`) to all three views
- Removed the footer text-link navigation pattern entirely (`<footer class="page-footer">` + `.page-footer` CSS rules deleted)
- Added a fixed bottom navbar (Now / Schedule / Days off) with inline SVG icons, active state per-view via `is-active` class
- Moved the version string from footer to a small line under the page header
- Added a session-scoped splash screen (heartbeat-pulse animation on the wordmark, "Honor · Glory · Love" tagline, 2s total, tap-to-skip, sessionStorage-gated)
- Bumped SW cache `mdtoday-v1.0.1 → mdtoday-v1.0.2`, added two icon files to PRECACHE_URLS (now 15 entries)

**What did NOT change:**
- No JS module touched
- Trust-state visual language preserved
- Three-layer model preserved
- Data flow preserved
- iPad-specific layout deliberately deferred (separate ticket)
- iOS-native PWA splash image deliberately deferred (separate Phase-4-residual ticket)

**Notable decisions, recorded for future-me:**
- **The splash adds ~2s to first-of-session load.** This conflicts with the time-to-decision invariant (`claude.md` line 102). The product owner weighed the trade-off and chose to ship the splash for cold-load brand identity, accepting the cost on the assumption that subsequent navigation (which dominates the in-hallway use case) is unaffected by sessionStorage gating. See "Brand & Navigation" in the Design System section for the full reasoning and the conditions under which to revisit.
- **Cache bump v1.0.1 → v1.0.2 happened correctly.** Second consecutive session to exercise the bump-discipline pattern. Two new files precached (the icons), version string in `.page-version` updated in lockstep across all three HTMLs, sw.js CACHE_NAME flipped. Mechanism still works.
- **Bottom navbar markup is triplicated across HTML files.** The `is-active` class moves between `<a>` tags by file. This is duplication-by-design — the alternative (build step or runtime JS injection) violates the "no build step, no framework" architectural commitment. If a fourth view is ever added, the triplication becomes quadruplication; that's the trigger to reconsider.

**v1.1 candidates surfaced or made more concrete:**
- **iPad-optimized layout.** Currently phone-first with `--content-max: 480px`. Works on iPad but doesn't take advantage of the larger viewport. Real ticket once iPad student usage is observed.
- **Settings/About page.** No place currently for school-identity content beyond the splash and header. An About page would also give the splash an "off switch" (localStorage toggle) for students who find the brand moment annoying after the first few days.
- **iOS-native PWA splash image** (separate from the in-app splash). Currently a PWA cold launch from home screen shows a white screen until the HTML parses; a proper `<link rel="apple-touch-startup-image">` set would brand that gap. Real ticket, blocked on generating a per-device-size image set.
- **Splash skip toggle** in a future settings page so students can disable the brand moment entirely if it becomes annoying after first-week novelty wears off.

### Phase 6: Deploy — ✅ COMPLETE

1. ✅ Live at `https://mdtoday.netlify.app` — GitHub-connected auto-deploy from `main`, no build step, publish directory is repo root
2. ✅ iCal proxy migrated from `corsproxy.io` to a same-origin Netlify Function (`/.netlify/functions/ical`) — eliminates the third-party CORS dependency that was Risk 4 in the Launch Risk Register
3. ✅ June rotation task logged: every June, check if Mater Dei has rolled over to the next school year's iCal URL, and update the `ICAL_TARGET` constant in `netlify/functions/ical.js` (moved from `js/data.js` during the proxy migration)
4. ⏸ Three-student soft launch — URL ready to share, pending selection of three students for a week of real-world testing before wider launch

**Ship criterion:** ✅ MET on 2026-04-21. Verified on iPhone PWA (Safari → Add to Home Screen): splash plays, Now view renders Confirmed state on real Mater Dei data, Schedule and Days Off views render correctly, trust-state transitions visible (Confirmed → Stale after 12h cache aging shim), bottom navbar active states per view. Final cache version at session close: `v1.0.6`.

### Phase 6 implementation notes

- **Netlify Function for iCal proxy.** Lives at `netlify/functions/ical.js`, ~34 lines. Same-origin request from the app means no CORS headers needed — cleaner than the original cross-origin pattern. `ICAL_TARGET` is hardcoded to Mater Dei's feed, making this a closed proxy (can't be abused for arbitrary URLs). 30-minute `Cache-Control: max-age` on responses, sitting inside Netlify's edge — client-side `localStorage` cache continues to sit in front of this, so two layers of caching (edge + client) with the trust state derived from the client-side `lastFetch` timestamp.
- **`js/data.js` change is one line.** `ICAL_URL` flipped from the `corsproxy.io` URL-encoded wrapper to the plain relative path `'/.netlify/functions/ical'`. Surgical change, left the surrounding comment block intact (though the comment's pointer to "claude.md → Data Sources → Live URLs" is now slightly stale — the live URL there is no longer the literal fetched URL, the function file is).
- **Schedule table responsive fix — track column hidden on narrow viewports.** The Schedule view's three-column table (Time / Block / Track) was overflowing on iPhone widths. Fix: `@media (max-width: 600px) { .schedule-table__track { display: none; } }` in `css/styles.css`. The Track column is redundant at this viewport anyway — the block_name already encodes track info ("Block 5/6 (Lower Class)", "Upper Lunch", "Lower Lunch") — so hiding it resolves the redundancy in favor of the more descriptive source. Column remains visible on iPad and desktop where there's room.
- **Cache version progression in this session:** `v1.0.2` (Brand pass, carry-in) → `v1.0.3` (Netlify Function migration) → `v1.0.4` (first track-column attempt) → `v1.0.5` (second track-column attempt) → `v1.0.6` (final track-column breakpoint). Four commits on the main branch, lockstep discipline held on every bump. The sequence is a record of one real architectural change (the proxy) and three iterations to land one CSS fix.
- **Cloudflare Worker at `mdtoday-ical-proxy.peteraugros.workers.dev` exists as a cold spare.** Deployed during Phase 6 but not the active proxy. Free tier, costs $0/month. Can be deleted or kept as a manual failover — if Netlify Functions ever breaks, flipping `ICAL_URL` back to the Worker URL is a one-line change.

**v1.1 candidates surfaced during Phase 6:**

- **Delete the Cloudflare Worker** or keep as documented failover. Low priority, zero cost either way.
- **Update the `js/data.js` header comment** to reflect that the actual iCal URL now lives in `netlify/functions/ical.js`, and update the June-rotation reminder comment to point at the function file. Not urgent — the reminder still works, just points at the wrong file.
- **Verify `mass` template bell times** — during Phase 6 smoke testing, the April 21 Mass-day schedule showed Block 5/6 (Lower Class) at 12:00–1:00 PM overlapping Upper Classes at 12:45–1:45 PM, plus an Office Hour / PLC / PD slot at 3:00–3:30 PM that wasn't on the radar. May be correct for the `mass` template as defined in the sheet; worth a sheet review to confirm, since this is the first time the Mass schedule was rendered against live production data.
- **iOS-native PWA splash image** (still deferred from Phase 4, carried forward). Currently a PWA cold launch from home screen shows a white flash before the in-app splash plays. A proper `<link rel="apple-touch-startup-image">` set would brand that gap.

---

## Pass App (Staff Dismissal Tool) — added 2026-04-23

The Pass App is a staff-facing dismissal tool at `/staff/`. Same repo, same deploy, same domain. PIN-gated, device-trust persisted in localStorage.

### File structure (additions only)

```
staff/
├── index.html              ← PIN entry + staff dashboard
└── dismiss.html            ← Sport detail: roster + dismissal actions
js/
├── pass-db.js              ← Dexie setup, schema, typed CRUD
├── pass-data.js            ← Fetch athletics-data JSON + Sheet overrides, merge
├── pass-trust.js           ← Device trust check (localStorage flag)
├── pass-staff.js           ← /staff/index.html entry point
└── pass-dismiss.js         ← /staff/dismiss.html entry point
netlify/functions/
├── athletics-data.js       ← Scheduled daily scraper (3am Pacific cron)
└── package.json            ← cheerio dependency
netlify.toml                ← Cron schedule config
```

### File structure (additions only) — updated 2026-04-23

```
staff/
├── index.html              ← PIN entry + staff dashboard
└── dismiss.html            ← Sport detail: roster + dismissal actions
js/
├── pass-db.js              ← Dexie setup, schema, typed CRUD + shared sync
├── pass-data.js            ← Fetch athletics-data JSON + Sheet overrides, merge
├── pass-trust.js           ← Device trust check (localStorage flag)
├── pass-staff.js           ← /staff/index.html entry point
└── pass-dismiss.js         ← /staff/dismiss.html entry point
netlify/functions/
├── athletics-data.js       ← Scheduled daily scraper (3am Pacific cron)
├── dismissals/             ← Shared dismissal state (directory-based function)
│   ├── index.js            ← GET/POST/DELETE against Netlify Blobs
│   ├── package.json        ← @netlify/blobs dependency (vendored)
│   └── node_modules/       ← Vendored — committed because root .gitignore excludes node_modules
├── ical.js                 ← iCal proxy
└── package.json            ← cheerio dependency (athletics scraper)
netlify.toml                ← Cron schedule config
```

### Key architectural decisions

- **UI state reflects Dexie. Always.** ACTIVE and DISMISSED lists derive from `Dexie.liveQuery()`, never local state. No optimistic updates.
- **Un-dismiss is tap-on-dismissed-name.** No toast, no confirmation modal. Symmetric with dismiss (one tap each direction).
- **Three-layer data merge:** game_overrides → scraper → sport_defaults → hide (no dismissal time = don't show).
- **Scraper boundary:** writes to Netlify Blobs only, never to the Google Sheet. Sheet is human-override territory.
- **5-tap hidden gesture** on the "MD Today" header brand navigates to `/staff/`. This is how teachers reach the PIN gate from inside the installed PWA (no address bar). `touch-action: manipulation` prevents zoom.
- **Floating key icon (FAB)** appears bottom-right on all student views only after device trust is established. Pulses for 5 minutes after page load (subtle box-shadow ripple), then stops. Respects `prefers-reduced-motion`.
- **PIN gate uses blocking `<script>` in `<head>`** to prevent flash of PIN section on trusted devices (bfcache, back-navigation).
- **Demo mode (`?demo`)** injects fake games for testing. Remove before production launch.
- **Trusted devices no longer auto-redirect to `/staff/`.** Teachers land on the Now view like students. The FAB pulse draws attention to the staff entry point. The `mdt:forceStudent` sessionStorage override in `pass-staff.js` is now a no-op but harmless.

### Shared dismissal state — added 2026-04-23

Dismissals sync across devices via Netlify Blobs. Local Dexie provides instant UI; Netlify Blobs is the shared source of truth.

**Data flow:**
- **Dismiss:** local Dexie write (instant UI) → async POST to `/.netlify/functions/dismissals` → stored in Netlify Blob keyed `dismissals-YYYY-MM-DD`
- **Page load:** GET from server → `syncPullDismissals` reconciles local Dexie with server (adds missing, deletes stale)
- **Un-dismiss:** local Dexie delete → async DELETE to server by `_remoteId`

**Key properties:**
- **Slow sync, not real-time.** Device B sees Device A's dismissals on page load/refresh, not instantly. Acceptable for school dismissal workflows — teachers aren't racing.
- **Any trusted device can un-dismiss any student.** Symmetric access, no per-teacher identity (Phase 2 candidate).
- **Bidirectional reconciliation.** `syncPullDismissals` adds server records missing locally AND deletes local records missing from server. Without this, un-dismiss on Device B was invisible to Device A.
- **One blob per day.** Key format `dismissals-YYYY-MM-DD` (US/Pacific timezone). Old blobs accumulate indefinitely — cleanup function for 30/90 day retention is a future task, low priority.
- **Server assigns `_id`.** Each record gets a unique `_id` on POST (`timestamp_random`). Stored in local Dexie as `_remoteId` so un-dismiss can reference it for server deletion.
- **Fire-and-forget push.** `syncPushDismissal` is called without `await` in the dismiss flow. If network fails, dismissal is saved locally with a console warning. Server catches up on next successful push.
- **Vendored dependency.** `@netlify/blobs` is committed inside `netlify/functions/dismissals/node_modules/` because root `.gitignore` excludes `node_modules/` and Netlify only auto-injects `@netlify/blobs` for scheduled functions, not regular ones. The directory-based function with its own `package.json` + vendored `node_modules` is the pattern that works.

### Student-facing files modified by Pass App

- `index.html`, `upcoming.html`, `sports.html`, `daysoff.html` — inline script for FAB (with 5-min pulse) + 5-tap gesture
- `css/styles.css` — staff styles appended under `/* Pass App (Staff) */` header; FAB pulse animation (`fab-pulse` keyframe)

All student-facing JS modules are untouched. The auto-redirect from `js/app.js` was removed 2026-04-23.

### Google Sheet tabs — created 2026-04-23

Four tabs in the existing MD Today sheet, published as CSV:
- `sport_defaults` (gid `1365459934`) — coach policy dismissal times per sport/level
- `manual_rosters` (gid `567893210`) — rosters for sports without roster pages on athletics site
- `game_overrides` (gid `1944365028`) — per-game dismissal time overrides
- `dismissals` (gid `825803187`) — created for potential future Sheet-based logging; currently unused (Netlify Blobs is the active shared store)

Config tab gids are wired into `js/pass-data.js` (lines ~16-21). All Sheet CSV fetches now go through `/.netlify/functions/sheets?tab=X` (see "Zero external dependencies" below).

### Session 2026-04-24: Scraper, zero-dependency architecture, resolver fixes

**Athletics scraper — now working in production:**
- **iCal-filtered scraping.** Scraper fetches the iCal feed first to determine which sports have games today, then only scrapes those (typically 2-5 sports, ~20 requests instead of 120+). Falls back to scraping all if iCal is unavailable.
- **Rate limiting solved.** The athletics site returns a 2195-char block page after ~60 requests. The iCal filter + 2s delay between sports + scrape lock (prevents concurrent invocations) keeps us under the limit.
- **Scrape lock.** Uses a Netlify Blob (`scrape-lock`) with a 3-minute TTL. Second invocation serves cached data instead of starting another scrape. Without this, the CDN retry triggered a second scraper that doubled the request load.
- **Manual trigger.** `?scrape=md1950` on the athletics-data function forces a fresh scrape without waiting for the cron. Uses the staff PIN as a simple gate.
- **Cron moved to 12:01 AM Pacific** (`1 7 * * *` UTC) — calendar is already set by then, no need to wait until 3am.
- **Real game data confirmed.** April 24: Baseball Varsity vs JSerra (dismiss 11:45 AM), Softball Varsity vs JSerra (dismiss 1:20 PM). Rendered on staff dashboard without demo mode.
- **Directory-based functions.** Both `athletics-data/` and `dismissals/` are directory-based with vendored `node_modules/` (committed via `.gitignore` override). This is the pattern that works on Netlify — the root `.gitignore` excludes `node_modules/` globally, and Netlify doesn't run `npm install` for subdirectory functions.

**Zero external dependencies — all fetches proxied through same origin:**
- **Vendored JS libraries.** PapaParse, ical.js, and Dexie moved from CDN imports (`cdn.jsdelivr.net`) to `./vendor/` directory. `cdn.jsdelivr.net` was unreachable on some cellular networks, causing the entire app to fail to load. ~310KB total, precached by service worker.
- **Google Sheet CSV proxy.** New `netlify/functions/sheets.js` proxies all 5 Sheet tabs via `/.netlify/functions/sheets?tab=X`. `docs.google.com` was also unreachable on some cellular networks. The Sheet must be both "Published to web" AND shared as "Anyone with the link can view" — these are separate Google permissions. Missing the share permission causes a 302 redirect to Google login.
- **Complete list of same-origin proxied endpoints:**
  - `/.netlify/functions/ical` → Mater Dei iCal feed
  - `/.netlify/functions/sheets?tab=templates` → bell schedule templates CSV
  - `/.netlify/functions/sheets?tab=summary_map` → calendar SUMMARY → template mapping CSV
  - `/.netlify/functions/sheets?tab=sport_defaults` → coach default dismissal times CSV
  - `/.netlify/functions/sheets?tab=manual_rosters` → manual roster entries CSV
  - `/.netlify/functions/sheets?tab=game_overrides` → per-game overrides CSV
  - `/.netlify/functions/athletics-data` → scraped game schedules + rosters JSON
  - `/.netlify/functions/dismissals` → shared dismissal state (Netlify Blobs)
- **If Netlify is up, the app works. No CDN, no Google, no third parties in the critical path.**

**Sports view fix:**
- `SPORTS_PATTERNS` in `sports-view.js` required a gender word (Boys/Girls) after the level prefix, missing sports like Baseball, Softball, Track that use `"V Baseball @ ..."` without a gender word. Fixed to match any `^V\s`, `^JV\s`, `^FR\s` prefix.

**Friday office hours fix:**
- Resolver now filters out blocks matching `/office\s*hour/i` on Fridays (`date.getDay() === 5`). Same pattern as the Monday homeroom substitution — a localized resolver convention, not a template change.

**Countdown format:**
- Shows `1h 44m 56s` instead of `104m 56s` when countdown exceeds 60 minutes.

**Cache version:** `v2.2.0` (bumped from `v2.0.0` during this session).

**`reset.html`** — nuclear reset page at `/reset.html`. Unregisters all service workers, clears all caches, clears localStorage. Created during mobile debugging. Can be used by any student with a stuck PWA. Consider removing or PIN-gating before wider launch.

**Known issues from this session:**
- **Baseball and softball have no online rosters.** The athletics site roster pages are empty for these sports — the coaches haven't entered data into HomeCampus. The `manual_rosters` Sheet tab exists and the code reads from it, but it needs to be populated with player names from the coaches.
- **10 sports total have no roster pages** on the athletics site: Baseball, Softball, Track & Field, Volleyball (Boys), Swimming, Tennis, Golf, Lacrosse, Water Polo, Wrestling. All require manual entry in the Sheet's `manual_rosters` tab for roster-based dismissal.

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
14. **When debugging module-loading weirdness in Safari, empty the cache.** `Develop → Empty Caches` (or `Cmd+Option+E`) before assuming the code is wrong. Safari aggressively caches ES modules between edits, and `Cmd+Shift+R` does not always clear them. Lost ~20 minutes of Phase 2 debugging to this once; symptom was "page stuck on LOADING… but no console errors, and `import('./js/app.js')` in console succeeds." If the file on disk is correct and `wc -l` confirms it's non-empty, the problem is Safari's cache, not the code.
15. **"Phase N says create file X" in the spec ≠ "file X does not exist on disk."**
16. **CSS `display` values override the `hidden` attribute.** If a CSS rule sets `display: flex` (or any explicit display), the HTML `hidden` attribute is silently ignored. Use `style.display = 'none'` / `style.display = ''` instead of `.hidden` when CSS declares a display value. This burned us on the staff stale banner.
17. **iOS PWA localStorage is separate from Safari.** Adding to Home Screen creates a new browsing context with its own localStorage. Trust flags, personal schedules, and any other localStorage state set in Safari do NOT carry over. The 5-tap gesture exists specifically so teachers can reach `/staff/` and enter the PIN from inside the PWA context.
19. **Never add external CDN imports.** All JS libraries are vendored in `./vendor/` and all data fetches go through same-origin Netlify Functions. CDN and Google were unreachable on cellular networks, breaking the app entirely. If a new library is needed, download the ESM build into `vendor/`, add to SW precache, and import with a relative path.
20. **Friday never has office hours.** The resolver filters these out automatically. If this changes, remove the Friday filter in `resolve.js`.
21. **Google Sheet must be both "Published to web" AND shared as "Anyone with the link."** These are separate permissions. Missing either one breaks the CSV fetch — Published-but-Restricted returns a 302 to Google login.
18. **The `hidden` attribute pattern is unreliable when CSS sets `display`.** Prefer `style.display` toggling for any element that has an explicit `display` value in CSS. The `hidden` attribute works fine for elements with no CSS display override. Empty stub files are common in early-phase scaffolding (this has happened at least twice — `countdown.js` before Phase 2's correction, `sw.js` + `manifest.json` before Phase 4). Before any phase that introduces new files, run `ls -la` or `git ls-files` + `wc -l` on each named target. "Create X" in the spec means "fill X," not "assume X doesn't exist." The consequence of assuming wrong is overwriting real work with no recovery path.

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

**✅ Audit completed 2026-04-20.** Ran an in-browser audit against the live 2025–2026 feed. Result: 1043 unique SUMMARYs in the feed; all 18 schedule-representing SUMMARYs (`RED:`, `RED (...)`, `GRAY:`, `GRAY (...)`, `Special Online Schedule:`) are mapped in `summary_map`. Zero schedule SUMMARYs unmapped. Risk 1 mitigation verified.

Audit snippet (runnable in browser console — reproduce before each school-year rotation):

```js
(async () => {
  const { loadData } = await import('./js/data.js');
  const d = await loadData();
  const mapped = new Set((d.summaryMap || []).map(r => r.calendar_summary));
  const scheduleLike = [...new Set(
    d.events.filter(e => /schedule|^RED|^GRAY/i.test(e.summary)).map(e => e.summary)
  )];
  scheduleLike.sort().forEach(s => {
    console.log(`${mapped.has(s) ? '✓ mapped ' : '✗ UNMAPPED'}  ${s}`);
  });
})();
```

Note: the `^RED|^GRAY` half of the regex catches non-schedule events with "Red" prefixes (e.g. "Red Ribbon Week", "Red Cross Blood Drive", "Red Hot Jazz") — those correctly appear as ✗ UNMAPPED and should be ignored. Any `✗ UNMAPPED` line containing `RED: B.`, `RED (`, `GRAY: B.`, `GRAY (`, or `Schedule:` is a real gap that needs a `summary_map` row.

**Follow-up observations (not launch-blockers, candidates for v1.1+):**

- **Semester Exams schedule events are unmapped.** Seven SUMMARY variants exist: `Semester Exams (Blocks 1 & 2)` through `Semester Exams (Blocks 7 & 8)` (and the block-order-swapped variants). Each appears once in the feed. These are real schedule days with non-standard block orders; currently the app enters Assumed state on exam days. Honest but suboptimal. Fix path: add a `semester_exams` template to the `templates` tab (or per-variant templates if block times differ), map each SUMMARY variant to it. Low priority until real exam weeks are observed in production.
- **`FLEX DAY` × 3 occurrences — completely invisible to the app.** Not a schedule SUMMARY, not a day-off keyword, not an announcement keyword. Action item: ask the school what the schedule looks like on a FLEX DAY and either add a template or add a day-off keyword, depending on whether there's instruction.
- **Announcement filter has plural-insensitive misses.** The `ANNOUNCEMENT_INCLUDE_KEYWORDS` list in `resolve.js` uses substring matching against lowercased summaries. `'testing'` catches `ACT Testing` but misses `SAT Test` (no trailing `ing`). `'graduation'` is absent — graduation day wouldn't surface as an announcement. `'last day'` is absent — `Last Day of School` is silent. Risk 2 says "loosen the filter only in response to a specific missed event, never preemptively," so these are logged but not fixed in v1. Revisit after real use.

**Follow-up addendum (resolved during Phase 5 build):** The audit caught no schedule-SUMMARY false negatives, but Phase 5's Days Off view exposed a related issue in `DAY_OFF_KEYWORDS` — the `'holiday'` keyword was producing false positives on sport events ("Holiday Cup", "Portland Holiday Classic"). Removed in Phase 5. See Phase 5 implementation notes. Pre-launch keyword audits should test BOTH directions: schedule SUMMARYs not over-matched as day-offs, AND day-off SUMMARYs not under-matched.

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

### Risk 4: Third-party CORS proxy becomes a single point of failure

The iCal feed is fetched through corsproxy.io because Mater Dei's server doesn't send CORS headers. If corsproxy.io goes down or changes its URL format, every Mater Dei fetch fails until cache expires — and then the app is Stale for every user simultaneously, not degrading gradually.

**Mitigation:**
- The failure is caught and produces a visible **Stale** trust state, not a crash — students still see cached data honestly
- 12-hour freshness horizon limits the window where Stale is silent vs. visible
- The proxy URL is a single constant in `js/data.js` — switching to `api.allorigins.win` or a self-hosted Cloudflare Worker is a one-line change
- Track a v2 task: eliminate the third-party dependency by running our own Cloudflare Worker that proxies the iCal endpoint. Free tier of Workers handles our volume easily.
- Until the v2 migration lands, monitor: if Confirmed-state days drop noticeably and no Mater Dei schedule changed, check the proxy first

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
- **Self-hosted CORS proxy.** Replace the corsproxy.io dependency with a tiny Cloudflare Worker (or Netlify/Vercel edge function) that fetches the Mater Dei iCal feed server-side and re-emits it with proper CORS headers. Eliminates the third-party single point of failure. Free tier on any of these platforms handles our volume easily. See Risk 4 in the Launch Risk Register.
- **Daily news video embed.** Originally specified as part of the Now module. Deferred because it introduces a content dependency (which platform hosts the video, how embeds behave, whether ads appear) that is orthogonal to the schedule-truth invariant and risks contaminating the Now view's information density. Revisit only after v1 adoption is real and only if students request it.
- Push notifications for schedule changes (requires real backend or FCM setup)
- Per-student schedule (requires login — big scope jump)
- Native home screen widget (iOS requires a real app)
- Teacher-authored announcements (requires auth)
- Migration to a real backend if the sources become a bottleneck

**The temptation to add these during v1 is the single biggest risk to the project. Resist it.**

---

## Live Sports — Vision (April 2026)

This is the feature that transitions MD Today from a schedule utility to a school platform. The schedule gets students to install it. Live scores get them to keep opening it. Strong conviction that students, teachers, admin, and alums would all use this — described as "glaringly absent" in the Mater Dei sporting community.

### Architecture (proof of concept)

- **Scorer UI:** One person (student manager) taps score updates from the sideline. Simple: [−] score [+] per team, period/quarter/inning selector, unofficial clock.
- **Broadcast:** Same infra as dismissals — POST to Netlify Blobs, pull/refresh on the client. Not real-time, but "live enough" (10-30 second delay). WebSockets deferred until demand requires it (probably when logins exist).
- **Entry point:** The Sports tab already exists. A game day with a live score becomes the most compelling thing in the app.

### Feature layers (build in order)

**Layer 1 — Live scoring (proof of concept)**
- Tap-to-score UI for the student manager
- Score + period/quarter broadcast to all viewers
- Unofficial clock display
- Pull-to-refresh on the viewer side

**Layer 2 — Sport day view enhancements**
- Address field linking to Maps for away games
- RSVP for students — view a list of who's going
- Tap a sport to open its season schedule with results

**Layer 3 — Season schedule + results**
- Unofficial results first (from scorer)
- Official results verified later via CIF data

**Layer 4 — Roster + player profiles**
- Tap a name → player pic, bio, stats, press, height, weight
- Scraper already pulls rosters; profile data needs another source

**Layer 5 — Live feed chat**
- Everyone watching the stream can read and participate
- Heavy AI filter for language (non-negotiable in a school context)
- Requires auth (login system) — deferred until backend exists

### Rollout sequence

1. **Football (fall)** — biggest crowd, simplest score model (two numbers + quarter)
2. **Basketball (winter)** — high engagement, indoor
3. **Baseball (spring)** — more granular scoring
4. Fill in remaining sports once the big three are established

### Infrastructure progression

- **Phase 1 (now):** Netlify Blobs + pull refresh. Same stack as dismissals. No new dependencies.
- **Phase 2 (when usage demands it):** WebSockets + backend + login system. This is when chat, per-user identity, and real-time push become necessary.
- **Phase 3:** CIF data integration for official results, player profile data sources.

### Why this matters for monetization

A parent watching their kid's game from work, on the school's own app — that's institutional pride, not just a tool. This is the feature that makes a principal say "we need to budget for this." Live sports transforms MD Today from "a nice thing a student built" to "part of how we run athletics."

---

## Attendance — Vision (April 2026)

Replaces the teacher's manual roll-call-and-data-entry loop with a kiosk students tap on the way in. Same architecture as dismissals — roster of names, tap to change state, synced across devices. This is a new use of the existing teacher role, not a new project.

### The problem

Current attendance flow: teacher takes roll call (scan room, count, check seating chart) → logs into Aeries → navigates to attendance → finds the right class → marks absent students → if a student arrives late, goes back in and changes absent to tardy. 3-5 minutes per class period, 5 periods a day, every day. That's 15-25 minutes of instructional time lost daily.

### MVP features (non-negotiable for v1)

1. **Teacher login + class selection** — teacher opens the app on a tablet/Chromebook, selects which period/class
2. **Roster display** — grid of student names, big tap targets. Seeded from CSV or manual entry for the pilot (no API dependency)
3. **Tap-to-check-in** — student taps their name as they enter, it turns green. One tap, done
4. **Bell-schedule awareness** — the app knows when the period starts (MD Today already has this data). Taps before the bell = present. Taps after = tardy (auto-categorized, teacher doesn't think about it)
5. **End-of-period summary** — clean list: present, tardy, absent. One screen
6. **Export** — one-click copy-to-clipboard or CSV download, formatted to match Aeries import. Ships without API write access

### What's out of scope for MVP

- Aeries API integration (read or write) — seed rosters manually for the pilot
- Student photos
- Student-side self-reporting (spoofing risk without verification; teacher-as-kiosk-operator is the verification)
- Anti-spoofing (QR codes, geofencing) — teacher is in the room, they're the verification
- Parent notifications
- Analytics, trends, reports
- Late-bell edge cases (excused tardies, nurse passes, early releases)
- Admin dashboard

### Aeries integration — gating question (research needed)

Aeries has a documented REST API (JSON, vendor-friendly, certificate-based auth). Districts/dioceses grant a 32-char API key. Known writable endpoints include contacts, student info, gradebook, scheduling, test scores. **Attendance writes appear to be read-only at v5** — every confirmed attendance endpoint uses GET only.

**Action item:** Email Aeries integration team and ask specifically: "Does v5 support POST/PUT for period attendance (ATT table), and if not, is it on the roadmap?" The answer determines whether this becomes a full-loop product (tap → Aeries updated automatically) or a teacher-assist tool (tap → teacher pastes a short list into Aeries in 10 seconds).

**Mater Dei specifics:**
- Private school, Diocese of Orange (~40 schools)
- Aeries instance may be school-level or diocesan-level — need to determine who administers it
- Private/diocesan schools have more flexibility to adopt tools than public districts (fewer compliance hoops, no state procurement)
- If the pilot works at Mater Dei, natural expansion path to every school in the diocese

### Why this matters

- **Dismissal:** tap = "this student left" (operational convenience)
- **Attendance:** tap = "this student is here" (legal mandate)

The stakes are higher. A dismissal bug means a kid waits an extra 5 minutes. An attendance bug means a kid is marked absent when they're present — triggering truancy letters, parental calls, grade consequences. The trust-state architecture (showing confidence level alongside data) is the right foundation, but reliability is non-negotiable.

### Architecture notes

- Same Dexie local state + Netlify Blobs shared store as dismissals
- Same PIN-gated teacher role
- Bell-schedule awareness is free — MD Today already resolves the current period and countdown
- Could be a new view under the teacher role or an extension of the existing dismiss flow
- Roster source for MVP: manual CSV import or Sheet tab. API integration is v2

---

## Streak Indicator — added 2026-04-23

Quiet personal reflection mechanic on the Now view. Not gamification — a subtle mirror of the student's own behavior.

- Tracks which dates the student opened the app in localStorage (max 90 days)
- Counts consecutive school days backward from today — weekends are skipped, not counted as breaks
- Shows nothing on day 1 — no "1-day streak" begging for attention
- Shows "X-day streak" starting at 2+ days, in 12px muted text at 50% opacity, centered below the schedule blocks
- Disappears silently if they miss a school day — the quiet absence is the nudge, not a message
- The dopamine hit is seeing the number go up; the motivation is not wanting to see it gone

---

## Roles & Access Model

MD Today uses PIN-gated roles. Each PIN unlocks a different view layer on top of the base student experience. Student is the default — every role also sees what students see. PINs are device-trusted via localStorage (enter once, remembered until cleared).

| Role | PIN | What they see beyond student view | Status |
|---|---|---|---|
| **Student** | none (default) | Schedule, streak, sports, RSVP | Live |
| **Teacher** | `md1950` | + Dismissal dashboard | Live |
| **Coach** | `co1950` | + Their sport roster, lineup, dismissals | Not built |
| **Parent** | `pa1950` | + Their student's info, game alerts | Not built |
| **Scorekeeper** | `sk1950` | + Score entry UI during games | Not built |
| **Admin** | `ad1950` | + Analytics, overrides, all-sport view | Not built |
| **Commerce** | `cm1950` | + Merch catalog, ticket sales, transactions | Not built |
| **ASB/Spirit** | `as1950` | + Spirit day posts, rally info | Not built |

### Design principles

- **Every role is student-plus.** No role loses the student view. A coach is a student who can also manage their sport. A parent is a student who can also see their kid's info.
- **PINs are simple role gates, not authentication.** They establish "what kind of user is this device" — not "who is this person." Real identity (per-user login) is a Phase 2 concern, deferred until the backend exists.
- **One device can hold multiple roles.** Entering a new PIN adds that role's access without removing previous ones. A teacher who is also a coach sees both views.
- **The 5-tap gesture + FAB pattern extends to all roles.** Currently used for teacher access. Future roles will use the same entry point — the PIN gate determines which dashboard appears.

### Implementation notes

- Currently only `md1950` (teacher) is implemented in `js/pass-trust.js`
- Multi-role support will require `pass-trust.js` to store a set of roles rather than a single boolean flag
- Each role's view can be a separate HTML page under `/staff/` or a filtered version of the same dashboard — TBD based on complexity per role

---

## Vision Alignment — MD Today (April 2026)

The principal responded with strong enthusiasm to MD Today, validating early product-market fit and signaling real institutional interest. Initial student onboarding has begun, and traction is emerging organically.

The broader vision is expanding to include role-based views (student, teacher, coach, parent, etc.) along with future features such as game engagement and monetization pathways. However, the current phase is not about rapid feature expansion, but about clarifying and solidifying the vision.

The focus has shifted from building to articulation—moving the idea from a "mushy" internal state to a clearly defined and communicable system, with a realistic 6–12 month development horizon.

### Core Insight

Schools already possess valuable systems and information, but these resources are fragmented across platforms and go underutilized because they are difficult to access.

### Positioning

MD Today does not aim to replace existing systems. It serves as a unifying access layer that brings those systems into one place.

### Launch Strategy

Initial rollout will be simple and direct:

- QR code distribution at lunch
- Immediate access via mobile
- Usage tracking through GoatCounter

This enables real data collection (adoption, engagement, usage patterns) to present to administration.

### North Star

> "MD Today unifies the scattered systems of school life into one simple app that students actually use."

This statement serves as the guiding principle for all product and strategic decisions moving forward.

---

## Monetization Strategy & Free-to-Paid Transition (April 2026)

### Current thinking

MD Today will initially monetize through a percentage of school-related transactions (such as merchandise), while long-term sustainability will come from institutional adoption as a core operational platform.

### Assessment of merch % model

**Strengths:**
- Aligned with usage (more engagement → more sales)
- Easy for admin to say yes to (no upfront cost)
- Proves you're thinking beyond just building

**Weaknesses:**
- Indirect — you don't control the revenue stream
- Small — merch sales won't justify the value you're creating
- Avoidable — school can just not route sales through you later

**Risk:** Building something essential and getting paid like it's optional.

### Reframing: merch % is proof of value, not the business model

**1. Primary revenue (later, once they depend on it):**
School pays for MD Today as infrastructure.
- Per student: ~$3–$10/student/year → $6,000–$20,000/year at ~2,000 students (cleanest)
- Flat annual license: Small school $5k, Mid $10k, Large/private $15–25k (admin prefers predictable)

**2. Secondary revenue (what's already proposed):**
- % of merch sales
- Extensible later to: event tickets, donations, fundraisers

**3. Optional expansion (future):**
- Premium features for athletics, analytics, etc.

### Why they would actually pay

You need to be able to say (and eventually prove):
- "This runs dismissal"
- "Students actually check this daily"
- "This replaces confusion across X systems"
- "This increases engagement in athletics/events"

Once even one of those is true, you're no longer optional.

### The free-to-paid transition (5 phases)

**Phase 1: Free, but essential (now)**
Roll it out. Get adoption. Let it quietly become part of the day. You're not selling anything yet. You're building: "we use MD Today."

**Phase 2: Prove value with data**
This is where GoatCounter pays off. Walk into admin with:
- "78% of students used it this week"
- "Dismissal traffic peaks at 3:10 daily"
- "Students check it before games"

Now it's not "I built something cool." It's "This is already part of your school."

**Phase 3: Soft positioning (not a pitch)**
Don't say "pay me." Say something like: "I want to keep building this out properly — parent view, athletics, full integration — but that probably means formalizing it as a supported system."

You're inviting them into the next level.

**Phase 4: Frame the decision correctly**
Don't frame it as: "Do you want to buy this?"
Frame it as: "Do you want this to become an official system at the school?"
Money becomes a detail, not the decision.

**Phase 5: Give them an easy yes**
Example: "We could structure it at about $5 per student annually, which would let me maintain and expand it properly."
That sounds reasonable, already thought through, not aggressive.

### The real leverage point

Your power moment is when this becomes true:
- Teachers expect it
- Students check it
- Admin references it

At that point, the question is no longer "Should we pay?" — it becomes "We can't lose this — how do we support it?"

### What to track right now (your receipts)

As you roll this out, quietly start tracking:
- % of students onboarded
- Daily usage
- Dismissal usage specifically
- Any moment where someone says "this helped"

Those become the evidence for the Phase 2 conversation.

---

*MD Today — Mater Dei High School, Santa Ana*
