/**
 * Canonical level fingerprint for the user-level upload duplicate check.
 *
 * Two levels count as "the same case" when their puzzle-defining structure matches:
 * board size, room SHAPES, objects on the grid, windows/doors, the clues and every
 * attribute a clue actually references. Pure flavor — title, author, person names,
 * room names/colors/chars, theme, avatar styling no clue mentions, difficulty label,
 * id — is deliberately excluded, so a merely re-skinned copy of an existing level
 * (open in the editor, pick another theme, save) still counts as a duplicate:
 *
 *  - Room chars are relabelled by first appearance in the roomMap (the editor remaps
 *    foreign chars onto its own slots); clue references (inRoom/inRoomAdjacentTo)
 *    are remapped along. Declared-but-unpainted rooms don't count.
 *  - The rooms' `outside` flags join in ONLY when a clue hinges on the indoor/outdoor
 *    split — otherwise they are theme flavor (the editor derives them from the
 *    theme's room names, so switching themes would change the hash for nothing).
 *  - Person attributes count only if some clue references their key (gender, beard,
 *    glasses colour, …); un-referenced avatar styling is invisible to the puzzle,
 *    and an explicit `false` equals an absent trait.
 *  - Windows/doors are two-sided edges: both representations of one edge, duplicates
 *    and ordering all collapse to one canonical, sorted list.
 *  - Writing-style differences the editor introduces are normalized away: an
 *    all-empty object layer equals a missing one, and roomAttribute's `excludeSelf`
 *    only counts where the subject carries the trait themselves.
 *
 * The SAME function fingerprints the bundled levels (src/dev/userlevel-hashes.ts
 * writes php/internal_hashes.php for the server) and the upload candidate in the
 * client — one implementation, guaranteed consistent. PHP never re-derives the
 * hash; it only compares the hex strings.
 */
import type { ClueJson, LevelJson, Side } from '../engine/index.ts'
import { VOID_ROOM } from '../engine/index.ts'

/** JSON value with recursively key-sorted objects — key order can't change the hash. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  return value
}

/** Resolve a map layer's chars to object TYPES, so the (arbitrary) char legend of a
 *  level can't disguise an identical board. "." stays "." (empty). A layer with no
 *  object at all equals a missing one (the editor always writes both layers out). */
function typedMap(map: string[] | undefined, objects: LevelJson['objects']): string[] {
  if (!map || map.every((row) => [...row].every((ch) => ch === '.'))) return []
  return map.map((row) =>
    [...row].map((ch) => (ch === '.' ? '.' : (objects?.[ch]?.type ?? ch))).join(','),
  )
}

/** Canonical room labels by first appearance in the roomMap (row-major scan) — the
 *  (arbitrary) chars a level names its rooms with can't disguise an identical layout. */
function roomRelabeling(roomMap: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of roomMap) {
    for (const ch of row) {
      if (ch !== VOID_ROOM && !map.has(ch)) map.set(ch, String.fromCharCode(97 + map.size))
    }
  }
  return map
}

/** Fields whose explicit value equals the loader's fallback (createClue's `?? …`) —
 *  stripped so a written-out default and an omitted one hash alike (the editor writes
 *  some defaults out, e.g. roomExists' `relation: 'on'`, older levels omit them). */
const CLUE_DEFAULTS: Partial<Record<ClueJson['type'], Record<string, unknown>>> = {
  roomAttribute: { count: 1, exact: false, excludeSelf: false },
  roomExists: { attribute: null, value: true, person: null, object: '', relation: 'on' },
  sameRoom: { alone: false },
  sameRoomAsObject: { alone: false },
  directionFromObject: { at: null, all: false },
  directionFromAttr: { quantifier: 'some' },
  offsetFrom: { scope: 'people' },
  offsetFromObject: { room: 'any' },
  besideSameObject: { dir: null },
  aloneWith: { dir: null },
  neighborRoomCount: { dir: null },
}

/**
 * Canonical form of one clue (composites recurse): room chars are remapped, written-out
 * defaults are stripped, and a roomAttribute's `excludeSelf: true` is kept only where it
 * can matter — when the SUBJECT carries the trait themselves (the editor always writes
 * it, older levels omit it; for a non-matching subject both mean the same clue). `subj`
 * are the subject's raw attributes; pass null (global clues) to leave it untouched.
 */
function canonClue(
  clue: ClueJson,
  rm: (ch: string) => string,
  subj: Record<string, unknown> | null,
): ClueJson {
  if (clue.type === 'and' || clue.type === 'or') {
    return { ...clue, clues: clue.clues.map((c) => canonClue(c, rm, subj)) }
  }
  if (clue.type === 'not') return { ...clue, clue: canonClue(clue.clue, rm, subj) }
  const out: Record<string, unknown> = { ...clue }
  if (clue.type === 'inRoom' || clue.type === 'inRoomAdjacentTo') out.room = rm(clue.room)
  if (
    clue.type === 'roomAttribute' &&
    subj !== null &&
    clue.excludeSelf === true &&
    subj[clue.attribute] !== clue.value
  ) {
    delete out.excludeSelf
  }
  for (const [k, v] of Object.entries(CLUE_DEFAULTS[clue.type] ?? {})) {
    if (out[k] === v) delete out[k]
  }
  return out as unknown as ClueJson
}

/** The attribute keys ANY clue of the level references (suspect, global and board
 *  clues). Only those are puzzle-relevant — everything else on a person (hairstyle,
 *  glasses shape/colour, …) is avatar flavor and must not change the fingerprint. */
