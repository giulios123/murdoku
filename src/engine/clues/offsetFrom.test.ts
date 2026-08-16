import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLevel } from '../io/LevelLoader.ts'
import { Solution } from '../model/Solution.ts'
import { VICTIM_ID } from '../model/types.ts'
import { OffsetFromPersonClue, OffsetFromObjectClue } from './index.ts'
import type { OffsetAnchor } from './relationalClues.ts'
import type { Clue } from './Clue.ts'
import type { Board } from '../model/Board.ts'
import type { Puzzle } from '../model/Puzzle.ts'
import type { Cell, Direction, PersonId } from '../model/types.ts'
import type { LevelJson } from '../io/LevelSchema.ts'

/**
 * Soundness of the exact-offset-from-anonymous clues (see CLAUDE.md checklist):
 *  - `candidateCells` ⊇ {cells where test() can be true} for the object-anchored kinds,
 *  - `violatedBy` never flags a partial placement that still completes to a satisfying
 *    solution (checked via prefixes of full satisfying placements),
 *  - `OffsetFromObjectClue.candidateCells` equals an independent brute-force scan.
 */
const dir = resolve(process.cwd(), 'levels')
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
const readLevel = (f: string): LevelJson => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))

const sample = ['4x4', '6x6', '9x9']
  .map((size) => {
    const [w, h] = size.split('x').map(Number)
    return files.find((f) => {
      const l = readLevel(f)
      return l.size.width === w && l.size.height === h
    })
  })
  .filter((f): f is string => f !== undefined)

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Random placement obeying the one-per-row-and-column rule (murder rule not enforced —
 *  candidateCells must be a superset for EVERY line-legal placement). */
