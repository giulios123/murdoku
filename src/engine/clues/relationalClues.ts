import { Clue } from './Clue.ts'
import { ON_OBJECT_KEY_SUFFIX } from './unaryClues.ts'
import { inDirection8 } from '../model/types.ts'
import type { Board } from '../model/Board.ts'
import type { Solution } from '../model/Solution.ts'
import type { Puzzle } from '../model/Puzzle.ts'
import type { AttributeValue, Cell, Direction, Direction8, Explanation, PersonId } from '../model/types.ts'

/** "{name} and {target} were one inside and one outside." (opposite areas) */
export class InsideXorClue extends Clue {
  constructor(readonly target: PersonId) {
    super()
  }

  test(subjectId: PersonId, solution: Solution, puzzle: Puzzle): boolean {
    const a = puzzle.board.isOutside(solution.cellOf(subjectId))
    const b = puzzle.board.isOutside(solution.cellOf(this.target))
    return a !== b
  }

  override violatedBy(
    subjectId: PersonId,
    placement: ReadonlyMap<PersonId, Cell>,
    puzzle: Puzzle,
  ): boolean {
    const a = placement.get(subjectId)
    const b = placement.get(this.target)
    if (a === undefined || b === undefined) return false
    return puzzle.board.isOutside(a) === puzzle.board.isOutside(b)
  }

  describe(): Explanation {
    return { key: 'clue.insideXor', params: { target: this.target } }
  }
}

/**
 * "{name} was {direction} of {target}." Cardinals are half-planes (south = any
 * cell strictly below); diagonals mean BOTH cardinals (southwest = below AND
 * left), not only the diagonal line.
 */
export class DirectionClue extends Clue {
  constructor(
    readonly target: PersonId,
    readonly direction: Direction8,
  ) {
    super()
  }

  test(subjectId: PersonId, solution: Solution, puzzle: Puzzle): boolean {
    const s = puzzle.board.rc(solution.cellOf(subjectId))
    const t = puzzle.board.rc(solution.cellOf(this.target))
    return inDirection8(this.direction, s, t)
  }

  override violatedBy(
    subjectId: PersonId,
    placement: ReadonlyMap<PersonId, Cell>,
    puzzle: Puzzle,
  ): boolean {
    const s = placement.get(subjectId)
    const t = placement.get(this.target)
    if (s === undefined || t === undefined) return false
    return !inDirection8(this.direction, puzzle.board.rc(s), puzzle.board.rc(t))
  }

  describe(): Explanation {
    return {
      key: 'clue.direction',
      params: { direction: this.direction, target: this.target },
    }
  }
}

/** Existential ("of at least one matching person") vs universal ("of every one"). */
export type DirAttrQuantifier = 'some' | 'all'

/**
 * "{name} was {direction} of {some|all} people with a trait." The matching people are
 * the OTHER people (suspects + victim, never the subject) carrying attribute=value:
 *  - 'some' (∃): the subject is {direction} of AT LEAST ONE of them — weak, one-sided.
 *  - 'all'  (∀): the subject is {direction} of EVERY one of them — strong, two-sided.
 * Relational: depends on where the matching people stand (no fixed candidate set).
 */
export class DirectionFromAttrClue extends Clue {
  constructor(
    readonly attribute: string,
    readonly value: AttributeValue,
    readonly direction: Direction8,
    readonly quantifier: DirAttrQuantifier = 'some',
  ) {
    super()
  }

  /** Other people (suspects + victim, never the subject) carrying the trait. */
  matchers(subjectId: PersonId, puzzle: Puzzle): PersonId[] {
    return puzzle
      .allIds()
      .filter((id) => id !== subjectId && puzzle.attributesOf(id)[this.attribute] === this.value)
  }

  test(subjectId: PersonId, solution: Solution, puzzle: Puzzle): boolean {
    const s = puzzle.board.rc(solution.cellOf(subjectId))
    const matchers = this.matchers(subjectId, puzzle)
    const inDir = (id: PersonId) =>
      inDirection8(this.direction, s, puzzle.board.rc(solution.cellOf(id)))
    return this.quantifier === 'all' ? matchers.every(inDir) : matchers.some(inDir)
  }

