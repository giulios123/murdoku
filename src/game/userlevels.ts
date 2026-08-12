/**
 * Userlevel: Server-Sync, lokaler Cache, Bewertungen, Upload.
 *
 * Datenfluss (bewusst sparsam — Dirks Vorgabe "nicht ewig viel durchs Internet"):
 *  - `sync.php?sinceId=N` liefert NUR neue Level (volle JSONs) plus die winzigen
 *    Bewertungs-Zähler ALLER Level. Der Cache in localStorage ist danach vollständig
 *    und aktuell — offline läuft die Auswahl komplett aus dem Cache.
 *  - Fehlt eine gecachte id in den Zählern, wurde das Level serverseitig gelöscht
 *    und fliegt aus dem Cache.
 *  - Bewerten geht einmalig pro Level (lokale Sperre) und NUR online (Dirks Regel):
 *    gesperrt und lokal eingerechnet wird erst, wenn der Server die Bewertung
 *    angenommen hat — scheitert das Senden, meldet der Dialog es ehrlich.
 *
 * Der Auto-Tag "nologic": eindeutig lösbare Level, die die Deduktions-Engine (noch)
 * nicht ohne Raten knackt (dort funktioniert auch der Tipp nicht). Das Flag rechnet
 * JEDER Client selbst beim Sync — lernt die Engine später neue Techniken, verschwindet
 * der Tag mit dem App-Update von allein (deshalb steht er nicht in der DB).
 */
import type { LevelJson } from '../engine/index.ts'
import { DeductionEngine, loadLevel } from '../engine/index.ts'
import { TECHNIQUE_RANK } from '../engine/solver/DeductionStep.ts'
import { levelHash } from './levelHash.ts'
import { normalizeBoardClues } from './editorModel.ts'
import { readStorage, writeStorage } from './storage.ts'
import { LEVELS } from './levels.ts'

/** Basis-URL der PHP-API (Deploy-Ziel des php/-Ordners). */
export const USERLEVEL_API = 'https://apo-games.de/murdoku/'

const CACHE_KEY = 'murdoku.userlevels.v1'
const RATED_KEY = 'murdoku.userlevels.rated.v1'
const AUTHOR_KEY = 'murdoku.userlevels.author.v1'

/** Vom Spieler wählbare Eigenschaften (Reihenfolge = Spalten in sync.php-`ratings`!). */
export const USERLEVEL_TAGS = [
  'easy',
  'hard',
  'creative',
  'confusing',
  'fair',
  'thrilling',
  'tricky',
  'pretty',
] as const
export type UserLevelTag = (typeof USERLEVEL_TAGS)[number]

/** Der automatische Tag (nie selbst wählbar), s. Modul-Kommentar. */
export const NO_LOGIC_TAG = 'nologic'

export interface UserLevelStats {
  /** Summe aller vergebenen Sterne; Ø = stars / ratings. */
  stars: number
  ratings: number
  tags: Record<UserLevelTag, number>
}

export interface UserLevelEntry {
  dbId: number
  /** Das Level, id bereits auf `ul-<dbId>` gesetzt (gelöst/Fortschritt laufen darüber). */
  json: LevelJson
  created: string
  stats: UserLevelStats
  /** false = die Deduktions-Engine löst es (noch) nicht ohne Raten → Auto-Tag, kein Tipp. */
  logic: boolean
  /** false = dieser Build kennt das Level-Format nicht (z. B. neuerer Hinweistyp) —
   *  wird versteckt und nach einem App-Update erneut geprüft. */
  playable: boolean
  /** Engine-Signatur, unter der logic/playable zuletzt geprüft wurden. */
  checkedSig: number
}

interface UserLevelCache {
  /** `cursor` der letzten sync.php-Antwort (updated-Zeitstempel); '' = nie gesynct. */
  cursor: string
  levels: UserLevelEntry[]
}

interface PendingRating {
  dbId: number
  stars: number
  tags: UserLevelTag[]
}

export function userLevelId(dbId: number): string {
  return `ul-${dbId}`
}

/** Signatur des Deduktions-Wissens: ändert sich, wenn Techniken dazukommen —
 *  dann werden als "nologic"/"unspielbar" markierte Level neu bewertet. */
function engineSignature(): number {
  return Object.keys(TECHNIQUE_RANK).length
}

/** logic/playable eines Levels frisch bestimmen (Forward-Deduktion, kein Suchlauf —
 *  billig; die teure Eindeutigkeitsprüfung lief bereits beim Upload). */
function evaluate(json: LevelJson): { logic: boolean; playable: boolean } {
  try {
    const deduction = new DeductionEngine(loadLevel(json)).solve()
    return { logic: deduction.solved, playable: true }
  } catch {
    return { logic: false, playable: false }
  }
}

