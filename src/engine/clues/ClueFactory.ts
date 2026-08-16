import { Clue } from './Clue.ts'
import {
  AtWallClue,
  CornerClue,
  InColClue,
  InRoomAdjacentToClue,
  InRoomClue,
  InRowClue,
  NearAnyObjectClue,
  NearDoorClue,
  NearObjectClue,
  NearWindowClue,
  OnObjectClue,
  OutsideClue,
} from './unaryClues.ts'
import {
  AdjacentRoomsClue,
  DirectionClue,
  DirectionFromAttrClue,
  InsideXorClue,
  OffsetClue,
  OffsetFromPersonClue,
  SameRoomClue,
} from './relationalClues.ts'
import type { OffsetAnchor, OffsetScope } from './relationalClues.ts'
import {
  BesideSameObjectClue,
  DirectionFromObjectClue,
  OffsetFromObjectClue,
  SameLineAsObjectClue,
  SameRoomAsObjectClue,
} from './objectClues.ts'
import type { LineKind, ObjectMate, RoomRel } from './objectClues.ts'
import {
  UniqueOnObjectClue,
  UniqueNearObjectClue,
  UniqueNearWindowClue,
  UniqueNearDoorClue,
  UniqueOutsideClue,
} from './uniquenessClues.ts'
import {
  AloneClue,
  AloneWithClue,
  NeighborRoomCountClue,
  NeighborRoomEmptyClue,
  NotAloneClue,
  RoomAttributeClue,
  RoomCompanionClue,
  RoomExistsClue,
} from './socialClues.ts'
import type { Quantifier, RoomExistsRelation } from './socialClues.ts'
import { AndClue, NotClue, OrClue } from './compositeClues.ts'
import type { AttributeValue, Direction, Direction8, PersonId } from '../model/types.ts'

/** JSON shape of a clue, mirroring the Clue class hierarchy. */
export type ClueJson =
  | { type: 'onObject'; object: string }
  | { type: 'nearObject'; object: string }
  | { type: 'nearObjectAny'; objects: string[] }
  | { type: 'nearWindow' }
  | { type: 'nearDoor' }
  | { type: 'inside' }
  | { type: 'outside' }
  | { type: 'inRoom'; room: string; occupancy?: 'alone' | 'notAlone' }
  /** In SOME room sharing a wall edge with `room` — never in `room` itself. */
  | { type: 'inRoomAdjacentTo'; room: string }
  | { type: 'inRow'; row: number }
  | { type: 'inCol'; col: number }
  | { type: 'corner' }
  | { type: 'atWall' }
  | { type: 'uniqueOnObject'; object: string }
  | { type: 'uniqueNearObject'; object: string }
  | { type: 'uniqueNearWindow' }
  | { type: 'uniqueNearDoor' }
  | { type: 'uniqueInside' }
  | { type: 'uniqueOutside' }
  | { type: 'alone' }
  | { type: 'notAlone' }
  /** At least one room bordering the subject's room holds nobody (negate → every one was occupied). */
  | { type: 'neighborRoomEmpty' }
  /** A room bordering the subject's — optionally lying ENTIRELY `dir` of them — holds exactly
   *  `count` suspects. */
  | { type: 'neighborRoomCount'; count: number; dir?: Direction }
  | {
      type: 'aloneWith'
      people: PersonId[]
      attribute: string
      value: AttributeValue
      extraCount: number
      dir?: Direction
    }
  | {
      type: 'roomAttribute'
      quantifier: Quantifier
      attribute: string
      value: AttributeValue
      excludeSelf?: boolean
      /** 'some' only: required number of matching others (default 1). */
      count?: number
      /** 'some' only: `count` is exact, not a lower bound. */
      exact?: boolean
    }
  | { type: 'direction'; of: PersonId; dir: Direction8 }
  | { type: 'directionFromAttr'; attribute: string; value: AttributeValue; dir: Direction8; quantifier?: 'some' | 'all' }
  | { type: 'insideXor'; with: PersonId }
  | { type: 'offset'; of: PersonId; dir: Direction; distance: number }
  /** Exactly `distance` rows/columns `dir` of an ANONYMOUS someone: a trait-bearer or
   *  a person on/beside an object. `scope` (object kinds only): 'people' counts the
   *  victim, 'suspects' does not; default 'people'. */
  | { type: 'offsetFrom'; who: OffsetAnchor; dir: Direction; distance: number; scope?: OffsetScope }
  /** Exactly `distance` rows/columns `dir` of AT LEAST ONE tile of the object type
   *  (∃; optional same/other-room qualifier). Deliberately no `at`/`all` readings —
   *  with an exact distance they collapse to a disguised row/column clue. */
  | { type: 'offsetFromObject'; object: string; dir: Direction; distance: number; room?: RoomRel }
  | { type: 'sameRoom'; as: PersonId; alone?: boolean }
  /** The two stand in DIFFERENT rooms that share a wall edge. Symmetric. */
  | { type: 'adjacentRooms'; as: PersonId }
  | { type: 'sameLineAsObject'; object: string; line: LineKind; room: RoomRel }
  /** `at` (cell index) anchors to ONE tile; `all` = every tile (∀); else any (∃). */
  | { type: 'directionFromObject'; object: string; dir: Direction8; room: RoomRel; at?: number; all?: boolean }
  | { type: 'sameRoomAsObject'; object: string; alone?: boolean }
  | { type: 'besideSameObject'; object: string; mate: ObjectMate; dir?: Direction8 }
  | { type: 'roomCompanion'; count: number; attribute: string; value: AttributeValue }
  | {
      type: 'roomExists'
      /** Omitted/null = anyone (unless `person` is set). */
      attribute?: string | null
      value?: AttributeValue
      /** A specific named suspect as the "someone" — overrides attribute/value. */
      person?: PersonId | null
      /** Required for 'on'/'near'; ignored for the board-position relations. */
      object?: string
      /** Where the companion stood: on/beside an object, or a board position. */
      relation?: RoomExistsRelation
    }
  | { type: 'not'; clue: ClueJson }
  | { type: 'and'; clues: ClueJson[] }
  | { type: 'or'; clues: ClueJson[] }

