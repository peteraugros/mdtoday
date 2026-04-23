# BUILD.md — Pass App (MD Today Extension) — v1.5

**Purpose of this file:** executable build instructions for Claude Code. Keep this file open during sessions. For architectural reasoning, see `mdtoday.md` (spec) and `claude.md` (project conventions).

**v1.5 changes:** Replaces the speculative scraper (Step 4) with a confirmed three-phase athletics data scraper. Adds a three-layer data architecture (iCal + enrichment + Sheet override). Sheet role reduces to override/fallback only. Changelog at end of file.

---

## This Is an Extension, Not a New Build

The Pass App is a new capability inside the **existing** MD Today codebase. Same repo, same deploy, same domain. Nothing about the current student-facing product changes.

**What gets added:**
- `staff/` directory with two new HTML files
- Five new `js/pass-*.js` modules (prefixed to stay visually separate)
- One new Netlify scheduled function: `netlify/functions/athletics-data.js`
- Appended rules at the bottom of the existing `css/styles.css` under a `/* === Pass App (Staff) === */` header
- Two new tabs in the existing Google Sheet: `sport_defaults`, `manual_rosters` (override-only, not ingestion)

**What does NOT change:**
- `index.html`, `schedule.html`, `daysoff.html` — untouched
- `js/app.js` — receives ONE scoped addition (~10 lines) for session-aware redirect to `/staff/` on trusted devices. See Step 3a. All other student-facing JS untouched.
- `js/resolve.js`, `js/data.js`, `js/schedule.js`, `js/countdown.js`, `js/schedule-view.js`, `js/daysoff-view.js` — untouched
- Service worker, manifest, icons — untouched
- Existing `netlify/functions/ical.js` — untouched
- The iCal feed and existing Sheet tabs (`templates`, `summary_map`) — untouched
- Existing student-facing GoatCounter tracking — untouched

**Mental model:** MD Today v1 is a student schedule viewer. MD Today v1.x is a student schedule viewer + hidden staff tools at `/staff/`. Same product, two surfaces.

## Data Architecture — Three Layers

The Pass App uses a three-layer data flow. Each layer has a single, clean responsibility:

**Layer 1 — Calendar (existing, unchanged):** The Edlio iCal feed MD Today already consumes is the source of truth for *what games exist today*. The Pass App never fetches game lists independently — it reads them from the existing iCal pipeline.

**Layer 2 — Enrichment (new, daily cron):** A Netlify scheduled function (`athletics-data.js`) runs daily at 3am Pacific. It scrapes `materdeiathletics.org` for two data types the iCal feed doesn't carry:
- **Dismissal times** per game (from the WordPress AJAX endpoint)
- **Team rosters** per sport (from roster pages)

The scraper caches its last-good result and serves it from `/.netlify/functions/athletics-data` on every call. The app fetches this JSON on `/staff/` load.

**Layer 3 — Override (the Sheet, shrunk):** The Sheet now holds human-owned overrides only — no ingested data:
- `sport_defaults` — coach policy dismissal times per sport (used when scraper finds none)
- `manual_rosters` — rosters for sports without roster pages on the athletics site (10 sports listed in §22 of `mdtoday.md`)
- Per-game override rows — when a coach says "we're leaving earlier today"

**Merge order at display time (LOCK):** override-if-present → scraper-otherwise → fallback empty. A game with no dismissal time from any source simply doesn't appear in the dismissal dashboard.

---

## ⚠️ READ BEFORE EVERY SESSION

This is an **extension to the existing, shipped MD Today codebase.** It is not a new app.

**From `claude.md` — these rules apply to every Pass App session:**

1. **Always request the current file before editing.** Never reconstruct from memory. If BUILD.md or `mdtoday.md` says a file exists, the real file is on the user's disk — ask for it. Do not recreate.
2. **Surgical fixes only.** Do not "clean up while you're there."
3. **Before any phase that introduces new files, run `ls -la` or `git ls-files` on the target directory.** "Create X" means "fill X," not "assume X doesn't exist."
4. **After every session, before committing:** run `git diff --stat HEAD`. Verify no files deleted. If any `.html`, `.js`, `.ts`, or `.css` files show as deleted, STOP — do not commit.
5. **Commit after every working change.** Small commits. Clear messages. Never batch unrelated changes.
6. **Log full error objects.** `console.error('Context:', { err })`, not just `.message`.
7. **Student-facing files MUST NOT gain teacher affordances**, with ONE scoped exception: `js/app.js` gains a 10-line session-aware redirect block that checks device trust and sends trusted teachers to `/staff/` on first load of `/`. The exception is narrowly defined — no UI, no imports from `pass-*` modules besides `pass-trust.js`, no visible affordance to students. Everything else (`index.html`, `schedule.html`, `daysoff.html`, `css/styles.css`, `js/resolve.js`, `js/data.js`, `js/schedule.js`, `js/countdown.js`, `js/schedule-view.js`, `js/daysoff-view.js`) stays untouched. Pass App surface stays under `/staff/` + dedicated `js/pass-*.js` modules.

---

## Stack (Locked — Do Not Deviate)

This matches the existing MD Today stack. Do not introduce a framework, build step, TypeScript, or npm dependencies.

| Layer | Choice |
|---|---|
| Markup | Vanilla HTML |
| Styling | Vanilla CSS, existing `:root` variables in `css/styles.css` |
| Behavior | Vanilla JavaScript (ES modules) |
| Local DB | Dexie.js via CDN |
| CSV parsing | PapaParse via CDN (already in stack) |
| Athletics data ingestion | Netlify scheduled function (follows existing `netlify/functions/ical.js` pattern) |
| Host | Netlify (existing deploy) |

**CDN imports — use these exact URLs:**

```html
<!-- In /staff/index.html and /staff/dismiss.html -->
<script src="https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
```

**Do NOT:**
- Install npm packages
- Add a build step
- Introduce React / Vue / Svelte
- Add TypeScript
- Add Tailwind
- Use `import` from anywhere other than local `./js/pass-*.js` files or the CDN URLs above

---

## File Structure (Additions Only)

Existing MD Today files are NOT modified unless explicitly called out. The Pass App adds:

```
mdtoday/
├── staff/
│   ├── index.html              ← PIN entry + staff dashboard (today's games list)
│   └── dismiss.html            ← Sport detail view: roster + dismissal actions
├── js/
│   ├── pass-db.js              ← Dexie setup, schema, typed read/write helpers
│   ├── pass-data.js            ← Fetch athletics-data JSON + Sheet overrides, merge, in-memory cache
│   ├── pass-trust.js           ← Device trust check (localStorage flag)
│   ├── pass-staff.js           ← /staff/index.html entry point (dashboard render)
│   └── pass-dismiss.js         ← /staff/dismiss.html entry point (roster + dismiss flow)
├── netlify/functions/
│   └── athletics-data.js       ← Scheduled daily scraper; serves JSON on every call from cached last-good result
└── css/styles.css              ← EXTEND with /staff/ styles (append, do not modify existing rules)
```

**Total new files: 7.** If you need an 8th file, you are probably avoiding a simpler solution. In 48 hours, file count is cognitive load, and cognitive load is bugs. Resist.

**Naming convention:** all Pass App JS modules prefixed `pass-` to keep them visually distinct from MD Today's core modules.

---

## Data Model

### Layer 1 — iCal Feed (Existing, Unchanged)

MD Today's existing `js/data.js` already parses the Edlio iCal feed. Athletics events appear in that feed with SUMMARY strings like `"V Baseball @ JSerra"` and are currently filtered out as non-schedule events (no matching `summary_map` row).

The Pass App's `pass-data.js` re-reads these events from the iCal data the app already has in memory, filtering by the `Athletics` category to isolate games. **No new iCal fetch; no second iCal pipeline.**

### Layer 2 — Scraper Output (New)

The Netlify scheduled function `athletics-data.js` returns JSON of this exact shape:

```json
{
  "generated_at": "2026-04-23T10:03:12Z",
  "source": "scrape|cache|fallback",
  "games": [
    {
      "date": "2026-04-24",
      "sport_slug": "baseball",
      "sport_name": "Baseball",
      "level": "Varsity",
      "opponent": "JSerra Catholic",
      "home_away": "home|away",
      "game_time": "18:30",
      "dismissal_time": "14:30"
    }
  ],
  "rosters": {
    "baseball_varsity": [
      { "name_slug": "orlando-castano", "display_name": "Orlando Castano", "jersey": "12" }
    ]
  }
}
```

**Field rules:**
- `sport_slug` is the athletics site's URL slug (e.g., `basketball-boys`, `volleyball-girls`). This is the canonical identifier used across scraper output, Sheet override keys, and Dexie records. **It is NOT the iCal feed's SUMMARY format** (which uses shorter forms like `"V Basketball, Boys"`). Translating between the two is handled in `pass-data.js` via a mapping table — NOT in the scraper. The scraper should never "fix" sport names to match iCal; if future-you is tempted to normalize slugs in the scraper, stop: the translation boundary belongs in the app, not the ingestion layer.
- `dismissal_time` is `HH:MM` in local Pacific time. May be `null` if the scraper found none for that game.
- `home_away` is derived from the `.vs` element text (`at` = away, `vs` = home).
- `level` is one of `"Varsity"`, `"JV Red"`, `"JV Gray"`, `"Freshman"`. Coverage varies by sport; the scraper tries all four per sport and skips empty responses.
- Roster keys are `{sport_slug}_{level_lowercase_underscored}`, e.g., `baseball_varsity`, `soccer_boys_jv_red`.
- `source` is `"scrape"` on a fresh successful run, `"cache"` if serving last-good result less than 36h old, `"fallback"` if older (app should show staleness indicator — see "Stale Data Handling" in Step 4).

