# Calendar Detail Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Calendar tab open with today's detail panel visible, and collapse weekly routines in that panel to parent-only by default with a per-routine expand chevron.

**Architecture:** All changes live in `src/modules/calendar.js` with one additional `window` binding in `src/main.js` and a small SCSS block in `src/styles/app.scss`. A module-local `Set` (`expandedCalRoutines`) tracks which parent routines the user has expanded; it is transient (no `localStorage`) and resets on day change, month change, and page reload. Detail-panel rendering mirrors the parent/subtask split already used in `renderTaskList('weekly')` inside `src/modules/render.js:186-242`.

**Tech Stack:** Vite + vanilla JS modules, SCSS. No framework. Existing pattern: inline `onclick` handlers call `window._*` globals wired in `src/main.js`.

**Spec:** [docs/superpowers/specs/2026-04-18-calendar-detail-defaults-design.md](../specs/2026-04-18-calendar-detail-defaults-design.md)

**Testing approach:** This codebase only unit-tests pure functions in `src/lib/utils.js` (see CLAUDE.md). DOM/interaction code is verified manually via `npm run dev`. Each task ends with a manual verification checkpoint in the browser before committing.

---

## File structure

| File | Role in this plan |
|------|-------------------|
| `src/modules/calendar.js` | All rendering logic. Adds `expandedCalRoutines` Set, `toggleCalRoutineExpand` export, parent/subtask split in `calSelectDay`, reset hooks in `calPrev`/`calNext`, auto-select-today in `renderCalendar`. |
| `src/main.js` | One new line exposing `window.toggleCalRoutineExpand`. |
| `src/styles/app.scss` | Small block for subtask indent and chevron sizing inside the calendar detail panel. |

---

## Task 1: Parent/subtask split with per-routine expand chevron

Introduce the per-routine collapse mechanism. At the end of this task, the Calendar detail panel still requires a click on a day to open, but once open the Routines section shows parent routines only with a working chevron that toggles subtasks for that routine.

**Files:**
- Modify: `src/modules/calendar.js` (top-level state + `calSelectDay`)
- Modify: `src/main.js:42-79` (window globals)
- Modify: `src/styles/app.scss` (after line 375)

### Step 1.1: Add the expand Set and toggle function in calendar.js

- [ ] **Step 1.1.1: Add module-local Set at top of `src/modules/calendar.js`**

After the existing `let calSelectedDay = null;` line (around line 11), add:

```javascript
// Transient per-routine expand state for the detail panel. Resets on day
// change, month change, and page reload — intentionally not persisted.
let expandedCalRoutines = new Set();
```

- [ ] **Step 1.1.2: Add exported toggle function at the bottom of `src/modules/calendar.js`**

After the existing `calNext` export (after line 134), add:

```javascript
export function toggleCalRoutineExpand(parentId) {
  if (expandedCalRoutines.has(parentId)) {
    expandedCalRoutines.delete(parentId);
  } else {
    expandedCalRoutines.add(parentId);
  }
  if (calSelectedDay !== null) {
    calSelectDay(calSelectedDay, null, null, null);
  }
}
```

### Step 1.2: Rewrite weekly-items rendering inside calSelectDay

The current implementation in `src/modules/calendar.js:82-116` renders weekly items as a flat list. Replace the weekly-handling branch with a parent/subtask split.

- [ ] **Step 1.2.1: Replace the weekly rendering branch in `calSelectDay`**

Find this block in `src/modules/calendar.js` (lines 80-117):

