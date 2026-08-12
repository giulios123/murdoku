import { OBJECT_CATALOG, VOID_ROOM, type AttributeValue, type BoardClueJson, type ClueJson, type LevelJson, type ObjectDef, type Side, type SuspectJson } from '../engine/index.ts'
import { cluesToGroup, emptyClueGroup, groupToClues, type ClueGroup } from './editorClues.ts'
import { resolveHairstyle } from './avatar.ts'

/** Up to 15 room slots the editor can paint (matching a theme's room count). */
export const ROOM_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F']
export const ROOM_COLORS = [
  '#e8d8b0',
  '#b9d0e6',
  '#cfe0cf',
  '#d8c0c0',
  '#e6cda0',
  '#e6c0d2',
  '#c6c0e0',
  '#c0e0c8',
  '#e0c4a0',
  '#a8c8e0',
  '#d8e0a8',
  '#e0b0a8',
  '#c8b0d8',
  '#a8e0d0',
  '#ded0e6',
]

/** An object the editor can place. Aliased to the engine's shared catalog type. */
export type EditorObject = ObjectDef

/** Objects the editor can place — the engine-owned catalog (shared with the generator). */
export const EDITOR_OBJECTS: readonly EditorObject[] = OBJECT_CATALOG

export const GROUND_OBJECTS = EDITOR_OBJECTS.filter((o) => o.layer === 'ground')
export const TOP_OBJECTS = EDITOR_OBJECTS.filter((o) => o.layer === 'top')

export interface EditorWindow {
  r: number
  c: number
  side: Side
}

/** A suspect as edited: identity + visible traits + the flat clue builder.
 *  Style fields ('' = auto/derived) only render when their toggle is on. */
export interface EditorSuspect {
  id: string
  name: string
  gender: 'm' | 'f'
  beard: boolean
  glasses: boolean
  bald: boolean
  hair: string // '' = unset, else a colour name
  hairstyle?: string // '' = auto from id, else a style id
  beardStyle?: string // '' = full, else a beard style id
  glassesShape?: string // '' = round, else a glasses shape id
  glassesColor?: string // '' = black, else a glasses colour id
  clue: ClueGroup
}

export interface EditorVictim {
  name: string
  gender: 'm' | 'f'
}

export interface EditorState {
  size: number
  roomMap: string[]
  groundMap: string[]
  topMap: string[]
  windows: EditorWindow[]
  /** Doors (two-sided edges), same shape as windows. */
  doors: EditorWindow[]
  /** Board-wide clues (counts / empty rooms). */
  boardClues: BoardClueJson[]
  suspects: EditorSuspect[]
  victim: EditorVictim
  /** Display name (nameKey) per room slot 0..7 — usually picked from a theme. */
  roomNames: string[]
}

/** Fallback room names when no theme is supplied. */
const DEFAULT_ROOM_NAMES = ROOM_IDS.map((id) => `room.editor${id}`)

const EMPTY_ROW = (size: number, ch: string) => ch.repeat(size)

/** Suspect letters A, B, C … (board fits at most `size` people incl. victim). */
export const SUSPECT_LETTERS = 'ABCDEFGHIJKLMNO'.split('')

function makeSuspect(i: number): EditorSuspect {
  const id = SUSPECT_LETTERS[i] ?? `S${i + 1}`
  return {
    id,
    name: `Person ${id}`,
    gender: i % 2 === 0 ? 'm' : 'f',
    beard: false,
    glasses: false,
    bald: false,
    hair: '',
    hairstyle: '',
    beardStyle: '',
    glassesShape: '',
    glassesColor: '',
    clue: emptyClueGroup(),
  }
}

/** Resize the suspect list to `count`, preserving existing entries. */
export function fitSuspects(suspects: EditorSuspect[], count: number): EditorSuspect[] {
  const next = suspects.slice(0, count)
  for (let i = next.length; i < count; i++) next.push(makeSuspect(i))
  return next
}

export function emptyEditorState(size: number, roomNames: string[] = DEFAULT_ROOM_NAMES): EditorState {
  return {
    size,
    roomMap: Array.from({ length: size }, () => EMPTY_ROW(size, '1')),
    groundMap: Array.from({ length: size }, () => EMPTY_ROW(size, '.')),
    topMap: Array.from({ length: size }, () => EMPTY_ROW(size, '.')),
    windows: [],
    doors: [],
    boardClues: [],
    suspects: fitSuspects([], size - 1),
    victim: { name: 'Opfer', gender: 'm' },
    roomNames: ROOM_IDS.map((_, i) => roomNames[i] ?? DEFAULT_ROOM_NAMES[i]),
  }
}

