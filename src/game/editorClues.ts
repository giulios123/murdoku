import { OCCUPIABLE_OBJECT_TYPES, HAIR_COLORS } from '../engine/index.ts'
import type { ClueJson } from '../engine/index.ts'
import type { AttributeValue, Direction, Direction8, LineKind, RoomRel } from '../engine/index.ts'
import { BEARD_STYLES, GLASSES_COLORS, GLASSES_SHAPES, HAIRSTYLE_IDS } from './avatar.ts'

/**
 * The flat clue builder: a suspect's clue is a list of conditions joined by ONE
 * connector (UND/ODER), each optionally negated (NICHT). This module owns the
 * editor-side condition shape and turns it into engine `ClueJson`.
 */

export type CondKind =
  // Raum — one hub for everything about the subject's room (incl. its NEIGHBOURING rooms)
  | 'room' // alone / in a specific room / same room as (person|object|trait|anyone) / someone on-beside an object / anything about an adjoining room
  | 'aloneWith' // alone with a named person + N others matching a trait
  // Objekte
  | 'onObject' // + optional "einzige" (unique)
  | 'nearObject' // + optional "einzige"
  | 'sameObject' // beside the same object instance as a person / trait / anyone
  | 'sameLineAsObject'
  // Lage am Brett
  | 'inout' // inside / outside, + optional "einzige"
  | 'portal' // window / door, + optional "einzige"
  | 'line' // row / column + value
  | 'boardPos' // in a corner / at a wall
  // Richtung & Abstand
  | 'direction' // 8-way direction from a person OR an object
  | 'offset' // exactly N cells in a cardinal direction of a person / a trait-bearer / someone on-beside an object / an object tile
  | 'insideXor'

/** The menu sections (optgroup headers), in order. `portal` is filtered out by the
 *  builder when the board has neither windows nor doors. */
export const COND_SECTIONS: { labelKey: string; kinds: CondKind[] }[] = [
  { labelKey: 'condGrp.room', kinds: ['room', 'aloneWith'] },
  { labelKey: 'condGrp.object', kinds: ['onObject', 'nearObject', 'sameObject', 'sameLineAsObject'] },
  { labelKey: 'condGrp.board', kinds: ['inout', 'portal', 'line', 'boardPos'] },
  { labelKey: 'condGrp.dir', kinds: ['direction', 'offset', 'insideXor'] },
]

/** Flat list of pickable kinds, in menu order (derived from the sections). */
export const COND_KINDS: CondKind[] = COND_SECTIONS.flatMap((s) => s.kinds)

/** Window vs door, for the merged "Fenster/Tür" condition. */
export type PortalKind = 'window' | 'door'
/** Inside vs outside, for the merged "Drinnen/Draußen" condition. */
export type InOutKind = 'inside' | 'outside'
/** Row vs column, for the merged "Zeile/Spalte" condition. */
export type AxisKind = 'row' | 'col'
/** The four cardinal directions (offset / aloneWith-direction use these). */
export const CARDINALS: Direction[] = ['north', 'south', 'east', 'west']

/** Line a person can share with an object (column / row / either). */
export const LINE_KINDS: LineKind[] = ['col', 'row', 'either']
/** Room qualifier for object clues (no constraint / same / different room). */
export const ROOM_RELS: RoomRel[] = ['any', 'same', 'other']
/** Eight compass directions, offered by BOTH the person- and object-direction
 *  clues (cardinals = half-plane, diagonals = both cardinals at once). */
export const DIRECTIONS_8: Direction8[] = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
]

export type Quantifier = 'none' | 'some' | 'all'
export const QUANTIFIERS: Quantifier[] = ['none', 'some', 'all']

/** Attributes usable in a room-attribute clue → the value they imply. */
export type AttrKind =
  | 'gender'
  | 'beard'
  | 'beardStyle'
  | 'glasses'
  | 'glassesShape'
  | 'glassesColor'
  | 'bald'
  | 'hair'
  | 'hairstyle'
