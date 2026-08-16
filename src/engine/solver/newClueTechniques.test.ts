import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLevel } from '../io/LevelLoader.ts'
import { SearchSolver } from './SearchSolver.ts'
import { DeductionEngine } from './DeductionEngine.ts'
import { createClue, createBoardClue } from '../clues/index.ts'
import { VICTIM_ID } from '../model/types.ts'
import type { ClueJson } from '../clues/ClueFactory.ts'
import type { BoardClueJson, LevelJson } from '../io/LevelSchema.ts'
import type { Solution } from '../model/Solution.ts'
import type { Puzzle } from '../model/Puzzle.ts'
import type { PersonId } from '../model/types.ts'

/**
 * End-to-end soundness for the room-neighbourhood clues and the two counting board clues.
 *
 * The trick: take a bundled level (unique by construction), ADD a clue that is TRUE for its
 * reference solution, and check two things that must both hold for any correct clue:
 *
 *  1. the level stays uniquely solvable with the SAME solution — a true clue can never
 *     remove the true placement, so a drop to 0 solutions means `candidateCells` or
 *     `violatedBy` wrongly rejects a legal cell (the [[clue-candidatecells-soundness]] trap);
 *  2. the pure forward deduction never eliminates a person's TRUE cell — that is what makes
 *     a technique unsound, and it is invisible to a plain "does it solve" check.
 *
 * Running it over real boards of several sizes exercises the techniques far harder than a
 * hand-built fixture could.
 */
const dir = resolve(process.cwd(), 'levels')
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
const readLevel = (f: string): LevelJson => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))

/** One real board per size — broad coverage, still fast. */
const sample = [...new Set([4, 5, 6, 7, 8, 9].map((n) => files.find((f) => readLevel(f).size.width === n)))].filter(
  (f): f is string => f !== undefined,
)

/** The level with `clue` ANDed onto `id`'s existing clue (never replacing it). */
function withClue(base: LevelJson, id: PersonId, clue: ClueJson): LevelJson {
  return {
    ...base,
    suspects: base.suspects.map((s) =>
      s.id === id ? { ...s, clues: [{ type: 'and', clues: [...(s.clues ?? []), clue] } as ClueJson] } : s,
    ),
  }
}

/** Every room-neighbourhood clue that is TRUE for `subject` in `solution`. */
function trueNeighborClues(puzzle: Puzzle, solution: Solution, subject: PersonId): ClueJson[] {
  const board = puzzle.board
  const cell = solution.cellOf(subject)
  const room = board.roomIdOf(cell)
  const out: ClueJson[] = []
  for (const n of board.roomNeighbors(room)) out.push({ type: 'inRoomAdjacentTo', room: n })
  for (const s of puzzle.suspects) {
    if (s.id !== subject) out.push({ type: 'adjacentRooms', as: s.id })
  }
  out.push({ type: 'neighborRoomEmpty' })
  out.push({ type: 'not', clue: { type: 'neighborRoomEmpty' } })
  for (let count = 1; count <= puzzle.suspects.length; count++) {
    out.push({ type: 'neighborRoomCount', count })
    for (const dir of ['north', 'south', 'east', 'west'] as const) {
      out.push({ type: 'neighborRoomCount', count, dir })
    }
  }
  // Keep only the ones that genuinely hold — exactly what the generator's filter does.
  return out.filter((j) => createClue(j).test(subject, solution, puzzle))
}