/** Toggle a window on a cell's side (returns a new windows array). */
export function toggleWindow(windows: EditorWindow[], r: number, c: number, side: Side): EditorWindow[] {
  const i = windows.findIndex((w) => w.r === r && w.c === c && w.side === side)
  if (i >= 0) return windows.filter((_, j) => j !== i)
  return [...windows, { r, c, side }]
}

const SIDES: Side[] = ['N', 'S', 'W', 'E']
const STEP: Record<Side, [number, number]> = { N: [-1, 0], S: [1, 0], W: [0, -1], E: [0, 1] }

/** Perpendicular distance from a fractional click (fx,fy in [0,1]) to an edge. */
function edgeDist(side: Side, fx: number, fy: number): number {
  if (side === 'N') return fy
  if (side === 'S') return 1 - fy
  if (side === 'W') return fx
  return 1 - fx
}

function nearestSide(fx: number, fy: number): Side {
  return SIDES.reduce((a, b) => (edgeDist(b, fx, fy) < edgeDist(a, fx, fy) ? b : a))
}

/** Canonical key for a wall edge: anchored at the top/left cell, side S (down) or
 *  E (right), so a two-sided edge toggles the same whichever cell you click. */
function canonicalEdge(r: number, c: number, side: Side): { r: number; c: number; side: Side } {
  if (side === 'N') return { r: r - 1, c, side: 'S' }
  if (side === 'W') return { r, c: c - 1, side: 'E' }
  return { r, c, side }
}

/**
 * Toggle a window OR door on the wall edge nearest the click (fx,fy fractional 0..1).
 * Windows and doors share one mechanic: an interior edge is canonicalised (anchored
 * at the top/left cell) so clicking from either side hits the same edge and it counts
 * from both; a boundary/exterior edge keeps the click's own side (only one cell). They
 * differ only in look and which clue they trigger. Clicking the same edge removes it.
 */
export function toggleWallEdgeAt(
  edges: EditorWindow[],
  r: number,
  c: number,
  fx: number,
  fy: number,
): EditorWindow[] {
  const side = nearestSide(fx, fy)
  const e = canonicalEdge(r, c, side)
  // N/W boundary: the canonical anchor is off-board → keep the click's own side here.
  if (e.r < 0 || e.c < 0) return toggleWindow(edges, r, c, side)
  return toggleWindow(edges, e.r, e.c, e.side)
}

/**
 * Drop windows/doors that no longer sit on a wall after a room repaint. Both follow
 * the same rule: an edge survives where its two sides differ — between two rooms, or
 * on the board's outer boundary (one side is off-board / exterior).
 */
export function pruneWallEdges(
  roomMap: string[],
  size: number,
  windows: EditorWindow[],
  doors: EditorWindow[],
): { windows: EditorWindow[]; doors: EditorWindow[] } {
  const roomAt = (r: number, c: number): string | null =>
    r < 0 || r >= size || c < 0 || c >= size ? null : roomMap[r][c]
  const onWall = (e: EditorWindow): boolean => {
    const [dr, dc] = STEP[e.side]
    return roomAt(e.r, e.c) !== roomAt(e.r + dr, e.c + dc)
  }
  return { windows: windows.filter(onWall), doors: doors.filter(onWall) }
}

/** Set one character in a row-string array (returns a new array). */
export function setCell(map: string[], row: number, col: number, ch: string): string[] {
  const next = [...map]
  next[row] = next[row].slice(0, col) + ch + next[row].slice(col + 1)
  return next
}

/**
 * Build a LevelJson from the editor state. All room slots and object chars are
 * declared so any painted cell is valid; suspects/victim are placeholders for
 * board rendering (real ones are filled in later stages).
 */
export function buildEditorLevel(
  state: EditorState,
  suspects: SuspectJson[] = [],
  victim: { name: string; attributes?: Record<string, string | number | boolean> } = { name: '?' },
  title?: string,
  /** Room names that count as outdoors (from the theme) → rooms[].outside. */
  outdoorRooms: string[] = [],
): LevelJson {
  const outside = new Set(outdoorRooms)
  const rooms: LevelJson['rooms'] = {}
  ROOM_IDS.forEach((id, i) => {
    const nameKey = state.roomNames[i] ?? `room.editor${id}`
    rooms[id] = { nameKey, color: ROOM_COLORS[i], outside: outside.has(nameKey) }
  })
  const objects: LevelJson['objects'] = {}
  for (const o of EDITOR_OBJECTS) objects[o.char] = { type: o.type, occupiable: o.occupiable }

  return {
    schema: 1,
    id: 'editor-preview',
    title,
    size: { width: state.size, height: state.size },
    rooms,
    objects,
    roomMap: state.roomMap,
    groundMap: state.groundMap,
    topMap: state.topMap,
    windows: state.windows,
    doors: state.doors,
    suspects,
    victim,
    boardClues: state.boardClues,
  }
}