function referencedAttrKeys(level: LevelJson): Set<string> {
  const keys = new Set<string>()
  const walk = (clue: ClueJson): void => {
    if (clue.type === 'and' || clue.type === 'or') clue.clues.forEach(walk)
    else if (clue.type === 'not') walk(clue.clue)
    else if (
      clue.type === 'aloneWith' ||
      clue.type === 'roomAttribute' ||
      clue.type === 'directionFromAttr' ||
      clue.type === 'roomCompanion'
    ) {
      keys.add(clue.attribute)
    } else if (clue.type === 'roomExists' && typeof clue.attribute === 'string') {
      keys.add(clue.attribute)
    } else if (clue.type === 'besideSameObject' && clue.mate.kind === 'attr') {
      keys.add(clue.mate.attribute)
    } else if (clue.type === 'offsetFrom' && clue.who.kind === 'attr') {
      keys.add(clue.who.attribute)
    }
  }
  for (const s of level.suspects) (s.clues ?? []).forEach(walk)
  for (const c of level.globalClues ?? []) walk(c)
  for (const bc of level.boardClues ?? []) if (bc.type === 'countWithAttr') keys.add(bc.attribute)
  return keys
}

/** JSON twin of clueRefs.ts → usesInsideOutside: does ANY clue hinge on the
 *  indoor/outdoor split? Only then are the rooms' `outside` flags part of the
 *  puzzle; otherwise the editor's theme choice would leak into the hash. */
function usesInsideOutsideJson(level: LevelJson): boolean {
  const inClue = (clue: ClueJson): boolean => {
    if (clue.type === 'and' || clue.type === 'or') return clue.clues.some(inClue)
    if (clue.type === 'not') return inClue(clue.clue)
    return (
      clue.type === 'inside' ||
      clue.type === 'outside' ||
      clue.type === 'uniqueInside' ||
      clue.type === 'uniqueOutside' ||
      clue.type === 'insideXor'
    )
  }
  return (
    level.suspects.some((s) => (s.clues ?? []).some(inClue)) ||
    (level.globalClues ?? []).some(inClue) ||
    (level.boardClues ?? []).some((bc) => bc.type === 'countWithAttr')
  )
}

/** Windows and doors are TWO-sided edges (the loader registers both cells), so
 *  {r,c,'S'} and {r+1,c,'N'} name the same edge. Anchor each at its top/left cell,
 *  drop duplicates and sort — representation and order can't change the hash. */
function canonicalEdges(
  list: readonly { r: number; c: number; side: Side }[] | undefined,
): { r: number; c: number; side: Side }[] {
  const out = new Map<string, { r: number; c: number; side: Side }>()
  for (const e of list ?? []) {
    const anchored =
      e.side === 'N' && e.r > 0
        ? { r: e.r - 1, c: e.c, side: 'S' as Side }
        : e.side === 'W' && e.c > 0
          ? { r: e.r, c: e.c - 1, side: 'E' as Side }
          : { r: e.r, c: e.c, side: e.side }
    out.set(`${anchored.r},${anchored.c},${anchored.side}`, anchored)
  }
  return [...out.values()].sort(
    (a, b) => a.r - b.r || a.c - b.c || (a.side < b.side ? -1 : a.side > b.side ? 1 : 0),
  )
}

/** The puzzle-defining core of a level, ready for canonical serialization. */
function coreOf(level: LevelJson): unknown {
  const rooms = roomRelabeling(level.roomMap)
  const rm = (ch: string): string => rooms.get(ch) ?? ch
  const attrKeys = referencedAttrKeys(level)
  const person = (p: { attributes?: Record<string, unknown>; clues?: ClueJson[] }) => ({
    // Only clue-referenced keys count, and an explicit `false` equals "absent" —
    // no clue in existence compares against false (corpus-checked), but some levels
    // write `beard: false` where the editor writes nothing.
    attributes: Object.fromEntries(
      Object.entries(p.attributes ?? {}).filter(([k, v]) => attrKeys.has(k) && v !== false),
    ),
    clues: (p.clues ?? []).map((c) => canonClue(c, rm, p.attributes ?? {})),
  })
  return {
    size: level.size,
    roomMap: level.roomMap.map((row) => [...row].map(rm).join('')),
    // Canonical label → outside flag, only while some clue actually uses the split.
    outside: usesInsideOutsideJson(level)
      ? [...rooms.entries()].map(([ch, label]) => [label, level.rooms[ch]?.outside === true])
      : null,
    groundMap: typedMap(level.groundMap, level.objects),
    topMap: typedMap(level.topMap, level.objects),
    windows: canonicalEdges(level.windows),
    doors: canonicalEdges(level.doors),
    suspects: level.suspects.map((s) => ({ id: s.id, ...person(s) })),
    // The victim shows ONLY their gender; every other stored trait is random, hidden
    // flavor (no clue may ever hinge on it — CLAUDE.md), so it can't fingerprint.
    victim: {
      attributes:
        attrKeys.has('gender') && level.victim.attributes?.gender !== undefined
          ? { gender: level.victim.attributes.gender }
          : {},
      clues: [],
    },
    globalClues: (level.globalClues ?? []).map((c) => canonClue(c, rm, null)),
    boardClues: level.boardClues ?? [],
  }
}

/** The canonical JSON string the hash is computed over (exported for tests). */
export function canonicalCore(level: LevelJson): string {
  return JSON.stringify(canonical(coreOf(level)))
}

/** SHA-256 hex fingerprint of the level's puzzle core. Works in the browser AND in
 *  Node dev scripts (both expose WebCrypto as globalThis.crypto). */
export async function levelHash(level: LevelJson): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCore(level))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
