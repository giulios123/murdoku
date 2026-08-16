import type { Clue } from './Clue.ts'
import { AndClue, OrClue, NotClue } from './compositeClues.ts'
import { RoomAttributeClue, RoomCompanionClue, RoomExistsClue, AloneWithClue } from './socialClues.ts'
import { AdjacentRoomsClue, DirectionClue, OffsetClue, OffsetFromPersonClue, SameRoomClue, InsideXorClue, DirectionFromAttrClue } from './relationalClues.ts'
import { BesideSameObjectClue } from './objectClues.ts'
import { OutsideClue } from './unaryClues.ts'
import { UniqueOutsideClue } from './uniquenessClues.ts'
import { CountWithAttrClue } from './boardClues.ts'
import type { AttributeValue, PersonId } from '../model/types.ts'
import type { Puzzle } from '../model/Puzzle.ts'

/**
 * Does ANY clue of this puzzle hinge on the indoor/outdoor split?
 *
 * `outside` is a per-room FLAG, and nothing on the board reveals it: the floor art is chosen
 * from the room's NAME, never from that flag. So whenever a clue leans on it, the panels must
 * spell out which rooms are outdoors — otherwise "exactly 2 men were inside" is unusable.
 *
 * Covers all three homes a clue can have: a suspect's own clues, the puzzle's global clues,
 * and the board clues (the trait-count clue names an area). Note `UniqueOutsideClue` does NOT
 * extend `OutsideClue` — it must be listed separately or "the only person outside" is missed.
 */
export function usesInsideOutside(puzzle: Puzzle): boolean {
  const inClue = (clue: Clue): boolean => {
    if (clue instanceof OutsideClue || clue instanceof UniqueOutsideClue || clue instanceof InsideXorClue) {
      return true
    }
    if (clue instanceof NotClue) return inClue(clue.inner)
    if (clue instanceof AndClue || clue instanceof OrClue) return clue.clues.some(inClue)
    return false
  }
  return (
    puzzle.suspects.some((s) => s.clues.some(inClue)) ||
    puzzle.globalClues.some(inClue) ||
    puzzle.boardClues.some((c) => c instanceof CountWithAttrClue)
  )
}

/** The traits and named people a clue points at — used to highlight the OTHER suspects a
 *  selected suspect's clue is "about" (everyone sharing a mentioned trait, plus any named
 *  person). Reading-only: it never reveals positions, just groups by visible appearance. */
interface ClueRefs {
  traits: { attribute: string; value: AttributeValue }[]
  persons: PersonId[]
}

function collect(clue: Clue, into: ClueRefs): void {
  if (clue instanceof AndClue || clue instanceof OrClue) {
    for (const c of clue.clues) collect(c, into)
    return
  }
  if (clue instanceof NotClue) {
    collect(clue.inner, into)
    return
  }
  if (
    clue instanceof RoomAttributeClue ||
    clue instanceof RoomCompanionClue ||
    clue instanceof DirectionFromAttrClue
  ) {
    into.traits.push({ attribute: clue.attribute, value: clue.value })
    return
  }
  if (clue instanceof OffsetFromPersonClue) {
    // Only the trait anchor names people by appearance; the object anchors don't.
    if (clue.who.kind === 'attr') {
      into.traits.push({ attribute: clue.who.attribute, value: clue.who.value })
    }
    return
  }
  if (clue instanceof AloneWithClue) {
    into.traits.push({ attribute: clue.attribute, value: clue.value })
    into.persons.push(...clue.people)
    return
  }
  if (clue instanceof RoomExistsClue) {
    if (clue.person) into.persons.push(clue.person)
    else if (clue.attribute) into.traits.push({ attribute: clue.attribute, value: clue.value })
    return
  }
  if (clue instanceof BesideSameObjectClue) {
    if (clue.mate.kind === 'person') into.persons.push(clue.mate.of)
    else if (clue.mate.kind === 'attr') {
      into.traits.push({ attribute: clue.mate.attribute, value: clue.mate.value })
    }
    return
  }
  if (
    clue instanceof DirectionClue ||
    clue instanceof OffsetClue ||
    clue instanceof SameRoomClue ||
    clue instanceof AdjacentRoomsClue ||
    clue instanceof InsideXorClue
  ) {
    into.persons.push(clue.target)
  }
}

/**
 * The OTHER suspects a suspect's clues refer to: every (other) suspect sharing a trait the
 * clues mention, plus any named suspect. Excludes the suspect themselves and the victim.
 * Drives the "select a suspect → matching cards pulse" highlight.
 */
export function relatedSuspects(
  clues: readonly Clue[],
  selfId: PersonId,
  puzzle: Puzzle,
): Set<PersonId> {
  const refs: ClueRefs = { traits: [], persons: [] }
  for (const c of clues) collect(c, refs)

  const out = new Set<PersonId>()
  const victim = puzzle.victim.id
  for (const p of refs.persons) if (p !== selfId && p !== victim) out.add(p)
  if (refs.traits.length > 0) {
    for (const s of puzzle.suspects) {
      if (s.id === selfId) continue
      const attrs = puzzle.attributesOf(s.id)
      if (refs.traits.some((t) => attrs[t.attribute] === t.value)) out.add(s.id)
    }
  }
  return out
}