export const ATTR_KINDS: AttrKind[] = [
  'gender',
  'beard',
  'beardStyle',
  'glasses',
  'glassesShape',
  'glassesColor',
  'bald',
  'hair',
  'hairstyle',
]
// Re-export the canonical list (defined in the engine) so editor-side consumers keep
// their import path, while editor and generator share ONE source of truth.
export { HAIR_COLORS }
/** Boolean traits (no value to pick — they're either present or not). */
export const BOOL_ATTRS: AttrKind[] = ['beard', 'glasses', 'bald']

/**
 * Valued attributes → their allowed values + the i18n prefix for the short
 * dropdown labels. Boolean attributes (beard/glasses/bald) are absent here.
 * Single source for both the clue value picker and the suspect-editor dropdowns.
 */
export const VALUED_ATTRS: Record<string, { values: string[]; labelKey: string }> = {
  gender: { values: ['m', 'f'], labelKey: 'genderVal' },
  hair: { values: [...HAIR_COLORS], labelKey: 'hairColor' },
  hairstyle: { values: [...HAIRSTYLE_IDS], labelKey: 'hairstyle' },
  beardStyle: { values: [...BEARD_STYLES], labelKey: 'beardStyle' },
  glassesShape: { values: [...GLASSES_SHAPES], labelKey: 'glassesShape' },
  glassesColor: { values: [...GLASSES_COLORS], labelKey: 'glassesColor' },
}

/** One row in the builder. Optional fields apply only to the matching `kind`. */
export interface Condition {
  kind: CondKind
  not: boolean
  room?: string // room(in) — room id char
  object?: string // onObject / nearObject / room(object|onObject) — object TYPE
  index?: number // line — 0-based row/column index
  of?: string // room(person) / direction(person) / insideXor — other suspect id
  dir?: Direction8 // direction — 8 compass directions
  at?: number // direction(object) — cell index of ONE object tile (undefined = any)
  quantifier?: Quantifier // room(with-trait) — none / some / all
  count?: number // room(with-trait, some) — how many matching companions (≥1, default 1)
  exact?: boolean // room(with-trait, some) — exactly `count` (true) vs at least `count` (false)
  /** Generator-constraint mode only: names of target fields the GENERATOR may choose
   *  freely (e.g. ['of'] = any person, ['object'] = any object, ['attribute','value'] =
   *  any trait). Empty/absent = the picked concrete values must match. Ignored when a
   *  condition is turned into a real clue. */
  wild?: string[]
  /** room(with-trait) / sameObject / room(onObject); 'any' = "irgendjemand". */
  attribute?: AttrKind | 'any' | 'object'
  value?: string // valued attribute (gender, hair, hairstyle, …)
  hair?: string // legacy roomAttribute value (read for old drafts; new ones use `value`)
  line?: LineKind // sameLineAsObject — column / row / either
  roomRel?: RoomRel // sameLineAsObject / direction(object) — room qualifier
  alone?: boolean // room — also requires being alone (no one else in the room)
  unique?: boolean // onObject / nearObject / portal / inout — the ONLY person there
  portal?: PortalKind // portal — window or door
  side?: InOutKind // inout — inside or outside
  axis?: AxisKind // line — row or column
  roomTarget?: 'person' | 'object' | 'attr' | 'anyone' // room(with) — shared with whom ('anyone' = not alone)
  dist?: number // offset — exact distance (≥1) in the cardinal direction
  objects?: string[] // nearObject — beside one of these object TYPES (1 = single, ≥2 = any)
  extraCount?: number // aloneWith — how many extra matching people share the room
  aloneDir?: 'none' | Direction // aloneWith — one extra is in this cardinal direction
  objTarget?: 'any' | 'person' | 'attr' // sameObject — who else is beside the same object
  objDir?: 'none' | Direction8 // sameObject — optional direction of the mate from subject
  objRel?: 'on' | 'near' | 'corner' | 'wall' | 'window' | 'door' // room(onObject) — where the companion stood (on/beside object, or a board position)
  /** room — which kind of room statement. The last three are about the ADJOINING rooms:
   *  'adjacent' = his room borders a named room / a person's room; 'neighborEmpty' = an
   *  empty room borders his; 'neighborCount' = a bordering room held exactly N suspects. */
  roomMode?: 'alone' | 'in' | 'with' | 'onObject' | 'adjacent' | 'neighborEmpty' | 'neighborCount'
  adjTarget?: 'room' | 'person' // room(adjacent) — borders a named room, or that person's room
  neighborDir?: 'none' | Direction // room(neighborCount) — the bordering room lies ENTIRELY this way (cardinals only: a diagonal would force the whole quadrant)
  /** direction/offset — relative to a person, an object (tile), a trait-bearer, or
   *  (offset only) an anonymous someone on/beside an object ('objectPerson'). */
  dirTarget?: 'person' | 'object' | 'attr' | 'objectPerson'
  scope?: 'people' | 'suspects' // offset(objectPerson) — "jemand" (incl. Opfer) vs. "ein Verdächtiger"
  pos?: 'corner' | 'wall' // boardPos — in a corner or at a wall
}

