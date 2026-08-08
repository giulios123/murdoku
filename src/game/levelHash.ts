/**
 * Canonical level fingerprint for the user-level upload duplicate check.
 *
 * Two levels count as "the same case" when their puzzle-defining structure matches:
 * board size, room shapes (+ outside flags), objects on the grid, windows/doors,
 * everyone's clue-relevant attributes and all clues. Pure flavor — title, author,
 * person names, room names/colors, difficulty label, id — is deliberately excluded,
 * so a merely re-skinned copy of an existing level still counts as a duplicate.
 *
 * The SAME function fingerprints the bundled levels (src/dev/userlevel-hashes.ts
 * writes php/internal_hashes.php for the server) and the upload candidate in the
 * client — one implementation, guaranteed consistent. PHP never re-derives the
 * hash; it only compares the hex strings.
 */
import type { LevelJson } from '../engine/index.ts'

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
 *  level can't disguise an identical board. "." stays "." (empty). */
function typedMap(map: string[] | undefined, objects: LevelJson['objects']): string[] {
  if (!map) return []
  return map.map((row) =>
    [...row].map((ch) => (ch === '.' ? '.' : (objects?.[ch]?.type ?? ch))).join(','),
  )
}

/** The puzzle-defining core of a level, ready for canonical serialization. */
function coreOf(level: LevelJson): unknown {
  // Room chars are kept as-is: they are the identity the roomMap + inRoom clues use.
  // Only the flavor per room (nameKey, color) is dropped; `outside` changes clue
  // semantics (inside/outside clues) and stays.
  const rooms = Object.fromEntries(
    Object.entries(level.rooms).map(([ch, room]) => [ch, { outside: room.outside === true }]),
  )
  const person = (p: { attributes?: Record<string, unknown>; clues?: unknown[] }) => ({
    attributes: p.attributes ?? {},
    clues: p.clues ?? [],
  })
  return {
    size: level.size,
    rooms,
    roomMap: level.roomMap,
    groundMap: typedMap(level.groundMap, level.objects),
    topMap: typedMap(level.topMap, level.objects),
    windows: level.windows ?? [],
    doors: level.doors ?? [],
    suspects: level.suspects.map((s) => ({ id: s.id, ...person(s) })),
    victim: person(level.victim),
    globalClues: level.globalClues ?? [],
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
