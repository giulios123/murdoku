import { describe, expect, it } from 'vitest'
import type { LevelJson } from '../engine/index.ts'
import { compareUserLevels, USERLEVEL_TAGS, type UserLevelEntry } from './userlevels.ts'

function entry(
  dbId: number,
  opts: { stars?: number; ratings?: number; size?: number; tags?: Partial<Record<string, number>> } = {},
): UserLevelEntry {
  const size = opts.size ?? 6
  const tags = Object.fromEntries(USERLEVEL_TAGS.map((t) => [t, opts.tags?.[t] ?? 0]))
  return {
    dbId,
    json: { size: { width: size, height: size } } as LevelJson,
    created: '',
    stats: { stars: opts.stars ?? 0, ratings: opts.ratings ?? 0, tags: tags as UserLevelEntry['stats']['tags'] },
    logic: true,
    playable: true,
    checkedSig: 0,
  }
}

describe('compareUserLevels', () => {
  it('sorts by average stars first, unrated last', () => {
    const best = entry(1, { stars: 10, ratings: 2 }) // Ø 5
    const mid = entry(2, { stars: 6, ratings: 2 }) // Ø 3
    const unrated = entry(3)
    expect([unrated, mid, best].sort(compareUserLevels)).toEqual([best, mid, unrated])
  })

  it('then by board size ascending', () => {
    const small = entry(1, { stars: 8, ratings: 2, size: 5 })
    const big = entry(2, { stars: 8, ratings: 2, size: 9 })
    expect([big, small].sort(compareUserLevels)).toEqual([small, big])
  })

  it('then by top property (tag order), untagged after tagged', () => {
    const creative = entry(1, { stars: 8, ratings: 2, tags: { creative: 3 } })
    const easy = entry(2, { stars: 8, ratings: 2, tags: { easy: 2 } })
    const none = entry(3, { stars: 8, ratings: 2 })
    expect([none, creative, easy].sort(compareUserLevels)).toEqual([easy, creative, none])
  })

  it('finally newest (higher dbId) first', () => {
    const older = entry(1, { stars: 8, ratings: 2 })
    const newer = entry(2, { stars: 8, ratings: 2 })
    expect([older, newer].sort(compareUserLevels)).toEqual([newer, older])
  })
})
