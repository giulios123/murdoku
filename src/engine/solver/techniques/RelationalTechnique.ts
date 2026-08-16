import { Technique } from './Technique.ts'
import {
  AdjacentRoomsClue,
  DirectionClue,
  DirectionFromAttrClue,
  OffsetClue,
  OffsetFromPersonClue,
  SameRoomClue,
} from '../../clues/relationalClues.ts'
import { AndClue, NotClue } from '../../clues/compositeClues.ts'
import type { Clue } from '../../clues/Clue.ts'
import type { Axis, SolveContext } from '../SolveContext.ts'
import type { DeductionStep, Elimination } from '../DeductionStep.ts'
import type { PersonId } from '../../model/types.ts'
import type { Puzzle } from '../../model/Puzzle.ts'

type Relational =
  | DirectionClue
  | DirectionFromAttrClue
  | OffsetClue
  | OffsetFromPersonClue
  | SameRoomClue
  | AdjacentRoomsClue

function relationalClues(clue: Clue): Relational[] {
  if (
    clue instanceof DirectionClue ||
    clue instanceof DirectionFromAttrClue ||
    clue instanceof OffsetClue ||
    clue instanceof OffsetFromPersonClue ||
    clue instanceof SameRoomClue ||
    clue instanceof AdjacentRoomsClue
  ) {
    return [clue]
  }
  if (clue instanceof AndClue) return clue.clues.flatMap(relationalClues)
  return []
}

/** "NOT in the same room as X" — the people each suspect must be apart from. Only a
 *  PLAIN sameRoom negation gives this; NOT(alone-with) is weaker (could be together
 *  but not alone), so it's excluded. */
function differentRoomTargets(clue: Clue): PersonId[] {
  if (clue instanceof NotClue && clue.inner instanceof SameRoomClue && !clue.inner.alone) {
    return [clue.inner.target]
  }
  if (clue instanceof AndClue) return clue.clues.flatMap(differentRoomTargets)
  return []
}

/** "NOT in a room adjoining X's" — the people each suspect must be at least two rooms from.
 *  Note it still ALLOWS sharing a room: a room never adjoins itself. */
function notAdjacentTargets(clue: Clue): PersonId[] {
  if (clue instanceof NotClue && clue.inner instanceof AdjacentRoomsClue) return [clue.inner.target]
  if (clue instanceof AndClue) return clue.clues.flatMap(notAdjacentTargets)
  return []
}

/**
 * Bound propagation for relational clues:
 * - "south/north/east/west of X": the subject's row/column must beat one of X's
 *   possible rows/columns, and X's must beat one of the subject's.
 * - "same room as X": both are confined to the rooms they share.
 */
export class RelationalTechnique extends Technique {
  readonly name = 'relational'
  readonly difficulty = 3

  apply(ctx: SolveContext): DeductionStep | null {
    for (const suspect of ctx.puzzle.suspects) {
      if (ctx.state.placed.has(suspect.id)) continue
      for (const clue of suspect.clues.flatMap(relationalClues)) {
        let step: DeductionStep | null
        if (clue instanceof DirectionClue) step = this.applyDirection(ctx, suspect.id, clue)
        else if (clue instanceof DirectionFromAttrClue) step = this.applyDirectionAttr(ctx, suspect.id, clue)
        else if (clue instanceof OffsetClue) step = this.applyOffset(ctx, suspect.id, clue)
        else if (clue instanceof OffsetFromPersonClue) step = this.applyOffsetFrom(ctx, suspect.id, clue)
        else if (clue instanceof AdjacentRoomsClue) step = this.applyAdjacentRooms(ctx, suspect.id, clue)
        else step = this.applySameRoom(ctx, suspect.id, clue)
        if (step) return step
      }
    }
    // "Different room" — a placed/confined side keeps the other out of that room.
    // (Iterates all suspects: even a placed subject still constrains its target.)
    for (const suspect of ctx.puzzle.suspects) {
      for (const target of suspect.clues.flatMap(differentRoomTargets)) {
        const step = this.applyDifferentRoom(ctx, suspect.id, target)
        if (step) return step
      }
      // "NOT one room over" — same shape, but it strikes the target's NEIGHBOURS.
      for (const target of suspect.clues.flatMap(notAdjacentTargets)) {
        const step = this.applyNotAdjacentRooms(ctx, suspect.id, target)
        if (step) return step
      }
    }
    return null
  }

  override relevant(puzzle: Puzzle): boolean {
    for (const suspect of puzzle.suspects) {
      for (const clue of suspect.clues) {
        if (
          relationalClues(clue).length > 0 ||
          differentRoomTargets(clue).length > 0 ||
          notAdjacentTargets(clue).length > 0
        ) {
          return true
        }
      }
    }
    return false
  }

