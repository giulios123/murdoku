import { beforeEach, describe, expect, it } from 'vitest'
import { recordGeneratedLevel, varietyPlan } from './variety.ts'
import type { LevelJson } from '../engine/index.ts'
import type { ClueJson } from '../engine/index.ts'

/** Minimal in-memory localStorage — variety.ts goes through readStorage/writeStorage,
 *  which only need getItem/setItem. */
function stubStorage(): void {
  const map = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

/** A fake delivered level carrying exactly the given clues on one suspect —
 *  levelClueFamilies only reads suspects[].clues. */
function fakeLevel(clues: ClueJson[]): LevelJson {
  return { suspects: clues.map((c, i) => ({ id: `S${i}`, name: `S${i}`, clues: [c] })) } as unknown as LevelJson
}

const offset = (distance: number): ClueJson => ({ type: 'offset', of: 'B', dir: 'east', distance })
const room = (r: string): ClueJson => ({ type: 'inRoom', room: r })

describe('variety memory (window 4, threshold 2)', () => {
  beforeEach(stubStorage)

  it('empty history: no bans, spotlight from the curated list', () => {
    const plan = varietyPlan(() => 0)
    expect(plan.bannedFamilies).toBeUndefined()
    expect(plan.spotlightFamily).toBe('offset')
  })

  it('two occurrences in ONE level trigger the cooldown', () => {
    recordGeneratedLevel(fakeLevel([offset(1), offset(2), room('1')]))
    const plan = varietyPlan(() => 0)
    expect(plan.bannedFamilies).toEqual(['offset'])
    // The spotlight never features a family the window already saw.
    expect(plan.spotlightFamily).not.toBe('offset')
  })

  it('one occurrence in each of two levels triggers it too (counts add up)', () => {
    recordGeneratedLevel(fakeLevel([offset(1)]))
    recordGeneratedLevel(fakeLevel([offset(3)]))
    expect(varietyPlan(() => 0).bannedFamilies).toEqual(['offset'])
  })

  it('a single occurrence does NOT ban, but blocks the spotlight', () => {
    recordGeneratedLevel(fakeLevel([offset(1)]))
    const plan = varietyPlan(() => 0)
    expect(plan.bannedFamilies).toBeUndefined()
    expect(plan.spotlightFamily).not.toBe('offset')
  })

  it('the window slides: after 4 fresh levels the old sighting is forgotten', () => {
    recordGeneratedLevel(fakeLevel([offset(1), offset(2)]))
    for (let i = 0; i < 4; i++) recordGeneratedLevel(fakeLevel([room('1')]))
    expect(varietyPlan(() => 0).bannedFamilies).toBeUndefined()
  })

  it('uncapped bread-and-butter families (inRoom & co.) are never banned', () => {
    for (let i = 0; i < 4; i++) recordGeneratedLevel(fakeLevel([room('1'), room('2')]))
    // inRoom is UNCAPPED → levelClueFamilies never counts it → no ban possible.
    expect(varietyPlan(() => 0).bannedFamilies).toBeUndefined()
  })

  it('at most 3 families are banned at once — the worst offenders by count', () => {
    recordGeneratedLevel(
      fakeLevel([
        offset(1), offset(2), offset(3),
        { type: 'direction', of: 'B', dir: 'north' }, { type: 'direction', of: 'B', dir: 'east' },
        { type: 'alone' }, { type: 'alone' },
        { type: 'corner' }, { type: 'corner' },
        { type: 'atWall' }, { type: 'atWall' },
      ]),
    )
    const banned = varietyPlan(() => 0).bannedFamilies!
    expect(banned.length).toBe(3)
    // 'offset' leads with 3 occurrences; the remaining two slots go to 2× families.
    expect(banned).toContain('offset')
  })

  it('a corrupt store falls back to an empty history', () => {
    localStorage.setItem('murdoku.gen.variety.v1', '{"kaputt":')
    expect(() => varietyPlan(() => 0)).not.toThrow()
    expect(varietyPlan(() => 0).bannedFamilies).toBeUndefined()
  })
})