  override violatedBy(
    subjectId: PersonId,
    placement: ReadonlyMap<PersonId, Cell>,
    puzzle: Puzzle,
  ): boolean {
    const s = placement.get(subjectId)
    if (s === undefined) return false
    const matchers = this.matchers(subjectId, puzzle)
    const sRc = puzzle.board.rc(s)
    const inDir = (c: Cell) => inDirection8(this.direction, sRc, puzzle.board.rc(c))
    if (this.quantifier === 'all') {
      // Violated as soon as ONE placed matcher is not in the direction.
      for (const id of matchers) {
        const c = placement.get(id)
        if (c !== undefined && !inDir(c)) return true
      }
      return false
    }
    // 'some': violated only when every matcher is placed and none qualifies.
    let allPlaced = true
    for (const id of matchers) {
      const c = placement.get(id)
      if (c === undefined) allPlaced = false
      else if (inDir(c)) return false
    }
    return allPlaced && matchers.length > 0
  }

  describe(): Explanation {
    const all = this.quantifier === 'all'
    // Gender uses a who-token ("mindestens einer Frau" / "allen Frauen"); other traits
    // reuse the attr.* token ("…, die einen Bart hatte/hatten").
    if (this.attribute === 'gender') {
      return {
        key: all ? 'clue.directionFromAttrGenderAll' : 'clue.directionFromAttrGenderSome',
        params: { direction: this.direction, who: all ? `${this.value}_all` : `${this.value}_dat` },
      }
    }
    const token = this.value === true ? this.attribute : `${this.attribute}_${this.value}`
    return {
      key: all ? 'clue.directionFromAttrTraitAll' : 'clue.directionFromAttrTraitSome',
      params: { direction: this.direction, attribute: token },
    }
  }
}

/**
 * "{name} was in the same room as {target}." With `alone`, the two share the room
 * AND nobody else is there (no other suspect, not even the victim) — "alone with X".
 */
export class SameRoomClue extends Clue {
  constructor(
    readonly target: PersonId,
    readonly alone = false,
  ) {
    super()
  }

  test(subjectId: PersonId, solution: Solution, puzzle: Puzzle): boolean {
    const board = puzzle.board
    const room = board.roomIdOf(solution.cellOf(subjectId))
    if (board.roomIdOf(solution.cellOf(this.target)) !== room) return false
    if (!this.alone) return true
    for (const id of puzzle.allIds()) {
      if (id === subjectId || id === this.target) continue
      if (board.roomIdOf(solution.cellOf(id)) === room) return false
    }
    return true
  }

  override violatedBy(
    subjectId: PersonId,
    placement: ReadonlyMap<PersonId, Cell>,
    puzzle: Puzzle,
  ): boolean {
    const board = puzzle.board
    const s = placement.get(subjectId)
    const t = placement.get(this.target)
    if (s !== undefined && t !== undefined && board.roomIdOf(s) !== board.roomIdOf(t)) return true
    if (this.alone && s !== undefined) {
      const room = board.roomIdOf(s)
      for (const [id, c] of placement) {
        if (id === subjectId || id === this.target) continue
        if (board.roomIdOf(c) === room) return true
      }
    }
    return false
  }

  describe(): Explanation {
    return { key: this.alone ? 'clue.aloneSameRoom' : 'clue.sameRoom', params: { target: this.target } }
  }
}

/**
 * "{name} and {target} were in adjoining rooms." — the two stand in DIFFERENT rooms that
 * share a wall edge. Symmetric. Being in the SAME room never satisfies it (a room is not its
 * own neighbour), so this is a genuine alternative to `SameRoomClue`, not a weaker form of it.
 * Relational: where the subject may stand depends on the target, so `candidateCells` stays
 * null and the pruning lives in `violatedBy` + the RelationalTechnique bound.
 */
export class AdjacentRoomsClue extends Clue {
  constructor(readonly target: PersonId) {
    super()
  }

  test(subjectId: PersonId, solution: Solution, puzzle: Puzzle): boolean {
    const board = puzzle.board
    const room = board.roomIdOf(solution.cellOf(subjectId))
    return board.roomNeighbors(room).has(board.roomIdOf(solution.cellOf(this.target)))
  }

  override violatedBy(
    subjectId: PersonId,
    placement: ReadonlyMap<PersonId, Cell>,
    puzzle: Puzzle,
  ): boolean {
    const s = placement.get(subjectId)
    const t = placement.get(this.target)
    if (s === undefined || t === undefined) return false
    const board = puzzle.board
    return !board.roomNeighbors(board.roomIdOf(s)).has(board.roomIdOf(t))
  }

