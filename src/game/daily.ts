/**
 * Rätsel des Tages: one shared case per calendar day, identical for EVERY player.
 *
 * Everything a day looks like (difficulty, board size, case number) derives
 * deterministically from the date alone — so the calendar can show any day's
 * difficulty without ever generating its level. The level itself is generated on
 * first open through the deterministic daily pool (fixed seed streams, attempt-
 * bound budget — see generatorClient) and then persisted for good: a stored day
 * never regenerates, even after app updates change the generator.
 *
 * Dates are the PLAYER'S local calendar days; all day arithmetic runs in UTC on
 * the day keys themselves so DST can never skip or double a day.
 */
import type { LevelJson } from '../engine/index.ts'
import { GENERATOR_OBJECT_TYPES, type GenDifficulty } from '../engine/generator/index.ts'
import { Rng } from '../engine/generator/random.ts'
import { generateDailyLevelAsync, type GenHandle } from './generatorClient.ts'
import { loadDailyLevels, saveDailyLevel } from './storage.ts'
import i18n, { SUPPORTED_LANGS } from '../i18n/index.ts'

/** First month with dailies: July 2026 (the calendar never navigates earlier). */
export const DAILY_START = { year: 2026, month: 7 }

const DAY_MS = 86_400_000
const SIZES = [5, 6, 7, 8] as const
const DIFFS: GenDifficulty[] = ['easy', 'medium', 'hard']
const ID_PREFIX = 'daily-'

/* ------------------------------------------------------------ day keys */

const pad2 = (n: number) => String(n).padStart(2, '0')

export function makeKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function parseKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number)
  return { year: y, month: m, day: d }
}

/** Today's key from the player's local clock. */
export function todayKey(now: Date = new Date()): string {
  return makeKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Key of the calendar day `delta` days away from `key` (UTC arithmetic — DST-safe). */
export function shiftKey(key: string, delta: number): string {
  const { year, month, day } = parseKey(key)
  const d = new Date(Date.UTC(year, month - 1, day) + delta * DAY_MS)
  return makeKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Running case number: 2026-07-01 is Fall № 1, counted up ever since. */
export function caseNumber(key: string): number {
  const { year, month, day } = parseKey(key)
  return (Date.UTC(year, month - 1, day) - Date.UTC(DAILY_START.year, DAILY_START.month - 1, 1)) / DAY_MS + 1
}

export function dailyLevelId(key: string): string {
  return ID_PREFIX + key
}

export function isDailyId(id: string): boolean {
  return id.startsWith(ID_PREFIX)
}

export function dailyKeyOf(id: string): string {
  return id.slice(ID_PREFIX.length)
}

/** The next catch-up target after `key`: the first later day up to `today` whose
 *  case is still open — null when there is none (in particular when `key` IS
 *  today). Drives the win dialog's "next level" for dailies: catching up walks
 *  forward through the open days and stops at today. */
export function nextOpenDailyKey(
  key: string,
  today: string,
  isSolved: (levelId: string) => boolean,
): string | null {
  for (let k = shiftKey(key, 1); k <= today; k = shiftKey(k, 1)) {
    if (!isSolved(dailyLevelId(k))) return k
  }
  return null
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/* ------------------------------------------------------- month schedule */

export interface MonthPlan {
  /** Index 0 = the 1st of the month. */
  difficulties: GenDifficulty[]
  sizes: number[]
}

/** Seed for a month's plan — a fixed, date-only mix (identical for all players). */
function planSeed(year: number, month: number): number {
  return (Math.imul(year * 100 + month, 2654435761) ^ 0x9e3779b9) >>> 0
}

/**
 * The month's difficulty/size assignment: easy/medium/hard in even thirds (the
 * 1–2 remainder days rotate through the difficulties month by month, so no tier
 * is systematically favoured), sizes 5×5–8×8 in even fourths — both shuffled
 * deterministically. The calendar reads this to label days it never generated.
 */
export function monthPlan(year: number, month: number): MonthPlan {
  const days = daysInMonth(year, month)
  const rng = new Rng(planSeed(year, month))
  const base = Math.floor(days / 3)
  const extra = days % 3
  const rot = (year * 12 + month) % 3
  const difficulties: GenDifficulty[] = []
  DIFFS.forEach((diff, i) => {
    const count = base + ((i - rot + 3) % 3 < extra ? 1 : 0)
    for (let k = 0; k < count; k++) difficulties.push(diff)
  })
  rng.shuffle(difficulties)
  const sizes: number[] = []
  for (let i = 0; i < days; i++) sizes.push(SIZES[i % SIZES.length])
  rng.shuffle(sizes)
  return { difficulties, sizes }
}

export interface DayInfo {
  key: string
  year: number
  month: number
  day: number
  caseNo: number
  difficulty: GenDifficulty
  size: number
}

export function dayInfo(key: string): DayInfo {
  const { year, month, day } = parseKey(key)
  const plan = monthPlan(year, month)
  return {
    key,
    year,
    month,
    day,
    caseNo: caseNumber(key),
    difficulty: plan.difficulties[day - 1],
    size: plan.sizes[day - 1],
  }
}

/* ------------------------------------------------------------- streaks */

export interface DailyStreaks {
  /** Consecutive solved days ending today (or yesterday if today is open). */
  current: number
  best: number
}

/** The solved daily DAY KEYS hiding in the game's solved-id set. */
export function solvedDailyDays(solvedIds: Iterable<string>): string[] {
  return [...solvedIds].filter(isDailyId).map(dailyKeyOf)
}

/** Streaks over the solved days. WHEN a day was solved doesn't matter — catching
 *  up heals the chain retroactively (user's call), so the streak is simply the
 *  longest run of consecutive solved calendar days. */
export function dailyStreaks(solvedDays: Iterable<string>, today: string): DailyStreaks {
  const days = new Set(solvedDays)
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const k of [...days].sort()) {
    run = prev !== null && shiftKey(prev, 1) === k ? run + 1 : 1
    if (run > best) best = run
    prev = k
  }
  let current = 0
  let cursor = days.has(today) ? today : shiftKey(today, -1)
  while (days.has(cursor)) {
    current++
    cursor = shiftKey(cursor, -1)
  }
  return { current, best: Math.max(best, current) }
}

/* ----------------------------------------------------------- generation */

/** Seed for one day's generation; `round` provides a deterministic retry ladder
 *  (round 1 only ever runs if round 0 found nothing — on EVERY device alike). */
function dailySeed(caseNo: number, round: number): number {
  return (Math.imul(caseNo, 2654435761) ^ Math.imul(round + 1, 40503)) >>> 0
}

/** Intl locale for a UI language ('pt' is European Portuguese throughout the app). */
function intlTag(lang: string): string {
  return lang === 'pt' ? 'pt-PT' : lang
}

/** Localised long date of a day key ("23. Juli 2026"). */
export function formatDayLong(key: string, lang: string): string {
  const { year, month, day } = parseKey(key)
  return new Intl.DateTimeFormat(intlTag(lang), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day, 12))
}

/** Month name / weekday helpers for the calendar UI. */
export function formatMonthYear(year: number, month: number, lang: string): string {
  return new Intl.DateTimeFormat(intlTag(lang), { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1, 12),
  )
}

/** Short month for the narrow calendar leaf ("Juli", "Sept." — long names clip). */
export function formatMonthShort(year: number, month: number, lang: string): string {
  return new Intl.DateTimeFormat(intlTag(lang), { month: 'short' }).format(
    new Date(year, month - 1, 1, 12),
  )
}

/** Short weekday for the leaf ("Do.", "jeu." — pt's "quinta-feira" would clip). */
export function formatWeekdayShort(key: string, lang: string): string {
  const { year, month, day } = parseKey(key)
  return new Intl.DateTimeFormat(intlTag(lang), { weekday: 'short' }).format(
    new Date(year, month - 1, day, 12),
  )
}

/** Mo–So column headers, Monday first (2024-01-01 was a Monday). */
export function weekdayHeaders(lang: string): string[] {
  const fmt = new Intl.DateTimeFormat(intlTag(lang), { weekday: 'short' })
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(2024, 0, 1 + i, 12)).replace(/\.$/, ''),
  )
}