  /** The room a person is certainly in (placed cell, or whole domain in one room). */
  private roomOf(ctx: SolveContext, id: PersonId): string | null {
    const cell = ctx.state.placed.get(id)
    if (cell !== undefined) return ctx.roomOf(cell)
    return ctx.guaranteedRoomOf(id)
  }

  /** "{subject} not in the same room as {target}": if one is confined to a room, the
   *  other can't be in it. `removeFrom` skips a placed side, so both directions are safe. */
  private applyDifferentRoom(
    ctx: SolveContext,
    subjectId: PersonId,
    target: PersonId,
  ): DeductionStep | null {
    const subjRoom = this.roomOf(ctx, subjectId)
    const targetRoom = this.roomOf(ctx, target)
    const eliminated: Elimination[] = []
    if (subjRoom) this.removeFrom(ctx, target, (c) => ctx.roomOf(c) === subjRoom, eliminated)
    if (targetRoom) this.removeFrom(ctx, subjectId, (c) => ctx.roomOf(c) === targetRoom, eliminated)
    if (eliminated.length === 0) return null
    return {
      technique: 'relational',
      personId: subjectId,
      eliminated,
      explanation: { key: 'step.differentRoom', params: { name: subjectId, target } },
    }
  }

  /** "{subject} NOT in a room adjoining {target}'s": once one side is confined to a room,
   *  the other loses every room BORDERING it — but keeps that room itself, since a room does
   *  not adjoin itself. Mirrors applyDifferentRoom, which strikes the room instead. */
  private applyNotAdjacentRooms(
    ctx: SolveContext,
    subjectId: PersonId,
    target: PersonId,
  ): DeductionStep | null {
    const subjRoom = this.roomOf(ctx, subjectId)
    const targetRoom = this.roomOf(ctx, target)
    const eliminated: Elimination[] = []
    if (subjRoom) {
      const banned = ctx.board.roomNeighbors(subjRoom)
      this.removeFrom(ctx, target, (c) => banned.has(ctx.roomOf(c)), eliminated)
    }
    if (targetRoom) {
      const banned = ctx.board.roomNeighbors(targetRoom)
      this.removeFrom(ctx, subjectId, (c) => banned.has(ctx.roomOf(c)), eliminated)
    }
    if (eliminated.length === 0) return null
    return {
      technique: 'relational',
      personId: subjectId,
      eliminated,
      explanation: { key: 'step.notAdjacentRooms', params: { name: subjectId, target } },
    }
  }

  private removeFrom(
    ctx: SolveContext,
    id: PersonId,
    predicate: (cell: number) => boolean,
    out: Elimination[],
  ): void {
    if (ctx.state.placed.has(id)) return
    const removed = ctx.removeWhere(id, predicate)
    if (removed.length > 0) out.push({ personId: id, cells: removed })
  }

  private applyDirection(
    ctx: SolveContext,
    subjectId: PersonId,
    clue: DirectionClue,
  ): DeductionStep | null {
    // A Direction8 is up to TWO half-plane constraints, one per axis: a cardinal has one
    // ("north" = row-less), a diagonal both ("northwest" = row-less AND col-less). Applying
    // each keeps the propagation complete for diagonals (which used to prune only one axis).
    const d = clue.direction
    const eliminated: Elimination[] = []
    if (d.includes('north')) this.applyHalfPlane(ctx, subjectId, clue.target, 'row', false, eliminated)
    if (d.includes('south')) this.applyHalfPlane(ctx, subjectId, clue.target, 'row', true, eliminated)
    if (d.includes('east')) this.applyHalfPlane(ctx, subjectId, clue.target, 'col', true, eliminated)
    if (d.includes('west')) this.applyHalfPlane(ctx, subjectId, clue.target, 'col', false, eliminated)
    if (eliminated.length === 0) return null
    return {
      technique: 'relational',
      personId: subjectId,
      eliminated,
      explanation: {
        key: 'step.relationalDirection',
        params: { name: subjectId, direction: clue.direction, target: clue.target },
      },
    }
  }

  /** Prune one half-plane of a direction: the subject must beat the target along `axis`
   *  (`greater` = subject's line is larger, i.e. south/east), and the target must beat the
   *  subject the other way. Same bound as a plain cardinal, applied per component. */
  private applyHalfPlane(
    ctx: SolveContext,
    subjectId: PersonId,
    targetId: PersonId,
    axis: Axis,
    greater: boolean,
    eliminated: Elimination[],
  ): void {
    const subj = ctx.linesOf(subjectId, axis)
    const target = ctx.linesOf(targetId, axis)
    if (subj.size === 0 || target.size === 0) return
    if (greater) {
      const tgtMin = Math.min(...target)
      const subjMax = Math.max(...subj)
      this.removeFrom(ctx, subjectId, (c) => ctx.axisOf(c, axis) <= tgtMin, eliminated)
      this.removeFrom(ctx, targetId, (c) => ctx.axisOf(c, axis) >= subjMax, eliminated)
    } else {
      const tgtMax = Math.max(...target)
      const subjMin = Math.min(...subj)
      this.removeFrom(ctx, subjectId, (c) => ctx.axisOf(c, axis) >= tgtMax, eliminated)
      this.removeFrom(ctx, targetId, (c) => ctx.axisOf(c, axis) <= subjMin, eliminated)
    }
  }

