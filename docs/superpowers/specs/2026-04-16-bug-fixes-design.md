# Bug fixes — routine state, XP accounting, Completed section, collapse toggle

**Date:** 2026-04-16
**Scope:** Five user-reported bugs affecting task completion accounting and the Completed/routines UI.

## Context

QuestLog awards XP and gold when users complete tasks. Weekly routines can have subtasks whose completion auto-completes the parent. Daily tasks archive after 2 seconds; backlog tasks archive on completion. The Completed section (`renderCompleted`) lists archived items grouped by month.

Several interactions currently produce incorrect XP/gold totals or stale UI state. This spec fixes those.

## Bugs and fixes

### Bug 1 — Deselecting a subtask does not remove the parent's completed checkmark

**Observed:** In a weekly routine with subtasks, completing all subtasks auto-completes the parent (shows ✓). If the user then unchecks a subtask, the parent keeps its checkmark and stays in `todayCompletions`.

**Root cause:** `toggleTask` in [src/modules/game-engine.js](../../../src/modules/game-engine.js) awards parent completion when `allSiblingsDone` (lines 136–164), but the undo branch (lines 166–179) never reverses it.

**Fix:** When undoing a subtask (task has `parent_id`), check if the parent is in `todayCompletions`. If so:
- Remove the parent from `todayCompletions`.
- Reverse the parent's XP (`character.xp -= parent.xp_reward`, clamped at 0).
- Reverse the parent's gold (`character.gold -= parent.gold_reward`, clamped at 0).
- Decrement `character.total_completed` (clamped at 0).
- Delete the parent's row from `completions` for today.

### Bug 2 — Repeated completion inflates XP/gold

**Observed:** Marking a task complete multiple times keeps increasing XP and gold. Deselecting does not reduce them.

**Root cause:** Primary cause is Bug 1's subtask-loop: user completes all subtasks → parent auto-awards XP, uncheck a subtask → parent still counted as done (in `todayCompletions`), recheck the subtask → `allSiblingsDone` is true again and the parent awards XP a second time. This repeats indefinitely.

**Fix:** Same as Bug 1. Once the parent is correctly decremented on subtask uncheck, the `allSiblingsDone` check fires cleanly on re-complete without duplicating awards.

**Acceptance test:** Start with 0 XP. Complete all subtasks of a routine (parent awards, e.g., 100 XP). Uncheck one subtask (parent removed, 100 XP returned). Re-check it (parent auto-completes, 100 XP awarded again). Total delta should be **one** parent award, not two or more across toggles. Use a counter assertion on `character.xp` across three toggles.

### Bug 3 — Archived daily tasks re-appear in Today's list

**Observed:** After completing a daily to-do item, previously completed (archived) daily tasks return to the Today list on the next `state:reload` or re-render.