export interface ClueGroup {
  connector: 'and' | 'or'
  conditions: Condition[]
}

export function emptyClueGroup(): ClueGroup {
  return { connector: 'and', conditions: [] }
}

/** The (attribute, value) a room-attribute / companion condition encodes.
 *  ('any'/'object' never reach this — their builders handle them before.) */
function attrValue(c: Condition): { attribute: string; value: AttributeValue } {
  const attribute =
    c.attribute === 'any' || c.attribute === 'object' || !c.attribute ? 'beard' : c.attribute
  const spec = VALUED_ATTRS[attribute]
  if (spec) return { attribute, value: c.value ?? c.hair ?? spec.values[0] }
  return { attribute, value: true } // boolean traits: beard / glasses / bald
}

/** Convert one condition to its engine clue JSON (sans the NICHT wrapper).
 *  NOTE: `room` (mode 'in' + alone) folds its own NICHT in (see `condJson`). */
function baseJson(c: Condition): ClueJson | null {
  switch (c.kind) {
    case 'room': {
      // The "Im Raum …" hub. The aspect dropdown (roomMode) chooses which underlying
      // room clue is emitted — membership / alone / same-room-as / someone-on-object.
      const mode = c.roomMode ?? 'in'
      if (mode === 'alone') return { type: 'alone' } // NICHT → "nicht allein"
      // --- the ADJOINING-room aspects ---
      if (mode === 'adjacent') {
        // "in a room bordering X" — X is a named room (deducible on its own) or another
        // person's room (relational, and symmetric).
        if ((c.adjTarget ?? 'room') === 'person') {
          return c.of ? { type: 'adjacentRooms', as: c.of } : null
        }
        return c.room ? { type: 'inRoomAdjacentTo', room: c.room } : null
      }
      // NICHT → "no bordering room was empty" (the far stronger universal form).
      if (mode === 'neighborEmpty') return { type: 'neighborRoomEmpty' }
      if (mode === 'neighborCount') {
        const dir = c.neighborDir && c.neighborDir !== 'none' ? c.neighborDir : undefined
        // count 0 would just be "an empty bordering room" — that is `neighborEmpty`, and it
        // reads far better, so the count starts at 1.
        return { type: 'neighborRoomCount', count: Math.max(1, c.count ?? 1), ...(dir ? { dir } : {}) }
      }
      if (mode === 'in') {
        if (!c.room) return null
        // "allein" on → alone/not-alone in that room (NICHT flips which); off → plain
        // membership (the wrapper applies NICHT as "not in the room").
        if (c.alone) return { type: 'inRoom', room: c.room, occupancy: c.not ? 'notAlone' : 'alone' }
        return { type: 'inRoom', room: c.room }
      }
      if (mode === 'onObject') {
        // "In seinem Raum war <wer> <wo>": who = anyone / a named person / a trait;
        // where = on/beside an object, or a board position (corner/wall/window/door).
        const relation = c.objRel ?? 'on'
        const needsObject = relation === 'on' || relation === 'near'
        if (needsObject && !c.object) return null
        const objField = needsObject ? { object: c.object } : {}
        const target =
          c.roomTarget === 'person' || c.roomTarget === 'attr' || c.roomTarget === 'anyone'
            ? c.roomTarget
            : !c.attribute || c.attribute === 'any' || c.attribute === 'object'
              ? 'anyone'
              : 'attr'
        if (target === 'person') {
          return c.of ? { type: 'roomExists', person: c.of, relation, ...objField } : null
        }
        if (target === 'attr') {
          const { attribute, value } = attrValue(c)
          return { type: 'roomExists', attribute, value, relation, ...objField }
        }
        return { type: 'roomExists', relation, ...objField }
      }
      // mode === 'with' — same room as a person / object / trait / anyone.
      const alone = c.alone ? { alone: true as const } : {}
      const target = c.roomTarget ?? 'person'
      // "with anyone" = simply not alone; NICHT then flips it to "alone".
      if (target === 'anyone') return { type: 'notAlone' }
      if (target === 'attr') {
        const { attribute, value } = attrValue(c)
        const quantifier = c.quantifier ?? 'some'
        if (quantifier === 'some') {
          const count = Math.max(1, c.count ?? 1)
          // "jemand mit Merkmal" + allein = exactly `count` matching companions, room
          // otherwise empty.
          if (c.alone) return { type: 'roomCompanion', count, attribute, value }
          // "≥ count" by default, "exactly count" when the genau/mindestens toggle is set.
          // Omit the defaults (count 1, at-least) so unchanged levels keep their old JSON.
          return {
            type: 'roomAttribute',
            quantifier: 'some',
            attribute,
            value,
            excludeSelf: true,
            ...(count > 1 ? { count } : {}),
            ...(c.exact ? { exact: true } : {}),
          }
        }
        return { type: 'roomAttribute', quantifier, attribute, value, excludeSelf: true }
      }
      if (target === 'object') {
        return c.object ? { type: 'sameRoomAsObject', object: c.object, ...alone } : null
      }
      return c.of ? { type: 'sameRoom', as: c.of, ...alone } : null
    }
    case 'boardPos':
      return c.pos === 'wall' ? { type: 'atWall' } : { type: 'corner' }
    case 'onObject':
      if (!c.object) return null
      return c.unique
        ? { type: 'uniqueOnObject', object: c.object }
        : { type: 'onObject', object: c.object }
    case 'nearObject': {
      // Multi-select: one object → nearObject (with optional "einzige"); several →
      // nearObjectAny ("beside one of these"). Avoids a separate clue type.
      const objs = c.objects ?? []
      if (objs.length === 0) return null
      if (objs.length === 1) {
        return c.unique
          ? { type: 'uniqueNearObject', object: objs[0] }
          : { type: 'nearObject', object: objs[0] }
      }
      return { type: 'nearObjectAny', objects: objs }
    }
    case 'portal':
      return c.portal === 'door'
        ? c.unique
          ? { type: 'uniqueNearDoor' }
          : { type: 'nearDoor' }
        : c.unique
          ? { type: 'uniqueNearWindow' }
          : { type: 'nearWindow' }
    case 'inout':
      return c.side === 'outside'
        ? c.unique
          ? { type: 'uniqueOutside' }
          : { type: 'outside' }
        : c.unique
          ? { type: 'uniqueInside' }
          : { type: 'inside' }
    case 'line':
      return c.axis === 'col'
        ? { type: 'inCol', col: c.index ?? 0 }
        : { type: 'inRow', row: c.index ?? 0 }
    case 'sameLineAsObject':
      return c.object
        ? { type: 'sameLineAsObject', object: c.object, line: c.line ?? 'col', room: c.roomRel ?? 'any' }
        : null
    case 'sameObject': {
      if (!c.object) return null
      const kind = c.objTarget ?? 'any'
      const dir = c.objDir && c.objDir !== 'none' ? c.objDir : undefined
      const mate =
        kind === 'person'
          ? c.of
            ? ({ kind: 'person', of: c.of } as const)
            : null
          : kind === 'attr'
            ? ({ kind: 'attr', ...attrValue(c) } as const)
            : ({ kind: 'any' } as const)
      if (!mate) return null
      return { type: 'besideSameObject', object: c.object, mate, ...(dir ? { dir } : {}) }
    }
    case 'direction': {
      // Merged "Richtung von …": relative to a person, an object, OR a trait-bearer.
      // For object/attr the `quantifier` chooses ∃ ('some') vs ∀ ('all'); a specific
      // object tile (`at`) overrides the quantifier (it's that one tile).
      const all = c.quantifier === 'all'
      if (c.dirTarget === 'object') {
        return c.object
          ? {
              type: 'directionFromObject',
              object: c.object,
              dir: c.dir ?? 'north',
              room: c.roomRel ?? 'any',
              ...(c.at !== undefined ? { at: c.at } : all ? { all: true } : {}),
            }
          : null
      }
      if (c.dirTarget === 'attr') {
        const { attribute, value } = attrValue(c)
        return { type: 'directionFromAttr', attribute, value, dir: c.dir ?? 'north', quantifier: all ? 'all' : 'some' }
      }
      return c.of ? { type: 'direction', of: c.of, dir: c.dir ?? 'north' } : null
    }
    case 'offset': {
      // "exactly N cells {cardinal} of …": a person, a trait-bearer, someone on/beside
      // an object (with the "jemand"/"Verdächtiger" scope), or an object tile itself.
      const dist = Math.max(1, c.dist ?? 1)
      const dir = (c.dir as Direction) ?? 'east'
      const target = c.dirTarget ?? 'person'
      if (target === 'attr') {
        const { attribute, value } = attrValue(c)
        return { type: 'offsetFrom', who: { kind: 'attr', attribute, value }, dir, distance: dist }
      }
      if (target === 'objectPerson') {
        if (!c.object) return null
        const kind = c.objRel === 'near' ? ('near' as const) : ('on' as const)
        // Omit the default scope ('people') so unchanged levels keep their old JSON.
        return {
          type: 'offsetFrom',
          who: { kind, object: c.object },
          dir,
          distance: dist,
          ...(c.scope === 'suspects' ? { scope: 'suspects' as const } : {}),
        }
      }
      if (target === 'object') {
        return c.object
          ? { type: 'offsetFromObject', object: c.object, dir, distance: dist, room: c.roomRel ?? 'any' }
          : null
      }
      return c.of ? { type: 'offset', of: c.of, dir, distance: dist } : null
    }
    case 'insideXor':
      return c.of ? { type: 'insideXor', with: c.of } : null
    case 'aloneWith': {
      if (!c.of) return null
      const { attribute, value } = attrValue(c)
      const dir = c.aloneDir && c.aloneDir !== 'none' ? c.aloneDir : undefined
      return {
        type: 'aloneWith',
        people: [c.of],
        attribute,
        value,
        extraCount: Math.max(0, c.extraCount ?? 1),
        ...(dir ? { dir } : {}),
      }
    }
  }
}

