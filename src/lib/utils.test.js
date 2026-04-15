/**
 * @file Unit tests for src/lib/utils.js
 *
 * Pure functions only — no DOM, no Supabase, no side effects.
 * Run with: npm run test:run
 */
import { describe, it, expect } from 'vitest'
import {
  xpForLevel,
  getCharLevel,
  getCharTitle,
  getStreakMultiplier,
  escapeHtml,
  todayStr,
  formatDate,
  CHAR_TITLES,
} from './utils.js'

// ─── xpForLevel ────────────────────────────────────────────────────────────

describe('xpForLevel', () => {
  it('returns 0 for level 1 (the floor)', () => {
    expect(xpForLevel(1)).toBe(0)
  })

  it('scales at 100 XP/level for levels 2–10', () => {
    expect(xpForLevel(2)).toBe(100)
    expect(xpForLevel(5)).toBe(400)
    expect(xpForLevel(10)).toBe(900)
  })

  it('steps up to 150 XP/level for levels 11–20', () => {
    // Formula: 1000 + (lvl - 11) * 150
    expect(xpForLevel(11)).toBe(1000)         // 1000 + 0*150
    expect(xpForLevel(15)).toBe(1600)         // 1000 + 4*150
    expect(xpForLevel(20)).toBe(2350)         // 1000 + 9*150
  })

  it('steps up to 200 XP/level for levels 21–35', () => {
    // Formula: 2500 + (lvl - 21) * 200
    expect(xpForLevel(21)).toBe(2500)         // 2500 + 0*200
    expect(xpForLevel(35)).toBe(5300)         // 2500 + 14*200
  })

  it('steps up to 300 XP/level for levels 36–50', () => {
    // Formula: 5500 + (lvl - 36) * 300
    expect(xpForLevel(36)).toBe(5500)         // 5500 + 0*300
    expect(xpForLevel(50)).toBe(5500 + 14 * 300) // 5500 + 4200 = 9700
  })

  it('is always monotonically increasing', () => {
    for (let lvl = 2; lvl <= 50; lvl++) {
      expect(xpForLevel(lvl)).toBeGreaterThan(xpForLevel(lvl - 1))
    }
  })
})

// ─── getCharLevel ───────────────────────────────────────────────────────────

describe('getCharLevel', () => {
  it('returns level 1 at 0 XP', () => {
    expect(getCharLevel(0)).toBe(1)
  })

  it('returns level 1 just below the level 2 threshold', () => {
    expect(getCharLevel(99)).toBe(1)
  })

  it('returns level 2 at exactly the threshold', () => {
    expect(getCharLevel(100)).toBe(2)
  })

  it('returns level 5 at 400 XP', () => {
    expect(getCharLevel(400)).toBe(5)
  })

  it('returns level 10 at 900 XP', () => {
    expect(getCharLevel(900)).toBe(10)
  })

  it('returns level 11 at 1000 XP', () => {
    expect(getCharLevel(1000)).toBe(11)
  })

  it('caps at level 50 regardless of XP amount', () => {
    expect(getCharLevel(1_000_000)).toBe(50)
  })

  it('is consistent with xpForLevel (round-trip)', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      expect(getCharLevel(xpForLevel(lvl))).toBe(lvl)
    }
  })
})

// ─── getCharTitle ───────────────────────────────────────────────────────────

describe('getCharTitle', () => {
  const cases = [
    [1, 'Apprentice'], [4, 'Apprentice'],
    [5, 'Squire'],     [9, 'Squire'],
    [10, 'Scout'],     [14, 'Scout'],
    [15, 'Warrior'],   [19, 'Warrior'],
    [20, 'Knight'],    [24, 'Knight'],
    [25, 'Champion'],  [29, 'Champion'],
    [30, 'Guardian'],  [34, 'Guardian'],
    [35, 'Veteran'],   [39, 'Veteran'],
    [40, 'Master'],    [49, 'Master'],
    [50, 'Legend'],
  ]

  it.each(cases)('level %i → "%s"', (level, expected) => {
    expect(getCharTitle(level)).toBe(expected)
  })

  it('CHAR_TITLES covers levels 1–50 with no gaps', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const title = getCharTitle(lvl)
      expect(title).toBeTruthy()
      expect(typeof title).toBe('string')
    }
  })
})

// ─── getStreakMultiplier ─────────────────────────────────────────────────────

describe('getStreakMultiplier', () => {
  it('returns 1.0 for streaks 0–6', () => {
    expect(getStreakMultiplier(0)).toBe(1.0)
    expect(getStreakMultiplier(6)).toBe(1.0)
  })

  it('returns 1.1 for streaks 7–13', () => {
    expect(getStreakMultiplier(7)).toBe(1.1)
    expect(getStreakMultiplier(13)).toBe(1.1)
  })

  it('returns 1.25 for streaks 14–29', () => {
    expect(getStreakMultiplier(14)).toBe(1.25)
    expect(getStreakMultiplier(29)).toBe(1.25)
  })

  it('returns 1.5 for streaks 30+', () => {
    expect(getStreakMultiplier(30)).toBe(1.5)
    expect(getStreakMultiplier(365)).toBe(1.5)
  })

  it('always returns a value >= 1.0', () => {
    for (const streak of [0, 1, 7, 14, 30, 100]) {
      expect(getStreakMultiplier(streak)).toBeGreaterThanOrEqual(1.0)
    }
  })
})

// ─── escapeHtml ─────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('')
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('escapes & to &amp;', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
  })

  it('escapes < and > to prevent tag injection', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  it('escapes " to prevent attribute injection', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe("it&#39;s")
  })

  it('neutralizes a classic XSS payload', () => {
    const xss = '<img src=x onerror="alert(1)">'
    const safe = escapeHtml(xss)
    expect(safe).not.toContain('<')
    expect(safe).not.toContain('>')
    expect(safe).toContain('&lt;')
  })

  it('handles normal task names without mangling them', () => {
    expect(escapeHtml('Read for 30 minutes')).toBe('Read for 30 minutes')
  })

  it('coerces non-string input to string', () => {
    expect(escapeHtml(42)).toBe('42')
  })
})

// ─── todayStr ───────────────────────────────────────────────────────────────

describe('todayStr', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = todayStr()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('matches what new Date() produces for the same day', () => {
    const expected = new Date().toISOString().split('T')[0]
    expect(todayStr()).toBe(expected)
  })
})

// ─── formatDate ─────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('returns empty string for falsy input', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate(null)).toBe('')
  })

  it('formats a date with default short options', () => {
    // 2026-04-15 → "Apr 15"
    const result = formatDate('2026-04-15')
    expect(result).toContain('15')
    expect(result).toMatch(/[A-Z][a-z]+/) // month name
  })

  it('accepts custom Intl options', () => {
    const result = formatDate('2026-04-15', { year: 'numeric' })
    expect(result).toContain('2026')
  })
})

// ─── CHAR_TITLES completeness ───────────────────────────────────────────────

describe('CHAR_TITLES', () => {
  it('has exactly 10 tiers', () => {
    expect(CHAR_TITLES).toHaveLength(10)
  })

  it('starts at level 1 and ends at level 50', () => {
    expect(CHAR_TITLES[0][0]).toBe(1)
    expect(CHAR_TITLES[CHAR_TITLES.length - 1][1]).toBe(50)
  })

  it('has no gaps between tiers', () => {
    for (let i = 1; i < CHAR_TITLES.length; i++) {
      const prevMax = CHAR_TITLES[i - 1][1]
      const currMin = CHAR_TITLES[i][0]
      expect(currMin).toBe(prevMax + 1)
    }
  })
})