/** Every counting board clue that is TRUE for `solution`. */
function trueBoardClues(puzzle: Puzzle, solution: Solution): BoardClueJson[] {
  const board = puzzle.board
  const out: BoardClueJson[] = []
  for (const scope of ['people', 'suspects'] as const) {
    const ids = scope === 'people' ? puzzle.allIds() : puzzle.suspects.map((s) => s.id)
    // Empty rooms count as 0 and must be included, or "at least"/"not exactly" would be wrong.
    const per = new Map<string, number>()
    for (const id of board.rooms.keys()) per.set(id, 0)
    for (const id of ids) {
      const r = board.roomIdOf(solution.cellOf(id))
      per.set(r, (per.get(r) ?? 0) + 1)
    }
    const counts = [...per.values()]
    const max = Math.max(...counts)
    const min = Math.min(...counts)
    out.push({ type: 'roomOccupancy', op: 'atMost', count: max, scope })
    out.push({ type: 'roomOccupancy', op: 'atLeast', count: min, scope })
    if (min === max) out.push({ type: 'roomOccupancy', op: 'exactly', count: min, scope })
    const present = new Set(counts)
    for (let n = 0; n <= max + 1; n++) {
      if (!present.has(n)) out.push({ type: 'roomOccupancy', op: 'notExactly', count: n, scope })
    }
  }
  if (board.cellsOutside(true).size > 0 && board.cellsOutside(false).size > 0) {
    for (const [attribute, value] of [
      ['gender', 'm'],
      ['gender', 'f'],
      ['beard', true],
      ['glasses', true],
    ] as const) {
      for (const scope of ['people', 'suspects'] as const) {
        if (scope === 'people' && attribute !== 'gender') continue
        const ids = scope === 'people' ? puzzle.allIds() : puzzle.suspects.map((s) => s.id)
        const carriers = ids.filter((id) => puzzle.attributesOf(id)[attribute] === value)
        if (carriers.length === 0) continue
        for (const area of ['inside', 'outside'] as const) {
          const count = carriers.filter(
            (id) => board.isOutside(solution.cellOf(id)) === (area === 'outside'),
          ).length
          if (count > 0) out.push({ type: 'countWithAttr', attribute, value, area, count, scope })
        }
      }
    }
  }
  return out.filter((c) => createBoardClue(c).test(solution, puzzle))
}

/** No forward-deduction step may ever eliminate a person's TRUE cell. */
function assertDeductionKeepsTruth(level: LevelJson, truth: Map<PersonId, number>, label: string): void {
  const puzzle = loadLevel(level)
  const result = new DeductionEngine(puzzle).solve()
  for (const step of result.steps) {
    for (const elim of step.eliminated ?? []) {
      const trueCell = truth.get(elim.personId)
      if (trueCell === undefined) continue
      expect(
        elim.cells.includes(trueCell),
        `${label}: technique "${step.technique}" eliminated ${elim.personId}'s TRUE cell ${trueCell}`,
      ).toBe(false)
    }
  }
  // Whenever it does finish, it must land on the real answer.
  if (result.solved && result.solution) {
    for (const [id, cell] of truth) expect(result.solution.cellOf(id)).toBe(cell)
  }
}

describe('new clues: adding a TRUE clue keeps the level solvable and the deduction sound', () => {
  for (const file of sample) {
    describe(`${file}`, () => {
      const base = readLevel(file)
      const puzzle = loadLevel(base)
      const solution = new SearchSolver(puzzle).firstSolution()
      const truth = new Map<PersonId, number>()
      if (solution) for (const [id, cell] of solution.entries()) truth.set(id, cell)

      it('reference level is unique', () => {
        expect(solution).not.toBeNull()
        expect(new SearchSolver(puzzle).countSolutions(2)).toBe(1)
      })

      it('room-neighbourhood clues (A1–A4)', () => {
        if (!solution) return
        let checked = 0
        for (const s of puzzle.suspects) {
          for (const clue of trueNeighborClues(puzzle, solution, s.id)) {
            const level = withClue(base, s.id, clue)
            const label = `${file} ${s.id} ${JSON.stringify(clue)}`
            // A clue TRUE for the solution can never rule that solution out.
            expect(new SearchSolver(loadLevel(level)).countSolutions(2), `${label}: lost the solution`).toBe(1)
            assertDeductionKeepsTruth(level, truth, label)
            checked++
          }
        }
        expect(checked, 'no neighbourhood clue was true anywhere — the test proves nothing').toBeGreaterThan(0)
      })

      it('counting board clues (B1, C1)', () => {
        if (!solution) return
        let checked = 0
        for (const bc of trueBoardClues(puzzle, solution)) {
          const level: LevelJson = { ...base, boardClues: [...(base.boardClues ?? []), bc] }
          const label = `${file} ${JSON.stringify(bc)}`
          expect(new SearchSolver(loadLevel(level)).countSolutions(2), `${label}: lost the solution`).toBe(1)
          assertDeductionKeepsTruth(level, truth, label)
          checked++
        }
        expect(checked).toBeGreaterThan(0)
      })
    })
  }
})

