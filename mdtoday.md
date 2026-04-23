# MD Today — Data + System Spec (v1.5)

## 1. Data Source (Single Source of Truth)

**Decision:**
Use a Google Sheet published as CSV/JSON (publish-to-web) as the only backend.

**Rationale:**

- No backend required
- Instant editability
- Human-readable
- Easy handoff to admin later
- Fast iteration during school year chaos

**Constraint:**
The app is only as reliable as the sheet is clean.

---

## 2. Schedule Model (Critical Design Choice)

Instead of storing times per day, the system uses **schedule templates**.

### Core Concept

Each date maps to a named template. Each template = ordered list of periods.

### Example Structure

**Templates Table**

- Red Day (Regular)
- Gray Day (Regular Alternate)
- Late Start
- Assembly Day
- Liturgy Schedule
- Rally Schedule
- Minimum Day
- Finals Schedule (Block 1)
- Finals Schedule (Block 2)
- Finals Schedule (Block 3)

### Template Definition

Each template is:

- Ordered list of blocks
- Each block has:
  - Name (Period 1, Lunch, Advisory, etc.)
  - Start time
  - End time

### Date Mapping Table

| Date       | Template Name | Notes        |
|------------|---------------|--------------|
| 2026-09-02 | Red Day       |              |
| 2026-09-03 | Assembly Day  | Spirit Rally |

### Key Design Insight

You are not editing schedules daily — you are selecting from a controlled vocabulary of templates.

That's what makes this scalable.

---

## 3. Maintenance Workflow (Operational Reality Layer)

You now need to decide one thing clearly:

### Option A — You maintain it (recommended for MVP)

- You update sheet weekly (Sunday reset)
- You are the "schedule operator"

**Pros:**

- Fast iteration
- No coordination overhead
- You control correctness

**Cons:**

- Single point of failure
- You become the system

### Option B — Admin maintains it (long-term ideal)

If someone at the school owns it:

- Use dropdowns only (no free text)
- Locked template names
- Protected ranges in sheet
- Simple "Date → Template" editing only

**Pros:**

- Sustainable
- Official adoption possible

**Cons:**

- Slower iteration
- Requires trust + onboarding

### Design Requirement (regardless of owner)

The system must fail gracefully when the sheet is wrong or incomplete.

That means:

- Default fallback template
- Last known valid schedule cached locally
- No blank states visible to students

---

## 4. Announcement Field (High-Leverage Simplicity Hack)

Add a single optional field per date:

`announcement_text`

**Examples:**

- "Pep rally after 4th period"
- "Modified schedule due to testing"
- "Mass today — report to gym"

**Behavior:**

- If present → render prominently in "Now" view
- If empty → ignore completely

### Why this matters

This becomes your escape valve for reality.

Instead of expanding your data model for edge cases, you push exceptions into a single human-readable string.

This is how real-world scheduling systems survive.

---

## 5. Revised Build Order (Corrected MVP Path)

The correct sequence is:

### Phase 1 — Data First

- Define sheet structure
- Define templates
- Define date mapping
- Add announcement field

### Phase 2 — Core Engine

- Parse sheet
- Resolve today → template
- Compute current period + next period

### Phase 3 — Now View (FIRST UI)

- Current status
- Countdown timer
- Announcement banner (if present)

### Phase 4 — Schedule View

- Render full template cleanly

### Phase 5 — Secondary Features

- Days off
- News video integration

---

## 6. Open Question — Who Maintains the Sheet?

This is actually the most important product decision.

**My honest recommendation:**
Start with YOU maintaining it.

Not because it's ideal — but because:

- You control correctness immediately
- You learn real usage patterns fast
- You avoid dependency on institutional approval
- You can iterate daily without permission bottlenecks

### Upgrade Path

Once adoption is real:

- Propose admin handoff
- Or hybrid model (you + admin approvals)

---

## Bottom Line

You are not building a "schedule app."

You are building a **lightweight scheduling authority layer** over an existing school system.

The sheet design + template abstraction + announcement escape hatch is exactly what makes this:

- Maintainable
- Scalable
- Resilient in real school chaos