```javascript
const selectedDate = new Date(calYear, calMonth, day);
const isSelectedToday = selectedDate.toDateString() === new Date().toDateString();
const dailies = isSelectedToday ? tasks.daily : [];
const weeklies = tasks.weekly.filter(t => !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(dow));
const allItems = [
  ...dailies.map(t => ({ name: escapeHtml(t.name), type: 'daily', dot: 'daily' })),
  ...weeklies.map(t => ({ name: escapeHtml(t.name), type: 'weekly', dot: 'weekly' })),
  ...(goalsDue || []).map(g => ({ name: escapeHtml(g.title), type: 'goal deadline', dot: 'goal' })),
];

detail.classList.add('open');
titleEl.textContent = new Date(calYear, calMonth, day)
  .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

if (!allItems.length) {
  itemsEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No tasks or deadlines.</div>';
} else {
  const dailyItems = allItems.filter(i => i.type === 'daily');
  const weeklyItems = allItems.filter(i => i.type === 'weekly');
  const goalItems = allItems.filter(i => i.type === 'goal deadline');

  const renderItems = (items) => items.map(i => `
    <div class="cal-detail-item">
      <div class="cal-detail-dot cal-dot ${i.dot}"></div>
      <span>${escapeHtml(i.name)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--muted)">${i.type}</span>
    </div>`).join('');

  let html = '';
  if (dailyItems.length) html += renderItems(dailyItems);
  if (weeklyItems.length) {
    html += `<div class="cal-routine-header" onclick="toggleCalRoutines()">
      <span>📅 Routines (${weeklyItems.length})</span>
      <span class="section-chevron" id="chevron-cal-routines">▼</span>
    </div>`;
    html += `<div id="list-cal-routines">${renderItems(weeklyItems)}</div>`;
  }
  if (goalItems.length) html += renderItems(goalItems);
  itemsEl.innerHTML = html;
}
```

Replace it with:

```javascript
const selectedDate = new Date(calYear, calMonth, day);
const isSelectedToday = selectedDate.toDateString() === new Date().toDateString();
const todayCompletions = store.get('todayCompletions');
const dailies = isSelectedToday ? tasks.daily : [];
const weeklies = tasks.weekly.filter(t => !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(dow));

// Split weekly routines into parents and subtasks keyed by parent_id.
const weeklyParents = weeklies.filter(t => !t.parent_id);
const weeklySubtaskMap = {};
weeklies.filter(t => t.parent_id).forEach(t => {
  if (!weeklySubtaskMap[t.parent_id]) weeklySubtaskMap[t.parent_id] = [];
  weeklySubtaskMap[t.parent_id].push(t);
});

detail.classList.add('open');
titleEl.textContent = new Date(calYear, calMonth, day)
  .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

const hasAnything = dailies.length || weeklyParents.length || (goalsDue && goalsDue.length);

if (!hasAnything) {
  itemsEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No tasks or deadlines.</div>';
} else {
  const renderFlatItem = (name, type, dot) => `
    <div class="cal-detail-item">
      <div class="cal-detail-dot cal-dot ${dot}"></div>
      <span>${escapeHtml(name)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--muted)">${type}</span>
    </div>`;

  const renderRoutineParent = (parent) => {
    const children = weeklySubtaskMap[parent.id] || [];
    const hasSubtasks = children.length > 0;
    const isExpanded = expandedCalRoutines.has(parent.id);
    const progress = hasSubtasks && isSelectedToday
      ? ` <span class="subtask-progress">(${children.filter(c => todayCompletions.has(c.id)).length}/${children.length})</span>`
      : '';
    const chevron = hasSubtasks
      ? `<button class="cal-routine-chevron${isExpanded ? ' open' : ''}" title="${isExpanded ? 'Collapse' : 'Expand'}" onclick="event.stopPropagation();window.toggleCalRoutineExpand('${parent.id}')">▸</button>`
      : '';
    const parentRow = `
      <div class="cal-detail-item">
        <div class="cal-detail-dot cal-dot weekly"></div>
        <span>${escapeHtml(parent.name)}${progress}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--muted)">weekly</span>
        ${chevron}
      </div>`;
    const subtaskRows = (hasSubtasks && isExpanded)
      ? children.map(sub => `
          <div class="cal-detail-item cal-detail-subtask">
            <div class="cal-detail-dot cal-dot weekly"></div>
            <span>${escapeHtml(sub.name)}</span>
          </div>`).join('')
      : '';
    return parentRow + subtaskRows;
  };

  let html = '';
  dailies.forEach(t => { html += renderFlatItem(t.name, 'daily', 'daily'); });
  if (weeklyParents.length) {
    html += `<div class="cal-routine-header" onclick="toggleCalRoutines()">
      <span>📅 Routines (${weeklyParents.length})</span>
      <span class="section-chevron open" id="chevron-cal-routines">▼</span>
    </div>`;
    html += `<div id="list-cal-routines">${weeklyParents.map(renderRoutineParent).join('')}</div>`;
  }
  (goalsDue || []).forEach(g => { html += renderFlatItem(g.title, 'goal deadline', 'goal'); });
  itemsEl.innerHTML = html;
}
```