  /** "{subject} {dir} of {some|all} matching people" (victim counts).
   *  - 'some' (∃): one-sided — the subject must beat the SMALLEST line any matcher can
   *    still occupy. The matchers can't be pruned (disjunction), so it's sound but weak.
   *  - 'all'  (∀): a conjunction — apply the two-sided per-target bound (like a plain
   *    "{dir} of X") to EVERY matcher, pruning both the subject and each matcher. */
  private applyDirectionAttr(
    ctx: SolveContext,
    subjectId: PersonId,
    clue: DirectionFromAttrClue,
  ): DeductionStep | null {
    const axis: Axis = clue.direction === 'north' || clue.direction === 'south' ? 'row' : 'col'
    const subj = ctx.linesOf(subjectId, axis)
    if (subj.size === 0) return null
    const matchers = clue.matchers(subjectId, ctx.puzzle)
    if (matchers.length === 0) return null
    const greater = clue.direction === 'south' || clue.direction === 'east'
    const eliminated: Elimination[] = []

    if (clue.quantifier === 'all') {
      const subjMax = Math.max(...subj)
      const subjMin = Math.min(...subj)
      for (const m of matchers) {
        const target = ctx.linesOf(m, axis)
        if (target.size === 0) continue
        if (greater) {
          const tgtMin = Math.min(...target)
          this.removeFrom(ctx, subjectId, (c) => ctx.axisOf(c, axis) <= tgtMin, eliminated)
          this.removeFrom(ctx, m, (c) => ctx.axisOf(c, axis) >= subjMax, eliminated)
        } else {
          const tgtMax = Math.max(...target)
          this.removeFrom(ctx, subjectId, (c) => ctx.axisOf(c, axis) >= tgtMax, eliminated)
          this.removeFrom(ctx, m, (c) => ctx.axisOf(c, axis) <= subjMin, eliminated)
        }
      }
    } else {
      const lines = new Set<number>()
      for (const m of matchers) for (const l of ctx.linesOf(m, axis)) lines.add(l)
      if (lines.size === 0) return null
      if (greater) {
        const tgtMin = Math.min(...lines)
        this.removeFrom(ctx, subjectId, (c) => ctx.axisOf(c, axis) <= tgtMin, eliminated)
      } else {
        const tgtMax = Math.max(...lines)
        this.removeFrom(ctx, subjectId, (c) => ctx.axisOf(c, axis) >= tgtMax, eliminated)
      }
    }
    if (eliminated.length === 0) return null
    return {
      technique: 'relational',
      personId: subjectId,
      eliminated,
      explanation: {
        key: 'step.relationalDirectionAttr',
        params: { name: subjectId, direction: clue.direction },
      },
    }
  }

  private applyOffset(
    ctx: SolveContext,
    subjectId: PersonId,
    clue: OffsetClue,
  ): DeductionStep | null {
    const { isColumn, delta } = clue.resolve()
    const axis: Axis = isColumn ? 'col' : 'row'
    const subj = ctx.linesOf(subjectId, axis)
    const target = ctx.linesOf(clue.target, axis)
    if (subj.size === 0 || target.size === 0) return null

    const allowedSubj = new Set([...target].map((c) => c + delta))
    const allowedTarget = new Set([...subj].map((c) => c - delta))
    const eliminated: Elimination[] = []
    this.removeFrom(ctx, subjectId, (c) => !allowedSubj.has(ctx.axisOf(c, axis)), eliminated)
    this.removeFrom(ctx, clue.target, (c) => !allowedTarget.has(ctx.axisOf(c, axis)), eliminated)
    if (eliminated.length === 0) return null

    const described = clue.describe()
    return {
      technique: 'relational',
      personId: subjectId,
      // `subject` lets a standalone reason NAME the subject ("Alysson war 1 Spalte westlich
      // von George") instead of the card pronoun ("sie war …") — see CluePanel's nameSubject.
      explanation: { key: described.key, params: { ...described.params, name: subjectId, subject: subjectId } },
    }
  }