---

# Pass App (MVP Spec) — Dismissal + Sports System

## 7. Overview

This is the seed version of a future "Pass App" system. The current focus is a minimal, reliable workflow for student dismissal from class to sports activities, with persistent logging and a lightweight teacher access model.

**Guiding principle:**
One critical action — reliably record student release from class to an activity.
Everything else is secondary.

### Relationship to MD Today

- **MD Today** = schedule context (read-only, student-facing)
- **Pass App** = dismissal execution layer (write-heavy, teacher-facing)

These systems coexist. No merging required yet.

---

## 8. Core Concept

The system tracks:

- Which student is being released
- From which activity context (sport/event)
- At what time
- By which teacher

This is **not** attendance tracking. It is a **release / dismissal system of record** — a ledger of "who was released, when, and by whom."

Every feature must answer: *"Does this improve the speed, clarity, or reliability of student dismissal?"* If not, it is deferred.

---

## 9. Primary Feature — Sports Dismissal View

### UI Structure

Each sport entry contains:

- Sport name
- Time
- Student roster list
- Dismissal interaction

### Roster View (Default State)

```
ACTIVE STUDENTS:
- John Smith
- Maria Lopez
- David Kim
```

No additional UI complexity.

### Dismissal Action

When a teacher taps a student:

- Student is marked as dismissed
- UI updates immediately

```
ACTIVE:
- Maria Lopez
- David Kim

DISMISSED:
- John Smith ✓ (3:42 PM)
```

### Behavior Rules

- Dismissal is instant
- Multiple dismissals supported per session
- UI must clearly separate ACTIVE vs DISMISSED
- **Undo is MVP-critical, not optional** (see §11)

---

## 10. Data Persistence (CRITICAL)

### Requirement

Dismissals must persist beyond UI session. Data must survive refresh/reload.

### Storage Strategy — IndexedDB via Dexie.js

**Decision:** Use IndexedDB through Dexie.js, not localStorage.

**Rationale (scale math):**

- 2000 students × ~2 events/week × 36 weeks ≈ **144,000 records/year**
- At ~200 bytes/record ≈ **29 MB/year**
- localStorage caps at 5–10 MB → blown by November
- localStorage also blocks the main thread on every write (serializes entire blob)

**Why Dexie over raw IndexedDB:**

- Clean, promise-based API
- Stable, widely used (~25KB)
- Makes local persistence feel like a normal database without backend complexity

### Schema (Minimal, MVP)

```js
db.version(1).stores({
  dismissals: '++id, sport_id, timestamp'
})
```

Two single-field indexes only. No compound index yet. Add one when a real query is demonstrably slow — not speculatively.

### Data Model

Each dismissal event:

```json
{
  "id": "auto_increment",
  "identity": {
    "type": "roster | free_text",
    "value": "John Smith"
  },
  "student_id": "optional, present when matched to roster",
  "sport_id": "string",
  "sport_name": "string",
  "roster_match": "bool — system match result at time of action",
  "timestamp": "unix_epoch_ms",
  "dismissed_by": "teacher_id_or_placeholder"
}
```

**Identity semantics:** The system records a teacher-asserted identity, optionally linked to a known roster entry. Do not treat `student_name` as a primary key — names change, have variants, and collide. The `identity` object keeps the source of the name (`roster` tap vs `free_text` entry) separate from the name string itself, which preserves clean semantics for future reconciliation against a school directory.

**`roster_match` meaning:** Captures the system's match result at the moment of the action. This is distinct from "did the teacher type it" — a typed name might actually be on roster (teacher missed the suggestion), and a tapped name is by definition matched. The field answers *"did the system recognize this student at dismissal time?"* which is the useful question for later reconciliation.

### Retention Policy

- Store all records indefinitely in MVP
- No automatic deletion
- No archiving required yet
- **UI note:** Dismissed list renders *today's records only*. Historical records persist in storage but are not shown by default.

### Offline-First Mindset

Dismissal writes must never depend on network. The flow is **local-first, sync-later**.

Roster reads can tolerate a reload on network failure. Dismissal writes cannot fail.

