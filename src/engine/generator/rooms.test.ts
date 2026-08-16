import { describe, expect, it } from 'vitest'
import { generateOnce, generateRooms } from './Generator.ts'
import { Rng } from './random.ts'
import { loadLevel } from '../io/LevelLoader.ts'

// Room ids are SINGLE chars in the roomMap. The old `String(room + 1)` turned room 10
// into the two chars "10", corrupting the map — 11×11/12×12 allow 10–11 rooms, so every
// big-board generation crashed within a few attempts ("bricht nach 1 Sekunde ab").
const ROOM_CHARS = '123456789ABCDEF'

describe('generateRooms with 10+ rooms', () => {
  it('encodes every room as one alphabet char, map and ids consistent', () => {
    for (const roomCount of [10, 11]) {
      for (let seed = 0; seed < 5; seed++) {
        const { roomMap, ids } = generateRooms(12, 12, roomCount, new Rng(seed))
        // Every id is a distinct single char from the alphabet…
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ids) {
          expect(id).toHaveLength(1)
          expect(ROOM_CHARS).toContain(id)
        }
        // …the map stays one char per cell, and only painted ids appear.
        const idSet = new Set(ids)
        for (const row of roomMap) {
          expect(row).toHaveLength(12)
          for (const ch of row) expect(idSet.has(ch)).toBe(true)
        }
        // The BSP must actually have reached double digits (the regression case).
        expect(ids.length).toBeGreaterThanOrEqual(10)
      }
    }
  })
})

describe('generateOnce on big boards', () => {
  // 4 full 12×12 attempts à ~1–2s — well over vitest's default 5s.
  it('never throws at 12×12 and yields loadable levels (incl. 10+ room boards)', { timeout: 30000 }, () => {
    let bigRoomBoards = 0
    // 400000 and 400034 are seeds whose attempt RETURNS a level with 11 rooms — the
    // exact case the old `String(room + 1)` encoding crashed on. Asserted below, so a
    // future re-roll of roomCountFor can't silently drop the regression coverage.
    // NOTE these seeds are gate-sensitive: ANY change to the generator's accept gates
    // or candidate pools (measured twice on 16.08.2026: the merged exact-offset family
    // cap, then the instance-edge semantics) can turn a returning seed into a failing
    // one — then HUNT fresh seeds (generateOnce loop over seeds, keep those returning
    // >= 10 rooms), never weaken the assertion.
    for (const seed of [1000, 8919, 400000, 400034]) {
      const result = generateOnce(
        { width: 12, height: 12, suspects: 11, difficulty: 'hard', seed },
        seed,
      )
      if (!result) continue // a failed attempt is fine — only a THROW is the regression
      const puzzle = loadLevel(result.level) // asserts every roomMap char is declared
      expect(puzzle.board.width).toBe(12)
      if (Object.keys(result.level.rooms).length >= 10) bigRoomBoards++
    }
    expect(bigRoomBoards).toBeGreaterThanOrEqual(2)
  })
})