function condJson(c: Condition): ClueJson | null {
  const base = baseJson(c)
  if (!base) return null
  // "in Raum X + allein" folds NICHT into alone/notAlone already — don't double-negate.
  if (c.kind === 'room' && c.roomMode === 'in' && c.alone) return base
  return c.not ? { type: 'not', clue: base } : base
}

/** Turn a builder group into the `clues` array of a SuspectJson (0 or 1 entries). */
export function groupToClues(group: ClueGroup): ClueJson[] {
  const parts = group.conditions.map(condJson).filter((j): j is ClueJson => j !== null)
  if (parts.length === 0) return []
  if (parts.length === 1) return [parts[0]]
  return [{ type: group.connector, clues: parts }]
}

/** Reverse of `condJson`: turn one engine clue back into a builder condition.
 *  Returns null for clue types the flat builder can't represent (nested and/or). */
function jsonToCondition(json: ClueJson): Condition | null {
  let not = false
  let c: ClueJson = json
  if (c.type === 'not') {
    not = true
    c = c.clue
  }
  const make = (kind: CondKind, extra: Partial<Condition> = {}): Condition => ({
    kind,
    not,
    dir: 'north',
    line: 'col',
    roomRel: 'any',
    quantifier: 'some',
    count: 1,
    exact: false,
    attribute: 'beard',
    value: 'blond',
    index: 0,
    unique: false,
    portal: 'window',
    side: 'inside',
    axis: 'row',
    dist: 1,
    objects: [],
    extraCount: 1,
    aloneDir: 'none',
    objTarget: 'any',
    objDir: 'none',
    objRel: 'on',
    roomMode: 'in',
    roomTarget: 'person',
    adjTarget: 'room',
    neighborDir: 'none',
    dirTarget: 'person',
    scope: 'people',
    pos: 'corner',
    ...extra,
  })
  switch (c.type) {
    case 'inRoom':
      if (!c.occupancy) return make('room', { roomMode: 'in', room: c.room })
      return make('room', { roomMode: 'in', room: c.room, alone: true, not: c.occupancy === 'notAlone' })
    case 'inRoomAdjacentTo':
      return make('room', { roomMode: 'adjacent', adjTarget: 'room', room: c.room })
    case 'adjacentRooms':
      return make('room', { roomMode: 'adjacent', adjTarget: 'person', of: c.as })
    case 'neighborRoomEmpty':
      return make('room', { roomMode: 'neighborEmpty' })
    case 'neighborRoomCount':
      return make('room', { roomMode: 'neighborCount', count: c.count, neighborDir: c.dir ?? 'none' })
    case 'onObject':
      return make('onObject', { object: c.object, unique: false })
    case 'uniqueOnObject':
      return make('onObject', { object: c.object, unique: true })
    case 'nearObject':
      return make('nearObject', { objects: [c.object], unique: false })
    case 'uniqueNearObject':
      return make('nearObject', { objects: [c.object], unique: true })
    case 'sameLineAsObject':
      return make('sameLineAsObject', { object: c.object, line: c.line, roomRel: c.room })
    case 'directionFromObject':
      return make('direction', {
        dirTarget: 'object',
        object: c.object,
        dir: c.dir,
        roomRel: c.room,
        at: c.at,
        quantifier: c.all ? 'all' : 'some',
      })
    case 'besideSameObject': {
      const m = c.mate
      return make('sameObject', {
        object: c.object,
        objTarget: m.kind,
        of: m.kind === 'person' ? m.of : undefined,
        attribute: m.kind === 'attr' ? (m.attribute as AttrKind) : undefined,
        value: m.kind === 'attr' && typeof m.value === 'string' ? m.value : undefined,
        objDir: c.dir ?? 'none',
      })
    }
    case 'sameRoomAsObject':
      return make('room', { roomMode: 'with', roomTarget: 'object', object: c.object, alone: c.alone })
    case 'nearWindow':
      return make('portal', { portal: 'window', unique: false })
    case 'uniqueNearWindow':
      return make('portal', { portal: 'window', unique: true })
    case 'nearDoor':
      return make('portal', { portal: 'door', unique: false })
    case 'uniqueNearDoor':
      return make('portal', { portal: 'door', unique: true })
    case 'inside':
      return make('inout', { side: 'inside', unique: false })
    case 'outside':
      return make('inout', { side: 'outside', unique: false })
    case 'uniqueInside':
      return make('inout', { side: 'inside', unique: true })
    case 'uniqueOutside':
      return make('inout', { side: 'outside', unique: true })
    case 'inRow':
      return make('line', { axis: 'row', index: c.row })
    case 'inCol':
      return make('line', { axis: 'col', index: c.col })
    case 'corner':
      return make('boardPos', { pos: 'corner' })
    case 'atWall':
      return make('boardPos', { pos: 'wall' })
    case 'alone':
      // The room hub's "war allein" aspect.
      return make('room', { roomMode: 'alone' })
    case 'notAlone':
      // The room hub's "im selben Raum wie irgendjemand" (= not alone) aspect.
      return make('room', { roomMode: 'with', roomTarget: 'anyone' })
    case 'sameRoom':
      return make('room', { roomMode: 'with', roomTarget: 'person', of: c.as, alone: c.alone })
    case 'roomCompanion':
      // "alone with `count` matching people" → the trait target + allein in the room hub.
      return make('room', {
        roomMode: 'with',
        roomTarget: 'attr',
        quantifier: 'some',
        alone: true,
        count: Math.max(1, c.count),
        attribute: c.attribute as AttrKind,
        value: typeof c.value === 'string' ? c.value : undefined,
      })
    case 'direction':
      return make('direction', { dirTarget: 'person', of: c.of, dir: c.dir })
    case 'directionFromAttr':
      return make('direction', {
        dirTarget: 'attr',
        attribute: c.attribute as AttrKind,
        value: typeof c.value === 'string' ? c.value : undefined,
        dir: c.dir,
        quantifier: c.quantifier ?? 'some',
      })
    case 'offset':
      return make('offset', { dirTarget: 'person', of: c.of, dir: c.dir, dist: c.distance })
    case 'offsetFrom':
      if (c.who.kind === 'attr') {
        return make('offset', {
          dirTarget: 'attr',
          attribute: c.who.attribute as AttrKind,
          value: typeof c.who.value === 'string' ? c.who.value : undefined,
          dir: c.dir,
          dist: c.distance,
        })
      }
      return make('offset', {
        dirTarget: 'objectPerson',
        object: c.who.object,
        objRel: c.who.kind,
        scope: c.scope ?? 'people',
        dir: c.dir,
        dist: c.distance,
      })
    case 'offsetFromObject':
      return make('offset', {
        dirTarget: 'object',
        object: c.object,
        roomRel: c.room ?? 'any',
        dir: c.dir,
        dist: c.distance,
      })
    case 'insideXor':
      return make('insideXor', { of: c.with })
    case 'roomAttribute':
      return make('room', {
        roomMode: 'with',
        roomTarget: 'attr',
        quantifier: c.quantifier,
        count: c.count ?? 1,
        exact: c.exact ?? false,
        attribute: c.attribute as AttrKind,
        value: typeof c.value === 'string' ? c.value : undefined,
      })
    case 'roomExists':
      return make('room', {
        roomMode: 'onObject',
        roomTarget: c.person ? 'person' : c.attribute ? 'attr' : 'anyone',
        of: c.person ?? undefined,
        attribute: (c.attribute ?? 'any') as AttrKind | 'any',
        value: typeof c.value === 'string' ? c.value : undefined,
        ...(c.object ? { object: c.object } : {}),
        objRel: c.relation ?? 'on',
      })
    case 'aloneWith':
      return make('aloneWith', {
        of: c.people[0],
        attribute: c.attribute as AttrKind,
        value: typeof c.value === 'string' ? c.value : undefined,
        extraCount: c.extraCount,
        aloneDir: c.dir ?? 'none',
      })
    case 'nearObjectAny':
      return make('nearObject', { objects: c.objects })
    default:
      return null
  }
}