### Future Migration

Data structure is backend-ready for later migration to Supabase / Firebase / custom API.

---

## 11. Undo (MVP-Critical)

Teachers will mis-tap. When they do on an iPad during dismissal rush, they need to fix it in one gesture.

**Implementation:**

- 5-second toast after each dismissal
- Tap "Undo" → `db.dismissals.delete(id)`
- ~10 lines of code

**Why this is not optional:**

If a teacher mis-taps and can't fix it, the ledger now contains a false record. That's worse than no ledger — it erodes trust in the one thing this system exists to do. Undo protects ledger integrity, which is the whole point.

---

## 12. Roster Source

Extend the Google Sheet pattern from MD Today. Add two tabs:

- `sports` — sport_id, name, time
- `rosters` — sport_id, student_id, student_name

**Flow:**

- Fetch from Sheet on app open
- Hold in memory for the session
- If network fails, teacher retries
- No roster caching in Dexie yet (premature until update patterns are known)

Dismissal writes go to Dexie. Roster reads come from the Sheet on open. Keep the two flows separate.

---

## 13. Teacher Access Model

See **§21 — Access Model (Route Separation + Device Trust)** for the full access architecture. The earlier "simple role gate" approach has been superseded by route separation, which is structurally stronger and equally simple to implement.

---

## 14. MVP Build Order

1. **Data layer.** Google Sheet with `sports` and `rosters` tabs. Publish as CSV. Scraper pipeline from MD athletics site populates sheet (see §22).
2. **Dexie setup.** Schema + read/write helpers. Test with fake data before any UI.
3. **Route scaffold.** `/` for students (schedule, announcements). `/staff` for teachers. Separate component trees, not conditional UI.
4. **Device trust on `/staff`.** First-visit PIN (`md1950`) → `trusted_device` flag in localStorage.
5. **Today-first sport list.** Teacher lands on `/staff` → sees today's sports with leave times.
6. **Roster view with dismiss action.** The one critical path.
7. **Off-roster entry.** "Add student not on roster" text input, same dismissal flow.
8. **Undo toast.** Non-negotiable (see §11).
9. **Today-scoped dismissed list.** Unified view; off-roster entries tagged but not segregated.

---

## 15. Known Open Questions (Defer, Don't Forget)

- **Cross-sport student conflicts:** Same student on two rosters (soccer at 3:30, track at 4:00). Dismissed from soccer — do they appear as already dismissed in track? Active? Missing? Most students are on one sport, so punt for MVP, but note it.
- **Roster update cadence:** How often do rosters change? Who owns the source of truth? Answer emerges after real usage.
- **Sync architecture:** Background sync, roster caching in Dexie — future evolution, not MVP.

---

## 16. Non-Goals (Explicitly Out of Scope)

Do NOT build:

- Chat system
- Live game updates
- Stats engine
- Articles / news
- Store or monetization layer
- Attendance tracking
- Parent notifications

These belong to later phases.

---

## 17. Future Expansion Path

Intentional evolution toward a broader "Pass System":

- **Phase 2:** RSVP (intent to attend), log history view
- **Phase 3:** Coach → parent notification chain, student check-in at event
- **Phase 4:** Cross-context passes (class, sports, office, etc.)

---

## 18. Success Criteria (MVP)

The system is successful if:

- Teacher can dismiss a student in <3 taps
- Dismissals are clearly visible immediately
- Dismissals persist after refresh
- Teacher can trust the record later
- No confusion about who is active vs dismissed
- Mis-taps are recoverable within 5 seconds

---

## Pass App Bottom Line

You are not building a database system.

You are building **a reliable ledger of who was released, when, and by whom.**

Dexie + IndexedDB + minimal schema + undo + offline-first reads — everything in the system serves that sentence.

---

# Pass App — Refined Architecture (v1.3 additions)

## 19. Teacher-Centered Framing

### Purpose Statement (Refined)

The Pass App is not a student-tracking system. It is a **teacher's verification-and-record tool**.

The real-world interaction it solves:

> Student walks up to teacher: "I have a soccer game."
> Teacher has no way to verify, no way to refuse without being the bad guy, no record the conversation happened.
> Teacher: "…ok I guess."

The app replaces that with:

1. **Verification** — teacher glances at today's roster, confirms the claim
2. **Record** — one tap logs that the teacher authorized the release

The teacher already has authority. The app does not grant permission — it **acknowledges movement** and preserves the teacher's defensibility.

### Single Action: `released`

There is no deny flow. No approve/deny branching. No override path.

**The only action is `released`.** Everything else is metadata.

Rationale:
- A "deny" button would imply the app holds authority over the dismissal, which it does not
- Teachers rarely refuse in practice — refusal isn't an operational mode, it's a hypothetical
- A denial log is a paper trail of teacher-vs-student conflicts, which invites the tool to become adversarial
- If teachers feel the app could be used against them (or against students), they stop using it

The system records reality. It does not adjudicate it.

### Off-Roster Path (First-Class)

When a student claims an activity but isn't on the scraped roster, the teacher still needs to act. This is common — JV/varsity shifts, roster changes, late additions, scraper gaps.

**UI:**

```
ACTIVE STUDENTS:
- John Smith
- Maria Lopez
- David Kim

[ + Add student not on roster ]
```

Tap → free-text name input → Dismiss. Same one-tap action, same ledger.

**Display:** off-roster dismissals appear in the unified DISMISSED list with a subtle tag, not in a separate section:

```
DISMISSED:
- John Smith ✓ (2:41 PM)
- Johnny Smith ⚠︎ (2:43 PM) — off-roster
- Maria Lopez ✓ (2:44 PM)
```

### No Blocking Validation

The system never prevents a dismissal action. Lightweight assistance (autocomplete, fuzzy-match suggestions) may be added later, but nothing blocks the teacher's action. The teacher's judgment is the authority.

### Framing Constraint (Important)

This app is **operational truth**, not **teacher evaluation**. The moment it becomes a compliance/surveillance tool, the incentives corrupt — teachers will stop entering honest data, or dismiss exactly on schedule regardless of reality. Keep it framed as a tool that supports the teacher, not one that watches them.

---

## 20. Planned vs Actual Architecture

### Two-Layer Event System

The system has two distinct data layers that are **never merged**:

**Context layer (enrichment — "what should happen")**
- Game list from iCal + dismissal_time enrichment from scraper + sport_defaults/game_overrides from Sheet
- Merged at display time into date-scoped entries: sport_id + date + dismissal_time + opponent + location
- Best-effort truth from three layered sources (see §22)
- Human overrides in the Sheet take precedence over scraper output

**Action layer (teacher actions — "what actually happened")**
- `dismissals` table
- Identity, timestamp, sport_id
- Authoritative record of the moment a teacher acknowledged movement

Linked by `sport_id + date`, never merged.

### Date-Scoped Schedule Table

Schedule entries must be date-scoped, not just sport-scoped:

```js
resolvedGames: {
  id,           // composite: "2026-10-15_soccer-boys"
  date,
  sport_id,     // "{sport_slug}_{level_lower}"
  dismissal_time,
  opponent,
  location
}
```

Soccer leaves at 2:30 on Tuesday but 1:45 on Friday. `sport_id` alone isn't enough.

### UI State Reflects Storage, Not Local State

**Non-negotiable architectural principle:**

- Click → write event → UI re-renders from data
- **Never:** click → UI changes → "hope it saved"

In Dexie terms: use `useLiveQuery` to subscribe to table changes. The component has no local state for the dismissed list — it reads from storage every render. If the write fails, the student doesn't appear in the dismissed list. No desync possible.

```js
const dismissals = useLiveQuery(
  () => db.dismissals.where('sport_id').equals(sportId).toArray(),
  [sportId]
);
```

This also makes undo trivial — `db.dismissals.delete(id)` and the UI rolls back automatically. No separate rollback code path.

### Derived Metrics (Future, Not MVP)

Because planned and actual are separated, the following become possible without schema changes:

- Variance per sport ("basketball averages 8 min late")
- Teacher patterns (for self-reflection, not evaluation)
- Sport reliability over time
- Missed-dismissal flags (roster entry exists, no dismissal event)

None of this is MVP. All of it is *possible* because the layers are separate. Do not build until there is demand.

---

## 21. Access Model (Route Separation + Device Trust)

### Core Principle

**Separate student surface from staff surface at the route level, not via conditional UI.**

Hidden affordances (gestures, long-presses, secret taps) look clever but fail under school conditions:
- Substitutes don't inherit the gesture
- Teachers demonstrate it in front of students
- Tribal knowledge decays over time
- Cognitive load under stress

The correct solution is not hiding access — it is **removing student presence from the access boundary entirely**.

### Architecture

**Student surface (`/`):**
- Schedule, today view, announcements
- No teacher UI exists anywhere in this route tree
- No login button, no gesture, no affordance hinting at staff functionality

**Staff surface (`/staff`):**
- Separate route, not linked from the student surface
- Own component tree, own bundle path
- Accessed by direct URL only (bookmark, typed, shared among staff)

**Separate routes, not conditional rendering.** Do not do `if (isTeacher) showDismissalUI()` on the home page — that bundles teacher UI into the student surface at the code level and defeats the separation principle.

### Enrollment: PIN as Device Trust, Not Authentication

First visit to `/staff`:
- Prompt for PIN: `md1950` (Mater Dei founding year, chosen for memorability)
- On success: `localStorage.setItem('trusted_device', true)`
- Subsequent visits: direct access, no prompt

```js
const isTrusted = localStorage.getItem('trusted_device') === 'true';
if (!isTrusted) {
  showPinGate();
}
```

**The PIN is an enrollment ceremony, not ongoing authentication.** It gates initial device trust, nothing more. Once a device is enrolled, it stays enrolled until localStorage is cleared.

### Failure Mode

Wrong PIN:
- Input silently clears
- No error message, no lockout, no logging
- Nothing rewards guessing

No rate limiting. No stealth failure behavior. The threat model does not justify either.

### Explicit Non-Goals

- **Not authentication** — no teacher identity per-action in MVP
- **Not authorization** — once inside, any trusted device can dismiss any student from any sport
- **Not security** — if a student observes the PIN, they can enroll a device; that's acceptable at this phase
- **Not rate-limited** — no lockouts, no cooldowns
- **No hidden gestures** — if it needs to be taught, it needs to be explicit

Real teacher identity, revocable device trust, and per-user audit trails are phase-2 concerns.

### Why This Works

| Attack | Why it fails |
|--------|--------------|
| Student opens student app and hunts for teacher login | No teacher UI exists in student bundle |
| Student shoulder-surfs a teacher typing the PIN | They'd still need to know the `/staff` URL exists |
| Student learns both the URL and PIN | They can enroll a device, but physical/social consequences of misuse remain |
| Substitute teacher can't find the feature | URL is documented; no gesture to forget |
| Teacher uses different device | Navigate to `/staff`, enter PIN once, done |

The system is boring, predictable, and survives school conditions.

---

## 22. Athletics Data Ingestion Pipeline (Three-Layer Architecture)

### Problem

The dismissal app needs three kinds of data about today's games:

1. **What games exist today** — date, sport, opponent, level
2. **When the team leaves campus** — the "dismissal time" that determines when classroom pull-out happens
3. **Who's on the team** — the roster the teacher checks names against

MD Today already consumes the school's Edlio iCal feed for the main calendar. That feed carries games (problem 1) but not dismissal times or rosters (problems 2 and 3).

`materdeiathletics.org` publishes all three, but as human-readable web pages — WordPress pages with AJAX-loaded schedule widgets and server-rendered roster pages. No public JSON API.

### Decision: Three-Layer Architecture

The pipeline separates concerns into three layers, each with a single clean responsibility:

**Layer 1 — Calendar (existing):** The Edlio iCal feed MD Today already consumes defines *what games exist today*. The Pass App does not re-fetch game lists; it re-reads athletics events from the feed the app already has in memory, filtering by the `Athletics` category.

