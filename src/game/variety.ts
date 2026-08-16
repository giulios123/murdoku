import { levelClueFamilies } from '../engine/generator/index.ts'
import { readStorage, writeStorage } from './storage.ts'
import type { LevelJson } from '../engine/index.ts'

/**
 * The variety memory (Dirk, 16.08.2026): a device-local sliding window over the clue
 * FAMILIES of the last generated levels, so consecutive generations do not keep leaning
 * on the same clue kinds.
 *
 * - COOLDOWN: a family seen >= THRESHOLD times across the last WINDOW generated levels
 *   is banned for the next generation (`bannedFamilies`). The ban dissolves by itself as
 *   old levels slide out of the window — no timer to manage.
 * - SPOTLIGHT: one family that appears NOWHERE in the window is actively featured
 *   (`spotlightFamily`) — variety is not just "less of the old" but "some of the new".
 *
 * Both are fail-open inside the generator (they never cause "kein Level") and NEVER
 * apply to the daily case (its generation must stay device-independent — the daily's
 * counterweight is its own rule-based family cap, see daily.ts).
 *
 * The family vocabulary is the generator's own `cappedFamilies` (via levelClueFamilies),
 * so the cooldown counts exactly what the in-level caps count.
 */

const KEY = 'murdoku.gen.variety.v1'
/** How many recent generated levels the memory holds. */
const WINDOW = 4
/** Total occurrences within the window that trigger a family's cooldown. */
const THRESHOLD = 2
/** At most this many families are banned AT ONCE — the worst offenders by count.
 *  Measured without the cap: after two levels half the vocabulary was over the
 *  threshold, the strict search became unsatisfiable and the fail-open fired in
 *  9 of 10 runs (i.e. no cooldown at all). Three bans keep it satisfiable. */
const MAX_BANS = 3

/** Families worth actively featuring. Curated: 'line' stays out (row/column clues are
 *  deliberately scarce — MAX_LINE_CLUES), and the trivial position families (corner,
 *  wall, inside/outside, alone) add nothing as a "feature".
 *  Exported for the daily's deterministic Tages-Rezept (daily.ts) — NOTE the daily
 *  derives its per-day feature from this list's ORDER, so reordering/removing entries
 *  shifts future daily recipes (stored days stay untouched; cross-version skew is the
 *  same accepted story as any generator change). */
export const SPOTLIGHT_FAMILIES = [
  'offset',
  'direction',
  'sameRoom',
  'adjacentRooms',
  'roomAttribute',
  'roomExists',
  'roomCompanion',
  'aloneWith',
  'besideSameObject',
  'insideXor',
  'sameLineAsObject',
  'sameRoomAsObject',
  'directionFromObject',
  'neighborRoom',
]

export interface VarietyPlan {
  bannedFamilies?: string[]
  spotlightFamily?: string
}

function loadHistory(): string[][] {
  const v = readStorage<unknown>(KEY, [])
  return Array.isArray(v) ? v.filter((e): e is string[] => Array.isArray(e)) : []
}

/** The plan for the NEXT generation, derived from the window. `rand` is injectable for
 *  deterministic tests; the app uses Math.random (client-side only — never the daily). */
export function varietyPlan(rand: () => number = Math.random): VarietyPlan {
  const counts = new Map<string, number>()
  for (const families of loadHistory()) {
    for (const f of families) counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  const banned = [...counts]
    .filter(([, n]) => n >= THRESHOLD)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_BANS)
    .map(([f]) => f)
  const unseen = SPOTLIGHT_FAMILIES.filter((f) => !counts.has(f))
  const spotlight = unseen.length > 0 ? unseen[Math.floor(rand() * unseen.length)] : undefined
  return {
    ...(banned.length > 0 ? { bannedFamilies: banned } : {}),
    ...(spotlight !== undefined ? { spotlightFamily: spotlight } : {}),
  }
}

/** Record a DELIVERED level (never mere candidates, never the daily). */
export function recordGeneratedLevel(level: LevelJson): void {
  const history = loadHistory()
  history.push(levelClueFamilies(level))
  while (history.length > WINDOW) history.shift()
  writeStorage(KEY, history)
}
