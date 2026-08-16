import { describe, it, expect } from 'vitest'
import { generateOnce, levelClueFamilies } from './index.ts'
import type { LevelJson } from '../io/LevelSchema.ts'

/**
 * The variety knobs must REALLY bite (Dirks Frage: "Klappt das mit den Deckeln
 * wirklich?"): every level a single strict attempt returns must respect
 *  - familyCaps overrides (the daily's { offset: 1 }),
 *  - bannedFamilies (cooldown families never appear),
 *  - spotlightFamily (the featured family DOES appear).
 * generateOnce runs one attempt with strict=true — exactly the mode the knobs target.
 */

const count = (level: LevelJson, family: string): number =>
  levelClueFamilies(level).filter((f) => f === family).length

function collect(
  extra: Record<string, unknown>,
  seeds: number[],
  size = 7,
): LevelJson[] {
  const out: LevelJson[] = []
  for (const seed of seeds) {
    const r = generateOnce(
      { width: size, height: size, suspects: size - 1, difficulty: 'hard', seed, ...extra },
      seed,
    )
    if (r) out.push(r.level)
  }
  return out
}

const SEEDS = Array.from({ length: 16 }, (_, i) => 610000 + i)
const SLOW = { timeout: 60000 }

describe('variety knobs really bite', () => {
  it('familyCaps { offset: 1 } (the daily rule): never two exact-distance clues', SLOW, () => {
    const levels = collect({ familyCaps: { offset: 1 } }, SEEDS)
    expect(levels.length, 'no attempt returned — the test proves nothing').toBeGreaterThanOrEqual(3)
    for (const level of levels) {
      expect(count(level, 'offset'), level.id).toBeLessThanOrEqual(1)
    }
  })

  it('default cap still allows up to 2 but never 3 (the merged offset family)', SLOW, () => {
    const levels = collect({}, SEEDS)
    expect(levels.length).toBeGreaterThanOrEqual(3)
    for (const level of levels) {
      expect(count(level, 'offset'), level.id).toBeLessThanOrEqual(2)
    }
  })

  it('bannedFamilies: cooled-down families never appear in a strict attempt', SLOW, () => {
    const banned = ['offset', 'direction', 'roomExists']
    const levels = collect({ bannedFamilies: banned }, SEEDS)
    expect(levels.length, 'no attempt returned — the test proves nothing').toBeGreaterThanOrEqual(2)
    for (const level of levels) {
      for (const fam of banned) {
        expect(count(level, fam), `${level.id} enthält gesperrte Familie ${fam}`).toBe(0)
      }
    }
  })

  it('spotlightFamily: the featured family really shows up', SLOW, () => {
    // 'offset' always has hosts (any other suspect on a different line qualifies), so a
    // returned strict attempt MUST carry it — the host's pool was narrowed to the family.
    const levels = collect({ spotlightFamily: 'offset' }, SEEDS)
    expect(levels.length, 'no attempt returned — the test proves nothing').toBeGreaterThanOrEqual(2)
    for (const level of levels) {
      expect(count(level, 'offset'), `${level.id} ohne Spotlight-Familie`).toBeGreaterThanOrEqual(1)
    }
  })

  it('ban and spotlight compose: banned gone AND featured present', SLOW, () => {
    const levels = collect({ bannedFamilies: ['direction'], spotlightFamily: 'offset' }, SEEDS)
    expect(levels.length).toBeGreaterThanOrEqual(2)
    for (const level of levels) {
      expect(count(level, 'direction')).toBe(0)
      expect(count(level, 'offset')).toBeGreaterThanOrEqual(1)
    }
  })
})