/** Monday-based column (0–6) of the 1st of a month. */
export function firstWeekdayColumn(year: number, month: number): number {
  return (new Date(year, month - 1, 1, 12).getDay() + 6) % 7
}

/** Brand a freshly generated level as THE case of `info.key`: stable id, the
 *  scheduled difficulty as its label, and a dated title in every language. */
function brandDaily(level: LevelJson, info: DayInfo): LevelJson {
  const titles: Record<string, string> = {}
  for (const lang of SUPPORTED_LANGS) {
    titles[lang] = i18n.t('daily.levelTitle', { lng: lang, date: formatDayLong(info.key, lang) })
  }
  return {
    ...level,
    id: dailyLevelId(info.key),
    difficulty: info.difficulty,
    title: titles.de,
    titles,
  }
}

export interface DailyHandle {
  promise: Promise<LevelJson>
  cancel: () => void
}

/**
 * The level for a day: stored → returned as-is (never regenerated); otherwise
 * generated deterministically and persisted. Up to three seed rounds — a round
 * only ever runs if the previous one found nothing, which is itself a
 * deterministic fact of the date, so every player walks the same ladder.
 */
export function getDailyLevel(key: string): DailyHandle {
  const stored = loadDailyLevels()[key]
  if (stored) return { promise: Promise.resolve(stored), cancel: () => {} }

  const info = dayInfo(key)
  let cancelled = false
  let inner: GenHandle | null = null
  const promise = (async () => {
    let lastError: Error = new Error('generation failed')
    for (let round = 0; round < 3; round++) {
      if (cancelled) throw new Error('cancelled')
      inner = generateDailyLevelAsync({
        width: info.size,
        height: info.size,
        suspects: info.size - 1,
        difficulty: info.difficulty,
        // The full object set in its fixed catalogue order — part of the seed contract.
        objects: [...GENERATOR_OBJECT_TYPES],
        windows: true,
        doors: false,
        seed: dailySeed(info.caseNo, round),
      })
      try {
        const level = brandDaily(await inner.promise, info)
        saveDailyLevel(key, level)
        return level
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (lastError.message === 'cancelled') throw lastError
      }
    }
    throw lastError
  })()

  return {
    promise,
    cancel: () => {
      cancelled = true
      inner?.cancel()
    },
  }
}