### Layer 3 — Google Sheet Override Tabs (New)

**Tab: `sport_defaults`** (one row per sport/level)

| Column | Type | Notes |
|---|---|---|
| sport_slug | string | Matches scraper's `sport_slug` |
| level | string | `Varsity`, `JV Red`, `JV Gray`, `Freshman` |
| default_dismissal_time | `HH:MM` | Coach policy; used when scraper's `dismissal_time` is null |
| notes | string | Optional — human context |

**Tab: `manual_rosters`** (one row per player on teams without roster pages)

| Column | Type | Notes |
|---|---|---|
| sport_slug | string | Matches scraper's `sport_slug` |
| level | string | |
| display_name | string | Full name as teachers would recognize |
| notes | string | Optional |

These tabs are for the 10 sports listed in `mdtoday.md` §22 that have no roster page on the athletics site (Baseball, Softball, Track & Field, Volleyball Boys, etc.).

**Tab: `game_overrides`** (per-game adjustments)

| Column | Type | Notes |
|---|---|---|
| date | `YYYY-MM-DD` | |
| sport_slug | string | |
| dismissal_time | `HH:MM` | Overrides both scraper and sport default |
| notes | string | |

Used when a coach says "today is different" — traffic, weather, bus change. Humans only; scraper never writes here.

### Merge Order (LOCK)

When `/staff/` renders today's dismissal dashboard, each game resolves dismissal time in this exact order:

1. `game_overrides` row matching `(date, sport_slug)` → use this
2. Scraper's `dismissal_time` field for this game → use this
3. `sport_defaults` row matching `(sport_slug, level)` → use this
4. Otherwise → game doesn't appear in dismissal dashboard (no dismissal time = no need to dismiss)

Roster resolution follows similar order:

1. Scraper's `rosters[{sport_slug}_{level}]` → use this
2. `manual_rosters` rows matching `(sport_slug, level)` → use this
3. Empty roster → teacher uses off-roster entry only

### iCal ↔ Scraper Game Matching (MVP)

When the app displays today's dismissal dashboard, it takes games from the iCal feed and attaches scraper-enriched data to each. **Match by `(date, sport_slug)` — first match wins.**

**MVP behavior:** if multiple games exist for the same sport on the same day (tournament day, doubleheader), the first match is used. Document it in the UI as a known limitation; tighten to include opponent matching only if real use shows collisions.

**Why not opponent matching in MVP:** string matching "St. John Bosco" vs "St John Bosco" vs "St. John Bosco HS" is fragile. Opponent match would either miss real matches (false negatives — worse than tournament-day collisions) or require normalization logic that spirals. Better to fail visibly and debuggably than silently wrong.

**Mapping iCal SUMMARY to sport_slug:** the iCal feed's SUMMARY strings use short forms like `"V Baseball @ JSerra"` while the scraper uses slugs like `baseball`. A small mapping table in `pass-data.js` handles the translation. When in doubt, the iCal event is shown without dismissal enrichment (which is fine — the teacher can still off-roster dismiss).

### Dexie Schema (LOCK)

In `js/pass-db.js`:

```js
// ESM import from CDN
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.mjs';

export const db = new Dexie('mdtoday_pass');

db.version(1).stores({
  dismissals: '++id, sport_id, date, timestamp'
});
```

**One table. Three single-field indexes.** The `date` field stores `'YYYY-MM-DD'` local-date strings (not timestamps) so that `getTodaysDismissals(sport_id)` becomes an O(log n) compound lookup via `.where({ sport_id, date: todayString() })` rather than a full-table scan filtered in JS.

**Why `date` is a separate field and not derived from `timestamp`:** Dexie indexes physical columns. Filtering by "timestamp >= startOfToday()" forces a scan. Storing the local-date string explicitly makes the query index-driven. Costs 10 bytes per row, saves an O(n) scan that grows forever.

**Date construction rule:** `date` MUST be built from the device's local timezone, not UTC. Use:

```js
function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

A dismissal at 11:55 PM Pacific must not record as the next day's UTC date.

**Sport ID in dismissal records:** The Pass App uses `{sport_slug}_{level_lowercase}` (e.g., `baseball_varsity`, `soccer_boys_jv_red`) as the `sport_id` field in dismissal records. This matches the scraper's roster keying and the Sheet's override keying, keeping the whole system on one identifier scheme.

### Dismissal Record Shape (LOCK)

Every record written to `db.dismissals` MUST match this shape:

```js
{
  id: auto,                          // Dexie auto-increments
  sport_id: 'string',                // format: "{sport_slug}_{level_lower}", e.g., "baseball_varsity"
  sport_name: 'string',              // denormalized for display without re-lookup
  date: 'YYYY-MM-DD',                // local-date string from todayString() — indexed
  identity: {
    type: 'roster' | 'free_text',    // source of the name
    value: 'string'                  // the name itself
  },
  student_id: 'string' | null,       // present only when type === 'roster'; holds the _key (see Step 8)
  roster_match: boolean,             // system-match result at time of action (not "did teacher type")
  timestamp: number,                 // Date.now() — for sort/display only, not for date filtering
  dismissed_by: 'teacher'            // placeholder; real identity is phase 2
}
```

**Do not treat `identity.value` as a primary key.** It is a human-readable name, not an identifier. Names change, duplicate, and have variants. Dismissal-identity comparisons MUST prefer `student_id` when present (see ACTIVE derivation rule in Step 8).

---

## Build Order (48 Hours)

### Pre-Flight (already completed)

The scraper endpoints were verified during spec drafting. These are confirmed working against the live athletics site as of 2026-04-23:

**Nonce extraction** — works. Returns a fresh 10-char hex nonce per page load:
```bash
curl -s "https://www.materdeiathletics.org/varsity/baseball/schedule-results?hl=0" \
  | grep -oE '_ajax_nonce=[a-f0-9]+' | head -1
```

**Schedule + dismissal times AJAX** — works. Returns rendered HTML with `data-date` attributes, opponent text, and `#hoverModal_N` divs containing `Dismissal Time: HH:MM`:
```bash
curl -s "https://www.materdeiathletics.org/wp-admin/admin-ajax.php?action=load_schedule_results_full&level=Varsity&sportID=21&showRecord=yes&school_id=289&year=2025-26&endpoint=https://www.homecampus.com/api&show_team_events=&_ajax_nonce=$NONCE"
```

**Roster pages** — works. Returns server-rendered HTML with `href="/player/{slug}?picture=..."` for each player. Slug format varies (some sports use `first-last`, others use `last-first`). Do NOT attempt to normalize — store display name as converted from slug (hyphens → spaces, title-case), let teachers recognize.

**Known limitations (see §22 of `mdtoday.md` for full list):**
- Football roster shows stale `__trashed` entries from prior season — filter these out
- 10 sports have no roster page at all — `manual_rosters` Sheet tab covers these
- Coverage varies per sport-season; baseball often empty, basketball/volleyball reliable

If the pre-flight needs re-verification (e.g., WordPress update breaks the endpoints), re-run the three curls above. If any fail, Step 4 needs investigation before proceeding.

### Day 1 — Data Layer + Shell

**Step 1: `js/pass-db.js`** (~55 lines)
- Import Dexie from CDN
- Export `db` with the v1 schema above (indexes: `sport_id`, `date`, `timestamp`)
- Export `todayString()` — local-date `YYYY-MM-DD` builder (see "Date construction rule" above)
- Export `addDismissal(record)` — **writes the record to Dexie AFTER a DB-layer uniqueness check (LOCK). Returns `{ id, isNew }` so the caller can distinguish real writes from duplicate-guard hits:**
  ```js
  // Normalize free-text names so "John Smith", "john smith", and " John Smith "
  // all collapse to the same identity — prevents messy duplicate off-roster entries.
  const normalize = s => String(s || '').trim().toLowerCase();

  export async function addDismissal(record) {
    // Defensive assertion — roster dismissals MUST carry student_id (the _key).
    if (record.identity.type === 'roster' && !record.student_id) {
      console.error('Roster dismissal missing student_id — refusing write', { record });
      return { id: null, isNew: false };
    }

    // DB-layer uniqueness guard — protects against rapid taps across page refreshes,
    // race conditions with liveQuery settling, and any UI-layer bypass.
    const existing = await db.dismissals
      .where({ sport_id: record.sport_id, date: record.date })
      .filter(d =>
        (d.student_id && record.student_id && d.student_id === record.student_id) ||
        (!d.student_id && !record.student_id &&
          normalize(d.identity.value) === normalize(record.identity.value))
      )
      .first();

    if (existing) return { id: existing.id, isNew: false };

    const id = await db.dismissals.add(record);
    return { id, isNew: true };
  }
  ```
  This is the **authoritative** duplicate guard. The UI-layer `dismissedKeys` check in Step 8 is a performance optimization that avoids the async DB roundtrip on normal taps; this is the safety net that catches edge cases (post-refresh rapid tap, liveQuery not yet settled, two tabs open on the same sport, case/whitespace variants of the same free-text name).
- Export `deleteDismissal(id)`
- Export `getTodaysDismissals(sport_id)` — returns `db.dismissals.where({ sport_id, date: todayString() }).toArray()`
- Export `liveTodaysDismissals(sport_id)` — returns `Dexie.liveQuery(() => getTodaysDismissals(sport_id))`