  describe(): Explanation {
    return { key: 'clue.adjacentRooms', params: { target: this.target } }
  }
}

/** "{name} was exactly {distance} column(s)/row(s) {direction} of {target}." */
export class OffsetClue extends Clue {
  constructor(
    readonly target: PersonId,
    readonly direction: Direction,
    readonly distance: number,
  ) {
    super()
  }

  /** Whether this offset is along columns, and the signed delta to apply. */
  resolve(): { isColumn: boolean; delta: number } {
    const isColumn = this.direction === 'west' || this.direction === 'east'
    const negative = this.direction === 'west' || this.direction === 'north'
    return { isColumn, delta: negative ? -this.distance : this.distance }
  }

  test(subjectId: PersonId, solution: Solution, puzzle: Puzzle): boolean {
    const { isColumn, delta } = this.resolve()
    const s = puzzle.board.rc(solution.cellOf(subjectId))
    const t = puzzle.board.rc(solution.cellOf(this.target))
    const sc = isColumn ? s.col : s.row
    const tc = isColumn ? t.col : t.row
    return sc === tc + delta
  }

  override violatedBy(
    subjectId: PersonId,
    placement: ReadonlyMap<PersonId, Cell>,
    puzzle: Puzzle,
  ): boolean {
    const s = placement.get(subjectId)
    const t = placement.get(this.target)
    if (s === undefined || t === undefined) return false
    const { isColumn, delta } = this.resolve()
    const sub = puzzle.board.rc(s)
    const tar = puzzle.board.rc(t)
    const sc = isColumn ? sub.col : sub.row
    const tc = isColumn ? tar.col : tar.row
    return sc !== tc + delta
  }

  describe(): Explanation {
    const key =
      'clue.offset' + this.direction.charAt(0).toUpperCase() + this.direction.slice(1)
    return { key, params: { n: this.distance, target: this.target } }
  }
}

/** The anonymous anchor of an exact-offset clue: someone carrying a trait, or someone
 *  on/beside an object (instance-aware, `Board.isBesideObject` semantics). */
export type OffsetAnchor =
  | { kind: 'attr'; attribute: string; value: AttributeValue }
  | { kind: 'on' | 'near'; object: string }

/** Whether the anchor may be anyone (victim included) or only a suspect. Only the
 *  object kinds get the choice — a trait anchor picks its set implicitly (gender is
 *  shown for the victim so it counts; hidden traits never match it). */
export type OffsetScope = 'people' | 'suspects'

/**
 * "{name} was exactly {distance} row(s)/column(s) {direction} of someone …" where the
 * someone is anonymous: a trait-bearer, or a person on/beside an object. Existential —
 * at least one qualifying person sits at that exact line. In a full permutation each
 * line holds exactly ONE person, so the clue pins down WHO stands on the anchor line:
 * that person must qualify (the pigeonhole reading the techniques exploit).
 * Trait anchors match like `DirectionFromAttrClue` (all people except the subject).
 */
export class OffsetFromPersonClue extends Clue {
  constructor(
    readonly who: OffsetAnchor,
    readonly direction: Direction,
    readonly distance: number,
    readonly scope: OffsetScope = 'people',
  ) {
    super()
  }

  /** Whether this offset is along columns, and the signed delta (subject = anchor + delta). */
  resolve(): { isColumn: boolean; delta: number } {
    const isColumn = this.direction === 'west' || this.direction === 'east'
    const negative = this.direction === 'west' || this.direction === 'north'
    return { isColumn, delta: negative ? -this.distance : this.distance }
  }

  /** Cells where a person qualifies by POSITION (object kinds; null for a trait anchor). */
  anchorCells(board: Board): Set<Cell> | null {
    if (this.who.kind === 'attr') return null
    return this.who.kind === 'on'
      ? board.cellsWithObject(this.who.object)
      : board.cellsNearObject(this.who.object)
  }

  /** People other than the subject that could ever be the anchor. */
  matchers(subjectId: PersonId, puzzle: Puzzle): PersonId[] {
    const ids = puzzle.allIds().filter((id) => id !== subjectId)
    if (this.who.kind === 'attr') {
      const { attribute, value } = this.who
      return ids.filter((id) => puzzle.attributesOf(id)[attribute] === value)
    }
    return this.scope === 'suspects' ? ids.filter((id) => id !== puzzle.victim.id) : ids
  }