describe('new clue semantics against a real solution', () => {
  const file = sample[sample.length - 1]
  const base = readLevel(file)
  const puzzle = loadLevel(base)
  const solution = new SearchSolver(puzzle).firstSolution()!
  const board = puzzle.board

  it('adjacentRooms agrees with roomNeighbors for the real placement', () => {
    for (const a of puzzle.suspects) {
      for (const b of puzzle.suspects) {
        if (a.id === b.id) continue
        const ra = board.roomIdOf(solution.cellOf(a.id))
        const rb = board.roomIdOf(solution.cellOf(b.id))
        const clue = createClue({ type: 'adjacentRooms', as: b.id })
        expect(clue.test(a.id, solution, puzzle)).toBe(board.roomNeighbors(ra).has(rb))
      }
    }
  })

  it('neighborRoomEmpty counts a room with only the victim as OCCUPIED', () => {
    // The victim always shares its room with exactly one suspect, so "no suspect" and
    // "nobody at all" coincide — this pins that assumption down.
    const victimRoom = board.roomIdOf(solution.cellOf(VICTIM_ID))
    const suspectsThere = puzzle.suspects.filter(
      (s) => board.roomIdOf(solution.cellOf(s.id)) === victimRoom,
    )
    expect(suspectsThere.length).toBe(1)
  })

  /** Headcount per room for a scope, empty rooms included as 0. */
  const perRoom = (scope: 'people' | 'suspects'): number[] => {
    const ids = scope === 'people' ? puzzle.allIds() : puzzle.suspects.map((s) => s.id)
    const per = new Map<string, number>()
    for (const id of board.rooms.keys()) per.set(id, 0)
    for (const id of ids) {
      const r = board.roomIdOf(solution.cellOf(id))
      per.set(r, (per.get(r) ?? 0) + 1)
    }
    return [...per.values()]
  }

  it('roomOccupancy: every operator matches the real per-room counts', () => {
    for (const scope of ['people', 'suspects'] as const) {
      const counts = perRoom(scope)
      const max = Math.max(...counts)
      const min = Math.min(...counts)
      const holds = (op: 'atLeast' | 'atMost' | 'exactly' | 'notExactly', count: number) =>
        createBoardClue({ type: 'roomOccupancy', op, count, scope }).test(solution, puzzle)

      expect(holds('atMost', max)).toBe(true)
      expect(holds('atMost', max - 1)).toBe(false)
      expect(holds('atLeast', min)).toBe(true)
      expect(holds('atLeast', min + 1)).toBe(false)
      // "exactly" can only hold when every room agrees.
      expect(holds('exactly', min)).toBe(min === max)
      // "not exactly" is true precisely for the counts no room has.
      const present = new Set(counts)
      for (let n = 0; n <= max + 1; n++) expect(holds('notExactly', n)).toBe(!present.has(n))
    }
  })

  it('roomOccupancy: the murder rule fixes what the victim’s room forces', () => {
    // The victim's room always holds the victim + exactly one suspect. So over PEOPLE no
    // room can be forbidden the count 2, and over SUSPECTS none can be forbidden 1 —
    // these are the bounds the editor blocks.
    const victimRoom = board.roomIdOf(solution.cellOf(VICTIM_ID))
    const peopleThere = puzzle.allIds().filter((id) => board.roomIdOf(solution.cellOf(id)) === victimRoom)
    expect(peopleThere.length).toBe(2)
    expect(createBoardClue({ type: 'roomOccupancy', op: 'notExactly', count: 2, scope: 'people' }).test(solution, puzzle)).toBe(false)
    expect(createBoardClue({ type: 'roomOccupancy', op: 'notExactly', count: 1, scope: 'suspects' }).test(solution, puzzle)).toBe(false)
    expect(createBoardClue({ type: 'roomOccupancy', op: 'atMost', count: 1, scope: 'people' }).test(solution, puzzle)).toBe(false)
  })

  it('legacy everyRoomCount still loads as roomOccupancy/exactly', () => {
    const counts = perRoom('people')
    const uniform = new Set(counts).size === 1
    expect(createBoardClue({ type: 'everyRoomCount', count: counts[0] }).test(solution, puzzle)).toBe(uniform)
  })
})

// ---------------------------------------------------------------------------
// Exact offset from an anonymous anchor (offsetFrom / offsetFromObject)
// ---------------------------------------------------------------------------

/** Object types present anywhere on the board. */
function boardObjectTypes(puzzle: Puzzle): string[] {
  const board = puzzle.board
  const all = new Set<string>()
  for (let c = 0; c < board.width * board.height; c++) {
    for (const obj of board.tileAt(c).objects()) all.add(obj.type)
  }
  return [...all]
}

