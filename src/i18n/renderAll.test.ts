import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLevel } from '../engine/io/LevelLoader.ts'
import { createBoardClue, createClue } from '../engine/clues/index.ts'
import type { ClueJson } from '../engine/clues/index.ts'
import { Renderer } from './Renderer.ts'
import type { BoardClueJson, LevelJson } from '../engine/io/LevelSchema.ts'

/**
 * Every clue of every bundled level must render to real TEXT in every language.
 *
 * `Renderer.render` falls back to returning the i18n KEY when a lookup misses, so a missing
 * or wrongly-nested translation doesn't throw — it silently shows "boardClue.roomOccupancy.
 * atLeast" to the player. This sweep is what turns that into a failing test. It also catches
 * an unfilled `{{param}}` slot, i.e. a template whose params the clue never supplies.
 */
const dir = resolve(process.cwd(), 'levels')
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
const readLevel = (f: string): LevelJson => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))

const LANGS = ['de', 'en', 'es', 'pt', 'fr', 'ru'] as const
const dicts = Object.fromEntries(
  LANGS.map((lg) => [lg, JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lg}.json`), 'utf8'))]),
)

/** A rendered string that still looks like a key ("clue.foo" / "boardClue.a.b") is a miss. */
const looksLikeKey = (s: string): boolean => /^[a-z][a-zA-Z]*(\.[a-zA-Z_]+)+$/.test(s.trim())
/** An unresolved placeholder means the template wanted a param the clue never passed. */
const hasUnfilledSlot = (s: string): boolean => s.includes('{{')

describe('every bundled level renders in every language', () => {
  for (const lg of LANGS) {
    it(`${lg}: all suspect clues`, () => {
      const bad: string[] = []
      for (const f of files) {
        const puzzle = loadLevel(readLevel(f))
        const r = new Renderer(dicts[lg], puzzle)
        for (const person of puzzle.people()) {
          for (const clue of person.clues) {
            const text = r.clue(clue.describe(), person.id)
            if (!text.trim() || looksLikeKey(text) || hasUnfilledSlot(text)) {
              bad.push(`${f} [${person.id}] → ${JSON.stringify(text)}`)
            }
          }
        }
      }
      expect(bad, `unrendered clues:\n${bad.slice(0, 10).join('\n')}`).toEqual([])
    })

    it(`${lg}: all board clues`, () => {
      const bad: string[] = []
      for (const f of files) {
        const puzzle = loadLevel(readLevel(f))
        const r = new Renderer(dicts[lg], puzzle)
        for (const bc of puzzle.boardClues) {
          const text = r.render(bc.describe())
          if (!text.trim() || looksLikeKey(text) || hasUnfilledSlot(text)) {
            bad.push(`${f} → ${JSON.stringify(text)}`)
          }
        }
      }
      expect(bad, `unrendered board clues:\n${bad.slice(0, 10).join('\n')}`).toEqual([])
    })
  }

  it('the legacy everyRoomCount shape still loads AND renders', () => {
    // No bundled level uses it any more, but old saved/custom levels may — it must keep
    // working through its RoomOccupancyClue mapping.
    const puzzle = loadLevel(readLevel(files[0]))
    const legacy: BoardClueJson = { type: 'everyRoomCount', count: 2 }
    for (const lg of LANGS) {
      const text = new Renderer(dicts[lg], puzzle).render(createBoardClue(legacy).describe())
      expect(looksLikeKey(text)).toBe(false)
      expect(hasUnfilledSlot(text)).toBe(false)
      expect(text.length).toBeGreaterThan(0)
    }
  })

  it('every roomOccupancy operator/scope/count combination renders', () => {
    const puzzle = loadLevel(readLevel(files[0]))
    for (const lg of LANGS) {
      const r = new Renderer(dicts[lg], puzzle)
      for (const op of ['atLeast', 'atMost', 'exactly', 'notExactly'] as const) {
        for (const scope of ['people', 'suspects'] as const) {
          for (const count of [0, 1, 2, 3]) {
            const text = r.render(createBoardClue({ type: 'roomOccupancy', op, count, scope }).describe())
            expect(looksLikeKey(text), `${lg} ${op}/${scope}/${count} → ${text}`).toBe(false)
            expect(hasUnfilledSlot(text), `${lg} ${op}/${scope}/${count} → ${text}`).toBe(false)
          }
        }
      }
    }
  })

  it('every neighborRoomCountDir form renders (generator-only, no bundled level carries it)', () => {
    const puzzle = loadLevel(readLevel(files[0]))
    const subject = puzzle.suspects[0].id
    for (const lg of LANGS) {
      const r = new Renderer(dicts[lg], puzzle)
      for (const dir of ['north', 'south', 'east', 'west'] as const) {
        for (const count of [1, 2]) {
          const pos: ClueJson = { type: 'neighborRoomCount', count, dir }
          for (const json of [pos, { type: 'not', clue: pos } as ClueJson]) {
            const text = r.clue(createClue(json).describe(), subject)
            expect(looksLikeKey(text), `${lg} ${json.type}/${dir}/${count} → ${text}`).toBe(false)
            expect(hasUnfilledSlot(text), `${lg} ${json.type}/${dir}/${count} → ${text}`).toBe(false)
            expect(text.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})