/** Turn a SuspectJson `clues` array back into a builder group (inverse of
 *  `groupToClues`). Unrepresentable parts are dropped. */
export function cluesToGroup(clues: ClueJson[] | undefined): ClueGroup {
  if (!clues || clues.length === 0) return emptyClueGroup()
  const top = clues[0]
  if (top.type === 'and' || top.type === 'or') {
    const conditions = top.clues.map(jsonToCondition).filter((x): x is Condition => x !== null)
    return { connector: top.type, conditions }
  }
  const one = jsonToCondition(top)
  return { connector: 'and', conditions: one ? [one] : [] }
}

/** A fresh condition of a given kind, with sensible defaults for its fields. */
export function defaultCondition(
  kind: CondKind,
  ctx: {
    rooms: string[]
    objects: string[]
    others: { id: string }[]
    hasWindows?: boolean
    hasDoors?: boolean
  },
): Condition {
  return {
    kind,
    not: false,
    room: ctx.rooms[0],
    // "on object" and the room hub (which can switch to its on/beside-object aspect)
    // need a tile a person can stand ON; pre-pick an occupiable object for those.
    object:
      kind === 'onObject' || kind === 'room'
        ? (ctx.objects.find((o) => OCCUPIABLE_OBJECT_TYPES.includes(o)) ?? ctx.objects[0])
        : ctx.objects[0],
    index: 0,
    of: ctx.others[0]?.id,
    dir: 'north',
    quantifier: 'some',
    count: 1,
    exact: false,
    attribute: 'beard',
    value: 'blond',
    line: 'col',
    roomRel: 'any',
    alone: false,
    unique: false,
    portal: ctx.hasWindows === false && ctx.hasDoors ? 'door' : 'window',
    side: 'inside',
    axis: 'row',
    roomMode: 'in',
    roomTarget: 'person',
    adjTarget: 'room',
    neighborDir: 'none',
    dirTarget: 'person',
    scope: 'people',
    pos: 'corner',
    dist: 1,
    objects: kind === 'nearObject' && ctx.objects[0] ? [ctx.objects[0]] : [],
    extraCount: 1,
    aloneDir: 'none',
    objTarget: 'any',
    objDir: 'none',
    objRel: 'on',
  }
}