Key behavioral points baked into this block:
- `hasAnything` checks **parent** counts only; a day with zero parent routines + zero dailies + zero goals shows the empty state (as before).
- The `(done/total)` progress is suppressed on non-today days because `todayCompletions` only tracks today — matching the existing daily-hiding behavior in the same function.
- The section chevron on the Routines header now gets the `open` class by default (previously it rendered as `▼` unstyled). This keeps the existing `toggleCalRoutines` global toggle behavior intact and consistent with the expanded-by-default goal.
- Stray weekly subtasks whose parent is filtered out of today's view are silently dropped — consistent with how the Weekly tab treats them (parent-less children never render standalone).

### Step 1.3: Expose the toggle on `window`

- [ ] **Step 1.3.1: Add `toggleCalRoutineExpand` to the calendar import in `src/main.js`**

Find this import at `src/main.js:29`:

```javascript
import { calPrev, calNext } from './modules/calendar.js'
```

Change it to:

```javascript
import { calPrev, calNext, toggleCalRoutineExpand } from './modules/calendar.js'
```

- [ ] **Step 1.3.2: Add `toggleCalRoutineExpand` to the window-globals block in `src/main.js`**

Find the Calendar block at `src/main.js:74-76`:

```javascript
  // Calendar
  calPrev, calNext,
  toggleCalRoutines: () => toggleSectionCollapse('cal-routines'),
```

Change it to:

```javascript
  // Calendar
  calPrev, calNext,
  toggleCalRoutines: () => toggleSectionCollapse('cal-routines'),
  toggleCalRoutineExpand,
```

### Step 1.4: Add SCSS for subtask indent and chevron

- [ ] **Step 1.4.1: Append calendar-specific rules after the existing `.cal-routine-header:hover` rule**

Find `src/styles/app.scss:375`:

```scss
.cal-routine-header:hover{color:var(--text)}
```

Append these rules directly after it (keep the compact single-line style the file uses):

```scss
.cal-detail-subtask{padding-left:22px}
.cal-routine-chevron{background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0 4px;margin-left:6px;transition:transform 0.15s ease}
.cal-routine-chevron.open{transform:rotate(90deg)}
.cal-routine-chevron:hover{color:var(--text)}
```

### Step 1.5: Manual verification

- [ ] **Step 1.5.1: Start the dev server**

Run:
```bash
npm run dev
```

Open the app at `http://localhost:5173/QuestLog/`, log in, and switch to the Calendar tab.

- [ ] **Step 1.5.2: Verify parent-only rendering**

Click any day that has weekly routines with subtasks (or create one if needed: on the Weekly tab, add a parent routine with 2+ subtasks, then return to Calendar and click today).

Expected:
- The detail panel opens.
- Parent routines appear once each.
- No subtask rows are visible yet.
- Each parent with subtasks has a `▸` chevron on the right.
- Parents without subtasks have no chevron.
- A parent row on today's date shows `(done/total)` progress next to its name.

- [ ] **Step 1.5.3: Verify per-routine expand**

Click a chevron on a parent row.

Expected:
- Its subtasks appear indented below, each with a weekly dot.
- The chevron rotates 90° (the `.open` class).
- Clicking the chevron again hides the subtasks.
- Expanding one parent does not expand or collapse any other parent.

- [ ] **Step 1.5.4: Verify read-only behavior**

Click on a subtask row (not the chevron — the row itself).