**Step 2: `js/pass-data.js`** (~180 lines)

This module is the Pass App's data assembly layer. It pulls from three sources, merges them per the order locked in the Data Model, and returns the games-with-enrichment that `/staff/` renders.

**Responsibilities:**
- Fetch the scraper's JSON output from `/.netlify/functions/athletics-data`
- Fetch the three Sheet override tabs (`sport_defaults`, `manual_rosters`, `game_overrides`) as published CSVs
- Read today's athletics events from the iCal data MD Today already has in memory (`js/data.js` exposes this)
- Merge the three layers per the merge order
- Return `{ games: [...], getRoster(sport_id) }` for the UI

**Constants:**
```js
const ATHLETICS_DATA_URL = '/.netlify/functions/athletics-data';
const SPORT_DEFAULTS_CSV = 'https://docs.google.com/.../pub?gid=XXX&output=csv';
const MANUAL_ROSTERS_CSV = 'https://docs.google.com/.../pub?gid=YYY&output=csv';
const GAME_OVERRIDES_CSV = 'https://docs.google.com/.../pub?gid=ZZZ&output=csv';
const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000; // 36 hours
```

**Core function: `getTodaysGames()`**
Returns a resolved list of today's dismissible games with all enrichment merged in:

```js
async function getTodaysGames() {
  const [athleticsData, sportDefaults, manualRosters, gameOverrides, icalEvents]
    = await Promise.all([
      fetchAthleticsData(),
      fetchSheetTab(SPORT_DEFAULTS_CSV, isValidSportDefaultsRow),
      fetchSheetTab(MANUAL_ROSTERS_CSV, isValidManualRosterRow),
      fetchSheetTab(GAME_OVERRIDES_CSV, isValidGameOverrideRow),
      getTodaysAthleticsEvents()  // from existing js/data.js
    ]);

  const today = todayString();

  return icalEvents
    .map(ev => attachEnrichment(ev, {
      scraper: athleticsData,
      defaults: sportDefaults.data,
      overrides: gameOverrides.data,
      today
    }))
    .filter(g => g.dismissal_time !== null);  // hide games with no dismissal time
}
```

**iCal → scraper matching (LOCK):** `attachEnrichment` matches iCal events to scraper-enriched games by `(date, sport_slug)`, first match wins. Opponent is ignored. Document tournament-day collision as known limitation in UI.

**SUMMARY → sport_slug mapping:** a small internal table translates iCal SUMMARY prefixes to scraper slugs:

```js
const SUMMARY_TO_SLUG = {
  'V Baseball': 'baseball',
  'V Basketball, Boys': 'basketball-boys',
  'V Basketball, Girls': 'basketball-girls',
  'V Football': 'football',
  'V Volleyball, Girls': 'volleyball-girls',
  // ...etc — populate during build from real feed inspection
};
```

Build this table by grepping a recent iCal dump for distinct SUMMARY prefixes. If a SUMMARY doesn't map, the game still shows on the iCal side of MD Today but gets no Pass App enrichment — teachers can still off-roster dismiss.

**Dismissal time resolution (LOCK):**
```js
function resolveDismissalTime(game, { overrides, scraper, defaults }) {
  // 1. Per-game override wins
  const override = overrides.find(o =>
    o.date === game.date && o.sport_slug === game.sport_slug
  );
  if (override?.dismissal_time) return override.dismissal_time;

  // 2. Scraper value
  const scraperMatch = scraper.games.find(g =>
    g.date === game.date && g.sport_slug === game.sport_slug
  );
  if (scraperMatch?.dismissal_time) return scraperMatch.dismissal_time;

  // 3. Sport default
  const fallback = defaults.find(d =>
    d.sport_slug === game.sport_slug && d.level === game.level
  );
  if (fallback?.default_dismissal_time) return fallback.default_dismissal_time;

  // 4. Nothing found
  return null;
}
```

**Roster resolution (LOCK):**
```js
function getRoster(sport_id, { scraper, manualRosters }) {
  // 1. Scraper wins if present
  const scraped = scraper.rosters?.[sport_id];
  if (scraped && scraped.length > 0) return scraped;

  // 2. Manual roster fallback
  const [sport_slug, ...levelParts] = sport_id.split('_');
  const level = levelParts.join(' ');  // restore "JV Red" from "jv_red"
  const manual = manualRosters.filter(r =>
    r.sport_slug === sport_slug &&
    r.level.toLowerCase().replace(/\s+/g, '_') === levelParts.join('_')
  );
  if (manual.length > 0) {
    return manual.map(r => ({ display_name: r.display_name, name_slug: null, jersey: null }));
  }

  // 3. Empty
  return [];
}
```

**Staleness check (LOCK):** before returning, check the scraper's `generated_at` vs now. If older than `STALE_THRESHOLD_MS`, set a flag on the return value so the UI can render a "Data may be stale (last updated X)" banner. Never hide stale data; just mark it.

```js
const staleness = Date.now() - new Date(athleticsData.generated_at).getTime();
return {
  games: resolvedGames,
  getRoster: (sport_id) => getRoster(sport_id, { scraper: athleticsData, manualRosters }),
  isStale: staleness > STALE_THRESHOLD_MS,
  lastUpdated: athleticsData.generated_at
};
```

**Validation gates (LOCK) — prevents poisoning the UI with malformed Sheet rows:**
```js
const isValidSportDefaultsRow = r => !!(r.sport_slug && r.level && r.default_dismissal_time);
const isValidManualRosterRow  = r => !!(r.sport_slug && r.level && r.display_name);
const isValidGameOverrideRow  = r => !!(r.date && r.sport_slug && r.dismissal_time);
```

**Fetch + cache rules (LOCK):**
- Every Sheet fetch caches its cleaned (valid-only) rows in `localStorage` under `pass_sheet_<tabname>_cache`
- On network failure or `valid.length / data.length < 0.5`, return the cached copy with `{ fromCache: true }`
- `fetchAthleticsData` similarly caches under `pass_athletics_data_cache` — if the function call fails, serve the last-good JSON and rely on the staleness indicator

**Never throw from public functions.** All failure modes return a result object. The caller decides how to render.

**Step 3: `js/pass-trust.js`** (~20 lines)
- `isTrusted()` → `localStorage.getItem('trusted_device') === 'true'`
- `trustDevice()` → sets the flag
- `PIN_VALUE = 'md1950'` — constant. Do NOT obfuscate; this is not auth.
- `PIN_LENGTH = 6` — exported so the UI can enforce input length
- **Input contract (enforced at the UI layer in Step 6):**
  - Input field `maxlength="6"`, auto-submit when length reaches 6 characters, no manual "submit" button needed
  - **Wrong-PIN feedback:** 150ms shake animation on the input row, then clear the field. No error message, no text. The shake is the only feedback — zero cognitive load, unambiguous signal. Under dismissal rush a teacher needs to know "that didn't work, try again" without reading anything.
  - Shake via CSS: `@keyframes pin-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }` applied via a transient class added then removed on animationend

**Step 3a: Session-aware redirect in `js/app.js`** (~10 lines, scoped exception to student-purity rule)

The PWA is installed from `/` and opens to `/` by default. Teachers can't type `/staff/` into an address bar because the installed PWA has no address bar. The fix: trusted devices auto-redirect to `/staff/` on first load of `/` per session, but respect an explicit return to the student view.

**Behavior (LOCK):**
- On app load at `/`:
  - If device is trusted AND no session override is set → redirect to `/staff/`
  - Otherwise → stay on `/` (student view renders normally)
- When a teacher clicks "← View student schedule" inside `/staff/`:
  - Set `sessionStorage.setItem('mdt:forceStudent', '1')`
  - Navigate to `/`
- The session override naturally resets when the PWA closes, so next-day launches go back to staff-first behavior.

**Implementation — add to the TOP of `js/app.js`, before any other logic:**

```js
// Pass App redirect — scoped exception to student-purity rule.
// Trusted devices land on /staff/ by default; explicit navigation to / respects user intent.
import { isTrusted } from './pass-trust.js';

if (
  isTrusted() &&
  !sessionStorage.getItem('mdt:forceStudent') &&
  window.location.pathname === '/'
) {
  window.location.replace('/staff/');
}
```

**Why this exact shape:**
- `window.location.replace()` (not `.assign()`) so the student view doesn't pollute back-button history
- Path check guards against firing on `/schedule.html` or `/daysoff.html` (only `/` triggers)
- `sessionStorage`-based override means teacher's explicit choice wins *this session*, but doesn't pollute long-term behavior
- Using `import` from `pass-trust.js` is the only coupling; no UI imports, no student-view mutations

**The "← View student schedule" link (in `/staff/index.html` header):**

```html
<a class="staff-header-back" href="/" data-staff-to-student>← View student schedule</a>
```

With a tiny click handler in `pass-staff.js`:

```js
document.querySelectorAll('[data-staff-to-student]').forEach(a => {
  a.addEventListener('click', () => {
    sessionStorage.setItem('mdt:forceStudent', '1');
    // Native navigation handles the rest
  });
});
```

**Verification checklist additions (folded into Step 10):**
- [ ] Untrusted device opens `/` → student view renders (no redirect)
- [ ] Trusted device opens `/` → redirects to `/staff/` without a flash of student content
- [ ] Trusted device at `/staff/` clicks "View student schedule" → lands on `/` and STAYS there
- [ ] While on `/` after override, refresh the page → still stays on `/` (override persists within session)
- [ ] Close the PWA, reopen → redirects back to `/staff/` (override is session-scoped, not permanent)
- [ ] Trusted device opens `/schedule.html` directly (e.g., via an old bookmark) → stays on `/schedule.html`, no redirect

