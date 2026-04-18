# Calendar Detail Defaults — Design

**Date:** 2026-04-18
**Status:** Approved (awaiting user spec review)
**Scope:** Calendar view (`src/modules/calendar.js`)

## Problem

Opening the Calendar tab today requires two extra clicks to see what's on the current day: the detail panel stays empty until the user clicks a date cell. Once open, the "Routines" section already exists with a section-level expand toggle, but inside it every weekly item (parent routines **and** their subtasks) is listed flat. This makes routine-heavy days look noisy and hides the parent/child structure users see on the Weekly tab.

## Goals

1. On initial render of the current month, open the detail panel for today automatically so the user sees the current day's items without clicking.
2. Inside the Routines section, show only parent routines by default and hide subtasks behind a per-routine expand chevron — mirroring the Weekly tab's interaction model.
3. Keep the per-routine expand state transient (reset on day change, month change, and page reload). The calendar is a read-only preview; its expand state should not bleed into the Weekly tab's persisted `collapsedRoutines` or vice versa.

## Non-goals

- No change to the outer "📅 Routines (N)" section header or its existing `toggleCalRoutines()` toggle. It remains expanded by default.
- Calendar stays read-only. Subtask rows in the detail panel do not toggle completion.
- No change to the Weekly tab's persisted `collapsedRoutines` (`localStorage` key `questlog:collapsedRoutines`).
- No new unit tests — this is pure DOM/interaction code with no new pure functions.

## Design

### 1. Auto-select today

In `renderCalendar()` (`src/modules/calendar.js:13`):

- After building the grid, if `calSelectedDay === null` **and** the viewed month/year matches today's month/year, set `calSelectedDay = today.getDate()` and call `calSelectDay(calSelectedDay, null, null, null)` so the detail panel opens.
- The existing tail call `if (calSelectedDay !== null) calSelectDay(...)` handles the re-render case; the new logic only sets the default before that line.
- `calPrev()` and `calNext()` continue to clear `calSelectedDay` and close the panel — auto-select only fires on first render of the current month.

### 2. Parent-only routine rendering with per-routine expand

Rewrite the weekly-items branch inside `calSelectDay()` to mirror `renderTaskList('weekly')` in `src/modules/render.js`:

- Split `weeklies` into `parentTasks` (no `parent_id`) and a `subtaskMap` keyed by `parent_id`.
- Each parent row renders:
  - The routine name
  - A `(done/total)` progress span when children exist, using `store.get('todayCompletions')` as the source of truth for completion (matches Weekly tab semantics — the calendar always reflects today's completion state regardless of which day is selected, since the underlying data model only tracks today's completions)
  - A chevron button (`▸`) with an `open` class when that parent's ID is in the module-local `expandedCalRoutines` Set
- Subtasks render indented beneath their parent only when the parent's ID is in `expandedCalRoutines`.
- Clicking the chevron calls a new exported `toggleCalRoutineExpand(parentId)` which mutates the Set and calls `calSelectDay(calSelectedDay, null, null, null)` to re-render the detail panel in place.
- The Set is declared at module scope: `let expandedCalRoutines = new Set();`. No persistence.

### 3. Reset on day change / month change

- `calSelectDay` clears `expandedCalRoutines` **only when the selected day changes** (i.e., `day !== calSelectedDay` on entry). Re-rendering the same day after a chevron toggle must not clobber the Set.
- `calPrev` and `calNext` clear `expandedCalRoutines` alongside the existing `calSelectedDay = null` reset.

### 4. Wiring

- Export `toggleCalRoutineExpand` from `calendar.js`.
- Add `toggleCalRoutineExpand: calendar.toggleCalRoutineExpand` to the window-globals block in `src/main.js` (paired with the existing `toggleCalRoutines`).
- Chevron buttons call `window.toggleCalRoutineExpand('<id>')` via inline `onclick`, matching the pattern used in `render.js` for `window._toggleRoutineCollapse`.

### 5. Styling

- Reuse existing `.cal-detail-item` layout for parent rows. Add a small indent class (e.g., `.cal-detail-subtask`) in `src/styles/app.scss` mirroring `.task-subtask-wrap` indentation. If the existing `.cal-detail-item` spacing already feels right with a left padding, a one-line rule is enough.
- Reuse the existing `.section-chevron` / `.routine-chevron` rotation styles where practical; if the calendar chevron needs its own class to avoid layout conflicts inside `.cal-detail-item`, add a minimal `.cal-routine-chevron` rule.

## Data flow

```
renderCalendar()
  └─ (new) auto-set calSelectedDay = today.getDate() when viewing current month
       └─ calSelectDay(day, ...)
            ├─ (new) if day changed, clear expandedCalRoutines
            ├─ split weeklies → parentTasks + subtaskMap
            ├─ render parents (with chevron when children exist)
            └─ render subtasks under parents whose id ∈ expandedCalRoutines

user clicks chevron
  └─ window.toggleCalRoutineExpand(id)
       └─ expandedCalRoutines.add/delete(id)
            └─ calSelectDay(calSelectedDay, null, null, null)  // re-render detail panel only
```

## Files touched

| File | Change |
|------|--------|
| `src/modules/calendar.js` | Auto-select today; parent/subtask split in detail panel; `expandedCalRoutines` Set; `toggleCalRoutineExpand` export; reset on day/month change. |
| `src/main.js` | Expose `window.toggleCalRoutineExpand`. |
| `src/styles/app.scss` | Minimal subtask indent + (optional) calendar-specific chevron rule. |

## Testing

- **Unit:** None needed. Logic is DOM-driven with no new pure functions.
- **Manual verification** (see Verification below).

## Verification

Run locally via `npm run dev` and check in a browser:

1. Load the app, switch to Calendar tab → detail panel is open for today; title reads today's date; today's weekly routines show as parent rows only (no subtasks visible).
2. Click a routine's expand chevron → subtasks appear indented; chevron rotates/opens.
3. Click chevron again → subtasks hide.
4. Click a different day → detail panel updates to that day; all routines render collapsed (parent-only) regardless of previous expand state.
5. Click next month / previous month → detail panel closes; navigate back to current month → today auto-selects again with parent-only routines.
6. Reload the page on the Calendar tab → today's detail opens; expand state is empty; Weekly tab's persisted `collapsedRoutines` is untouched.
7. Switch to Weekly tab → existing routine collapse state is preserved and unaffected by calendar interactions.
8. Verify read-only: clicking a subtask row in the calendar detail does **not** mark it complete.

## Risks / open questions

- **`(done/total)` semantics for non-today selections.** `todayCompletions` only tracks today; showing a progress count for a routine on a non-today day would be misleading. Mitigation: only render the `(done/total)` span when the selected day is today. Fall back to showing just the name on other days. This is consistent with the existing calendar behavior where dailies are only shown for today.
- **Empty-state overlap.** If a day has weekly routines but none have subtasks, chevrons simply aren't rendered — behavior is identical to the Weekly tab. No special case needed.