**Layer 2 — Enrichment (new scraper):** A Netlify scheduled function (`netlify/functions/athletics-data.js`) runs daily at 3am Pacific. It scrapes `materdeiathletics.org` for the two data types the iCal feed doesn't carry — dismissal times and rosters — and returns them as JSON. The scraper caches its last-good result in Netlify Blobs and serves from cache on failure. **The exact JSON output contract is specified in `BUILD.md` §Data Model §Layer 2 — see there for field types and shape; this section governs the architectural "why," not the wire format.**

**Layer 3 — Override (the Sheet):** A Google Sheet holds human-owned overrides only — no ingested data. Three tabs:
- `sport_defaults` — coach policy dismissal times per sport/level, used when the scraper finds none
- `manual_rosters` — rosters for the 10 sports with no roster page on the athletics site
- `game_overrides` — per-game coach adjustments ("leaving earlier today")

### Merge Order (LOCK)

When `/staff/` renders today's dismissal dashboard, dismissal time resolves in this order:

1. `game_overrides` row matching `(date, sport_slug)` → use this
2. Scraper's `dismissal_time` for this game → use this
3. `sport_defaults` row matching `(sport_slug, level)` → use this
4. Otherwise → game doesn't appear in the dashboard

Roster resolution follows an analogous order: scraper first, `manual_rosters` fallback, then empty (off-roster entry only).

### Why This Architecture

- **Scraper is enrichment, not source of truth.** The iCal feed is already the authoritative "what games exist" source. The scraper only adds what iCal doesn't carry. This matches MD Today's existing mental model: one canonical feed, extras bolted on.
- **Scrape-per-sport, not per-event.** The scraper fetches all sports it can discover, not just the sports that have games today. Simpler, more debuggable, avoids brittle iCal-to-athletics matching. The app matches to iCal events at display time.
- **Override layer is human-owned, full stop.** The scraper never writes to the Sheet. Coach policy (`sport_defaults`) never moves into the scraper. This separation means a scraper failure cannot corrupt coach policy data.
- **Humans can always override.** Scraper says 11:45, coach changed it to 12:00 this week — `game_overrides` wins. Fix in the Sheet, no redeploy. Same escape valve as the existing `announcement_text` field.
- **Scraper failures degrade gracefully.** On fetch failure, the function serves the last-good cache from Netlify Blobs. If the cache is >36h old, the app shows "Data may be stale (last updated X)" but does not break. Teacher can still off-roster dismiss.
- **No Sheet API dependency for scraped data.** Writing scraped data through the Sheets API would add auth tokens, quotas, silent failures, and merge-vs-overwrite logic to debug. The JSON endpoint pattern (following the existing `netlify/functions/ical.js`) is the same shape MD Today already runs.

### Scraper Mechanics (Three Phases)