Expected: nothing happens. No completion toggle, no visual change.

### Step 1.6: Commit

- [ ] **Step 1.6.1: Stage and commit**

```bash
git add src/modules/calendar.js src/main.js src/styles/app.scss
git commit -m "$(cat <<'EOF'
feat(calendar): parent-only routines with per-routine expand in detail panel

Split weekly routines into parents and subtasks in the calendar detail
panel, with a chevron beside each parent to toggle its subtasks. Expand
state is transient and held in a module-local Set — no localStorage, and
separate from the Weekly tab's persisted collapse state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Reset expand state on day change and month change

Clear `expandedCalRoutines` when the selected day changes or when the user navigates months. Within the same day, the Set must survive re-renders from chevron toggles (otherwise Task 1's chevrons would immediately reset themselves).

**Files:**
- Modify: `src/modules/calendar.js` (`calSelectDay`, `calPrev`, `calNext`)

### Step 2.1: Reset the Set when the selected day changes

- [ ] **Step 2.1.1: Add a day-change guard at the top of `calSelectDay`**

In `src/modules/calendar.js`, find the start of `calSelectDay`:

```javascript
export function calSelectDay(day, dateStr, dow, goalsDue) {
  calSelectedDay = day;
```

Change it to:

```javascript
export function calSelectDay(day, dateStr, dow, goalsDue) {
  if (day !== calSelectedDay) {
    expandedCalRoutines.clear();
  }
  calSelectedDay = day;
```

The equality check runs **before** `calSelectedDay` is updated, so a re-render triggered by `toggleCalRoutineExpand` (which passes the same `day`) does not clear the Set. Clicking a different day does.

### Step 2.2: Reset the Set on month navigation

- [ ] **Step 2.2.1: Clear the Set inside `calPrev`**

Find `src/modules/calendar.js:120-126`:

```javascript
export function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null;
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}
```

Change it to:

```javascript
export function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null;
  expandedCalRoutines.clear();
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}
```

- [ ] **Step 2.2.2: Clear the Set inside `calNext`**

Find `src/modules/calendar.js:128-134`:

```javascript
export function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null;
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}
```

Change it to:

```javascript
export function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null;
  expandedCalRoutines.clear();
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}
```

### Step 2.3: Manual verification

(Dev server from Task 1 should still be running. If not, run `npm run dev` again.)

- [ ] **Step 2.3.1: Verify reset on day change**

1. Click a day with weekly routines that have subtasks.
2. Expand one or more parent routines via their chevron.
3. Click a different day in the grid.

Expected: the newly-selected day's detail panel renders with all parents collapsed. No residual expanded state.

- [ ] **Step 2.3.2: Verify expand state survives chevron re-renders**

1. Click a day.
2. Expand routine A (subtasks appear).
3. Expand routine B (subtasks appear).
4. Collapse routine A.

Expected: routine B's subtasks remain visible. Routine A collapses cleanly. Same day stays selected the whole time.

- [ ] **Step 2.3.3: Verify reset on month navigation**

1. Expand a routine on today's detail panel.
2. Click the `▶` next-month arrow, then `◀` back to the current month.

Expected: the detail panel is closed (existing behavior), and if you click the same day again, the previously-expanded routine is collapsed.

### Step 2.4: Commit

- [ ] **Step 2.4.1: Stage and commit**

```bash
git add src/modules/calendar.js
git commit -m "$(cat <<'EOF'
feat(calendar): reset routine expand state on day and month change

Expanded parent routines collapse when the user picks a different day or
navigates months. Chevron toggles on the same day continue to work because
the reset is gated on the day actually changing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Auto-select today on initial calendar render

When the Calendar tab is first opened, open the detail panel for today automatically. This only applies to the initial render of the current month; navigating away and back triggers the same behavior because `calPrev`/`calNext` reset `calSelectedDay` to `null`.

**Files:**
- Modify: `src/modules/calendar.js` (`renderCalendar`)

### Step 3.1: Add auto-select logic to renderCalendar