/* ---------------------------------------------------------------------------
 * Generator constraints ("Zufällig setzen mit Vorgaben")
 *
 * A palette is a list of conditions used as TEMPLATES: the generator may only emit
 * clues whose shape matches one of them. A template's `wild` names the target fields
 * the generator chooses freely; all other (structural) fields must match exactly.
 * ------------------------------------------------------------------------- */

/** Target fields the "Generator wählt" toggle frees (besides `of`, which is always
 *  free in the editor — the suspects don't exist yet, so no concrete person to pick). */
export const TEMPLATE_TARGET_FIELDS = [
  'object',
  'objects',
  'attribute',
  'value',
  'room',
  'index',
  'at',
] as const

/** Deterministic, key-sorted JSON so two clues compare equal regardless of key order. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`
}

/** Does a concrete candidate clue match a palette template? Same kind, all NON-wild
 *  fields equal. We reuse the round-trip-safe `jsonToCondition`/`condJson`: convert the
 *  candidate to a condition, copy the template's WILD fields from it (so they always
 *  agree), then compare the re-emitted JSON. Concrete fields therefore must match, wild
 *  fields match anything. */
function condMatchesTemplate(json: ClueJson, tmpl: Condition): boolean {
  const cc = jsonToCondition(json)
  if (!cc || cc.kind !== tmpl.kind) return false
  const filledRec = { ...tmpl } as unknown as Record<string, unknown>
  const ccRec = cc as unknown as Record<string, unknown>
  for (const f of tmpl.wild ?? []) filledRec[f] = ccRec[f]
  const a = condJson(filledRec as unknown as Condition)
  const b = condJson(cc)
  return a !== null && b !== null && stableStringify(a) === stableStringify(b)
}