  /**
   * "{subject} exactly N rows/cols {dir} of SOMEONE with a trait / on/beside an object."
   * Two sound prunings, both riding on "one person per row & column":
   * 1. Forward: the subject's line must be (line of some still-possible qualifying
   *    anchor) + delta — anchors are the matchers' remaining cells, intersected with
   *    the object cells for the on/near kinds.
   * 2. Pigeonhole back: once the subject's line is KNOWN, the anchor line k is fixed,
   *    and whoever occupies line k must qualify — non-matchers (e.g. the victim for a
   *    suspects-scoped clue) lose line k entirely, matchers keep only qualifying cells.
   */
  private applyOffsetFrom(
    ctx: SolveContext,
    subjectId: PersonId,
    clue: OffsetFromPersonClue,
  ): DeductionStep | null {
    const { isColumn, delta } = clue.resolve()
    const axis: Axis = isColumn ? 'col' : 'row'
    if (ctx.linesOf(subjectId, axis).size === 0) return null
    const matchers = clue.matchers(subjectId, ctx.puzzle)
    if (matchers.length === 0) return null
    const anchors = clue.anchorCells(ctx.board)

    const anchorLines = new Set<number>()
    for (const m of matchers) {
      for (const cell of ctx.cellsOf(m)) {
        if (anchors !== null && !anchors.has(cell)) continue
        anchorLines.add(ctx.axisOf(cell, axis))
      }
    }
    const allowedSubj = new Set([...anchorLines].map((l) => l + delta))
    const eliminated: Elimination[] = []
    this.removeFrom(ctx, subjectId, (c) => !allowedSubj.has(ctx.axisOf(c, axis)), eliminated)

    const subjNow = ctx.linesOf(subjectId, axis)
    if (subjNow.size === 1) {
      const k = [...subjNow][0] - delta
      const matcherSet = new Set(matchers)
      for (const person of ctx.people) {
        if (person.id === subjectId) continue
        if (!matcherSet.has(person.id)) {
          this.removeFrom(ctx, person.id, (c) => ctx.axisOf(c, axis) === k, eliminated)
        } else if (anchors !== null) {
          this.removeFrom(ctx, person.id, (c) => ctx.axisOf(c, axis) === k && !anchors.has(c), eliminated)
        }
      }
    }
    if (eliminated.length === 0) return null
    const described = clue.describe()
    return {
      technique: 'relational',
      personId: subjectId,
      eliminated,
      // `subject` lets a standalone reason NAME the subject (see applyOffset above).
      explanation: { key: described.key, params: { ...described.params, name: subjectId, subject: subjectId } },
    }
  }

  /**
   * "{subject} and {target} in adjoining rooms": each side must sit in a room bordering one
   * of the rooms the other can still reach, so each is confined to the union of the
   * neighbours of the other's possible rooms. Sound: a cell whose room borders NONE of them
   * can never satisfy the clue, whichever of those rooms the other side ends up in.
   * Symmetric, and it tightens as soon as either side's room set shrinks.
   */
  private applyAdjacentRooms(
    ctx: SolveContext,
    subjectId: PersonId,
    clue: AdjacentRoomsClue,
  ): DeductionStep | null {
    const subjRooms = ctx.roomsOf(subjectId)
    const targetRooms = ctx.roomsOf(clue.target)
    if (subjRooms.size === 0 || targetRooms.size === 0) return null

    const neighborsOf = (rooms: Set<string>): Set<string> => {
      const out = new Set<string>()
      for (const room of rooms) for (const n of ctx.board.roomNeighbors(room)) out.add(n)
      return out
    }
    const allowedSubj = neighborsOf(targetRooms)
    const allowedTarget = neighborsOf(subjRooms)

    const eliminated: Elimination[] = []
    this.removeFrom(ctx, subjectId, (c) => !allowedSubj.has(ctx.roomOf(c)), eliminated)
    this.removeFrom(ctx, clue.target, (c) => !allowedTarget.has(ctx.roomOf(c)), eliminated)
    if (eliminated.length === 0) return null
    return {
      technique: 'relational',
      personId: subjectId,
      eliminated,
      explanation: {
        key: 'step.relationalAdjacentRooms',
        params: { name: subjectId, target: clue.target },
      },
    }
  }

  private applySameRoom(
    ctx: SolveContext,
    subjectId: PersonId,
    clue: SameRoomClue,
  ): DeductionStep | null {
    const subjRooms = ctx.roomsOf(subjectId)
    const targetRooms = ctx.roomsOf(clue.target)
    if (subjRooms.size === 0 || targetRooms.size === 0) return null

    const eliminated: Elimination[] = []
    this.removeFrom(ctx, subjectId, (c) => !targetRooms.has(ctx.roomOf(c)), eliminated)
    this.removeFrom(ctx, clue.target, (c) => !subjRooms.has(ctx.roomOf(c)), eliminated)
    if (eliminated.length === 0) return null
    return {
      technique: 'relational',
      personId: subjectId,
      eliminated,
      explanation: {
        key: 'step.relationalSameRoom',
        params: { name: subjectId, target: clue.target },
      },
    }
  }
}
