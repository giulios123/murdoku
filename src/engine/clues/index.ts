export { Clue, UnaryClue } from './Clue.ts'
export {
  OnObjectClue,
  NearObjectClue,
  NearAnyObjectClue,
  NearWindowClue,
  NearDoorClue,
  OutsideClue,
  InRoomClue,
  InRoomAdjacentToClue,
  InRowClue,
  InColClue,
  CornerClue,
  AtWallClue,
} from './unaryClues.ts'
export {
  AdjacentRoomsClue,
  DirectionClue,
  DirectionFromAttrClue,
  InsideXorClue,
  OffsetClue,
  OffsetFromPersonClue,
  SameRoomClue,
} from './relationalClues.ts'
export type { OffsetAnchor, OffsetScope } from './relationalClues.ts'
export {
  SameLineAsObjectClue,
  SameRoomAsObjectClue,
  DirectionFromObjectClue,
  OffsetFromObjectClue,
  BesideSameObjectClue,
} from './objectClues.ts'
export type { LineKind, RoomRel } from './objectClues.ts'
export {
  UniqueOnObjectClue,
  UniqueNearObjectClue,
  UniqueNearWindowClue,
  UniqueNearDoorClue,
  UniqueOutsideClue,
} from './uniquenessClues.ts'
export {
  AloneClue,
  NotAloneClue,
  AloneWithClue,
  NeighborRoomCountClue,
  NeighborRoomEmptyClue,
  RoomAttributeClue,
  RoomCompanionClue,
  RoomExistsClue,
} from './socialClues.ts'
export type { Quantifier } from './socialClues.ts'
export { NotClue, AndClue, OrClue } from './compositeClues.ts'
export { createClue, KNOWN_CLUE_TYPES } from './ClueFactory.ts'
export type { ClueJson } from './ClueFactory.ts'
export { referencedTraitKinds, relatedSuspects, usesInsideOutside } from './clueRefs.ts'
export {
  BoardClue,
  CountOnObjectClue,
  CountWithAttrClue,
  EmptyRoomsClue,
  RoomOccupancyClue,
  createBoardClue,
} from './boardClues.ts'
export type { CountScope, OccupancyOp } from './boardClues.ts'