  /** Positional part of the qualifier (always true for trait anchors). */
  qualifiesAt(cell: Cell, board: Board): boolean {
    const cells = this.anchorCells(board)
    return cells === null || cells.has(cell)
  }

  test(subjectId: PersonId, solution: Solution, puzzle: Puzzle): boolean {
    const board = puzzle.board
    const { isColumn, delta } = this.resolve()
    const s = board.rc(solution.cellOf(subjectId))
    const anchorLine = (isColumn ? s.col : s.row) - delta
    for (const id of this.matchers(subjectId, puzzle)) {
      const cell = solution.cellOf(id)
      const rc = board.rc(cell)
      if ((isColumn ? rc.col : rc.row) !== anchorLine) continue
      if (this.qualifiesAt(cell, board)) return true
    }
    return false
  }

  protected override computeCandidateCells(board: Board): Set<Cell> | null {
    // Object anchors stand on FIXED cells, so the subject's possible lines are fixed
    // too: every anchor-cell line shifted by delta. Trait anchors move with people →
    // no fixed set (relational, pruned by the technique instead).
    const anchors = this.anchorCells(board)
    if (anchors === null) return null
    const { isColumn, delta } = this.resolve()
    const lines = new Set<number>()
    for (const a of anchors) {
      const rc = board.rc(a)
      lines.add((isColumn ? rc.col : rc.row) + delta)
    }
    const out = new Set<Cell>()
    for (const cell of board.occupiableCells()) {
      const rc = board.rc(cell)
      if (lines.has(isColumn ? rc.col : rc.row)) out.add(cell)
    }
    return out
  }

  override violatedBy(
    subjectId: PersonId,
    placement: ReadonlyMap<PersonId, Cell>,
    puzzle: Puzzle,
  ): boolean {
    const s = placement.get(subjectId)
    if (s === undefined) return false
    const board = puzzle.board
    const { isColumn, delta } = this.resolve()
    const rcS = board.rc(s)
    const anchorLine = (isColumn ? rcS.col : rcS.row) - delta
    if (anchorLine < 0 || anchorLine >= (isColumn ? board.width : board.height)) return true
    // One person per row/column (game rule): a placed person on the anchor line IS the
    // line's only occupant — if they don't qualify, the clue can never hold anymore.
    const matcherSet = new Set(this.matchers(subjectId, puzzle))
    let occupied = false
    let allMatchersPlaced = true
    let satisfied = false
    for (const id of puzzle.allIds()) {
      if (id === subjectId) continue
      const c = placement.get(id)
      if (c === undefined) {
        if (matcherSet.has(id)) allMatchersPlaced = false
        continue
      }
      const rc = board.rc(c)
      if ((isColumn ? rc.col : rc.row) !== anchorLine) continue
      occupied = true
      if (matcherSet.has(id) && this.qualifiesAt(c, board)) satisfied = true
    }
    if (satisfied) return false
    if (occupied) return true
    return allMatchersPlaced // nobody left who could still stand on the anchor line
  }

  describe(): Explanation {
    const { isColumn } = this.resolve()
    const axis = isColumn ? 'Cols' : 'Rows'
    const params: Record<string, string | number> = { n: this.distance, direction: this.direction }
    if (this.who.kind === 'attr') {
      // Gender uses a who-token ("einem Mann" — neutral, the victim counts); other
      // traits read as suspects (the victim's are hidden), via the attr.* token.
      if (this.who.attribute === 'gender') {
        return { key: `clue.offsetFromGender${axis}`, params: { ...params, who: `${this.who.value}_dat` } }
      }
      const token = this.who.value === true ? this.who.attribute : `${this.who.attribute}_${this.who.value}`
      return { key: `clue.offsetFromTrait${axis}`, params: { ...params, attribute: token } }
    }
    const who = this.scope === 'suspects' ? 'any_dat_susp' : 'any_dat'
    if (this.who.kind === 'near') {
      return { key: `clue.offsetFromNear${axis}`, params: { ...params, who, object: this.who.object } }
    }
    const suffix = ON_OBJECT_KEY_SUFFIX[this.who.object] ?? ''
    return { key: `clue.offsetFromOn${axis}${suffix}`, params: { ...params, who, object: this.who.object } }
  }
}