/** Build a Clue instance from its JSON representation. */
export function createClue(json: ClueJson): Clue {
  switch (json.type) {
    case 'onObject':
      return new OnObjectClue(json.object)
    case 'nearObject':
      return new NearObjectClue(json.object)
    case 'nearObjectAny':
      return new NearAnyObjectClue(json.objects)
    case 'nearWindow':
      return new NearWindowClue()
    case 'nearDoor':
      return new NearDoorClue()
    case 'inside':
      return new OutsideClue(false)
    case 'outside':
      return new OutsideClue(true)
    case 'inRoom':
      return new InRoomClue(json.room, json.occupancy ?? null)
    case 'inRoomAdjacentTo':
      return new InRoomAdjacentToClue(json.room)
    case 'inRow':
      return new InRowClue(json.row)
    case 'inCol':
      return new InColClue(json.col)
    case 'corner':
      return new CornerClue()
    case 'atWall':
      return new AtWallClue()
    case 'uniqueOnObject':
      return new UniqueOnObjectClue(json.object)
    case 'uniqueNearObject':
      return new UniqueNearObjectClue(json.object)
    case 'uniqueNearWindow':
      return new UniqueNearWindowClue()
    case 'uniqueNearDoor':
      return new UniqueNearDoorClue()
    case 'uniqueInside':
      return new UniqueOutsideClue(false)
    case 'uniqueOutside':
      return new UniqueOutsideClue(true)
    case 'alone':
      return new AloneClue()
    case 'notAlone':
      return new NotAloneClue()
    case 'neighborRoomEmpty':
      return new NeighborRoomEmptyClue()
    case 'neighborRoomCount':
      return new NeighborRoomCountClue(json.count, json.dir ?? null)
    case 'aloneWith':
      return new AloneWithClue(
        json.people,
        json.attribute,
        json.value,
        json.extraCount,
        json.dir ?? null,
      )
    case 'insideXor':
      return new InsideXorClue(json.with)
    case 'roomAttribute':
      return new RoomAttributeClue(
        json.quantifier,
        json.attribute,
        json.value,
        json.excludeSelf ?? false,
        json.count ?? 1,
        json.exact ?? false,
      )
    case 'direction':
      return new DirectionClue(json.of, json.dir)
    case 'directionFromAttr':
      return new DirectionFromAttrClue(json.attribute, json.value, json.dir, json.quantifier ?? 'some')
    case 'offset':
      return new OffsetClue(json.of, json.dir, json.distance)
    case 'offsetFrom':
      return new OffsetFromPersonClue(json.who, json.dir, json.distance, json.scope ?? 'people')
    case 'offsetFromObject':
      return new OffsetFromObjectClue(json.object, json.dir, json.distance, json.room ?? 'any')
    case 'sameRoom':
      return new SameRoomClue(json.as, json.alone ?? false)
    case 'adjacentRooms':
      return new AdjacentRoomsClue(json.as)
    case 'sameLineAsObject':
      return new SameLineAsObjectClue(json.object, json.line, json.room)
    case 'directionFromObject':
      return new DirectionFromObjectClue(json.object, json.dir, json.room, json.at ?? null, json.all ?? false)
    case 'sameRoomAsObject':
      return new SameRoomAsObjectClue(json.object, json.alone ?? false)
    case 'besideSameObject':
      return new BesideSameObjectClue(json.object, json.mate, json.dir ?? null)
    case 'roomCompanion':
      return new RoomCompanionClue(json.count, json.attribute, json.value)
    case 'roomExists':
      return new RoomExistsClue(
        json.attribute ?? null,
        json.value ?? true,
        json.object ?? '',
        json.relation ?? 'on',
        json.person ?? null,
      )
    case 'not':
      return new NotClue(createClue(json.clue))
    case 'and':
      return new AndClue(json.clues.map(createClue))
    case 'or':
      return new OrClue(json.clues.map(createClue))
  }
}
