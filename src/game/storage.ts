/** localStorage persistence: solved levels, in-progress board, saved levels. */
import { Capacitor } from '@capacitor/core'
import type { LevelJson } from '../engine/index.ts'
import { normalizeBoardClues } from './editorModel.ts'
import type { LevelFilter } from './levels.ts'

const SOLVED_KEY = 'murdoku.solved.v1'
const RESULTS_KEY = 'murdoku.results.v1'
const PROGRESS_PREFIX = 'murdoku.progress.v1.'
const TIME_PREFIX = 'murdoku.time.v1.'
const HINTS_PREFIX = 'murdoku.hintsused.v1.'
const CUSTOM_KEY = 'murdoku.custom.v1'
const EDITOR_DRAFT_KEY = 'murdoku.editordraft.v1'
const FILTER_KEY = 'murdoku.filter.v1'
const SHOW_HIDDEN_AUTHOR_KEY = 'murdoku.showhiddenauthor.v1'
const ERASE_HINT_KEY = 'murdoku.erasehint.v1'
const GEN_SETTINGS_KEY = 'murdoku.gensettings.v1'
const APP_SETTINGS_KEY = 'murdoku.settings.v1'
const DAILY_LEVELS_KEY = 'murdoku.daily.levels.v1'

/** A board state flattened to JSON-friendly arrays (Maps/Sets don't serialize). */
export interface SavedState {
  placements: [string, number][]
  marks: [number, string[]][]
  crosses: number[]
  /** Subset of `crosses` set by hand (X-tool); optional for back-compat. */
  manualCrosses?: number[]
}

/** In-progress game: the current board plus the full undo history, so stepping back
 *  (Undo) survives a reload. Legacy saves stored just the bare board (no `present`). */
export interface SavedProgress {
  present: SavedState
  past: SavedState[]
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable / full — ignore */
  }
}

export function loadSolved(): Set<string> {
  return new Set(read<string[]>(SOLVED_KEY, []))
}

/** The level picker's last filter selection. Pass DEFAULT_FILTER as the fallback.
 *  Merged over the fallback so a selection stored before a filter key existed
 *  (e.g. `theme`) still yields a complete filter. */
export function loadFilter(fallback: LevelFilter): LevelFilter {
  return { ...fallback, ...read<Partial<LevelFilter>>(FILTER_KEY, {}) }
}

export function saveFilter(filter: LevelFilter): void {
  write(FILTER_KEY, filter)
}

/** Secret toggle (five quick taps on the picker title): reveal the hidden author's
 *  levels. Off by default, so those levels stay hidden until the player unlocks them. */
export function loadShowHiddenAuthor(): boolean {
  return read<boolean>(SHOW_HIDDEN_AUTHOR_KEY, false)
}

export function saveShowHiddenAuthor(value: boolean): void {
  write(SHOW_HIDDEN_AUTHOR_KEY, value)
}

/** The generator form's last selection (size, difficulty, theme, objects, openings). */
export interface GenSettings {
  size: number
  difficulty: string
  theme: string
  objects: string[]
  windows: boolean
  doors: boolean
}

/** Pass the form defaults as the fallback for a first-time visitor. */
export function loadGenSettings(fallback: GenSettings): GenSettings {
  return { ...fallback, ...read<Partial<GenSettings>>(GEN_SETTINGS_KEY, {}) }
}

export function saveGenSettings(settings: GenSettings): void {
  write(GEN_SETTINGS_KEY, settings)
}

/** Global app settings (gear menu). Spread over the defaults so new options
 *  added later fall back gracefully for returning players. */
export function loadAppSettings<T extends object>(fallback: T): T {
  return { ...fallback, ...read<Partial<T>>(APP_SETTINGS_KEY, {}) }
}

export function saveAppSettings(settings: unknown): void {
  write(APP_SETTINGS_KEY, settings)
}

/** Per-level best result: the FEWEST hints ever needed to solve it (0 = "solo", no hint).
 *  A better (lower) count overwrites the old one, so re-solving hint-free earns the medal. */
export interface LevelResult {
  hints: number
}

export function loadResults(): Record<string, LevelResult> {
  return read<Record<string, LevelResult>>(RESULTS_KEY, {})
}

/** The best (fewest) hint count recorded for a level, or null if solved without a record
 *  (legacy solves) / not solved. */
export function bestHints(id: string): number | null {
  const r = loadResults()[id]
  return r ? r.hints : null
}

export function markSolved(id: string, hints?: number): void {
  const solved = loadSolved()
  solved.add(id)
  write(SOLVED_KEY, [...solved])
  if (hints === undefined) return
  const results = loadResults()
  const prev = results[id]?.hints
  // Keep the best (fewest) — a hint-free re-solve upgrades an earlier hinted one.
  if (prev === undefined || hints < prev) {
    results[id] = { hints }
    write(RESULTS_KEY, results)
  }
}