/** Cache lesen — Migrations-Grenze wie bei Custom-Leveln (persistierte JSONs
 *  überleben Refactorings, s. CLAUDE.md). Ein alter Cache ohne `cursor` (die
 *  frühere lastId-Form) startet mit '' und wird beim nächsten Sync voll ersetzt. */
export function loadUserLevelCache(): UserLevelCache {
  const raw = readStorage<Partial<UserLevelCache>>(CACHE_KEY, {})
  return {
    cursor: typeof raw.cursor === 'string' ? raw.cursor : '',
    levels: (raw.levels ?? []).map((e) => ({
      ...e,
      json: { ...e.json, boardClues: normalizeBoardClues(e.json.boardClues) },
    })),
  }
}

/**
 * Listen-Reihenfolge (Dirks Vorgabe): beste Ø-Sterne zuerst (Unbewertete ans Ende),
 * dann Brettgröße aufsteigend, dann die meistgewählte Eigenschaft (in Tag-Reihenfolge,
 * Level ohne Eigenschaften danach), zuletzt neueste zuerst.
 */
export function compareUserLevels(a: UserLevelEntry, b: UserLevelEntry): number {
  const starsOf = (e: UserLevelEntry) => averageStars(e.stats) ?? -1
  const tagRank = (e: UserLevelEntry) => {
    const top = topTags(e.stats)[0]
    return top === undefined ? USERLEVEL_TAGS.length : USERLEVEL_TAGS.indexOf(top)
  }
  return (
    starsOf(b) - starsOf(a) ||
    a.json.size.width - b.json.size.width ||
    tagRank(a) - tagRank(b) ||
    b.dbId - a.dbId
  )
}

/** Nur die in diesem Build spielbaren Level, sortiert per {@link compareUserLevels}. */
export function loadUserLevels(): UserLevelEntry[] {
  return loadUserLevelCache()
    .levels.filter((e) => e.playable)
    .sort(compareUserLevels)
}

function emptyStats(): UserLevelStats {
  return {
    stars: 0,
    ratings: 0,
    tags: Object.fromEntries(USERLEVEL_TAGS.map((t) => [t, 0])) as Record<UserLevelTag, number>,
  }
}

/** Eine kompakte ratings-Zeile aus sync.php → Stats (Spaltenreihenfolge s. USERLEVEL_TAGS). */
function statsFromRow(row: number[]): UserLevelStats {
  const stats = emptyStats()
  stats.stars = row[1] ?? 0
  stats.ratings = row[2] ?? 0
  USERLEVEL_TAGS.forEach((tag, i) => {
    stats.tags[tag] = row[3 + i] ?? 0
  })
  return stats
}

/** Form-POST (application/x-www-form-urlencoded = kein CORS-Preflight, wie sheeptastic).
 *  Kurzes Timeout — alle Endpunkte antworten ohne OpenAI-Aufrufe (Dirks Regel:
 *  niemand wartet 10 Sekunden). */
async function post(endpoint: string, fields: Record<string, string>): Promise<unknown> {
  const res = await fetch(USERLEVEL_API + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(10000),
  })
  return res.json()
}

/** Moderation + Übersetzung der zuletzt hochgeladenen Level anstoßen — fire-and-forget,
 *  es wird NIE auf die Antwort gewartet (die OpenAI-Aufrufe laufen serverseitig).
 *  `keepalive` lässt den Request auch einen Screenwechsel überleben. */
export function kickProcessing(): void {
  try {
    void fetch(USERLEVEL_API + 'processUserlevel.php', { method: 'POST', keepalive: true }).catch(
      () => {},
    )
  } catch {
    /* fetch selbst nicht verfügbar — egal */
  }
}

interface SyncPayload {
  cursor: string
  levels: { id: number; level: LevelJson; created: string }[]
  ratings: number[][]
}

export interface SyncResult {
  /** false = Server nicht erreichbar — `levels` ist dann der (unveränderte) Cache. */
  online: boolean
  levels: UserLevelEntry[]
}

/**
 * Abgleich mit dem Server: liegengebliebene Nachbearbeitung anstoßen (ohne zu warten),
 * dann neue/aktualisierte Level holen + Zähler aller Level auffrischen + Gelöschtes
 * wegräumen. Jeder Fehler fällt still auf den Cache zurück (offline ist ein normaler
 * Zustand, kein Fehlerfall).
 */
