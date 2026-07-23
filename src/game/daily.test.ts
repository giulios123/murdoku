import { describe, expect, it } from 'vitest'
import {
  caseNumber,
  dailyLevelId,
  dailyStreaks,
  dayInfo,
  daysInMonth,
  monthPlan,
  nextOpenDailyKey,
  shiftKey,
} from './daily.ts'

describe('daily month plan', () => {
  it('is deterministic — the same month always yields the same plan', () => {
    const a = monthPlan(2026, 7)
    const b = monthPlan(2026, 7)
    expect(a).toEqual(b)
  })

  it('distributes difficulties in even thirds (remainder spread ≤ 1)', () => {
    for (const [year, month] of [
      [2026, 7],
      [2026, 8],
      [2026, 9],
      [2027, 2],
      [2028, 2], // leap February
    ] as const) {
      const plan = monthPlan(year, month)
      const days = daysInMonth(year, month)
      expect(plan.difficulties).toHaveLength(days)
      const counts = { easy: 0, medium: 0, hard: 0 }
      for (const d of plan.difficulties) counts[d]++
      const values = Object.values(counts)
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
    }
  })

  it('distributes sizes 5–8 evenly (remainder spread ≤ 1)', () => {
    const plan = monthPlan(2026, 7)
    const counts = new Map<number, number>()
    for (const s of plan.sizes) counts.set(s, (counts.get(s) ?? 0) + 1)
    expect([...counts.keys()].sort()).toEqual([5, 6, 7, 8])
    const values = [...counts.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
  })

  it('numbers cases from the July 2026 start', () => {
    expect(caseNumber('2026-07-01')).toBe(1)
    expect(caseNumber('2026-07-23')).toBe(23)
    expect(caseNumber('2026-08-01')).toBe(32)
  })

  it('dayInfo reads the plan at the right day', () => {
    const plan = monthPlan(2026, 7)
    const info = dayInfo('2026-07-23')
    expect(info.difficulty).toBe(plan.difficulties[22])
    expect(info.size).toBe(plan.sizes[22])
    expect(info.size).toBeGreaterThanOrEqual(5)
    expect(info.size).toBeLessThanOrEqual(8)
  })

  it('shiftKey walks calendar days across month borders', () => {
    expect(shiftKey('2026-07-31', 1)).toBe('2026-08-01')
    expect(shiftKey('2026-08-01', -1)).toBe('2026-07-31')
  })
})

describe('next open daily', () => {
  const solvedSet = (...days: string[]) => {
    const ids = new Set(days.map(dailyLevelId))
    return (id: string) => ids.has(id)
  }

  it('walks to the next unsolved day, skipping solved ones', () => {
    expect(nextOpenDailyKey('2026-07-10', '2026-07-23', solvedSet('2026-07-11'))).toBe(
      '2026-07-12',
    )
  })

  it('returns null on today (no future cases)', () => {
    expect(nextOpenDailyKey('2026-07-23', '2026-07-23', solvedSet())).toBeNull()
  })

  it('returns null when every later day up to today is solved', () => {
    expect(
      nextOpenDailyKey('2026-07-21', '2026-07-23', solvedSet('2026-07-22', '2026-07-23')),
    ).toBeNull()
  })

  it('crosses month borders while catching up', () => {
    expect(nextOpenDailyKey('2026-07-31', '2026-08-02', solvedSet('2026-08-01'))).toBe(
      '2026-08-02',
    )
  })
})

describe('daily streaks', () => {
  it('counts consecutive solved days — catching up heals the chain', () => {
    // Yesterday caught up today + today solved today ⇒ a chain of 2.
    const s = dailyStreaks(['2026-07-22', '2026-07-23'], '2026-07-23')
    expect(s.current).toBe(2)
    expect(s.best).toBe(2)
  })

  it('an open today anchors the current streak at yesterday', () => {
    const s = dailyStreaks(['2026-07-20', '2026-07-21', '2026-07-22'], '2026-07-23')
    expect(s.current).toBe(3)
    expect(s.best).toBe(3)
  })

  it('a gap resets the current streak but keeps the best', () => {
    const s = dailyStreaks(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-05'], '2026-07-06')
    expect(s.current).toBe(1)
    expect(s.best).toBe(3)
  })

  it('filling a gap later merges the chains', () => {
    const before = dailyStreaks(['2026-07-01', '2026-07-02', '2026-07-04'], '2026-07-04')
    expect(before.best).toBe(2)
    const after = dailyStreaks(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'], '2026-07-04')
    expect(after.current).toBe(4)
    expect(after.best).toBe(4)
  })
})
