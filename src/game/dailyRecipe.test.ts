import { describe, expect, it } from 'vitest'
import { dailyRecipe } from './daily.ts'
import { SPOTLIGHT_FAMILIES } from './variety.ts'

/**
 * The daily's Tages-Rezept must be a PURE function of the case number (every device
 * computes the identical recipe), ration the exact-distance family to roughly every
 * third day, ban yesterday's/the day before's features, and go fully free in the last
 * seed round (the deterministic "never no daily" net).
 */
describe('dailyRecipe', () => {
  it('is deterministic: same case number, same recipe — every time', () => {
    for (const n of [1, 57, 500, 4321]) {
      expect(dailyRecipe(n, 0)).toEqual(dailyRecipe(n, 0))
      expect(dailyRecipe(n, 1)).toEqual(dailyRecipe(n, 0))
    }
  })

  it('the last seed round runs recipe-free', () => {
    expect(dailyRecipe(123, 2)).toEqual({})
  })

  it('features come from the curated list and are never banned the same day', () => {
    for (let n = 1; n <= 200; n++) {
      const r = dailyRecipe(n, 0)
      expect(SPOTLIGHT_FAMILIES).toContain(r.spotlightFamily)
      expect(r.bannedFamilies ?? []).not.toContain(r.spotlightFamily)
      expect((r.bannedFamilies ?? []).length).toBeLessThanOrEqual(2)
    }
  })

  it("bans the two previous days' features (the storage-free cooldown)", () => {
    for (let n = 3; n <= 200; n++) {
      const today = dailyRecipe(n, 0)
      for (const prev of [dailyRecipe(n - 1, 0), dailyRecipe(n - 2, 0)]) {
        if (prev.spotlightFamily !== today.spotlightFamily) {
          expect(today.bannedFamilies, `Fall ${n}`).toContain(prev.spotlightFamily)
        }
      }
    }
  })

  it('rations "genau N Felder" to roughly every third day', () => {
    const N = 900
    let allowed = 0
    for (let n = 1; n <= N; n++) {
      const r = dailyRecipe(n, 0)
      expect(r.familyCaps?.offset === 0 || r.familyCaps?.offset === 1).toBe(true)
      if (r.familyCaps?.offset === 1 && !(r.bannedFamilies ?? []).includes('offset')) allowed++
    }
    // ~1/3 plus the feature-day override, minus days where yesterday featured it —
    // anything in the 25–45% band means the quota really bites.
    expect(allowed / N).toBeGreaterThan(0.25)
    expect(allowed / N).toBeLessThan(0.45)
  })

  it('a featured offset day is always an allowed offset day', () => {
    for (let n = 1; n <= 400; n++) {
      const r = dailyRecipe(n, 0)
      if (r.spotlightFamily === 'offset') expect(r.familyCaps?.offset).toBe(1)
    }
  })
})