export async function syncUserLevels(): Promise<SyncResult> {
  kickProcessing()

  const cache = loadUserLevelCache()
  let payload: SyncPayload
  try {
    const res = await fetch(
      `${USERLEVEL_API}sync.php?since=${encodeURIComponent(cache.cursor)}`,
      { signal: AbortSignal.timeout(12000) },
    )
    const body = (await res.json()) as { success: boolean; data?: SyncPayload }
    if (!body.success || !body.data) throw new Error('sync failed')
    payload = body.data
  } catch {
    return { online: false, levels: loadUserLevels() }
  }

  const statsById = new Map(payload.ratings.map((row) => [row[0], statsFromRow(row)]))
  const sig = engineSignature()

  // Bestehende behalten (nur wenn der Server sie noch kennt), Zähler auffrischen;
  // als nologic/unspielbar markierte nach einem Engine-Update neu bewerten.
  const kept = cache.levels
    .filter((e) => statsById.has(e.dbId))
    .map((e) => {
      const stats = statsById.get(e.dbId) ?? e.stats
      if ((!e.logic || !e.playable) && e.checkedSig !== sig) {
        return { ...e, stats, ...evaluate(e.json), checkedSig: sig }
      }
      return { ...e, stats }
    })

  // Gelieferte Level ERSETZEN vorhandene Einträge (idempotent — so kommt auch eine
  // nachgereichte Übersetzung desselben Levels an) und neue kommen dazu.
  for (const fresh of payload.levels) {
    if (!fresh.level || typeof fresh.level !== 'object') continue
    const json: LevelJson = {
      ...fresh.level,
      id: userLevelId(fresh.id),
      boardClues: normalizeBoardClues(fresh.level.boardClues),
    }
    const entry: UserLevelEntry = {
      dbId: fresh.id,
      json,
      created: fresh.created,
      stats: statsById.get(fresh.id) ?? emptyStats(),
      ...evaluate(json),
      checkedSig: sig,
    }
    const idx = kept.findIndex((e) => e.dbId === fresh.id)
    if (idx >= 0) kept[idx] = entry
    else kept.push(entry)
  }

  writeStorage(CACHE_KEY, { cursor: payload.cursor, levels: kept } satisfies UserLevelCache)
  return { online: true, levels: loadUserLevels() }
}

/* ---------------------------------- Bewertung ---------------------------------- */

/** Alle Level, die DIESER Spieler schon bewertet hat — einmal lesen, dann per Set
 *  prüfen (die Auswahl fragt das pro Karte ab). */
export function loadRatedIds(): Set<number> {
  return new Set(readStorage<number[]>(RATED_KEY, []))
}

export function isRated(dbId: number): boolean {
  return loadRatedIds().has(dbId)
}

function markRated(dbId: number): void {
  const rated = readStorage<number[]>(RATED_KEY, [])
  if (!rated.includes(dbId)) writeStorage(RATED_KEY, [...rated, dbId])
}

/** Bewertung lokal auf den Cache anwenden, damit sie sofort sichtbar ist (der Server
 *  zählt beim nächsten Sync ohnehin authoritativ). */
function applyRatingLocally(rating: PendingRating): void {
  const cache = loadUserLevelCache()
  const entry = cache.levels.find((e) => e.dbId === rating.dbId)
  if (!entry) return
  entry.stats.stars += rating.stars
  entry.stats.ratings += 1
  for (const tag of rating.tags) entry.stats.tags[tag] += 1
  writeStorage(CACHE_KEY, cache)
}

/**
 * Einmalige Bewertung abgeben (1–5 Sterne, max. 2 Eigenschaften) — NUR online:
 * erst wenn der Server sie angenommen hat, wird lokal gesperrt und eingerechnet.
 * Rückgabe false = nicht gespeichert (keine Verbindung); der Aufrufer darf es
 * erneut versuchen.
 */
export async function rateUserLevel(
  dbId: number,
  stars: number,
  tags: UserLevelTag[],
): Promise<boolean> {
  if (isRated(dbId)) return true
  const rating: PendingRating = { dbId, stars, tags: tags.slice(0, 2) }
  try {
    const body = (await post('rateUserlevel.php', {
      id: String(rating.dbId),
      stars: String(rating.stars),
      tags: rating.tags.join(','),
    })) as { success: boolean; error?: string }
    // "not found" = Level wurde inzwischen gelöscht → als erledigt werten (nur
    // sperren, nichts einrechnen).
    if (body.error === 'not found') {
      markRated(dbId)
      return true
    }
    if (!body.success) return false
  } catch {
    return false
  }
  markRated(dbId)
  applyRatingLocally(rating)
  return true
}

/* ----------------------------------- Upload ------------------------------------ */

/** Autor-Name für Uploads — einmal eingeben, wird gemerkt. */
export function loadAuthorName(): string {
  return readStorage<string>(AUTHOR_KEY, '')
}

export function saveAuthorName(name: string): void {
  writeStorage(AUTHOR_KEY, name.trim())
}

export type UploadError = 'duplicate' | 'content' | 'tooFast' | 'network' | 'rejected'

export type UploadResult = { ok: true; id: number } | { ok: false; error: UploadError }

/** Fingerprints aller offiziellen Level — einmal gerechnet und gemerkt (das Bundle
 *  ändert sich zur Laufzeit nie). */
