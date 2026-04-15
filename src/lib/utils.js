/**
 * @module utils
 * Pure utility functions for QuestLog — XP math, level curves, streak logic,
 * and DOM-safety helpers. All functions are side-effect free and fully testable.
 */

// ─── XP / Level curve ──────────────────────────────────────────────────────

/**
 * Returns the cumulative XP required to *reach* the given level.
 *
 * Tier breakpoints:
 * - Levels  1–10: 100 XP/level
 * - Levels 11–20: 150 XP/level
 * - Levels 21–35: 200 XP/level
 * - Levels 36–50: 300 XP/level
 *
 * @param {number} lvl - Target level (1–50)
 * @returns {number} Cumulative XP threshold for that level
 */
export function xpForLevel(lvl) {
  if (lvl <= 1)  return 0
  if (lvl <= 10) return (lvl - 1) * 100
  if (lvl <= 20) return 1000 + (lvl - 11) * 150
  if (lvl <= 35) return 2500 + (lvl - 21) * 200
  return 5500 + (lvl - 36) * 300
}

/**
 * Derives a character's current level from their total accumulated XP.
 *
 * @param {number} totalXP - Total XP earned by the character
 * @returns {number} Current level (1–50)
 */
export function getCharLevel(totalXP) {
  let lvl = 1
  while (lvl < 50 && totalXP >= xpForLevel(lvl + 1)) lvl++
  return lvl
}

// ─── Character titles ───────────────────────────────────────────────────────

/**
 * Character title tiers keyed by [minLevel, maxLevel, title].
 * @type {Array<[number, number, string]>}
 */
export const CHAR_TITLES = [
  [1,  4,  'Apprentice'],
  [5,  9,  'Squire'],
  [10, 14, 'Scout'],
  [15, 19, 'Warrior'],
  [20, 24, 'Knight'],
  [25, 29, 'Champion'],
  [30, 34, 'Guardian'],
  [35, 39, 'Veteran'],
  [40, 49, 'Master'],
  [50, 50, 'Legend'],
]

/**
 * Returns the character title for a given level.
 *
 * @param {number} level - Character level (1–50)
 * @returns {string} Title string (e.g. "Knight", "Legend")
 */
export function getCharTitle(level) {
  for (const [min, max, title] of CHAR_TITLES) {
    if (level >= min && level <= max) return title
  }
  return 'Legend'
}

// ─── Streak multipliers ─────────────────────────────────────────────────────

/**
 * XP streak multipliers applied when completing tasks.
 *
 * | Streak days | Multiplier |
 * |-------------|-----------|
 * | 0–6         | 1.0×      |
 * | 7–13        | 1.1×      |
 * | 14–29       | 1.25×     |
 * | 30+         | 1.5×      |
 *
 * @param {number} streak - Current consecutive-day streak
 * @returns {number} XP multiplier
 */
export function getStreakMultiplier(streak) {
  if (streak >= 30) return 1.5
  if (streak >= 14) return 1.25
  if (streak >= 7)  return 1.1
  return 1.0
}

// ─── DOM safety ─────────────────────────────────────────────────────────────

/**
 * Escapes user-supplied strings before inserting into innerHTML.
 * Prevents stored XSS attacks from malicious task/goal names.
 *
 * @param {string} str - Raw user-supplied string
 * @returns {string} HTML-safe string with dangerous characters escaped
 *
 * @example
 * // Returns "&lt;script&gt;alert('xss')&lt;/script&gt;"
 * escapeHtml("<script>alert('xss')</script>")
 */
export function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
}

// ─── Date helpers ───────────────────────────────────────────────────────────

/**
 * Returns today's date as an ISO 8601 date string (YYYY-MM-DD) in local time.
 *
 * @returns {string} Today's date, e.g. "2026-04-15"
 */
export function todayStr() {
  return new Date().toISOString().split('T')[0]
}

/**
 * Formats an ISO date string for display.
 *
 * @param {string} isoDate - ISO 8601 date string
 * @param {Intl.DateTimeFormatOptions} [opts] - Optional Intl format options
 * @returns {string} Human-readable date string
 */
export function formatDate(isoDate, opts = { month: 'short', day: 'numeric' }) {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleDateString('en-US', opts)
}