**Step 4: `netlify/functions/athletics-data.js`** (~250 lines)

Scheduled Netlify Function. Runs daily at 3am Pacific via cron. Scrapes `materdeiathletics.org` for dismissal times and rosters, returns JSON matching the Layer 2 contract in §Data Model. On failure, serves last successful result from Netlify Blobs.

**Netlify config (in `netlify.toml`):**
```toml
[functions."athletics-data"]
  schedule = "0 10 * * *"   # 3am Pacific = 10am UTC
```

**Dependencies (install in `netlify/functions/package.json`, separate from site root):**
```bash
cd netlify/functions && npm install cheerio
```

**High-level structure:**
```js
import * as cheerio from 'cheerio';
import { getStore } from '@netlify/blobs';

const SITE = 'https://www.materdeiathletics.org';
const SCHOOL_ID = '289';
const LEVELS = ['Varsity', 'JV Red', 'JV Gray', 'Freshman'];

/**
 * School year string in "YYYY-YY" format (e.g., "2025-26").
 * Rolls over on July 1 (before fall sports start).
 * Re-evaluated on every scraper run, so the constant never goes stale.
 */
function currentSchoolYear() {
  const now = new Date();
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 6 ? y : y - 1;  // month is 0-indexed; 6 = July
  const endYear = String(startYear + 1).slice(-2);
  return `${startYear}-${endYear}`;
}

export default async (req, context) => {
  const store = getStore('athletics-data');

  try {
    const data = await scrapeAll();
    await store.setJSON('latest', { ...data, generated_at: new Date().toISOString() });
    return respond({ ...data, source: 'scrape' });
  } catch (err) {
    console.error('Scrape failed, falling back to cache:', err);
    const cached = await store.get('latest', { type: 'json' });
    if (!cached) {
      return respond({ games: [], rosters: {}, source: 'fallback', error: String(err) }, 503);
    }
    const age = Date.now() - new Date(cached.generated_at).getTime();
    const source = age < 36 * 60 * 60 * 1000 ? 'cache' : 'fallback';
    return respond({ ...cached, source });
  }
};

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }
  });
}
```

**Phase 0 — Sport discovery (dynamic, not hardcoded):**

The athletics site's homepage has nav dropdowns listing all sports. Fetch the homepage and extract sport slugs; then, for each sport, fetch its schedule page to extract the WordPress `sportID` and a fresh `_ajax_nonce`.

**Verified extraction (2026-04-23 curl tests):**
- Sport slugs appear as nav links matching `/varsity/{slug}/schedule-results` on the homepage
- sportIDs do NOT appear on the homepage — they only appear on each sport's own schedule page
- On a sport's schedule page, the sportID appears in the "Sync Calendar" iCal subscribe link as `sport_ids={id}` (e.g., `sport_ids=21` for baseball)
- The sportID also appears in inline JS as `'&sportID=' + "21"` — used as fallback only

```js
async function discoverSports() {
  const homepageHtml = await fetch(SITE).then(r => r.text());
  const $home = cheerio.load(homepageHtml);
  const slugs = new Set();

  // Phase 0a — slugs from nav
  $home('a[href*="/varsity/"][href*="/schedule-results"]').each((_, el) => {
    const href = $home(el).attr('href');
    const match = href.match(/\/varsity\/([^/]+)\/schedule-results/);
    if (match) slugs.add(match[1]);
  });

  // Phase 0b — sportID + nonce per sport
  const sports = [];
  for (const slug of slugs) {
    const pageHtml = await fetch(`${SITE}/varsity/${slug}/schedule-results?hl=0`).then(r => r.text());

    // sportID — primary extraction from iCal subscribe link (cleanest)
    let id = pageHtml.match(/sport_ids=(\d+)/)?.[1];
    // Fallback — inline JS string concatenation
    if (!id) id = pageHtml.match(/sportID[^"]*"(\d+)"/)?.[1];

    const nonce = pageHtml.match(/_ajax_nonce=([a-f0-9]+)/)?.[1];

    // Extract display name from the page's <h1> or nav text if available; fall back to slug
    const name = pageHtml.match(/<title>([^<|]+)/)?.[1]?.trim() || slugToName(slug);

    if (id && nonce) {
      sports.push({ slug, id, nonce, name });
    }
  }

  return sports;
}
```

**Nonce behavior:** observed to be site-wide (same nonce returned across all 30 sport pages during testing), but nonces rotate. Fetching fresh per sport keeps the scraper robust against rotation. Cost is negligible — we're already fetching each sport page for the sportID.

**Expected result:** ~30 sports with verified IDs. Non-sequential (football=1, baseball=21, beach volleyball=232, flag football=255), which is exactly why a hardcoded constant would fragment over time.

**Phase 1 — Schedule + dismissal times (per sport, per level):**

For each `(sport, level)` pair, call the WordPress AJAX endpoint:

```js
async function fetchSchedule(sport, level) {
  const url = new URL(`${SITE}/wp-admin/admin-ajax.php`);
  url.searchParams.set('action', 'load_schedule_results_full');
  url.searchParams.set('level', level);
  url.searchParams.set('sportID', sport.id);
  url.searchParams.set('showRecord', 'yes');
  url.searchParams.set('school_id', SCHOOL_ID);
  url.searchParams.set('year', currentSchoolYear());
  url.searchParams.set('endpoint', 'https://www.homecampus.com/api');
  url.searchParams.set('show_team_events', '');
  url.searchParams.set('_ajax_nonce', sport.nonce);

  const html = await fetch(url.toString()).then(r => r.text());
  if (!html || html.trim() === '0' || html.trim() === '-1') return [];  // WP failure signal
  return parseScheduleHTML(html, sport, level);
}

function parseScheduleHTML(html, sport, level) {
  const $ = cheerio.load(html);
  const games = [];

  $('li[data-date]').each((_, el) => {
    const $li = $(el);
    const date = $li.attr('data-date');
    const opponent = $li.find('.school p').first().text().trim();
    const vsText = $li.find('.vs').text().trim().toLowerCase();
    const home_away = vsText.startsWith('at') ? 'away' : 'home';
    const game_time = $li.find('.time strong').first().text().trim();

    // Dismissal time lives in the hoverModal div for this game
    const modalId = $li.find('[id^="hoverModal_"]').attr('id');
    let dismissal_time = null;
    if (modalId) {
      const modalText = $(`#${modalId}`).text();
      const match = modalText.match(/Dismissal Time:\s*([0-9: APM]+)/i);
      if (match) dismissal_time = normalizeTime(match[1].trim());  // "11:45 AM" → "11:45"
    }

    games.push({
      date, sport_slug: sport.slug, sport_name: sport.name, level,
      opponent, home_away, game_time: normalizeTime(game_time), dismissal_time
    });
  });

  return games;
}

function normalizeTime(s) {
  // "11:45 AM" → "11:45", "2:30 PM" → "14:30", "" → null
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let [, h, min, period] = m;
  h = parseInt(h, 10);
  if (period?.toUpperCase() === 'PM' && h < 12) h += 12;
  if (period?.toUpperCase() === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}
```

**Phase 2 — Rosters (per sport, per level):**

For each sport and level, fetch the roster page. The 10 sports listed in `mdtoday.md` §22 have no roster page — skip them silently (404 handling is fine):

**Roster filter rules (LOCK):**
- **`__trashed` exclusion:** any player slug ending in `__trashed` is a WordPress soft-delete marker for a prior-season or removed player. These MUST be filtered. Not filtering would let stale players leak into current rosters (we observed 4 of 5 football entries had `__trashed` suffixes in April 2026, pointing at last season's team). This is a one-line rule but codifying it prevents a future re-implementation from silently dropping the filter and regressing data quality.
- **Dedupe by slug:** WordPress sometimes renders the same player twice in the page (old markup alongside new). Dedup via a `Set` of seen slugs; first occurrence wins.
- **Empty jersey is `null`, not `""`:** keeps the field type consistent and lets the UI check for truthy values without string-empty special cases.

```js
async function fetchRoster(sport, level) {
  // Level slug convention: Varsity → /varsity/, JV Red → /jv-red/, Freshman → /freshman/
  const levelPath = level.toLowerCase().replace(/\s+/g, '-');
  const url = `${SITE}/${levelPath}/${sport.slug}/roster`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const html = await res.text();
  return parseRosterHTML(html);
}

function parseRosterHTML(html) {
  const $ = cheerio.load(html);
  const players = [];
  const seenSlugs = new Set();

  $('a[href^="/player/"]').each((_, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\/player\/([^?]+)/);
    if (!match) return;
    let slug = match[1];

    // LOCK: filter WordPress soft-deletes (__trashed suffix)
    if (slug.endsWith('__trashed')) return;

    // LOCK: dedupe by slug
    if (seenSlugs.has(slug)) return;
    seenSlugs.add(slug);

    const display_name = slugToName(slug);
    const jersey = $(el).find('p').first().text().trim() || null;

    players.push({ name_slug: slug, display_name, jersey });
  });

  return players;
}