export function loadProgress(id: string): SavedProgress | null {
  const raw = read<unknown>(PROGRESS_PREFIX + id, null)
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Partial<SavedProgress>
  // New format carries `present` + `past`; a legacy save IS the bare board state.
  if (obj.present) return { present: obj.present, past: obj.past ?? [] }
  return { present: raw as SavedState, past: [] }
}

export function saveProgress(id: string, progress: SavedProgress): void {
  write(PROGRESS_PREFIX + id, progress)
}

export function clearProgress(id: string): void {
  try {
    localStorage.removeItem(PROGRESS_PREFIX + id)
  } catch {
    /* ignore */
  }
}

/** Elapsed play time per level (seconds) — persists alongside the board progress, so
 *  leaving a level and coming back resumes the clock. Cleared only on a win/restart. */
export function loadElapsed(id: string): number {
  const s = read<number>(TIME_PREFIX + id, 0)
  return Number.isFinite(s) && s > 0 ? Math.floor(s) : 0
}

export function saveElapsed(id: string, seconds: number): void {
  write(TIME_PREFIX + id, seconds)
}

export function clearElapsed(id: string): void {
  try {
    localStorage.removeItem(TIME_PREFIX + id)
  } catch {
    /* ignore */
  }
}

/** Hints taken so far on the CURRENT attempt — persists alongside the board progress so
 *  leaving a half-solved level and resuming keeps the tally honest (otherwise a resumed
 *  solve would wrongly count as hint-free). Cleared only on a win/restart/reset. */
export function loadHintsUsed(id: string): number {
  const n = read<number>(HINTS_PREFIX + id, 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export function saveHintsUsed(id: string, hints: number): void {
  write(HINTS_PREFIX + id, hints)
}

export function clearHintsUsed(id: string): void {
  try {
    localStorage.removeItem(HINTS_PREFIX + id)
  } catch {
    /* ignore */
  }
}

/** Player-kept generated levels, newest first. */
/**
 * Saved levels are persisted JSON and outlive refactors, so this is the boundary where a
 * shape from an older build has to be brought up to date — before anything hands it to
 * `loadLevel`, which (rightly) throws on a board-clue type it doesn't know. Covers the level
 * list, playing a custom level, and opening one in the editor alike.
 */
export function loadCustomLevels(): LevelJson[] {
  return read<LevelJson[]>(CUSTOM_KEY, []).map((level) => ({
    ...level,
    boardClues: normalizeBoardClues(level.boardClues),
  }))
}

export function saveCustomLevel(level: LevelJson): void {
  const list = loadCustomLevels().filter((l) => l.id !== level.id)
  list.unshift(level)
  write(CUSTOM_KEY, list)
}

export function isCustomSaved(id: string): boolean {
  return loadCustomLevels().some((l) => l.id === id)
}

/** Generated daily levels by day key ('2026-07-23'). Persisted JSON outlives
 *  refactors, so it passes the same board-clue migration boundary as customs —
 *  and once stored, a day NEVER regenerates (even if the generator changes). */
export function loadDailyLevels(): Record<string, LevelJson> {
  const raw = read<Record<string, LevelJson>>(DAILY_LEVELS_KEY, {})
  return Object.fromEntries(
    Object.entries(raw).map(([day, level]) => [
      day,
      { ...level, boardClues: normalizeBoardClues(level.boardClues) },
    ]),
  )
}

export function saveDailyLevel(day: string, level: LevelJson): void {
  write(DAILY_LEVELS_KEY, { ...loadDailyLevels(), [day]: level })
}

/** The in-progress editor draft (so leaving the editor to test-play never loses work). */
/**
 * Whether the eraser's "tap cells / hold for everything" note has been shown. The button
 * carries two reaches of one action, which is worth saying ONCE — at the moment the player
 * first arms it — and never again.
 */
export function eraseHintSeen(): boolean {
  return read<boolean>(ERASE_HINT_KEY, false)
}

export function markEraseHintSeen(): void {
  write(ERASE_HINT_KEY, true)
}

export function loadEditorDraft<T>(): T | null {
  return read<T | null>(EDITOR_DRAFT_KEY, null)
}

export function saveEditorDraft(draft: unknown): void {
  write(EDITOR_DRAFT_KEY, draft)
}

export function clearEditorDraft(): void {
  try {
    localStorage.removeItem(EDITOR_DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Save a level as a .json file (named after its title/id). On the web this triggers a
 * normal browser download; on native (Android) a plain blob download lands in an
 * unpredictable place, so instead we write the file into the app cache and hand it to
 * the OS share sheet — the user then picks Files / Drive / … and knows exactly where it
 * went. Resolves once done; rejects if the native share is dismissed or fails.
 */
export async function exportLevelJson(level: LevelJson): Promise<void> {
  const base = (level.title ?? level.id).trim().replace(/[^\w-]+/g, '_') || level.id
  const filename = `${base}.json`
  const json = JSON.stringify(level, null, 2)

  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    // `files` (not `url`) shares the actual file — Capacitor converts the cache URI to a
    // shareable content:// URI via its FileProvider, so Files/Drive/… receive the .json.
    await Share.share({ title: filename, files: [uri], dialogTitle: filename })
    return
  }

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
