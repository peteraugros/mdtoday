# MD Today — Data + System Spec (v1.1)

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
