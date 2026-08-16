import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLevel } from '../io/LevelLoader.ts'
import { SearchSolver } from '../solver/SearchSolver.ts'
import { createClue } from '../clues/ClueFactory.ts'
import { VICTIM_ID } from '../model/types.ts'
import { candidatesFor } from './Generator.ts'
import type { ClueJson } from '../clues/ClueFactory.ts'
import type { LevelJson } from '../io/LevelSchema.ts'

/**
 * Pool coverage of `candidatesFor`:
 *  1. every emitted clue is TRUE for the reference solution (the filter contract),
 *  2. the new offsetFrom / offsetFromObject types actually reach the pool,
 *  3. "IMMER ALLES" (Dirk): trait-anchored clues cover the VALUED styles (hairstyle,
 *     hair, …), not just the boolean basics — proven wherever a suspect wears one and
 *     the fairness guard (victim must not share a hidden trait) allows it,
 *  4. no emitted offsetFromObject is a disguised line clue (collapsesToLine guard).
 */
const dir = resolve(process.cwd(), 'levels')
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
const readLevel = (f: string): LevelJson => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))

const sample = [...new Set([5, 6, 8].map((n) => files.find((f) => readLevel(f).size.width === n)))].filter(
  (f): f is string => f !== undefined,
)

const VALUED = ['hair', 'hairstyle', 'beardStyle', 'glassesShape', 'glassesColor']

/** All leaf types of a (possibly composite) clue JSON. */
function leafTypes(json: ClueJson): string[] {
  if (json.type === 'and' || json.type === 'or') return json.clues.flatMap(leafTypes)
  if (json.type === 'not') return leafTypes(json.clue)
  return [json.type]
}

describe('candidatesFor pool coverage', () => {
  let sawOffsetFrom = false
  let sawOffsetFromObject = false
  let sawValuedTraitAnchor = false
  let valuedPossibleSomewhere = false

  for (const file of sample) {
    it(file, () => {
      const puzzle = loadLevel(readLevel(file))
      const solution = new SearchSolver(puzzle).firstSolution()
      expect(solution).not.toBeNull()
      if (!solution) return

      const victimAttrs = puzzle.attributesOf(VICTIM_ID)
      const valuedUsable = puzzle.suspects.some((s) =>
        VALUED.some((a) => {
          const v = puzzle.attributesOf(s.id)[a]
          return typeof v === 'string' && victimAttrs[a] !== v
        }),
      )
      if (valuedUsable) valuedPossibleSomewhere = true

      for (const suspect of puzzle.suspects) {
        const others = puzzle.suspects.filter((s) => s.id !== suspect.id).map((s) => s.id)
        const pool = candidatesFor(suspect.id, solution, puzzle, others)
        for (const json of pool) {
          // 1. The filter contract: everything in the pool is true here.
          expect(
            createClue(json).test(suspect.id, solution, puzzle),
            `${file} ${suspect.id}: pool contains an UNTRUE clue ${JSON.stringify(json)}`,
          ).toBe(true)
          if (json.type === 'offsetFrom') {
            sawOffsetFrom = true
            if (json.who.kind === 'attr' && VALUED.includes(json.who.attribute)) sawValuedTraitAnchor = true
          }
          if (json.type === 'directionFromAttr' && VALUED.includes(json.attribute)) sawValuedTraitAnchor = true
          if (json.type === 'offsetFromObject') {
            sawOffsetFromObject = true
            // 4. Never a disguised line clue: the candidates span >1 row AND >1 column
            //    is too strict (an L is fine) — the guard bans "all in ONE line".
            const cells = createClue(json).candidateCells(puzzle.board)!
            const rows = new Set<number>()
            const cols = new Set<number>()
            for (const c of cells) {
              const rc = puzzle.board.rc(c)
              rows.add(rc.row)
              cols.add(rc.col)
            }
            expect(
              rows.size > 1 && cols.size > 1,
              `${file}: offsetFromObject collapses to a line: ${JSON.stringify(json)}`,
            ).toBe(true)
          }
          // Sanity: composite pool entries never smuggle the banned shapes in.
          expect(leafTypes(json)).not.toContain('undefined')
        }
      }
    })
  }

  it('the new types actually reach the pool', () => {
    expect(sawOffsetFrom, 'no offsetFrom candidate anywhere').toBe(true)
    expect(sawOffsetFromObject, 'no offsetFromObject candidate anywhere').toBe(true)
  })

  it('valued styles (hairstyle & co.) anchor trait clues — IMMER ALLES', () => {
    // Only provable where a suspect wears a valued style the victim does not share.
    if (!valuedPossibleSomewhere) return
    expect(sawValuedTraitAnchor, 'no valued-style trait anchor despite wearers').toBe(true)
  })
})
