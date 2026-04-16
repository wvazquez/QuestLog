import './styles/app.scss'

// ── Infrastructure: reactive subscriptions ───────────────
import { init as initRender } from './modules/render.js'
import { init as initCache } from './modules/cache.js'
import { init as initSW } from './modules/service-worker.js'

// ── Boot ─────────────────────────────────────────────────
import { boot } from './modules/boot.js'

// ── Imports for window globals (HTML onclick handlers) ───
import { switchTab, toggleSectionCollapse } from './modules/ui.js'
import {
  toggleUserMenu, confirmLogout, openSettings, closeSettings,
  saveSettings, openDeleteAccount, closeDeleteAccount, handleDeleteAccount,
} from './modules/auth.js'
import { buyReward } from './modules/rewards.js'
import {
  openTaskModal, closeTaskModal, selectDiff, selectPriority,
  saveTask, deleteTask, confirmDeleteTask, cancelDelete, taskById,
  addSubtaskToModal, removeSubtaskFromModal, deleteTaskFromModal,
  moveBacklogToDaily,
} from './modules/tasks.js'
import { toggleTask, toggleArchive, permanentDeleteTask } from './modules/game-engine.js'
import {
  openGoalModal, closeGoalModal, selectGoalDiff, saveGoal,
  deleteGoal, completeGoal, goalById,
} from './modules/goals.js'
import { calPrev, calNext } from './modules/calendar.js'
import { toggleLeaderboard } from './modules/leaderboard.js'
import { loadAdminData } from './modules/admin.js'
import { toggleShowAllWeekly } from './modules/render.js'
import { renderCalendar } from './modules/calendar.js'
import { loadLeaderboard } from './modules/leaderboard.js'

// ── Wire reactive subscriptions ──────────────────────────
initRender()
initCache()
initSW()

// ── Expose to HTML onclick handlers ──────────────────────
Object.assign(window, {
  // Navigation (with lazy-load callbacks for tabs)
  switchTab: (tab) => switchTab(tab, {
    onAdmin: loadAdminData,
    onCalendar: renderCalendar,
    onLeaderboard: loadLeaderboard,
  }),
  // User menu / auth
  toggleUserMenu, confirmLogout,
  // Settings
  openSettings, closeSettings, saveSettings,
  openDeleteAccount, closeDeleteAccount, handleDeleteAccount,
  // Rewards
  _buyReward: buyReward,
  // Task CRUD
  openTaskModal, closeTaskModal, selectDiff, selectPriority,
  saveTask, _deleteTask: deleteTask,
  _confirmDeleteTask: confirmDeleteTask, _cancelDelete: cancelDelete,
  _taskById: taskById,
  _toggleTask: toggleTask,
  addSubtaskToModal, removeSubtaskFromModal, deleteTaskFromModal, moveBacklogToDaily,
  // Archive
  toggleArchive, _permanentDeleteTask: permanentDeleteTask,
  // Goal CRUD
  openGoalModal, closeGoalModal, selectGoalDiff, saveGoal,
  _deleteGoal: deleteGoal, _completeGoal: completeGoal, _goalById: goalById,
  // Sections
  toggleSectionCollapse,
  toggleShowAllWeekly,
  // Calendar
  calPrev, calNext,
  toggleCalRoutines: () => toggleSectionCollapse('cal-routines'),
  // Leaderboard
  toggleLeaderboard,
})

// ── Start ────────────────────────────────────────────────
boot()