- [ ] **Step 3.1.1: Replace the tail of `renderCalendar`**

Find the end of `renderCalendar` in `src/modules/calendar.js:55-59`:

```javascript
    cell.onclick = () => calSelectDay(d, dateStr, dow, goalsDue);
    grid.appendChild(cell);
  }

  if (calSelectedDay !== null) calSelectDay(calSelectedDay, null, null, null);
}
```

Change it to:

```javascript
    cell.onclick = () => calSelectDay(d, dateStr, dow, goalsDue);
    grid.appendChild(cell);
  }

  if (calSelectedDay === null
      && today.getFullYear() === calYear
      && today.getMonth() === calMonth) {
    calSelectedDay = today.getDate();
  }
  if (calSelectedDay !== null) calSelectDay(calSelectedDay, null, null, null);
}
```

The `today` variable is already declared earlier in `renderCalendar` (line 18) — reuse it.

### Step 3.2: Manual verification

(Dev server still running.)

- [ ] **Step 3.2.1: Verify initial auto-select**

1. Hard reload the page (`Cmd+Shift+R`).
2. Log in (if needed) and navigate to the Calendar tab.

Expected: the detail panel is already open for today. Title reads today's weekday and date. Weekly routines render parent-only. Dailies render (because today is selected). No click required.

- [ ] **Step 3.2.2: Verify navigation back to current month re-triggers auto-select**

1. From the Calendar tab, click `▶` to go to next month.

Expected: the detail panel closes.

2. Click `◀` to return to the current month.

Expected: the detail panel re-opens on today with parent-only routines.

- [ ] **Step 3.2.3: Verify non-current months do not auto-select**

1. From the current month, click `▶` to go to next month.

Expected: no day is selected, detail panel is closed. Clicking any day in that month still works normally.

2. Click `◀◀` twice to go back two months from current.

Expected: same — no auto-select, detail closed until the user clicks a day.

- [ ] **Step 3.2.4: Verify full-flow regression check**

On today's auto-opened detail panel:
- Expand a routine (subtasks appear).
- Click a different day (routine collapses; new day's items render parent-only).
- Click today's cell again (returns to today; routines parent-only again — the chevron state from earlier is gone because day-change cleared it).
- Switch to the Weekly tab and confirm the Weekly tab's routine collapse state is unchanged (whatever was previously collapsed there stays collapsed).

Expected: all behaviors match. Weekly tab's `localStorage` key `questlog:collapsedRoutines` is not touched.

### Step 3.3: Commit

- [ ] **Step 3.3.1: Stage and commit**

```bash
git add src/modules/calendar.js
git commit -m "$(cat <<'EOF'
feat(calendar): auto-select today on initial calendar render

Opening the Calendar tab now lands directly on today's detail panel when
viewing the current month, removing the extra click required to see what's
on today. Other months still open with no selection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (already run)

**Spec coverage** — every goal in the spec maps to a task:

| Spec goal | Task |
|-----------|------|
| Auto-select today on initial render of current month | Task 3 |
| Parent-only routine display with per-routine expand chevron | Task 1 (Steps 1.1 – 1.4) |
| Transient expand state (reset on day/month change, page reload) | Task 1 Step 1.1 (no persistence), Task 2 (reset hooks) |
| Progress `(done/total)` shown on today's routines only | Task 1 Step 1.2.1 (`isSelectedToday` guard on `progress`) |
| Read-only calendar (subtask rows don't toggle completion) | Task 1 Step 1.2.1 (no `onclick` handler on subtask rows) — verified in Step 1.5.4 |
| Section header and `toggleCalRoutines` unchanged | Task 1 Step 1.2.1 (header block preserved, with `open` class added for consistency) |
| Weekly tab's persisted `collapsedRoutines` untouched | Task 1 Step 1.1 uses its own Set; verified in Step 3.2.4 |

**Placeholder scan:** none.

**Type/name consistency:** `expandedCalRoutines`, `toggleCalRoutineExpand`, `.cal-routine-chevron`, `.cal-detail-subtask` used consistently across all tasks.