/**
 * The attribute record a suspect contributes. Style values are folded in so a
 * clue can reference them and the puzzle stays consistent with the avatar: every
 * non-bald person has a concrete hairstyle (explicit or derived from the id),
 * bearded/bespectacled people carry their style/shape/colour.
 */
export function suspectAttributes(s: EditorSuspect): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = { gender: s.gender }
  if (s.beard) {
    attrs.beard = true
    attrs.beardStyle = s.beardStyle || 'full'
  }
  if (s.glasses) {
    attrs.glasses = true
    attrs.glassesShape = s.glassesShape || 'round'
    attrs.glassesColor = s.glassesColor || 'black'
  }
  if (s.bald) attrs.bald = true
  else attrs.hairstyle = resolveHairstyle(s.gender, s.hairstyle, s.id)
  if (s.hair) attrs.hair = s.hair
  return attrs
}

function suspectToJson(s: EditorSuspect): SuspectJson {
  return { id: s.id, name: s.name, attributes: suspectAttributes(s), clues: groupToClues(s.clue) }
}

/** Inverse of `suspectToJson`: map a level's suspect (traits + clues) back into the
 *  editor's editable shape. Style fields absent from the attributes become '' (auto). */
function suspectFromJson(s: SuspectJson): EditorSuspect {
  const a = s.attributes ?? {}
  const str = (v: AttributeValue | undefined): string => (typeof v === 'string' ? v : '')
  return {
    id: s.id,
    name: s.name,
    gender: a.gender === 'f' ? 'f' : 'm',
    beard: a.beard === true,
    glasses: a.glasses === true,
    bald: a.bald === true,
    hair: str(a.hair),
    hairstyle: str(a.hairstyle),
    beardStyle: str(a.beardStyle),
    glassesShape: str(a.glassesShape),
    glassesColor: str(a.glassesColor),
    clue: cluesToGroup(s.clues),
  }
}

/** Pull the people (suspects + victim) out of a built level into editor state —
 *  used by the editor's "random" fill, which keeps the board and replaces the people. */
export function editorPeopleFromLevel(level: LevelJson): {
  suspects: EditorSuspect[]
  victim: EditorVictim
} {
  const va = level.victim.attributes ?? {}
  return {
    suspects: level.suspects.map(suspectFromJson),
    victim: { name: level.victim.name, gender: va.gender === 'f' ? 'f' : 'm' },
  }
}

/**
 * Map a level's room chars onto the editor's fixed slots (ROOM_IDS). Chars that are
 * already valid slots stay put; foreign ones (e.g. theme-authored "W"/"S"/… that no
 * editor uses) are reassigned to the first free slots. Identity for editor-made levels.
 */
function roomCharMap(roomMap: readonly string[]): Map<string, string> {
  const distinct: string[] = []
  for (const row of roomMap) {
    for (const ch of row) if (ch !== VOID_ROOM && !distinct.includes(ch)) distinct.push(ch)
  }
  const free = ROOM_IDS.filter((id) => !distinct.includes(id))
  const valid = new Set<string>(ROOM_IDS)
  const map = new Map<string, string>()
  let f = 0
  for (const ch of distinct) {
    if (valid.has(ch)) map.set(ch, ch)
    else if (f < free.length) map.set(ch, free[f++])
  }
  return map
}

/**
 * Reconstruct a full editor state from a finished level — for "open in the editor".
 * Room chars are remapped onto the editor's slots (so theme-/hand-authored levels with
 * chars like "W" open too — their references in clues are remapped along); the people
 * and room names are reverse-mapped. Assumes a square board; non-square falls back to width.
 */
/** The board-clue types this build's editor can actually show and save. */
const KNOWN_BOARD_CLUES = new Set(['countOnObject', 'emptyRooms', 'roomOccupancy', 'countWithAttr'])

/**
 * Migrate one board clue from any shape older data may carry onto the current one.
 *
 * Editor drafts, saved custom levels and exported files live in localStorage / on disk and
 * OUTLIVE a refactor — so this build will be handed types it no longer defines. Both known
 * predecessors fold onto the general per-room clue they always were; anything genuinely
 * unknown returns null and is dropped, because the alternative is an editor that can never
 * be opened again (createBoardClue now throws on unknown types, by design).
 */
export function normalizeBoardClue(bc: BoardClueJson): BoardClueJson | null {
  const old = bc as unknown as { type: string; count?: number; scope?: 'people' | 'suspects' }
  // "every room holds exactly N people"
  if (old.type === 'everyRoomCount') {
    return { type: 'roomOccupancy', op: 'exactly', count: old.count ?? 2, scope: 'people' }
  }
  // "no room holds more than N" — the intermediate shape before the operator was added.
  if (old.type === 'maxRoomOccupancy') {
    return { type: 'roomOccupancy', op: 'atMost', count: old.count ?? 2, scope: old.scope ?? 'people' }
  }
  return KNOWN_BOARD_CLUES.has(old.type) ? bc : null
}