function slugToName(slug) {
  // Do NOT attempt to normalize first/last order — slug order varies by sport.
  // Just hyphens → spaces, title-case. Teachers recognize what they see.
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
```

**Assembly — `scrapeAll()`:**

**Parsing contract (LOCK): the scraper never drops a game row because of missing enrichment.** Missing fields degrade to `null` (or empty string for text fields like `opponent`), and the row is still emitted. The only fatal parse failure is a missing `data-date` on a `<li>` — without a date, the row cannot be matched to an iCal event and is safely skipped with a log line.

Specific rules:
- `dismissal_time` missing (no modal, empty modal text, unparseable time string) → `null`
- `game_time` is literal `"TBD"` → preserve as-is, do not normalize to null
- `opponent` missing or empty → empty string (not null)
- `home_away` ambiguous → `null`
- Rainouts/postponed games → still emitted; the app filters by date, so past-tense rows don't appear in the dashboard anyway
- WordPress AJAX failure signals (`"0"` or `"-1"` responses) → treat as "no games for this sport/level," emit nothing, continue to next combination

The guiding principle: **the app is designed to tolerate missing enrichment.** A game with no dismissal time just doesn't appear in the dismissal dashboard; a game with no opponent still shows up with blank opponent text. Silently dropping rows because of a parse issue is strictly worse than emitting rows with null fields.

```js
async function scrapeAll() {
  const sports = await discoverSports();
  const games = [];
  const rosters = {};

  for (const sport of sports) {
    for (const level of LEVELS) {
      const levelSports = await fetchSchedule(sport, level);
      games.push(...levelSports);

      const roster = await fetchRoster(sport, level);
      if (roster.length > 0) {
        const key = `${sport.slug}_${level.toLowerCase().replace(/\s+/g, '_')}`;
        rosters[key] = roster;
      }
    }
  }

  return { games, rosters };
}
```

**Performance expectations:** ~20 sports × 4 levels = ~80 AJAX calls + ~80 roster fetches = ~160 HTTP requests. At 500ms each (generous), ~80 seconds total. Netlify scheduled functions have a 15-minute timeout — well within budget.

**Rate-limit considerations:** if the site starts 429-ing, add `await sleep(200)` between fetches. Not needed for MVP; note as a follow-up if observed.

**Scraper boundary rule (LOCK):** the scraper writes to Netlify Blobs for caching, returns JSON from the function URL, and otherwise has no side effects. It does NOT write to the Google Sheet. The Sheet is human-owned override territory; the scraper is machine-owned enrichment. Keeping these separate means a scraper failure never corrupts coach policy data.

**Known data quality issues (document at scraper output):**
- Football roster shows prior-season `__trashed` entries (filtered in code, but source is stale)
- Baseball often has no varsity roster populated on the site (expected empty)
- Slug name ordering varies by sport (volleyball = last-first, basketball = first-last)

These are *source data* issues, not scraper bugs. The app compensates via off-roster entry when rosters are empty or wrong.

**Step 5: `/staff/index.html`** (~40 lines)
- Standalone HTML file. Not linked from student surface.
- Two sections: PIN entry (hidden if device trusted), dashboard (hidden until trusted)
- Numeric keypad UI for PIN — 10 big buttons, one backspace, one display area
- On successful PIN: call `trustDevice()`, hide PIN section, show dashboard
- Dashboard: list of today's games sorted by `dismissal_time`, each row a link to `/staff/dismiss.html?sport_id=X`
- Staleness banner area at top (hidden by default; shown when `isStale: true` from `getTodaysGames()`)
- Include CDN scripts for Dexie + PapaParse at top of `<body>`

**Step 6: `js/pass-staff.js`** (~50 lines)
- Entry point for `/staff/index.html`
- On load: check `isTrusted()`. If not → render PIN UI. If yes → render dashboard.
- PIN handler: compare input to `PIN_VALUE`. Match → `trustDevice()` + re-render. Mismatch → clear input, no error message, no lockout.
- Dashboard render: call `getTodaysGames()` from `pass-data.js`, render list. If `isStale: true`, show "Data may be stale (last updated {lastUpdated})" banner. If games array is empty, show "No dismissals scheduled today."

### Day 2 — Dismissal Flow

**Step 7: `/staff/dismiss.html`** (~50 lines)
- Standalone HTML. Query param: `?sport_id=X` (format: `{sport_slug}_{level_lower}`).
- Three sections: header (sport name + dismissal time), ACTIVE list, DISMISSED list
- "+ Add student not on roster" button below ACTIVE
- Toast container at bottom for undo
- Include CDN scripts at top of `<body>`

**Step 8: `js/pass-dismiss.js`** (~200 lines — the core feature)
- Entry point for `/staff/dismiss.html`
- On load: read `sport_id` from query string. If no trust → redirect to `/staff/`.
- Get the `{ games, getRoster }` bundle from `pass-data.js` (or a scoped equivalent). Call `getRoster(sport_id)` → in-memory `roster` array. Each row has `{ name_slug, display_name, jersey }` (scraped) or `{ display_name, name_slug: null, jersey: null }` (manual fallback).
- **Roster key assignment (LOCK) — solves the same-name-no-id collision AND the Sheet-reorder ghost-reappearance bug:** immediately after fetching, stamp each roster row with a stable `_key` using occurrence-counted disambiguation, NOT positional index:
  ```js
  const counts = {};
  roster = roster.map(r => {
    const base = `${r.display_name}__${sport_id}`;
    counts[base] = (counts[base] || 0) + 1;
    return {
      ...r,
      // name_slug is naturally unique when present (from scraper); fall back to occurrence-counted for manual
      _key: r.name_slug || `${base}__${counts[base]}`
    };
  });
  ```
  Two "Alex Garcia" rows from the manual roster tab become `"Alex Garcia__soccer-boys_varsity__1"` and `"Alex Garcia__soccer-boys_varsity__2"` — distinct, AND stable across Sheet reorderings.

  **Why positional index (`__${i}`) was wrong:** if a coach adds a row in the middle of the Sheet, `i` shifts for every row after it. A student keyed `"Alex Garcia__3"` at dismissal time becomes `"Alex Garcia__7"` on the next roster fetch. The old Dexie record no longer matches any current roster row → dismissed student reappears in ACTIVE as a ghost. The occurrence-counted version is stable unless the actual roster composition changes (a duplicate is added or removed).

  **Why `name_slug` wins when present:** the scraper's slugs come from WordPress post permalinks and are unique per player within a team. They're also stable across scraper runs. When available, they're strictly better than any synthetic key.

  Dismissing one row does not collapse both; reordering the Sheet does not create ghost reappearances.
- **When a teacher dismisses a roster student, the record stores the `_key` as `student_id`** (either the real scraper-provided `name_slug` or the synthetic occurrence-counted key for manual entries). This keeps the Dexie record's `student_id` field as the canonical dismissed-identity reference.
- **Defensive assertion (LOCK):** `student_id` MUST be set on every roster-type dismissal. Guard before write:
  ```js
  if (record.identity.type === 'roster' && !record.student_id) {
    console.error('Roster dismissal missing student_id — refusing write', { record });
    return;
  }
  ```
  A null `student_id` on a roster dismissal would make the student impossible to match later → phantom ACTIVE entries. This assertion catches a class of bugs at their origin.
- Subscribe via `liveTodaysDismissals(sport_id)` → re-render on every change
- **ACTIVE derivation rule (LOCK — this is where `student_id` / `_key` earns its keep):**
  ```js
  // Build a set of dismissed keys (student_id is the synthetic _key for roster dismissals)
  const dismissedKeys = new Set(
    dismissals
      .filter(d => d.identity.type === 'roster')
      .map(d => d.student_id)
  );

  // A roster row is active if its _key does not appear in the dismissed set
  const active = roster.filter(r => !dismissedKeys.has(r._key));
  ```
  **Why this matters:** naive `identity.value` string matching breaks on name variants ("Johnny Smith" vs "John Smith"), casing, and cross-team duplicates. Using `_key` (real `student_id` when available, positional fallback when not) makes ACTIVE correct even when the roster has imperfect data. Off-roster dismissals (`type === 'free_text'`) are intentionally excluded from this set — they can't affect roster-based ACTIVE state.
- **Duplicate-tap guard (LOCK) — UI layer:** before every `addDismissal()` call, check:
  ```js
  if (dismissedKeys.has(rosterRow._key)) return;  // silent no-op, no toast, no error
  ```
  Protects against rapid double-taps during dismissal rush. Silent — no UI feedback needed; the student is already in the DISMISSED list.
- Tap on active student → duplicate-tap guard → build record with `identity.type: 'roster'`, `student_id: rosterRow._key`, `roster_match: true`, `date: todayString()` → `const { id, isNew } = await addDismissal(record)` → if `isNew`, update toast target and show toast; if `!isNew`, no-op (duplicate guard already handled it)
- "Add student not on roster" → input field + Dismiss button → build record with `identity.type: 'free_text'`, `roster_match: false`, `student_id: null`, `date: todayString()` → `const { id, isNew } = await addDismissal(record)` → same isNew-gated toast behavior
- Live query auto-renders ACTIVE and DISMISSED lists on every Dexie change; tap handlers do NOT manually update the UI.
- After every NEW dismissal (`isNew === true`): show toast with "Undo last dismissal" for 5 seconds. See Toast Rule below.
- **Un-dismiss rule (LOCK) — tap-on-dismissed reverses the dismissal:**
  - Tap on a student in the DISMISSED list → `deleteDismissal(id)` → student returns to ACTIVE via live query
  - Same one-tap gesture as dismissal, applied symmetrically — no new UI concept to teach
  - **No confirmation modal.** The teacher is the authority; if they tap DISMISSED, they meant to reverse it
  - **No toast for un-dismissal.** The un-dismiss IS the correction. If the teacher un-dismissed by mistake, they re-dismiss with one tap — the same gesture in the opposite direction. Adding undo-for-undo creates an infinite-loop UI, which is worse than just letting the teacher re-tap.
  - Tap target for dismissed names must match ACTIVE tap targets (minimum 48×48px) so the interaction feels symmetric
  - Hard delete only — the record is removed from Dexie. No `reversed_at` field, no soft-delete semantics. Audit-trail preservation is a phase-2 consideration per §19's teacher-centered framing: the ledger reflects what the teacher says happened, and the teacher is saying it didn't happen.

**Step 9: Style updates to `css/styles.css`** (append only, ~80 lines)
- Namespace new rules with `.staff-` prefix to avoid collision
- Reuse existing `:root` tokens (`--md-red`, `--md-gray-bg`, `--md-gray-text`, etc.)
- Numeric keypad: 3-column grid, 64px × 64px buttons, large text
- ACTIVE list: tap targets minimum 48×48px, clear "tap to dismiss" affordance (cursor pointer, subtle hover/active state)
- DISMISSED list: strikethrough + timestamp + subtle ⚠︎ for off-roster. **Must be visibly tappable** (same cursor pointer, same hover/active state as ACTIVE) so un-dismiss is discoverable. The dismissed name is not a dead label — it's an interactive element that reverses the action.
- Toast: fixed bottom-center, `--md-gray-text` bg, white text, Undo button inline, label "Undo last dismissal"
- PIN shake animation (referenced in Step 3):
  ```css
  @keyframes pin-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }
  .staff-pin-input.is-wrong { animation: pin-shake 150ms ease-out; }
  ```
- **Do NOT modify existing rules.** Append new rules at the end of the file with a header comment: `/* === Pass App (Staff) === */`

### Final Verification

**Step 10: Manual checklist — do not declare done until all pass**

Core flow:
- [ ] Navigate to `/staff/` on a fresh browser → PIN prompt appears
- [ ] Enter `md1950` → dashboard loads with today's sports
- [ ] Refresh page → no PIN re-prompt (device trusted)
- [ ] Tap a sport → dismiss.html loads with roster
- [ ] Tap a student → moves to DISMISSED list, toast appears
- [ ] Tap Undo within 5s → student returns to ACTIVE list
- [ ] Refresh page → DISMISSED list still populated (persistence works)
- [ ] Add off-roster student → appears in DISMISSED with ⚠︎ tag
- [ ] Inspect Dexie record in DevTools → `identity.type === 'free_text'`, `roster_match === false`, `date` field present as `YYYY-MM-DD`

Un-dismiss flow:
- [ ] Dismiss a student, wait for toast to expire (>5s), then tap the dismissed name → student returns to ACTIVE list
- [ ] Un-dismiss does NOT show a toast or confirmation modal
- [ ] Un-dismissed record is hard-deleted from Dexie (verify in DevTools — no `reversed_at` field, no soft-delete artifact, record gone)
- [ ] Re-dismiss the same student immediately after un-dismiss → new record created with new timestamp, flow works end-to-end
- [ ] Dismiss an off-roster student, then tap their name in DISMISSED → they are removed from DISMISSED (no re-entry to ACTIVE since they were never on roster; this is correct behavior)

Data shape:
- [ ] Every dismissal record contains `date`, `sport_id`, `identity`, `roster_match`, `timestamp`, `dismissed_by`
- [ ] `sport_id` format is `{sport_slug}_{level_lowercase}` (e.g., `baseball_varsity`, `soccer_boys_jv_red`)
- [ ] `date` string matches the local date (not UTC) — test at 11:50 PM Pacific if possible
- [ ] `getTodaysDismissals(sport_id)` returns only today's records (verify by manually inserting a record with `date: '2020-01-01'` — it should not appear)

Correctness guards:
- [ ] Rapid double-tap on same student → only ONE record in Dexie (UI-layer guard)
- [ ] Rapid double-tap after page refresh → only ONE record in Dexie (DB-layer guard in `addDismissal`)
- [ ] Rapid double-tap: second tap does NOT re-trigger the toast or reset its timer (duplicate-guard hit returns `isNew: false`)
- [ ] PIN input capped at 6 chars, auto-submits at length 6
- [ ] Wrong PIN → input clears silently with 150ms shake animation, no error text, no lockout
- [ ] Two roster rows with same name, no `student_id` → `_key` pattern makes them distinct. Dismissing one does NOT remove the other from ACTIVE.
- [ ] **Roster reorder test:** dismiss a student, then manually reorder rows in the Sheet (move the dismissed student's row, or add a new row above it), refresh the dismiss view → dismissed student stays in DISMISSED, does NOT ghost back into ACTIVE
- [ ] Name-variant test: if roster has "Jonathan Smith" and teacher dismisses them, ACTIVE list correctly excludes them even if another row with "Johnny Smith" exists (same `student_id` = same person)
- [ ] **Free-text normalization test:** dismiss "John Smith" via off-roster input, then try to dismiss "john smith" (lowercase) or " John Smith " (with whitespace) → DB-layer guard blocks the duplicate, no second record written
- [ ] Malformed CSV test: manually break ONE row in the Sheet → fetch still succeeds with the remaining valid rows cached. Break MOST rows → fetch falls back to last-good cache.
- [ ] **Defensive assertion test:** temporarily force a roster dismissal with `student_id: null` in dev → `addDismissal` logs the error and refuses the write, returns `{ id: null, isNew: false }`
- [ ] Toast label reads "Undo last dismissal" (not "Undo [name]"). Dismissing A then B → toast targets B, not A.

Separation:
- [ ] Open `/` in a fresh browser → ZERO teacher affordances visible
- [ ] No link from `/` anywhere points to `/staff/`
- [ ] `view-source:/` contains NO reference to Dexie, Pass App, or `/staff/`
- [ ] Student GoatCounter snippet NOT present in `/staff/*.html`
- [ ] Staff GoatCounter snippet NOT present in `/`, `/schedule.html`, `/daysoff.html`

Graceful degradation:
- [ ] Kill network → open `/staff/dismiss.html?sport_id=X` → roster from last cache renders, dismissals still work
- [ ] Cache write verified: after a successful fetch, inspect `localStorage` → `pass_athletics_data_cache` and `pass_sheet_*_cache` keys present with `{ data, fetchedAt }` shape
- [ ] Staleness banner shown when athletics-data JSON is older than 36h (force by editing the cached `generated_at` in localStorage to something >36h ago)

Three-layer merge:
- [ ] `game_overrides` row takes precedence over scraper dismissal time (manually add one, refresh, verify displayed time matches override)
- [ ] `sport_defaults` used when scraper returns null dismissal time (manually clear scraper output for one game, verify default is used)
- [ ] Game with no dismissal time from any source does NOT appear in today's dashboard
- [ ] iCal event shows on dashboard with "no dismissal" indicator if SUMMARY doesn't map to any `sport_slug`, rather than vanishing silently

Scraper integrity:
- [ ] `/.netlify/functions/athletics-data` returns valid JSON matching the Layer 2 contract
- [ ] `source` field is `"scrape"` on fresh run, `"cache"` on fallback <36h, `"fallback"` on fallback >36h
- [ ] `__trashed` player slugs filtered from roster output
- [ ] Scraper failure (simulate by blocking outbound network in the function) → returns last-good cache with appropriate `source` value, never throws to the caller

---

## UI Rules (Non-Negotiable)

- Dismissal ≤ 2 taps after sport selected
- Undo ≤ 1 tap
- **Un-dismissal is symmetric with dismissal** — tap DISMISSED name to return to ACTIVE, same one-tap gesture, no confirmation modal, no toast
- No modals except PIN entry
- No confirmation dialogs anywhere
- No page reloads during the flow (use query params + Dexie liveQuery)
- No deny button, no override, no "dismiss anyway" — one action: `released`
- Off-roster entries appear in the unified DISMISSED list (tagged, not segregated)
- Visual behavior on dismiss: name disappears from ACTIVE, appears in DISMISSED
- Visual behavior on un-dismiss: name disappears from DISMISSED, reappears in ACTIVE

### Toast / Undo Rule (LOCK)

The undo toast always targets the **most recent NEW dismissal only**. It does not stack, and it does not preserve earlier undo opportunities. Duplicate-guard hits (repeat taps on an already-dismissed student) do NOT update the toast target.

**Implementation:**

```js
let lastDismissalId = null;  // module-scoped
```

After every `addDismissal()` call:
1. Inspect the returned `{ id, isNew }`
2. **If `isNew === false`** (duplicate-guard hit): do nothing. Toast stays on whatever it was targeting. No re-trigger, no timer reset.
3. **If `isNew === true`:** set `lastDismissalId = id`, show toast with label "Undo last dismissal", start a 5-second timer
4. If another new dismissal happens before expiry: reset `lastDismissalId` to the new id, reset timer, leave toast visible

Tap on toast → `deleteDismissal(lastDismissalId)` → clear `lastDismissalId` → hide toast. Timer expiry → clear `lastDismissalId` → hide toast.

**Why `isNew` matters:** without this check, rapid double-taps work like this — first tap writes record A (isNew: true), toast shows for A. Second tap hits the DB-layer duplicate guard and returns `{ id: A, isNew: false }` — BUT naive code would still re-trigger the toast, making it look like a fresh dismissal. Teacher tapping "Undo" would undo A, thinking they were reversing a brand-new action. The flag prevents phantom toast refreshes.

**Why "Undo last dismissal" and not "Undo John Smith":**

If the label reads "Undo John Smith" and the teacher then dismisses Maria before John's undo window expires, the toast silently swaps to target Maria. A teacher glancing at the (now Maria-targeting) toast still reading "John" in their head would undo the wrong record. Labeling the toast by its actual behavior ("last dismissal") eliminates this gap between what the toast says and what it does.

### The One Rule That Must Not Break

**UI state reflects Dexie. Always. Every render of ACTIVE and DISMISSED lists derives from a live Dexie query. Never from component-local state.**

This is the single most important architectural decision in the build. Violating it — even once, even for "quick UI feedback" — introduces desync bugs, undo inconsistencies, and phantom states that are miserable to debug at 2pm on a Tuesday.

**Forbidden patterns:**
- `let dismissedList = []; dismissedList.push(...)` — no local arrays for dismissal state
- Optimistic UI updates before the Dexie write resolves
- Any "temporary" local state that mirrors what Dexie holds

**Required pattern:** `Dexie.liveQuery()` is the only source of truth. The write goes to Dexie → live query fires → render function rebuilds ACTIVE and DISMISSED from the returned array + the in-memory roster. If the write fails, the UI does not change. If undo succeeds, the UI rolls back automatically because the live query re-fires.

If you find yourself reaching for `setState` or a local variable to track dismissal status: **stop and reread this section.**

### Mental Model: Dexie Is Current Truth, Not a Log

Because un-dismiss is a hard delete (no `reversed_at` field, no soft-delete artifact), Dexie is not an append-only ledger. It's a live snapshot of **what the teacher currently asserts is true** about today's dismissals.

- A teacher dismisses a student, then un-dismisses them → no trace remains in Dexie
- Another teacher opening the same device 30 minutes later has no way to know that dismissal ever happened
- This is consistent with §19's teacher-centered framing: the system records what the teacher says happened, and the teacher is currently saying it didn't happen

**When this model will need to change:** the moment real teacher identity exists (phase 2), audit history becomes meaningful — "who dismissed, who reversed, when." At that point, migrate Dexie to soft-delete with `reversed_at` and `reversed_by`. Until then, hard delete is correct.

This is a deliberate tradeoff, not an oversight. Name it out loud so nobody later "fixes" it without understanding the framing.

---

## Analytics — Separate GoatCounter Site for `/staff/`

MD Today already has GoatCounter tracking on the student surface. The Pass App uses a **separate GoatCounter site** to keep the two metric streams cleanly separated.

**Why separate:**
- Student metrics (DAU, retention, adoption curves) get contaminated by teacher activity if pooled — including your own testing traffic during the build
- Staff metrics (dismissals per day, sports coverage, teacher adoption) are genuinely different questions on different rhythms
- Filtering "staff pageviews out of student metrics" every time you check the dashboard is a rule you will forget

**Setup:**
1. Create a second free GoatCounter site (e.g., `mdtoday-staff.goatcounter.com`)
2. Put that site's snippet in `/staff/index.html` and `/staff/dismiss.html` ONLY
3. Do NOT add the staff snippet to `index.html`, `schedule.html`, or `daysoff.html`
4. Do NOT add the student snippet to `/staff/*.html`

**Privacy check before shipping:** verify GoatCounter's dashboard does not log query strings by default. A path like `/staff/dismiss.html?sport_id=boys_soccer_varsity` is fine, but if rosters ever use a query parameter carrying a student name, that would end up in analytics. In GoatCounter site settings, confirm "Collect query strings" is off (or at minimum review what's being collected after first day of staff use).

**What NOT to track:**
- Individual dismissals (happens in Dexie; no analytics needed for MVP)
- Student names, sport IDs, or any identifiable content in query strings
- Anything beyond pageviews and referrers

Pageview-only tracking is enough for MVP. If you later want dismissal counts for the staff dashboard, build that from Dexie locally — not via analytics.

---

## What NOT to Build

Everything below is an explicit non-goal for MVP. If you find yourself building any of these, STOP and ask:

- Student authentication of any kind
- Teacher identity tracking (all dismissals use `dismissed_by: 'teacher'`)
- Parent notifications
- Chat or messaging
- Analytics dashboard
- Attendance tracking (this is a dismissal log, not attendance)
- Roster editing UI (edits happen in the Sheet's `manual_rosters` tab)
- Admin panel
- Push notifications
- Compliance / reporting layer
- Stacking toasts, confirmation modals, "are you sure?" prompts
- Merging dismissal UI into MD Today's student views
- Adding Pass App links to `/`, `/schedule.html`, or `/daysoff.html`
- Un-dismiss confirmation modals ("Move back to ACTIVE? Yes / No")
- Soft-delete with `reversed_at` field — hard delete only in MVP
- Audit trail of who reversed what dismissal (phase-2 when real teacher identity exists)
- Toast-for-undo on un-dismissal (creates infinite-loop UI)
- **Opponent-string matching between iCal and scraper** — `(date, sport_slug)` first-match wins for MVP
- **Name order normalization in rosters** — slug order varies by sport, teachers recognize what they see
- **Automated Sheet writes from the scraper** — scraper writes to Netlify Blobs + returns JSON only; the Sheet is human-override territory
- **Re-enumerating sports when scraper can't discover them** — if Phase 0 returns empty, return the last-good cache and wait for human investigation; don't fall back to a hardcoded list
- **Second PWA manifest, separate staff home-screen icon.** One PWA, one manifest. Staff access is gated by PIN + device trust, not by a separate install. The icon is not the security boundary; the trust flag is. A second manifest would duplicate entry points without adding enforcement. Only revisit if teachers frequently open the wrong mode under time pressure.

---

## Reference Pointers to `mdtoday.md`

BUILD.md tells you *what* to build. For *why*, see:

- **§10** — identity model rationale
- **§19** — why single action (no deny/approve)
- **§20** — why UI state must reflect Dexie, not local state
- **§21** — why route separation, not conditional rendering
- **§22** — three-layer ingestion architecture (iCal + scraper + Sheet override)
- **§23** — full 48-hour checklist with UX constraints
- **§24** — data quality caveats and sports-without-roster list

If a decision in BUILD.md seems arbitrary, consult `mdtoday.md` before deviating. Do not change locked decisions without surfacing the reasoning to the user first.

---

## Teacher Onboarding (Rollout Deliverable)

**The PWA has no address bar.** Teachers cannot type `/staff/` into an installed PWA. Onboarding is how they first reach `/staff/` to enter the PIN and trust their device.

**Distribution artifact: QR code + one-pager.** Not a Slack message, not a URL in an email. A printable physical card handed out at a staff meeting.

**Rollout flow:**

1. Generate a QR code encoding `https://mdtoday.com/staff/` (or the actual production domain — confirm before printing). Use any free QR generator; no code change needed.
2. Print a 4×6 index-card-sized one-pager per teacher:

   ```
   ┌─────────────────────────────────────┐
   │   MD Dismiss — Teacher Setup        │
   │                                     │
   │        [ QR CODE HERE ]             │
   │                                     │
   │   1. Scan with your iPhone camera   │
   │   2. Tap "Add to Home Screen"       │
   │   3. Open the icon, enter: md1950   │
   │                                     │
   │   After setup: one tap to dismiss.  │
   │   Questions? Text Peter.            │
   └─────────────────────────────────────┘
   ```

3. Distribute at a staff meeting. Walk through setup live so edge cases (non-Safari default browser, out-of-storage, vision issues) surface in real time.

**First-run behavior:**
- Teacher scans QR → opens `/staff/` in Safari
- Taps Share → Add to Home Screen → names it "MD Dismiss" (or whatever they want — no hard requirement on the name)
- Opens the icon → lands at PIN gate → enters `md1950` → `trustDevice()` fires → dashboard renders
- All subsequent opens of the app icon → auto-redirect from `/` to `/staff/` (via Step 3a logic)

**PIN-on-the-paper, not in the QR code:** keep the PIN as a visible line on the one-pager. Don't encode it in a URL parameter. If a one-pager gets left on a counter, a student has to scan the QR *and* type the PIN to get in — two barriers, not one.

**"iPhone camera, not a third-party scanner" note on the one-pager** handles the edge case where a teacher has Chrome or Firefox as their default browser. The iPhone Camera app opens QR-code links in Safari regardless of default-browser setting; third-party scanner apps may route through the default browser, which can break Add-to-Home-Screen on iOS.

**Teachers already set up on the student PWA:** they scan the same QR code, navigate to `/staff/`, enter the PIN once. Their existing PWA install is unchanged; the redirect logic takes over on subsequent opens. No need to reinstall.

---

## Session End Checklist

Before closing any Claude Code session:

1. Run `git diff --stat HEAD` — verify no files deleted
2. Run `ls -la staff/ js/pass-*.js netlify/functions/` — verify all expected files present and non-empty (`wc -l`)
3. Commit with a clear message. Small scope per commit.
4. Update the "v1.x Summary of Changes" section in `mdtoday.md` if architectural decisions changed
5. Note any new gotchas in `claude.md` under "Working Rules" if they're generalizable

---

## The One Thing Worth Saying Out Loud

You are extending a shipped product. The MD Today codebase is small, boring, and correct — and it survives because of that. The Pass App should be the same: small, boring, correct.

The hardest moment of the build will be around hour 30 when something feels clever. That cleverness is the thing that breaks the app on a Monday morning three months from now. Stay boring. Follow the checklist. The non-goals list exists to protect the 48-hour window.

When in doubt: read `mdtoday.md`. It's long because it captured every decision and every reason.

---

## Changelog

### v1.5.3 (2026-04-23, PWA onboarding patch)

Addresses a gap surfaced during review: an installed PWA has no address bar, so teachers cannot navigate to `/staff/` after the initial install. Adds three coordinated changes.

- **Step 3a: Session-aware redirect in `js/app.js`** (LOCK). Trusted devices on `/` auto-redirect to `/staff/`, but honor an explicit `sessionStorage` override when the teacher clicks "← View student schedule." Matches the rule: *help once, then get out of the way*. Always-redirect was considered and rejected — it creates a "the app won't let me stay where I want" feeling for teachers who are also MD parents.
- **Teacher Onboarding section added.** Specifies the rollout deliverable: QR code encoding `/staff/` + printed one-pager, distributed at a staff meeting. PIN stays on paper, not in the URL. "Scan with iPhone camera, not a third-party scanner" note handles default-browser edge cases.
- **New non-goal locked: no second PWA manifest.** One PWA, one install, one icon. Staff access is gated by PIN + trust flag, not by a separate home-screen entry. Documented reasoning in the non-goals list.
- **Scoped exception to student-purity rule.** `js/app.js` receives a 10-line redirect block. Every other student-facing file remains untouched. The exception is documented in the file structure notes and in rule 7 of "READ BEFORE EVERY SESSION."

### v1.5.2 (2026-04-23, second pressure-test patch)

Two clarifying additions after a second review pass. No code changes; both tighten rules that were previously implicit.

- **Sport name consistency rule added** to Layer 2 field docs. The `sport_slug` field is the athletics site's URL slug and is never translated to iCal-feed format inside the scraper — translation is the app's responsibility, in `pass-data.js`. Prevents a future "let me just fix this in the scraper" mistake from crossing the ingestion boundary.
- **`__trashed` filter upgraded from code comment to named LOCK rule.** Also codified the slug-dedup rule and the empty-jersey-is-null rule. These were all present in code but not called out as architectural commitments. Making them explicit means a reimplementation cannot regress them silently.

### v1.5.1 (2026-04-23, patch after pressure-test review)

Four targeted fixes after a pressure-test on the v1.5 draft. No architectural changes.

- **Phase 0 regex corrected.** Original spec claimed sportIDs were extractable from the homepage; verification showed they only appear on per-sport schedule pages, inside the iCal "Sync Calendar" link as `sport_ids={id}`. Primary regex updated to match verified behavior, with inline-JS extraction (`sportID[^"]*"(\d+)"`) as a documented fallback.
- **Hardcoded year removed.** Replaced `const YEAR = '2025-26'` with a `currentSchoolYear()` helper that rolls over on July 1. Prevents silent breakage at season end.
- **Null-handling parsing contract added** (LOCK). The scraper never drops a game row because of missing enrichment; missing fields degrade to `null` or empty string. Only a missing `data-date` is fatal (the row cannot be matched to iCal).
- **Modal pairing noted as index-based for MVP.** The linkage between `<li data-date>` game rows and `#hoverModal_N` dismissal modals was not verified to be explicit (via data attribute). For MVP, the scraper pairs by document order within each schedule response. Flagged as a known assumption to verify if tournament-day collisions appear in real use.

### v1.5 (2026-04-23)

Major revision: ingestion architecture moved from "hand-entered Sheet with deferred scraper" to "three-layer system with confirmed working scraper."

**What changed:**
- **Three-layer data architecture** (iCal + enrichment + Sheet override) replaces single-layer Sheet ingestion. Merge order locked: `game_overrides → scraper → sport_defaults → hide`.
- **Step 4 rewritten** from speculative `roster-scrape.js` to concrete three-phase scheduled function `athletics-data.js`. All endpoints and selectors verified by curl against the live site.
- **Sheet tabs replaced:** `sports` and `rosters` (ingested) removed; `sport_defaults`, `manual_rosters`, `game_overrides` (human-owned overrides) added.
- **Step 2 rewritten** to merge three data sources at display time rather than fetch CSVs of ingested data.
- **Sport IDs discovered dynamically** from the athletics homepage on each scraper run — no hardcoded constant to drift.
- **All levels covered** — Varsity, JV Red, JV Gray, Freshman — for both schedules and rosters.
- **Pre-flight shortened** because the endpoint verification was completed during spec drafting.
- **`sport_id` format standardized** to `{sport_slug}_{level_lowercase}` across scraper keys, Sheet keys, and Dexie records.
- **iCal matching locked** at `(date, sport_slug)`-first-match for MVP; opponent matching deferred.
- **Staleness handling** — 36h threshold with visible indicator, serve last-good data from Netlify Blobs on scraper failure.
- **Maintenance estimate** reduced from "~30 hrs/year hand-entry" to "~5 min/week review + ~1 hour/season of `manual_rosters` for the 10 sports without roster pages."

**What did NOT change:**
- All dismissal-flow logic (Step 8) unchanged except variable names aligned to new `sport_id` format
- Dexie schema, identity model, trust state, PIN gate, toast rules, undo rules, UI state rules — all unchanged
- The principle that UI state reflects Dexie via `useLiveQuery` only — unchanged
- File count (7 new files) — unchanged, same shape, one file renamed
- Route separation, analytics separation, non-goals list — unchanged in structure, extended with v1.5-specific items

**Reasoning preserved in `mdtoday.md` §22 (rewritten) and §24 (new).**

### v1.5.4 (2026-04-23, initial build session)

First implementation session. Steps 1–9 + 3a built and deployed. Several design adjustments made during real-device testing.

**What was built:**
- `js/pass-db.js` (Step 1) — Dexie schema, `addDismissal` with DB-layer uniqueness guard, `liveTodaysDismissals`
- `js/pass-data.js` (Step 2) — Three-layer merge (iCal + scraper + Sheet overrides), SUMMARY→slug mapping table, staleness check
- `js/pass-trust.js` (Step 3) — PIN constant, `isTrusted()`, `trustDevice()`
- `js/app.js` edit (Step 3a) — Session-aware redirect for trusted devices on `/`
- `netlify.toml` — Cron schedule for scraper (3am Pacific daily)
- `netlify/functions/package.json` — cheerio dependency for scraper
- `netlify/functions/athletics-data.js` fix — Hardcoded `YEAR` → `currentSchoolYear()` helper
- `staff/index.html` (Step 5) — PIN gate + dashboard shell with blocking trust-check script
- `js/pass-staff.js` (Step 6) — PIN input, dashboard render, staleness banner, demo mode
- `staff/dismiss.html` (Step 7) — Roster + dismiss flow shell
- `js/pass-dismiss.js` (Step 8) — Roster keying, live query rendering, dismiss/un-dismiss, demo mode
- `css/styles.css` (Step 9) — All staff styles appended under `/* Pass App (Staff) */` header

**Design changes made during testing (deviations from BUILD.md spec):**

1. **PIN input changed from numeric keypad to text field.** The spec assumed a numeric PIN, but the actual PIN (`md1950`) contains letters. Replaced the 12-button keypad grid with a single `type="password"` text input that auto-submits at 6 characters. Shake animation on wrong PIN preserved.

2. **Toast/undo replaced with tap-to-undo on dismissed names.** The spec's toast mechanism (5s timer, "Undo last dismissal" button) was removed. Having two undo mechanisms (toast button + tap-on-dismissed-name) was confusing. Now the dismissed list shows "Tap a name to undo" hint, and tapping a dismissed name is the only undo path. Simpler, no ambiguity.

3. **PIN gate uses blocking `<script>` in `<head>`.** The original `hidden` attribute toggling caused the PIN section to flash on back-navigation (browser bfcache restoring stale DOM). Fixed by reading `localStorage` synchronously in a `<head>` script and setting `style.display` before body renders — same pattern as the student-side splash gate.

4. **Access granted success state.** On correct PIN: label changes to "Access granted", green border, 1-second hold, 2-second opacity fade, then dashboard appears. Prevents the jarring instant-switch.

5. **Stale banner CSS fix.** `.staff-stale { display: flex }` was overriding the `hidden` attribute, causing an empty yellow banner to always render. Fixed by using `style.display` directly instead of the `hidden` attribute, and only showing the banner when `lastUpdated` is truthy (scraper has actually run).

6. **Floating staff button (FAB) on all student views.** A 32px red circle with a key icon, positioned bottom-right just above the navbar. Only rendered when `localStorage` has `trusted_device=true`. Added to all four student views (Now, Upcoming, Days Off, Sports) via inline script.

7. **5-tap hidden gesture on header brand.** Teachers reach `/staff/` from inside the installed PWA (no address bar) by tapping the "MD Today" header 5 times within 1.5 seconds. `touch-action: manipulation` prevents double-tap zoom. Added to all four student views. This replaces the QR-code-to-Safari flow which doesn't work because iOS opens QR links in Safari, not the installed PWA.

8. **Demo mode (`?demo` query param).** Injects 3 fake games with rosters for testing when no real games exist. Basketball Boys JV Red has two "Alex Garcia" entries to test duplicate-name keying. Demo param propagates through dashboard→dismiss→back links. Remove before production launch.

**Known issues / TODO:**
- Google Sheet override tabs (`sport_defaults`, `manual_rosters`, `game_overrides`) not yet created — placeholder gid values in `pass-data.js` need updating
- Scraper has not run yet — no real athletics data in Netlify Blobs until first cron execution
- GoatCounter for `/staff/` not yet set up (separate site per spec)
- Demo mode should be removed before production launch
- Netlify free tier hit usage limits during this session — upgraded to $9/mo Personal plan