/** One matcher PER template: each must be satisfied by at least one clue in the
 *  generated level ("use these clue types"); the generator fills the rest freely.
 *  Returns undefined for an empty palette (= no constraints). */
export function makeClueMatchers(
  palette: Condition[] | undefined,
): ((json: ClueJson) => boolean)[] | undefined {
  if (!palette || palette.length === 0) return undefined
  return palette.map((t) => (json: ClueJson) => condMatchesTemplate(json, t))
}

/** Pinned trait values from a "Vorgaben" palette: for each condition that names a CONCRETE
 *  trait value (not freed via `wild`, not negated, not a 'none' shape), its (attribute,
 *  value) and how many companions it needs. The generator biases its random trait
 *  assignment with these so enough suspects carry the value — otherwise an existence clue
 *  like "≥1 other with hair=white in the room" can never become true. Free ("Generator
 *  wählt") values are skipped; those already work. */
export function requiredAttrSeeds(
  palette: Condition[] | undefined,
): { attribute: string; value: AttributeValue; count: number }[] {
  if (!palette) return []
  const merged = new Map<string, { attribute: string; value: AttributeValue; count: number }>()
  for (const c of palette) {
    if (c.not) continue // negated → wants FEWER carriers, never seed
    if (c.quantifier === 'none') continue // "no one with X" → don't seed X
    const attr = c.attribute
    if (!attr || attr === 'any' || attr === 'object') continue // not a concrete trait
    if (c.wild?.includes('value') || c.wild?.includes('attribute')) continue // generator picks freely
    const { attribute, value } = attrValue(c)
    const count = c.count ?? c.extraCount ?? 1
    const key = `${attribute}=${String(value)}`
    const prev = merged.get(key)
    if (!prev || count > prev.count) merged.set(key, { attribute, value, count })
  }
  return [...merged.values()]
}