/** Every offsetFrom / offsetFromObject clue TRUE for `subject` in `solution` (deduped). */
function trueOffsetFromClues(puzzle: Puzzle, solution: Solution, subject: PersonId): ClueJson[] {
  const board = puzzle.board
  const { row, col } = board.rc(solution.cellOf(subject))
  const types = boardObjectTypes(puzzle)
  const out: ClueJson[] = []
  const deltasTo = (o: { row: number; col: number }): { dir: 'north' | 'south' | 'east' | 'west'; distance: number }[] => {
    const d: { dir: 'north' | 'south' | 'east' | 'west'; distance: number }[] = []
    if (o.col !== col) d.push({ dir: col > o.col ? 'east' : 'west', distance: Math.abs(col - o.col) })
    if (o.row !== row) d.push({ dir: row > o.row ? 'south' : 'north', distance: Math.abs(row - o.row) })
    return d
  }
  for (const id of puzzle.allIds()) {
    if (id === subject) continue
    const oCell = solution.cellOf(id)
    for (const { dir, distance } of deltasTo(board.rc(oCell))) {
      const g = puzzle.attributesOf(id).gender
      if (g === 'm' || g === 'f') {
        out.push({ type: 'offsetFrom', who: { kind: 'attr', attribute: 'gender', value: g }, dir, distance })
      }
      for (const t of types) {
        if (board.cellsNearObject(t).has(oCell)) {
          out.push({ type: 'offsetFrom', who: { kind: 'near', object: t }, dir, distance })
          if (id !== VICTIM_ID) {
            out.push({ type: 'offsetFrom', who: { kind: 'near', object: t }, dir, distance, scope: 'suspects' })
          }
        }
        if (board.cellsWithObject(t).has(oCell)) {
          out.push({ type: 'offsetFrom', who: { kind: 'on', object: t }, dir, distance })
          if (id !== VICTIM_ID) {
            out.push({ type: 'offsetFrom', who: { kind: 'on', object: t }, dir, distance, scope: 'suspects' })
          }
        }
      }
    }
  }
  for (const t of types) {
    for (const tileCell of board.objectCells(t)) {
      for (const { dir, distance } of deltasTo(board.rc(tileCell))) {
        for (const room of ['any', 'same', 'other'] as const) {
          out.push({ type: 'offsetFromObject', object: t, dir, distance, room })
        }
      }
    }
  }
  const seen = new Set<string>()
  return out.filter((j) => {
    const key = JSON.stringify(j)
    if (seen.has(key)) return false
    seen.add(key)
    return createClue(j).test(subject, solution, puzzle)
  })
}

describe('offsetFrom: adding a TRUE clue keeps the level solvable and the deduction sound', () => {
  // The technique must actually FIRE somewhere (see CLAUDE.md: a test that is green
  // because the technique never runs proves nothing) — counted across all samples.
  let fired = 0

  for (const file of sample) {
    it(`${file}`, () => {
      const base = readLevel(file)
      const puzzle = loadLevel(base)
      const solution = new SearchSolver(puzzle).firstSolution()
      expect(solution).not.toBeNull()
      if (!solution) return
      const truth = new Map<PersonId, number>()
      for (const [id, cell] of solution.entries()) truth.set(id, cell)

      let checked = 0
      for (const s of puzzle.suspects) {
        // Cap per suspect — each check runs a full uniqueness search + deduction.
        for (const clue of trueOffsetFromClues(puzzle, solution, s.id).slice(0, 8)) {
          const level = withClue(base, s.id, clue)
          const label = `${file} ${s.id} ${JSON.stringify(clue)}`
          expect(new SearchSolver(loadLevel(level)).countSolutions(2), `${label}: lost the solution`).toBe(1)
          const result = new DeductionEngine(loadLevel(level)).solve()
          for (const step of result.steps) {
            if (step.explanation.key.startsWith('clue.offsetFrom')) fired++
            for (const elim of step.eliminated ?? []) {
              const trueCell = truth.get(elim.personId)
              if (trueCell === undefined) continue
              expect(
                elim.cells.includes(trueCell),
                `${label}: technique "${step.technique}" eliminated ${elim.personId}'s TRUE cell ${trueCell}`,
              ).toBe(false)
            }
          }
          if (result.solved && result.solution) {
            for (const [id, cell] of truth) expect(result.solution.cellOf(id)).toBe(cell)
          }
          checked++
        }
      }
      expect(checked, 'no offsetFrom clue was true anywhere — the test proves nothing').toBeGreaterThan(0)
    })
  }

  it('the relational offsetFrom deduction fired at least once across the samples', () => {
    expect(fired).toBeGreaterThan(0)
  })
})