/** Migrate a whole list, dropping what can't be represented any more. */
export function normalizeBoardClues(bcs: readonly BoardClueJson[] | undefined): BoardClueJson[] {
  return (bcs ?? []).map(normalizeBoardClue).filter((b): b is BoardClueJson => b !== null)
}

export function editorStateFromLevel(level: LevelJson): EditorState {
  const map = roomCharMap(level.roomMap)
  const rm = (ch: string): string => map.get(ch) ?? ch
  const remapClue = (c: ClueJson): ClueJson => {
    if (c.type === 'inRoom' || c.type === 'inRoomAdjacentTo') return { ...c, room: rm(c.room) }
    if (c.type === 'and' || c.type === 'or') return { ...c, clues: c.clues.map(remapClue) }
    if (c.type === 'not') return { ...c, clue: remapClue(c.clue) }
    return c
  }
  const origOf = new Map<string, string>() // editor slot → original room char
  for (const [orig, slot] of map) origOf.set(slot, orig)

  // Object chars: remap the level's own chars (by TYPE) onto the editor catalog's
  // chars, so theme-/hand-authored maps (e.g. "S" for chair) paint correctly.
  const editorCharByType = new Map(EDITOR_OBJECTS.map((o) => [o.type, o.char]))
  const objMap = new Map<string, string>()
  for (const [ch, def] of Object.entries(level.objects ?? {})) {
    const editorCh = editorCharByType.get(def.type)
    if (editorCh) objMap.set(ch, editorCh)
  }
  const ro = (ch: string): string => objMap.get(ch) ?? ch
  const remapLayer = (rows?: string[]): string[] | undefined =>
    rows?.map((row) => [...row].map(ro).join(''))

  const size = level.size.width
  const blank = Array.from({ length: level.size.height }, () => '.'.repeat(size))
  const va = level.victim.attributes ?? {}
  return {
    size,
    roomMap: level.roomMap.map((row) => [...row].map(rm).join('')),
    groundMap: remapLayer(level.groundMap) ?? blank,
    topMap: remapLayer(level.topMap) ?? blank,
    windows: [...(level.windows ?? [])],
    doors: [...(level.doors ?? [])],
    boardClues: normalizeBoardClues(level.boardClues),
    suspects: level.suspects.map((s) => suspectFromJson({ ...s, clues: s.clues?.map(remapClue) })),
    victim: { name: level.victim.name, gender: va.gender === 'f' ? 'f' : 'm' },
    roomNames: ROOM_IDS.map((id, i) => {
      const orig = origOf.get(id)
      return (orig ? level.rooms[orig]?.nameKey : undefined) ?? DEFAULT_ROOM_NAMES[i]
    }),
  }
}

/** Build a fully playable level (real suspects + victim + clues) with a stable id. */
export function buildPlayableLevel(
  state: EditorState,
  id: string,
  title?: string,
  difficulty?: string,
  outdoorRooms: string[] = [],
): LevelJson {
  const level = buildEditorLevel(
    state,
    state.suspects.map(suspectToJson),
    { name: state.victim.name || '?', attributes: { gender: state.victim.gender } },
    title,
    outdoorRooms,
  )
  return difficulty ? { ...level, id, difficulty } : { ...level, id }
}

/** Distinct room ids actually painted on the board, in first-seen order
 *  (excluding empty/void cells, which are no room). */
export function usedRooms(state: EditorState): string[] {
  const seen: string[] = []
  for (const row of state.roomMap) {
    for (const ch of row) if (ch !== VOID_ROOM && !seen.includes(ch)) seen.push(ch)
  }
  return seen
}

/** Object TYPES present on the board (mapped from the painted chars). */
export function presentObjectTypes(state: EditorState): string[] {
  const byChar = new Map(EDITOR_OBJECTS.map((o) => [o.char, o.type]))
  const out: string[] = []
  for (const map of [state.groundMap, state.topMap]) {
    for (const row of map) {
      for (const ch of row) {
        const type = byChar.get(ch)
        if (type && !out.includes(type)) out.push(type)
      }
    }
  }
  return out
}

/** Cell indices (row*size+col) holding an object of `type`, on either layer — for
 *  anchoring a direction clue to one specific object tile. */
export function objectCellsOf(state: EditorState, type: string): number[] {
  const byChar = new Map(EDITOR_OBJECTS.map((o) => [o.char, o.type]))
  const out: number[] = []
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const ground = byChar.get(state.groundMap[r]?.[c] ?? '')
      const top = byChar.get(state.topMap[r]?.[c] ?? '')
      if (ground === type || top === type) out.push(r * state.size + c)
    }
  }
  return out
}