let bundledHashes: Promise<Set<string>> | null = null
function officialLevelHashes(): Promise<Set<string>> {
  bundledHashes ??= (async () => {
    const set = new Set<string>()
    for (const meta of LEVELS) set.add(await levelHash(meta.json))
    return set
  })()
  return bundledHashes
}

/** Lokale Duplikat-Prüfung VOR dem Upload: offizielle Level + Userlevel-Sync-Cache.
 *  Rechnet immer mit dem AKTUELLEN Hash-Algorithmus (unabhängig davon, welcher Build
 *  die Hashes in der DB geschrieben hat) und braucht kein Netz; der Server prüft
 *  danach nochmal per String-Vergleich als zweites Netz. */
async function isDuplicateLocally(hash: string): Promise<boolean> {
  if ((await officialLevelHashes()).has(hash)) return true
  for (const entry of loadUserLevelCache().levels) {
    if ((await levelHash(entry.json)) === hash) return true
  }
  return false
}

/**
 * Level hochladen — SCHNELL: der Server speichert nur (status 'pending') und
 * antwortet sofort; Moderation + Übersetzung stoßen wir danach fire-and-forget an
 * und niemand wartet darauf. Die fachlichen Tore (eineindeutig, Mörder existiert)
 * prüft der Aufrufer vor dem Upload über `checkLevel` (Editor-Save-Gate); Kopien
 * fängt zuerst die LOKALE Fingerprint-Prüfung (ohne Netz), danach der Server.
 */
export async function uploadUserLevel(level: LevelJson): Promise<UploadResult> {
  const hash = await levelHash(level)
  if (await isDuplicateLocally(hash)) return { ok: false, error: 'duplicate' }
  let body: { success: boolean; data?: { id: number }; error?: string }
  try {
    body = (await post('addUserlevel.php', {
      level: JSON.stringify(level),
      hash,
    })) as typeof body
  } catch {
    return { ok: false, error: 'network' }
  }
  if (body.success && body.data) {
    kickProcessing()
    return { ok: true, id: body.data.id }
  }
  const error: UploadError =
    body.error === 'duplicate'
      ? 'duplicate'
      : body.error === 'content'
        ? 'content'
        : body.error === 'too fast'
          ? 'tooFast'
          : 'rejected'
  return { ok: false, error }
}

/* ------------------------------ Anzeige-Helfer --------------------------------- */

/** Ø-Sterne (1 Nachkommastelle wird beim Rendern formatiert), null = unbewertet. */
export function averageStars(stats: UserLevelStats): number | null {
  return stats.ratings === 0 ? null : stats.stars / stats.ratings
}

/** Die (max. 2) meistgewählten Eigenschaften eines Levels — das ist auch die Menge,
 *  auf die der Eigenschaften-Filter matcht. */
export function topTags(stats: UserLevelStats): UserLevelTag[] {
  return USERLEVEL_TAGS.filter((t) => stats.tags[t] > 0)
    .sort((a, b) => stats.tags[b] - stats.tags[a])
    .slice(0, 2)
}

/** Auswahl des Userlevel-Screens (Thema ist Desktop-only, wie in der Levelauswahl). */
export interface UserLevelFilter {
  size: string | 'all'
  theme: string | 'all'
  /** '4'…'1' = mindestens Ø 4…1 Sterne; 'unrated' = noch ohne Bewertung. */
  stars: 'all' | '4' | '3' | '2' | '1' | 'unrated'
  /** Gelöst-Status; 'toRate' = gelöst, aber von DIESEM Spieler noch nicht bewertet
   *  (zum Nachbewerten: Level erneut lösen → Sterne-Zeile erscheint wieder). */
  status: 'all' | 'solved' | 'unsolved' | 'toRate'
  /** Eigenschaft (Desktop-only, wie das Thema): matcht die Top-2-Tags des Levels;
   *  der Auto-Tag „Ausprobieren" ist ebenfalls wählbar. */
  tag: 'all' | UserLevelTag | typeof NO_LOGIC_TAG
}

export const DEFAULT_USERLEVEL_FILTER: UserLevelFilter = {
  size: 'all',
  theme: 'all',
  stars: 'all',
  status: 'all',
  tag: 'all',
}

export function matchesStarsFilter(
  entry: UserLevelEntry,
  stars: UserLevelFilter['stars'],
): boolean {
  const avg = averageStars(entry.stats)
  if (stars === 'all') return true
  if (stars === 'unrated') return avg === null
  return avg !== null && avg >= Number(stars)
}

export function matchesTagFilter(entry: UserLevelEntry, tag: UserLevelFilter['tag']): boolean {
  if (tag === 'all') return true
  if (tag === NO_LOGIC_TAG) return !entry.logic
  return topTags(entry.stats).includes(tag)
}