**Phase 0 — Sport discovery.** Fetch `https://www.materdeiathletics.org`. Extract sport slugs from nav links matching `/varsity/{slug}/schedule-results`. For each slug, fetch the per-sport schedule page to extract the WordPress `sportID` (from the `sport_ids=N` parameter in the page's "Sync Calendar" iCal link) and a fresh `_ajax_nonce` (from the inline script). Result: a dynamic `[{ slug, id, nonce, name }]` list. No hardcoded sport constant.

*Rationale:* a static sportID map would require manual re-verification every season and would drift silently when sports are added or slugs change. Dynamic discovery costs ~30 extra HTTP requests per cron run (~15 seconds) and earns robustness. The tradeoff is locked because IDs are non-sequential and non-obvious (football=1, baseball=21, beach volleyball=232) — pattern-based guessing would not work.

**Phase 1 — Schedules + dismissal times.** For each `(sport, level)` pair across `[Varsity, JV Red, JV Gray, Freshman]`, call:

```
POST /wp-admin/admin-ajax.php
  ?action=load_schedule_results_full
  &sportID={id}&level={level}&school_id=289
  &year=2025-26&_ajax_nonce={nonce}
```

The endpoint returns rendered HTML. Parse with Cheerio:
- `li[data-date]` → one per game, `data-date` is `YYYY-MM-DD`
- `.school p` → opponent
- `.vs` text → `at` (away) or `vs` (home)
- `.time strong` → game start time
- `#hoverModal_N` → dismissal time (`Dismissal Time: HH:MM AM/PM`)

**Phase 2 — Rosters.** For each `(sport, level)` that has a roster page:
```
GET /{level-slug}/{sport-slug}/roster
```

Parse `<a href="/player/{slug}?picture=...">` elements inside `.rostertablediv`. Extract slug → display name (hyphens → spaces, title-case). Filter out WordPress soft-delete entries (`__trashed` suffix). Do NOT normalize first/last name ordering — slug order varies by sport (volleyball = last-first, basketball = first-last), and enforcing a convention would produce wrong names as often as right ones.

### iCal ↔ Scraper Matching (MVP)

At display time, the app attaches scraper-enriched data to each iCal event by matching on `(date, sport_slug)`. First match wins.

**MVP behavior:** tournament days with two same-sport games collide (the first match is used for both). This is a documented limitation, not a silent bug — the UI acknowledges it.

**Why not `(date, sport_slug, opponent)` matching:** string comparison across sources is fragile. "St. John Bosco" vs "St John Bosco" vs "St. John Bosco HS" would miss real matches. A normalization layer would spiral. Failing visibly on tournament days is better than failing silently on string mismatches.

**SUMMARY → slug translation:** the iCal feed uses short SUMMARY strings (`"V Baseball @ JSerra"`). The scraper uses slugs (`baseball`). A small translation table in `pass-data.js` handles this. When a SUMMARY doesn't map, the iCal event still displays in MD Today; it just gets no enrichment in the Pass App, and teachers can still dismiss off-roster.

### Rejected Alternatives

- **Scrape at app-open time directly (browser):** CORS blocks cross-origin fetches to the athletics site. Rejected.
- **Scrape in a per-page-load serverless proxy:** couples app uptime to both Netlify's function latency and the athletics site's uptime during the 2:30 dismissal rush. Daily cron decouples these. Rejected.
- **Write scraper output to the Sheet via Sheets API:** adds auth (service account), quota management, merge logic, and a new class of silent failures. The JSON endpoint pattern already exists in the codebase and requires none of that. Rejected.
- **Hardcoded sport ID constant:** drifts when the school adds or renames sports. Dynamic Phase 0 discovery is ~30 lines more code and solves the problem permanently. Rejected.
- **Varsity-only coverage:** JV and Freshman athletes leave class the same way varsity does. Varsity-only would create a two-tier trust experience. Rejected.

### Maintenance Reality

- **Daily cron runs unattended.** If it succeeds, no human touches anything.
- **Staleness banner appears if >36h since last successful run.** Peter sees it in `/staff/` and investigates.
- **Manual overrides happen in the Sheet as needed.** Weekly review takes ~5 minutes in-season. Season-start setup of `manual_rosters` for the 10 sports without roster pages takes ~1 hour.
- **Scraper breakage = one-off debug session.** When WordPress or the athletics site updates their markup, the scraper breaks. The app does not. Fix at leisure; the staleness banner gives users context in the meantime.

---

## 23. 48-Hour Build Checklist Pointer

The full executable checklist lives in `BUILD.md`. This spec governs *why*; BUILD.md governs *what*. If you find yourself writing build instructions here, stop — they belong in BUILD.md. If you find yourself writing architectural reasoning there, stop — it belongs here.

The canonical cross-references:

- `BUILD.md` §Data Architecture → this spec §22
- `BUILD.md` §Step 4 (`athletics-data.js`) → this spec §22 "Scraper Mechanics"
- `BUILD.md` §UI Rules → this spec §19 and §20
- `BUILD.md` §Verification checklist → this spec §18 Success Criteria

---

## 24. Data Quality Caveats

The scraper extracts what the athletics site publishes. The athletics site is a CMS maintained by coaches and athletic staff, not a system of record. Its data is as current as whoever last updated it — which varies by sport and by season.

### Known Quality Issues (as of 2026-04-23)

- **Football roster shows prior-season entries** with WordPress's `__trashed` soft-delete suffix. The scraper filters these out in code, but the underlying issue is that football's roster has not been updated for the current season. When football season starts, someone will repopulate it.
- **Baseball varsity roster often empty.** The page exists but returns zero players for the 2025-26 season. Root cause unknown; likely a data-entry gap on the coach's side.
- **Slug name ordering varies.** Volleyball girls uses `last-first` (`ciszewski-kaia`). Basketball boys uses `first-last` (`orlando-castano`). Different coaches, different Home Campus entry habits. The app does not attempt to normalize — teachers recognize their students regardless of display order.

### Sports Without Roster Pages

These 10 sports have no roster page on `materdeiathletics.org` at all and require manual entry in the Sheet's `manual_rosters` tab:

- Baseball
- Softball
- Track & Field (Coed)
- Volleyball (Boys)
- Wrestling (Boys)
- Lacrosse (Girls)
- ESports
- Traditional Competitive Cheer
- Ice Hockey (Club)
- Sailing (Club)
- Surf (Club)

This list is discovered empirically; sports may be added to or removed from the site over time. When the scraper fetches a roster page and finds no players, it treats that sport as coverage-less for that level and relies on `manual_rosters` entries.

### The Off-Roster Path Is the Universal Fallback

Because source data quality is inherently unreliable, every dismissal flow includes a first-class "Add student not on roster" entry point. This is not a fallback for edge cases — it is a primary affordance. Teachers should not perceive a difference in friction between roster-matched and free-text dismissals. The only UI distinction is a subtle `⚠︎` tag on free-text entries in the dismissed list, and that tag is purely informational — it does not gate any action or require any follow-up.

### Escalation Policy

When the scraped data is wrong (stale football roster, missing baseball players, etc.):

1. **Teachers use off-roster entry in the moment.** No friction added to the dismissal flow.
2. **The Sheet's `manual_rosters` tab holds the correction.** Peter (or a future Sheet maintainer) adds the missing players there. Merge order ensures manual entries take effect immediately — no cron wait.
3. **Source-data fixes happen out-of-band.** If the football coach is asked to update the athletics site, great. If not, the `manual_rosters` row is the permanent fix until they do. The app doesn't care which is source of truth.

This is the architectural point: **the app treats data quality issues as a routine condition, not an emergency.** The three-layer merge makes it possible to compensate for source-data problems without corrupting the pipeline or breaking a dismissal.

---

## v1.5 Summary of Changes

- **§22 Athletics Data Ingestion Pipeline** — fully rewritten. Replaced single-layer "scrape into Sheet" model with three-layer architecture (iCal + enrichment scraper + Sheet override). Documented the confirmed three-phase scraper mechanics, merge order (LOCK), iCal↔scraper matching rule, rejected alternatives, and maintenance expectations.
- **§23 Build Checklist Pointer** — new: clarifies the division of labor between `mdtoday.md` (why) and `BUILD.md` (what).
- **§24 Data Quality Caveats** — new: documents known issues with source data, lists the 10 sports without roster pages, and codifies the off-roster path as the universal fallback.

### v1.3 Summary (preserved)

- **§10 Data Model** — identity object replaces name-as-primary-key; `roster_match` semantics clarified
- **§13 Access Model** — replaced with pointer to §21 (route separation supersedes role gate)
- **§14 MVP Build Order** — reflects route separation and off-roster path
- **§19 Teacher-Centered Framing** — new: purpose, single action, no deny flow, off-roster as first-class
- **§20 Planned vs Actual Architecture** — new: two-layer event system, UI-state-reflects-storage principle
- **§21 Access Model** — new: route separation, device trust, PIN as enrollment
- **§22 Roster Ingestion Pipeline** — original: scrape-into-sheet, dismissal_offset model (superseded by v1.5 rewrite above)

The spec now captures both the decisions and the non-decisions — "no deny," "no hidden gestures," "no authentication in MVP," "no compliance framing," "no opponent-string matching," "no name normalization" — with reasoning attached. A future-you under deadline pressure can stress-test "should I add X?" against the logic, not just the outcome.