**Root cause:** `loadAll` in [src/modules/boot.js:85](../../../src/modules/boot.js#L85) filters daily by category only, pulling in rows that have `archived_at` set.

**Fix:**
- Line 85: `daily: all.filter(t => t.category === 'daily' && !t.archived_at)`
- Lines 89–92: include archived daily tasks in `archivedBacklog`: `all.filter(t => (t.category === 'backlog' || t.category === 'daily') && t.archived_at)`

### Bug 4 — Cannot toggle items in the Completed section

**Observed:** The Completed section only offers a permanent-delete action. There is no way to move a task back from completed to active.

**Fix:** Add an Undo/Restore button to each archived task in `renderCompleted` ([src/modules/render.js:344–361](../../../src/modules/render.js#L344)).

Restore action behavior:
- DB update: clear `archived_at`, `archive_month`, `completed_at` on the task row.
- DB delete: remove the `completions` row for that `task_id` at the archive date (`completed_at`'s YYYY-MM-DD), so the completion does not persist across days.
- Reverse XP, gold, and `total_completed` on the character row, clamped at 0. This matches the Bug 1/2 undo semantics and the user's explicit instruction: "when deselected, reduce XP and gold."
- Remove the task from `archivedBacklog`, re-insert into `tasks[task.category]` (daily or backlog).
- If restoring to the same day, re-add to `todayCompletions`? **No** — restoring means "un-complete." The user wants to bring the task back to active.
- Emit `state:reload` at the end to ensure consistency. (Alternative: do a pure in-memory mutation and skip the full reload. Reload is simpler and this is a rare action.)

New module function: `restoreArchivedTask(id)` in `game-engine.js` (next to `permanentDeleteTask`).

### Bug 5 — Routines with subtasks need a collapse toggle

**Observed:** Weekly routines with subtasks always render them expanded. No way to collapse.

**Fix:** In `renderTaskList('weekly')`:
- Track expanded parents in a module-scoped `Set<string>` (`expandedRoutines`), initialized from `localStorage['questlog:expandedRoutines']` (JSON-stringified array), default behavior: parent IDs not present in the set render as **expanded** (i.e., the set tracks collapsed or expanded — pick one convention).
- **Convention chosen:** store **collapsed** parent IDs (i.e., `Set<string>` of collapsed). Default is expanded; a parent appears in the set only if the user collapsed it. This keeps the common case (expanded) free of storage noise.
- Storage key: `questlog:collapsedRoutines`. Value is a JSON array.
- When a parent has subtasks, render a chevron element inside or next to the parent row.
- Clicking the chevron toggles membership in the set, persists to `localStorage`, and re-renders the weekly list.
- Clicking the chevron must not propagate to the parent's `onclick` (avoid toggling the parent task itself).
- CSS: chevron rotates 90° when expanded. Subtask wrap is removed from the DOM when collapsed (simpler than display:none with animation).

## Architecture impact

| Area | Change |
|------|--------|
| `src/lib/utils.js` | No change. |
| `src/modules/boot.js` | `loadAll` filter adjustment (Bug 3). |
| `src/modules/game-engine.js` | Undo-parent logic in `toggleTask` (Bugs 1, 2). New `restoreArchivedTask` function (Bug 4). |
| `src/modules/render.js` | `renderCompleted` adds restore button (Bug 4). `renderTaskList` adds chevron + collapse state (Bug 5). |
| `src/main.js` | Expose `window._restoreArchivedTask`, `window._toggleRoutineCollapse` globals if needed by inline handlers. |
| `src/styles/app.css` | New styles for chevron and restore button. |

## Testing

- Unit: pure functions in `utils.js` are unchanged. No new utility functions that warrant isolated tests.
- Integration: manual test plan in the PR description covering the acceptance tests below.

### Acceptance tests

1. **Subtask undo decrements parent:** Start fresh. Complete all subtasks of a routine. Observe parent checkmark + XP award. Uncheck one subtask → parent checkmark disappears, XP returns to pre-parent-award value, completion row deleted from DB.
2. **No XP stacking on repeated sub-completions:** After the first uncheck/recheck cycle in test 1, net XP delta equals one parent award (not two).
3. **Daily archive persists:** Complete a daily task, wait 2s, observe archival. Trigger `state:reload` (e.g., add a new task). Archived task stays in Completed, does not re-appear in Today.
4. **Restore from Completed:** From Completed, click Undo on an archived item. Task re-appears in its category's active list; character XP/gold/total_completed reduced by the task's rewards; task row updated (archived_at null); completions row for that day deleted.
5. **Routine collapse persists:** Collapse a routine. Reload the page. Routine remains collapsed. Expand it. Reload. Remains expanded.

## Non-goals

- No DB migration for historical rows with inconsistent state.
- No retroactive XP correction for past over-awards (character.xp represents current state, not replayable history).
- No changes to backlog archive behavior beyond the restore action.
- No change to the 2-second delay before daily archival.

## Open questions

None after user decisions:
- Q: Should Undo reverse XP/gold? A: yes.
- Q: Default state for collapse? A: expanded.
- Q: Migration for old archived rows? A: no.