function randomPlacement(board: Board, ids: PersonId[], rand: () => number): Map<PersonId, Cell> | null {
  const shuffle = <T,>(xs: T[]): T[] => {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const rows = shuffle([...Array(board.height).keys()])
  const usedCols = new Set<number>()
  const out = new Map<PersonId, Cell>()
  for (let i = 0; i < ids.length; i++) {
    const row = rows[i]
    if (row === undefined) return null
    const cols = shuffle([...Array(board.width).keys()]).filter(
      (c) => !usedCols.has(c) && board.isOccupiable(board.idx(row, c)),
    )
    if (cols.length === 0) return null
    usedCols.add(cols[0])
    out.set(ids[i], board.idx(row, cols[0]))
  }
  return out
}

/** candidateCells ⊇ every cell where test() is true, over many random legal placements. */
function assertSuperset(clue: Clue, puzzle: Puzzle, subject: PersonId, seed: number): void {
  const candidates = clue.candidateCells(puzzle.board)
  if (!candidates) return
  const rand = rng(seed)
  const ids = puzzle.allIds()
  for (let iter = 0; iter < 300; iter++) {
    const placement = randomPlacement(puzzle.board, ids, rand)
    if (!placement) continue
    const solution = new Solution(placement)
    if (!clue.test(subject, solution, puzzle)) continue
    const cell = solution.cellOf(subject)
    expect(
      candidates.has(cell),
      `${clue.constructor.name}: test() is true at cell ${cell} but candidateCells excludes it`,
    ).toBe(true)
  }
}

/** Every prefix of a satisfying FULL placement can still be completed (by that very
 *  placement) — so violatedBy must stay false on all of them. */
function assertNoFalsePositive(clue: Clue, puzzle: Puzzle, subject: PersonId, seed: number): void {
  const rand = rng(seed)
  const ids = puzzle.allIds()
  for (let iter = 0; iter < 200; iter++) {
    const placement = randomPlacement(puzzle.board, ids, rand)
    if (!placement) continue
    const solution = new Solution(placement)
    if (!clue.test(subject, solution, puzzle)) continue
    const entries = [...placement]
    for (let k = 1; k <= entries.length; k++) {
      const partial = new Map(entries.slice(0, k))
      expect(
        clue.violatedBy(subject, partial, puzzle),
        `${clue.constructor.name}: violatedBy flags a prefix of a satisfying placement`,
      ).toBe(false)
    }
  }
}

/** Object types present anywhere on the board, split by occupiability. */
function objectTypes(board: Board): { all: string[]; occupiable: string[] } {
  const all = new Set<string>()
  const occupiable = new Set<string>()
  for (let c = 0; c < board.width * board.height; c++) {
    for (const obj of board.tileAt(c).objects()) {
      all.add(obj.type)
      if (obj.occupiable) occupiable.add(obj.type)
    }
  }
  return { all: [...all], occupiable: [...occupiable] }
}

const DIRS: Direction[] = ['north', 'south', 'east', 'west']

describe('offsetFrom soundness (candidateCells ⊇ test, violatedBy never false-positive)', () => {
  for (const file of sample) {
    describe(file, () => {
      const puzzle = loadLevel(readLevel(file))
      const board = puzzle.board
      const subject = puzzle.suspects[0].id
      const types = objectTypes(board)

      it('object-anchored kinds (on/near × scope) are sound', () => {
        let seed = 101
        for (const kind of ['on', 'near'] as const) {
          const pool = kind === 'on' ? types.occupiable : types.all
          for (const object of pool.slice(0, 3)) {
            const who: OffsetAnchor = { kind, object }
            for (const d of DIRS) {
              for (const distance of [1, 2]) {
                for (const scope of ['people', 'suspects'] as const) {
                  const clue = new OffsetFromPersonClue(who, d, distance, scope)
                  assertSuperset(clue, puzzle, subject, seed)
                  assertNoFalsePositive(clue, puzzle, subject, seed + 1)
                  seed += 2
                }
              }
            }
          }
        }
      })

      it('trait kind is relational (no fixed candidate set) and sound in violatedBy', () => {
        let seed = 900
        for (const value of ['m', 'f'] as const) {
          const clue = new OffsetFromPersonClue({ kind: 'attr', attribute: 'gender', value }, 'south', 1)
          expect(clue.candidateCells(board)).toBeNull()
          for (const d of DIRS) {
            for (const distance of [1, 2, 3]) {
              assertNoFalsePositive(
                new OffsetFromPersonClue({ kind: 'attr', attribute: 'gender', value }, d, distance),
                puzzle,
                subject,
                seed++,
              )
            }
          }
        }
      })

      it('offsetFromObject measures from the INSTANCE edge (independent brute-force scan)', () => {
        const resolveDir = (d: Direction, distance: number) => ({
          isColumn: d === 'west' || d === 'east',
          delta: d === 'west' || d === 'north' ? -distance : distance,
        })
        for (const object of types.all.slice(0, 4)) {
          // Instances as cell lists — a 2-cell bed / merged carpet counts ONCE, and the
          // distance is measured from the facing edge (max line towards south/east,
          // min line towards north/west).
          const instances = board
            .objectInstances(object)
            .map((cells) => [...cells].map((c) => ({ ...board.rc(c), room: board.roomIdOf(c) })))
          for (const d of DIRS) {
            for (const distance of [1, 2]) {
              for (const room of ['any', 'same', 'other'] as const) {
                const clue = new OffsetFromObjectClue(object, d, distance, room)
                const got = clue.candidateCells(board)!
                const { isColumn, delta } = resolveDir(d, distance)
                for (const cell of board.occupiableCells()) {
                  const s = board.rc(cell)
                  const sRoom = board.roomIdOf(cell)
                  const want = instances.some((inst) => {
                    const lines = inst.map((o) => (isColumn ? o.col : o.row))
                    const edge = delta > 0 ? Math.max(...lines) : Math.min(...lines)
                    const lineOk = (isColumn ? s.col : s.row) === edge + delta
                    const sameRoom = inst.some((o) => o.room === sRoom)
                    const roomOk = room === 'any' ? true : room === 'same' ? sameRoom : !sameRoom
                    return lineOk && roomOk
                  })
                  expect(got.has(cell), `${object} ${d}+${distance} ${room} at cell ${cell}`).toBe(want)
                }
              }
            }
          }
        }
      })
    })
  }
})

describe('offsetFromObject instance semantics', () => {
  it('a multi-cell instance really EXCLUDES the per-tile middle reading somewhere', () => {
    // Hunt the corpus for an instance spanning several lines along some axis; the clue
    // measured from its facing edge must then DROP at least one per-tile line — the
    // exact difference Dirks Regel demands ("südlich vom Bett heißt das komplette Bett").
    for (const file of files.slice(0, 40)) {
      const puzzle = loadLevel(readLevel(file))
      const board = puzzle.board
      for (const object of objectTypes(board).all) {
        for (const inst of board.objectInstances(object)) {
          for (const isColumn of [false, true]) {
            const lines = [...inst].map((c) => (isColumn ? board.rc(c).col : board.rc(c).row))
            const min = Math.min(...lines)
            const max = Math.max(...lines)
            if (min === max) continue
            // Towards south/east the edge is `max` — the per-tile reading from the far
            // tile (min + distance) must be gone unless ANOTHER instance provides it.
            const distance = 1
            const clue = new OffsetFromObjectClue(object, isColumn ? 'east' : 'south', distance)
            const got = clue.candidateCells(board)!
            // Every candidate must lie on a facing-EDGE line of some instance …
            const edgeLines = new Set(
              board
                .objectInstances(object)
                .map((cells) =>
                  Math.max(...[...cells].map((c) => (isColumn ? board.rc(c).col : board.rc(c).row))) + distance,
                ),
            )
            for (const cell of got) {
              const line = isColumn ? board.rc(cell).col : board.rc(cell).row
              expect(edgeLines.has(line), `${file} ${object}: candidate on non-edge line ${line}`).toBe(true)
            }
            // … and the old per-tile reading from the far tile (min + 1) is really GONE:
            // when no other instance's edge produces that line, no candidate may sit there.
            if (!edgeLines.has(min + distance)) {
              for (const cell of got) {
                const line = isColumn ? board.rc(cell).col : board.rc(cell).row
                expect(line, `${file} ${object}: per-tile reading survived`).not.toBe(min + distance)
              }
            }
            return // one real multi-line instance proven — enough
          }
        }
      }
    }
    throw new Error('no multi-line instance found in the first 40 levels — widen the hunt')
  })
})

describe('offsetFrom semantics', () => {
  const puzzle = loadLevel(readLevel(sample[sample.length - 1]))
  const board = puzzle.board
  const subject = puzzle.suspects[0].id
  const types = objectTypes(board)

  it('suspects scope implies people scope (the victim only ever ADDS anchors)', () => {
    const rand = rng(4242)
    const ids = puzzle.allIds()
    const object = types.all[0]
    for (let iter = 0; iter < 300; iter++) {
      const placement = randomPlacement(board, ids, rand)
      if (!placement) continue
      const solution = new Solution(placement)
      for (const d of DIRS) {
        for (const distance of [1, 2]) {
          const people = new OffsetFromPersonClue({ kind: 'near', object }, d, distance, 'people')
          const suspects = new OffsetFromPersonClue({ kind: 'near', object }, d, distance, 'suspects')
          if (suspects.test(subject, solution, puzzle)) {
            expect(people.test(subject, solution, puzzle)).toBe(true)
          }
        }
      }
    }
  })

  it('pigeonhole: a placed non-qualifying person on the anchor line makes it violated', () => {
    // Find an object type, a subject cell and a NON-anchor cell exactly one column east
    // of the anchor line — the person there is the line's only possible occupant, so the
    // clue can never be satisfied anymore.
    const other = puzzle.suspects[1].id
    for (const object of types.all) {
      const clue = new OffsetFromPersonClue({ kind: 'near', object }, 'east', 1, 'people')
      const anchors = clue.anchorCells(board)!
      for (const sCell of board.occupiableCells()) {
        const s = board.rc(sCell)
        const anchorCol = s.col - 1
        if (anchorCol < 0) continue
        for (const oCell of board.occupiableCells()) {
          const o = board.rc(oCell)
          if (o.col !== anchorCol || o.row === s.row || anchors.has(oCell)) continue
          const placement = new Map<PersonId, Cell>([
            [subject, sCell],
            [other, oCell],
          ])
          expect(clue.violatedBy(subject, placement, puzzle)).toBe(true)
          return
        }
      }
    }
    throw new Error('no configuration found — the assertion never ran')
  })

  it('an off-board anchor line is violated immediately', () => {
    // Subject in column 0 with the anchor "one column west" — no such column exists.
    const cell = board.occupiableCells().find((c) => board.rc(c).col === 0)
    if (cell === undefined) return
    const clue = new OffsetFromPersonClue({ kind: 'near', object: types.all[0] }, 'east', 1, 'people')
    expect(clue.violatedBy(subject, new Map([[subject, cell]]), puzzle)).toBe(true)
  })

  it('the victim can be the anchor for people scope on a full placement', () => {
    // Direct construction: victim beside an object, subject exactly one line away.
    const object = types.all.find((t) => board.cellsNearObject(t).size > 0)
    if (!object) return
    const anchors = board.cellsNearObject(object)
    for (const aCell of anchors) {
      const a = board.rc(aCell)
      const sCell = board
        .occupiableCells()
        .find((c) => board.rc(c).col === a.col + 1 && board.rc(c).row !== a.row)
      if (sCell === undefined) continue
      const placement = new Map<PersonId, Cell>([
        [subject, sCell],
        [VICTIM_ID, aCell],
      ])
      // Fill the rest anywhere legal so the solution is complete.
      const usedRows = new Set([board.rc(sCell).row, a.row])
      const usedCols = new Set([board.rc(sCell).col, a.col])
      let ok = true
      for (const s of puzzle.suspects.slice(1)) {
        const free = board
          .occupiableCells()
          .find((c) => !usedRows.has(board.rc(c).row) && !usedCols.has(board.rc(c).col))
        if (free === undefined) {
          ok = false
          break
        }
        usedRows.add(board.rc(free).row)
        usedCols.add(board.rc(free).col)
        placement.set(s.id, free)
      }
      if (!ok) continue
      const solution = new Solution(placement)
      const people = new OffsetFromPersonClue({ kind: 'near', object }, 'east', 1, 'people')
      expect(people.test(subject, solution, puzzle)).toBe(true)
      return
    }
  })
})
