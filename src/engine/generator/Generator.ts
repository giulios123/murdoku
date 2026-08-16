import { Rng } from './random.ts'
import { suspectPerson, victimPerson } from './names.ts'
import { loadLevel } from '../io/LevelLoader.ts'
import { Solution } from '../model/Solution.ts'
import { SearchSolver } from '../solver/SearchSolver.ts'
import { findMurderer } from '../solver/murderer.ts'
import { DeductionEngine } from '../solver/DeductionEngine.ts'
import { checkLevel } from '../solver/validate.ts'
import { startCoverage } from '../solver/coverage.ts'
import { createClue } from '../clues/ClueFactory.ts'
import { createBoardClue } from '../clues/boardClues.ts'
import { NeighborRoomCountClue } from '../clues/socialClues.ts'
import { AndClue } from '../clues/compositeClues.ts'
import type { Clue } from '../clues/Clue.ts'
import { Puzzle } from '../model/Puzzle.ts'
import { Suspect } from '../model/Suspect.ts'
import { VICTIM_ID, inDirection8, HAIR_COLORS } from '../model/types.ts'
import type { AttributeValue, Cell, Direction, PersonId, Side } from '../model/types.ts'
import { OBJECT_CATALOG, EDITOR_ONLY_TYPES, type ObjectDef } from '../model/objects.ts'
import { furnishRooms, kitFor } from './furnishing.ts'
import type { Board } from '../model/Board.ts'
import type { BoardClueJson, LevelJson, SuspectJson } from '../io/LevelSchema.ts'
import type { ClueJson } from '../clues/ClueFactory.ts'
import type { ObjectMate } from '../clues/objectClues.ts'

interface Theme {
  id: string
  rooms: string[]
  /** Outdoor rooms: where a car may stand AND what counts as "outside" for inside/outside clues. */
  outdoor: string[]
}

// The generator places from the shared object catalog (same one the editor paints).
const ALL_OBJECTS: readonly ObjectDef[] = OBJECT_CATALOG
const OCCUPIABLE: ObjectDef[] = ALL_OBJECTS.filter((o) => o.occupiable)

/** Every placeable object type (for the UI's per-object toggles). Editor-only types
 *  (e.g. street, which must be laid as a continuous run) are excluded. */
export const GENERATOR_OBJECT_TYPES: string[] = ALL_OBJECTS.filter(
  (o) => !EDITOR_ONLY_TYPES.has(o.type),
).map((o) => o.type)

/** Object types that may occur by default; the rest are opt-in via `options.objects`. */
export const DEFAULT_OBJECT_TYPES: string[] = [
  'carpet',
  'chair',
  'bed',
  'table',
  'tv',
  'plant',
  'shelf',
  'box',
]

// Room names are i18n keys (room.*) so they translate in-game (de/en). Each theme
// lists 15 rooms; the generator picks a random subset per level.
const THEMES: Theme[] = [
  {
    // Merged 2026-07-11: apartment + crime-scene + game-night were near-identical
    // domestic themes — one best-of room pool replaces all three. (Old theme ids
    // survive only in saved level ids/titles; levels reference room keys, never
    // theme ids, so nothing breaks.)
    id: 'home',
    rooms: ['room.living', 'room.kitchen', 'room.bath', 'room.bedroom', 'room.kidsroom', 'room.gameroom', 'room.study', 'room.guestroom', 'room.hallway', 'room.dining', 'room.balcony', 'room.garage', 'room.basement', 'room.attic', 'room.laundry'],
    outdoor: ['room.garage', 'room.balcony'],
  },
  {
    // Merged: mansion + museum — both stately interiors of galleries, statues and
    // old libraries; the museum vault makes a fine crime-scene centrepiece.
    id: 'manor',
    rooms: ['room.entrancehall', 'room.salon', 'room.dininghall', 'room.ballroom', 'room.library', 'room.musicroom', 'room.maingallery', 'room.vault', 'room.boudoir', 'room.smokingroom', 'room.winecellar', 'room.greenhouse', 'room.servantsroom', 'room.archive', 'room.firesideroom'],
    outdoor: [],
  },
  {
    // Merged: hotel + restaurant — one hospitality house from lobby to wine cellar.
    id: 'grandhotel',
    rooms: ['room.lobby', 'room.frontdesk', 'room.restaurant', 'room.bar', 'room.suite', 'room.kitchen', 'room.winecellar', 'room.terrace', 'room.rooftop', 'room.spa', 'room.gym', 'room.luggageroom', 'room.breakfastroom', 'room.elevator', 'room.laundrette'],
    outdoor: ['room.terrace', 'room.rooftop'],
  },
  {
    // Merged: police-station + office — the noir precinct keeps its cells and
    // interrogation room, padded with the office rooms both shared anyway.
    id: 'precinct',
    rooms: ['room.openoffice', 'room.meeting', 'room.receptionarea', 'room.chiefoffice', 'room.interrogation', 'room.cell1', 'room.cell2', 'room.armory', 'room.forensics', 'room.evidenceroom', 'room.lockerroom', 'room.breakroom', 'room.archive', 'room.briefing', 'room.garage'],
    outdoor: ['room.garage'],
  },
  {
    id: 'auto-shop',
    rooms: ['room.workshop', 'room.storage', 'room.office', 'room.waiting', 'room.yard', 'room.washbay', 'room.partsstore', 'room.tirestore', 'room.reception', 'room.paintshop', 'room.assembly', 'room.testbay', 'room.breakroom', 'room.checkout', 'room.gasstation'],
    outdoor: ['room.workshop', 'room.yard', 'room.washbay', 'room.assembly', 'room.paintshop', 'room.testbay', 'room.gasstation'],
  },
  {
    id: 'school',
    rooms: ['room.classroom', 'room.assemblyhall', 'room.gymnasium', 'room.library', 'room.teachersroom', 'room.secretariat', 'room.schoolyard', 'room.chemlab', 'room.musichall', 'room.canteen', 'room.craftroom', 'room.computerroom', 'room.lockerroom', 'room.artroom', 'room.hallway'],
    outdoor: ['room.schoolyard'],
  },
  {
    id: 'hospital',
    rooms: ['room.reception', 'room.waitingroom', 'room.operating', 'room.ward', 'room.lab', 'room.pharmacy', 'room.xray', 'room.icu', 'room.commonroom', 'room.emergency', 'room.deliveryroom', 'room.sterilization', 'room.office', 'room.cafeteria', 'room.hallway'],
    outdoor: [],
  },
  {
    id: 'farm',
    rooms: ['room.pasture', 'room.yard', 'room.garden', 'room.shed', 'room.farmhouse', 'room.cowshed', 'room.pigsty', 'room.barn', 'room.henhouse', 'room.stable', 'room.greenhouse', 'room.pantry', 'room.dairy', 'room.field', 'room.pond'],
    outdoor: ['room.pasture', 'room.yard', 'room.garden', 'room.field', 'room.pond'],
  },
  {
    id: 'supermarkt',
    rooms: ['room.checkout', 'room.snacks', 'room.drinks', 'room.deli', 'room.fruit', 'room.chilled', 'room.toys', 'room.stockroom', 'room.bakery', 'room.produce', 'room.cheese', 'room.frozen', 'room.drugstore', 'room.staffroom', 'room.parking'],
    outdoor: ['room.parking'],
  },
  {
    id: 'camping',
    rooms: ['room.forest', 'room.clearing', 'room.lake', 'room.campsite1', 'room.campsite2', 'room.campfire', 'room.picnicarea', 'room.jetty', 'room.playground', 'room.parking', 'room.restroom', 'room.showers', 'room.kiosk', 'room.reception', 'room.cabin'],
    outdoor: ['room.forest', 'room.clearing', 'room.lake', 'room.campsite1', 'room.campsite2', 'room.campfire', 'room.picnicarea', 'room.jetty', 'room.playground', 'room.parking'],
  },
  {
    id: 'castle',
    rooms: ['room.throneroom', 'room.knightshall', 'room.armory', 'room.chapel', 'room.dungeon', 'room.towerroom', 'room.battlements', 'room.courtyard', 'room.stable', 'room.winecellar', 'room.castlekitchen', 'room.library', 'room.chamber', 'room.gatehouse', 'room.moat'],
    outdoor: ['room.battlements', 'room.courtyard', 'room.moat'],
  },
  {
    id: 'pool',
    rooms: ['room.mainpool', 'room.kidspool', 'room.lawn', 'room.sauna', 'room.steamroom', 'room.slidetower', 'room.massage', 'room.relaxroom', 'room.lockerroom', 'room.showers', 'room.restroom', 'room.kiosk', 'room.bar', 'room.reception', 'room.terrace'],
    outdoor: ['room.mainpool', 'room.kidspool', 'room.lawn', 'room.slidetower', 'room.terrace'],
  },
  {
    // Every animal room carries its animal (Dirk: "Elefantenanlage nur mit Elefant").
    // Penguin pool + flamingo pond are WATER rooms (see isWaterRoom).
    id: 'zoo',
    rooms: ['room.zooentrance', 'room.monkeyhouse', 'room.predatorhouse', 'room.bearpit', 'room.elephantyard', 'room.penguinpool', 'room.flamingopond', 'room.aviary', 'room.terrarium', 'room.pettingzoo', 'room.feedkitchen', 'room.vetstation', 'room.zooshop', 'room.picnicmeadow', 'room.zooschool'],
    outdoor: ['room.zooentrance', 'room.bearpit', 'room.elephantyard', 'room.penguinpool', 'room.flamingopond', 'room.aviary', 'room.pettingzoo', 'room.picnicmeadow'],
  },
  {
    // The snowy outdoor rooms are winter rooms (see isWinterRoom): trees and
    // boulders there render as their snowed-in variants.
    id: 'ski',
    rooms: ['room.gaststube', 'room.hutkitchen', 'room.snowbar', 'room.sunterrace', 'room.mattresscamp', 'room.lockerroom', 'room.skirental', 'room.skidepot', 'room.valleystation', 'room.topstation', 'room.piste', 'room.beginnerhill', 'room.sledrun', 'room.icerink', 'room.igloo'],
    outdoor: ['room.sunterrace', 'room.valleystation', 'room.topstation', 'room.piste', 'room.beginnerhill', 'room.sledrun', 'room.icerink', 'room.igloo'],
  },
]
const ROOM_COLORS = ['#e8d8b0', '#b9d0e6', '#cfe0cf', '#d8c0c0', '#e6cda0', '#e6c0d2', '#c6c0e0', '#c0e0c8']

/** Theme ids the generator knows (for the UI's theme picker). */
export const THEME_IDS: string[] = THEMES.map((t) => t.id)

/** A theme's room names (used as nameKeys, same as generated levels). */
export function themeRooms(id: string): string[] {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0]).rooms
}

/** A theme's outdoor room names (→ rooms[].outside for inside/outside clues). */
export function themeOutdoor(id: string): string[] {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0]).outdoor
}

/**
 * The object types that naturally belong to a theme — every object any of its rooms'
 * archetypes would place (a farm offers animals, a supermarket fridges, a garage cars).
 * The generator UI uses this to PRE-SELECT sensible objects when a theme is picked; the
 * user can still toggle. For "random" (no theme) it returns the plain defaults.
 */
export function themeDefaultObjects(themeId?: string): string[] {
  const theme = THEMES.find((t) => t.id === themeId)
  if (!theme) return [...DEFAULT_OBJECT_TYPES]
  return kitFor(theme.rooms, theme.outdoor)
}

/**
 * Guess which theme a level belongs to from its room nameKeys — the theme whose
 * room set shares the most keys with the level. Used by the editor to preselect
 * the theme when opening an existing level. Returns null if nothing overlaps
 * (e.g. a level using only generic room.editor* slots), so callers can keep a default.
 */
export function themeFromRoomKeys(keys: readonly string[]): string | null {
  const wanted = new Set(keys)
  let best: { id: string; score: number } | null = null
  for (const theme of THEMES) {
    const score = theme.rooms.reduce((n, key) => n + (wanted.has(key) ? 1 : 0), 0)
    if (score > 0 && (!best || score > best.score)) best = { id: theme.id, score }
  }
  return best?.id ?? null
}

export type GenDifficulty = 'easy' | 'medium' | 'hard'

/**
 * How long the generator may search. The CALLER sets this: the Web Worker passes a
 * generous budget (it can run long because Cancel = worker.terminate() kills it
 * instantly), while the main-thread fallback passes a tight one (there a synchronous
 * run blocks the UI and Cancel can't interrupt). Omitted → each entry point's own
 * historical default (so dev tools / tests are unaffected).
 */
export interface GenBudget {
  /** Max generation attempts before giving up. */
  maxAttempts: number
  /** Soft budget (ms): once a candidate exists, stop hunting for a better one. */
  softMs: number
  /** Hard wall-clock cap (ms): give up (and report failure) even with nothing found. */
  hardMs: number
  /** Cap for the easy path's fast-failing construction attempts (default 200000).
   *  The daily case sets this: its result must be bound by ATTEMPTS, never by the
   *  wall clock — a faster device must not see a different level. */
  easyAttempts?: number
}

export interface GenerateOptions {
  width: number
  height: number
  suspects: number
  seed?: number
  themeId?: string
  difficulty?: GenDifficulty
  /** Object types allowed on the board (default: DEFAULT_OBJECT_TYPES). */
  objects?: string[]
  /** Allow windows (on by default); some levels then get 2–6 of them. */
  windows?: boolean
  /** Place a few doors between rooms (enables "beside a door" clues). */
  doors?: boolean
  /** Search budget (see GenBudget). Omitted → historical defaults. */
  budget?: GenBudget
  /** Variety cooldown (the client's local memory, game/variety.ts): capped clue FAMILIES
   *  kept out of the candidate pools — but only while the search still has comfortable
   *  time (fail-open past the soft deadline), so a cooldown can never cause "kein Level". */
  bannedFamilies?: string[]
  /** Variety spotlight: ONE capped family to actively feature — a random suspect is
   *  narrowed onto it (the requiredClues mechanics). A soft wish: skipped when no suspect
   *  has a matching candidate, dropped past the soft deadline, and never applied to the
   *  easy construction (it pins by cell sets). */
  spotlightFamily?: string
  /** Per-request overrides of the per-level family caps (e.g. the daily's { offset: 1 }).
   *  Purely rule-based — never clock-dependent, so the DETERMINISTIC daily may use it. */
  familyCaps?: Record<string, number>
}

/** Random traits: gender; men beard/bald; everyone glasses + hair colour. */
function makeAttributes(gender: 'm' | 'f', rng: Rng): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = { gender }
  attrs.glasses = rng.chance(0.4)
  attrs.beard = gender === 'm' && rng.chance(0.5)
  attrs.bald = gender === 'm' && rng.chance(0.3)
  // A bald person has no hair → no hair colour (the avatar draws none), so hair clues
  // never hinge on them. They can still be asked about via the `bald` trait.
  if (attrs.bald !== true) attrs.hair = rng.pick(HAIR_COLORS)
  return attrs
}

/** Bias the random traits so each pinned "Vorgabe" value has ≥ count+1 carriers among
 *  the suspects: an existence clue ("≥count others with hair=white in the room") can only
 *  be generated if enough suspects actually wear it. Respects gender for beard/bald (men
 *  only). The +1 buffer gives the placement room to put `count` of them with a host.
 *  Raises the odds only — placement still has to co-locate them (the retry loop handles
 *  the rest). */
function seedRequiredAttributes(
  suspects: SuspectJson[],
  reqs: { attribute: string; value: AttributeValue; count: number }[],
  rng: Rng,
): void {
  for (const { attribute, value, count } of reqs) {
    const need = count + 1
    const has = (s: SuspectJson): boolean => s.attributes?.[attribute] === value
    const eligible = (s: SuspectJson): boolean =>
      attribute === 'beard' || attribute === 'bald' ? s.attributes?.gender === 'm' : true
    let carriers = suspects.filter(has).length
    if (carriers >= need) continue
    for (const s of rng.shuffle(suspects.filter((s) => !has(s) && eligible(s)))) {
      if (carriers >= need) break
      const attrs = { ...(s.attributes ?? {}), [attribute]: value }
      // Changing someone to female drops the men-only traits so the suspect stays consistent.
      if (attribute === 'gender' && value === 'f') {
        attrs.beard = false
        attrs.bald = false
      }
      // A hair colour means visible hair → the carrier can't be bald.
      if (attribute === 'hair') attrs.bald = false
      s.attributes = attrs
      carriers++
    }
  }
}

/**
 * Trait seeds the BOARD's own global clues demand — "exactly N with hair=brown were inside"
 * is only a board-WIDE statement if at least two suspects wear the trait (see the same bar in
 * `trueBoardClues`). The editor keeps a global clue the user placed, whatever the fill rolls,
 * so a single carrier leaves them with a clue that is really about one person and says nothing
 * once that person's own clue already confines them.
 *
 * It has to be derived HERE and not in the game layer: that builds `requiredAttributes` from
 * the suspect-clue palette alone (`requiredAttrSeeds`) and never looks at `board.boardClues` —
 * which is exactly how a user-placed trait clue ended up with one lone carrier.
 */
function boardClueAttrSeeds(board: LevelJson): { attribute: string; value: AttributeValue; count: number }[] {
  const seeds: { attribute: string; value: AttributeValue; count: number }[] = []
  for (const bc of board.boardClues ?? []) {
    if (bc.type !== 'countWithAttr') continue
    // seedRequiredAttributes guarantees count+1 carriers, and the clue itself needs `bc.count`
    // of them in its area — so ask for one more than both bars.
    seeds.push({ attribute: bc.attribute, value: bc.value, count: Math.max(1, bc.count) })
  }
  return seeds
}

/** Human-logic rating — the construction oracle. The DEFAULT engine is PURE forward +
 *  convergent deduction (no "assume X → contradiction"), so a level it fully solves is
 *  BOTH human-solvable AND unique (the engine never guesses). `maxRank` is the hardest
 *  technique the solution needs. One cheap call gives uniqueness + difficulty AND the
 *  guarantee that the hint chain a player follows is free of trial-and-error. A level
 *  that needs a contradiction simply comes back `solved: false` and is rejected. */
/** Combinatorial "chain" techniques — the cross-referencing reasoning the user enjoys
 *  at hard ("E & F take columns 2+3 ⇒ nobody else there ⇒ B is column 1 ⇒ D column 8"):
 *  naked groups / rectangle (set reservation), forced cells ("doppelter Ausschluss"),
 *  and the counting/capacity rules. NOT the trivial naked-single domino. */
const CHAIN_TECHNIQUES = [
  'nakedGroupRows', 'nakedGroupCols', 'rectangle',
  'forcedCell',
  'boardCount', 'emptyRooms', 'emptyRoomForcing', 'roomAssignment',
  'roomCapacity', 'roomCoverage', 'companionPairing', 'companionFit',
] as const

/**
 * Node budget for EVERY uniqueness search the generator runs (same idea as the editor's
 * CHECK_BUDGET, and the same fail-closed rule): the worst bundled level proves uniqueness
 * in ≈18k nodes, i.e. 27× headroom — but a rare 11×11/12×12 candidate ran 12–32 SECONDS
 * unbudgeted (measured), silently eating half a worker's whole budget. An aborted search
 * NEVER counts as unique; the candidate (or prune step) is simply discarded. One shared
 * constant everywhere, so a candidate accepted in pickBestLevel deterministically passes
 * the identical re-checks in pruneClues and assertShippable.
 */
const UNIQUE_NODE_BUDGET = 500_000

function logicRating(level: LevelJson): LogicRating {
  return logicRatingOn(loadLevel(level))
}

type LogicRating = {
  solved: boolean
  unique: boolean
  maxRank: number
  chainSteps: number
  /**
   * How many deduction steps pass before the FIRST suspect can be placed — the user's "spät
   * setzen von Eindeutigkeiten", i.e. how long the board resists before it gives anyone away.
   * Higher = harder: the player must cross out and cross-reference before anything is certain.
   *
   * Measured against the hand-made `museum` (the user's reference for "logical but hard"): it
   * holds out for 24 steps, generated hard levels for 8 — and, relative to their chain length,
   * generated "hard" levels (21–27%) gave a suspect away EARLIER than hand-made EASY ones
   * (31–50%). Use the ABSOLUTE count, not the fraction: easy chains are only 13–17 steps long,
   * so the fraction flatters them, and the mean placement position separates nothing.
   */
  openingSteps: number
  /** Suspects the forward deduction never managed to place — where a clue would actually help. */
  stuck: PersonId[]
}

/** `logicRating` on an ALREADY-LOADED puzzle — the construction hot path builds its Puzzle
 *  directly from cached pieces (board parsed once, clue instances reused so their
 *  candidateCells memo stays warm across hundreds of solves) instead of round-tripping
 *  through LevelJson + loadLevel on every single rating. */
function logicRatingOn(puzzle: Puzzle): LogicRating {
  // Accept ONLY levels solvable by straight forward deduction — NO case split. The user
  // found auto-generated case-splits ("Fallunterscheidung") too frequent and too deep to
  // solve by hand. Players/hints still get the full pipeline for hand-made levels.
  const result = new DeductionEngine(puzzle, { noCaseSplit: true }).solve()
  const chainSteps = CHAIN_TECHNIQUES.reduce((n, t) => n + (result.techniqueCounts[t] ?? 0), 0)
  // WHO the forward deduction could not place, and WHEN the first one fell. Every placement is
  // a NakedSingle-style step — the ONLY ones carrying `placedCell`; every other technique
  // merely eliminates until one cell is left. Both numbers below rest on that: the stragglers
  // are the suspects that never got such a step, and `openingSteps` is where the first one is.
  // A second placing technique would silently break both — see TECHNIQUE_RANK / forward.ts.
  const placedByEngine = new Set<PersonId>()
  let openingSteps = result.steps.length
  result.steps.forEach((step, i) => {
    if (step.placedCell === undefined || !step.personId) return
    if (placedByEngine.size === 0) openingSteps = i
    placedByEngine.add(step.personId)
  })
  const stuck = puzzle.suspects.map((s) => s.id).filter((id) => !placedByEngine.has(id))
  // `unique` is LAZY, and that matters: the clue construction calls this hundreds of times per
  // attempt but only ever reads `solved` / `maxRank`. Computing the uniqueness search eagerly
  // meant every one of those solves also paid for a full backtracking search nobody looked at
  // (measured: 8–13% of all solver time). Only pickBestLevel and pruneClues touch it — once
  // each, on a candidate that already passed. Memoised, so reading it twice is free.
  //
  // Same primitive `checkLevel` uses, and only meaningful when forward-solvable: counting
  // solutions on a dead candidate would needlessly exhaust the board.
  let uniqueCache: boolean | undefined
  return {
    solved: result.solved,
    maxRank: result.maxRank,
    chainSteps,
    openingSteps,
    stuck,
    get unique(): boolean {
      if (uniqueCache === undefined) {
        if (!result.solved) {
          uniqueCache = false
        } else {
          // Budgeted + fail-closed: an aborted search is NOT a uniqueness proof.
          const solver = new SearchSolver(puzzle)
          uniqueCache = solver.countSolutions(2, UNIQUE_NODE_BUDGET) === 1 && !solver.aborted
        }
      }
      return uniqueCache
    },
  }
}

/**
 * Does ANY clue carry nothing — i.e. can it be dropped and the case still cracks?
 *
 * Such a clue is pure noise: the player reads it, reasons with it, and it turns out to have
 * been decorative. Measured before this gate existed, ~15–20% of all clues were droppable —
 * in generated AND hand-made levels alike, because the old `pruneClues` only ever shed ANDed
 * PARTS and never questioned a suspect's single clue.
 *
 * The probe is the FORWARD engine alone (no uniqueness search): a level it solves forward is
 * cracked without guessing, which is exactly what "this clue wasn't needed" means. That is
 * one forward solve per clue part — affordable only because callers run it on candidates
 * that already passed the full rating.
 *
 * Note a redundant clue can never be REPAIRED by swapping it: if the case cracks without any
 * clue for that suspect, every clue for them is equally pointless — the level is
 * over-determined by the OTHERS. Only a different candidate helps, so this is a gate, not a
 * fix-up.
 */
function hasRedundantClue(level: LevelJson): boolean {
  for (const suspect of level.suspects) {
    const clue = (suspect.clues ?? [])[0]
    if (!clue) continue
    const parts = clue.type === 'and' ? clue.clues : [clue]
    for (let i = 0; i < parts.length; i++) {
      const rest = parts.filter((_, j) => j !== i)
      const trial: LevelJson = {
        ...level,
        suspects: level.suspects.map((s) =>
          s.id === suspect.id
            ? {
                ...s,
                // Dropping the LAST part leaves the suspect clueless — still a fair probe:
                // if the case cracks even then, that clue was carrying nothing.
                clues: rest.length === 0 ? [] : [rest.length === 1 ? rest[0] : { type: 'and', clues: rest }],
              }
            : s,
        ),
      }
      if (new DeductionEngine(loadLevel(trial), { noCaseSplit: true }).solve().solved) return true
    }
  }
  return false
}

/** The hardest forward-deduction rank that DEFINES each tier (see TECHNIQUE_RANK):
 *  medium MUST need a rank-4 room/count deduction, hard a rank-5 one (murder rule,
 *  group-room reasoning, or the CONVERGENT "egal wo X → raus" case split) — all pure
 *  human logic; contradiction case splits and forcing/SAT are never used. */
const TARGET_RANK: Record<GenDifficulty, number> = { easy: 1, medium: 4, hard: 5 }
const targetRankOf = (d?: GenDifficulty): number => (d ? TARGET_RANK[d] : TARGET_RANK.hard)

/** Honest tier from the rank a level actually needs: rank ≥5 ⇒ hard (murder rule),
 *  rank 4 ⇒ medium (room counting), below ⇒ easy. Lets a level that falls short of its
 *  requested tier be labelled by what it truly is. */
function rankToTier(maxRank: number): GenDifficulty {
  if (maxRank >= TARGET_RANK.hard) return 'hard'
  if (maxRank >= TARGET_RANK.medium) return 'medium'
  return 'easy'
}

/**
 * Start-coverage bar per tier (easy is exempt). Two complementary checks so the
 * board feels FULL without demanding that every clue is broad:
 *  - `constrainedRatio`: union over suspects whose clue actually pins cells —
 *    "allein"/"im selben Raum wie X" can't game the union (hard ≥85%, medium ≥75%);
 *  - `avgBreadth`: a few broad clues ("nicht neben einer Pflanze", "nicht in einer
 *    Ecke") must lift the mean domain size (hard ≥25%, medium ≥18%) — tight 2-cell
 *    anchors stay legitimate, reference levels sit at 27–39%.
 */
/** Gentle breadth preference (NO fixed bars, per the user): among comparable
 *  candidates, the level whose clues keep more of the board open wins — measured as
 *  the union over restricted suspects ("allein" etc. can't game it). */
function breadthPenalty(level: LevelJson): number {
  return Math.round((1 - startCoverage(loadLevel(level)).constrainedRatio) * 60)
}

/**
 * The "hard" clue families — relational/social clues a player can only use by
 * cross-referencing OTHER people: "one direction from <person>", "beside the same
 * <object> as <person / someone with a trait>", and the whole "in a room WITH
 * someone (with a trait)" group. They are inherently BROAD (many candidate cells),
 * so piling many of them onto a level makes it both harder and more open — the
 * user's definition of a hard level (à la Museum / Der Bauernhof), as opposed to
 * the old "needs a rank-5 technique" definition. Scales with the board on its own:
 * more suspects ⇒ room for more such clues.
 */
const HARD_CLUE_TYPES = new Set<string>([
  'direction', // one direction from a person
  'directionFromAttr', // one direction from someone with a trait
  'offsetFrom', // exact distance from an ANONYMOUS someone (trait / on/beside object)
  'besideSameObject', // same object instance as a person / someone with a trait
  'roomExists', // in a room where someone (with a trait) was on/beside an object
  'roomCompanion', // alone with someone who has a trait
  'roomAttribute', // none / someone / everyone else in the room had a trait
  'sameRoom', // same room as a person
  'adjacentRooms', // one room over from a person
  'neighborRoomEmpty', // a neighbouring room was (not) empty — needs everyone else's rooms
  'neighborRoomCount', // a neighbouring room held exactly N suspects
  'insideXor', // exactly one of the two was outside
])

/** Leaf clue types, flattening `and` and unwrapping `not`. */
function leafTypes(clue: ClueJson): string[] {
  if (clue.type === 'and') return clue.clues.flatMap(leafTypes)
  if (clue.type === 'not') return leafTypes(clue.clue)
  return [clue.type]
}

/** Families EXEMPT from the "max 2 per family" variety cap: each instance reads as a
 *  DIFFERENT clue (a different object / room / window-vs-door), so repeating them isn't
 *  monotonous — unlike a chain of "north of …". Row/column clues are NOT exempt: they're
 *  capped AND actively avoided (especially at easy). */
const UNCAPPED_TYPES = new Set<string>([
  'onObject', 'uniqueOnObject',
  'nearObject', 'uniqueNearObject', 'nearObjectAny',
  // Both name a specific ROOM, so each instance reads as a different clue ("next to the
  // kitchen" vs "next to the garage") — the same reason plain `inRoom` is exempt.
  'inRoom', 'inRoomAdjacentTo',
  'nearWindow', 'uniqueNearWindow',
  'nearDoor', 'uniqueNearDoor',
])
/** The capped families of a clue (the ones the variety limit counts). Row and column
 *  clues collapse to one "line" family; the two person/attribute direction clues collapse
 *  to one "direction" family (so "west of Alex" and "south-west of Alex" — or two
 *  directions off ANY anchor — count together and can't both appear); ALL exact-distance
 *  clues collapse to one "offset" family — "genau N Zeilen/Spalten von …" reads the same
 *  whether the anchor is a person, an anonymous someone or an object tile, and three of
 *  them in one level read monotonous (Dirk, 16.08.2026); the two "what was in a room NEXT
 *  to his" clues collapse to one, so a level can't stack four near-identical neighbour
 *  statements. */
const cappedFamilies = (clue: ClueJson): string[] =>
  leafTypes(clue)
    .filter((t) => !UNCAPPED_TYPES.has(t))
    .map((t) => {
      if (t === 'inRow' || t === 'inCol') return 'line'
      if (t === 'direction' || t === 'directionFromAttr') return 'direction'
      if (t === 'offset' || t === 'offsetFrom' || t === 'offsetFromObject') return 'offset'
      if (t === 'neighborRoomEmpty' || t === 'neighborRoomCount') return 'neighborRoom'
      return t
    })

/** Per-family variety limit: at most ONE "line" (row/column) clue per level — the user
 *  finds two "in row/column X" clues poor puzzling — at most ONE person/attribute
 *  "direction" clue (two directions, e.g. off the same person, read repetitive and pile up
 *  at hard), and at most two of every other capped family. */
const familyCap = (family: string): number =>
  family === 'line' || family === 'direction' ? 1 : 2

/** Does a suspect's clue use a HARD (relational/social) family? */
const isHardClue = (clue: ClueJson): boolean => leafTypes(clue).some((t) => HARD_CLUE_TYPES.has(t))

/** The capped families of every suspect clue of a level, with multiplicity — the unit
 *  the client's variety memory (game/variety.ts) counts. Single source: cappedFamilies,
 *  so the cooldown counts exactly what the in-level caps count. */
export function levelClueFamilies(level: LevelJson): string[] {
  const out: string[] = []
  for (const s of level.suspects) for (const c of s.clues ?? []) out.push(...cappedFamilies(c))
  return out
}

/**
 * Apply the client's variety plan to freshly built candidate pools: drop banned families,
 * then narrow one random suspect onto the spotlight family (the requiredClues mechanics).
 * Fail-open BY DESIGN: callers pass strict=false once the soft deadline has passed, a
 * spotlight with no possible host is simply skipped, and a ban that empties someone's
 * pool only fails THIS attempt (the free retries come via strict=false). Never applied
 * to the easy construction's spotlight — it pins by intersecting cell sets, and a purely
 * relational family would leave the host unpinnable (same reason requiredClues treats
 * easy specially).
 */
function applyVariety(
  candidates: Map<PersonId, ClueJson[]>,
  plan: { bannedFamilies?: string[]; spotlightFamily?: string },
  strict: boolean,
  rng: Rng,
  easyConstruct: boolean,
): boolean {
  if (!strict) return true
  const banned = new Set(plan.bannedFamilies ?? [])
  if (banned.size > 0) {
    for (const [id, pool] of candidates) {
      const kept = pool.filter((j) => !cappedFamilies(j).some((f) => banned.has(f)))
      if (kept.length === 0) return false
      candidates.set(id, kept)
    }
  }
  const fam = plan.spotlightFamily
  if (fam && !easyConstruct) {
    const hosts = [...candidates.keys()].filter((id) =>
      candidates.get(id)!.some((j) => cappedFamilies(j).includes(fam)),
    )
    const host = rng.shuffle(hosts)[0]
    if (host !== undefined) {
      candidates.set(host, candidates.get(host)!.filter((j) => cappedFamilies(j).includes(fam)))
    }
  }
  return true
}

/** Canonical signature of a clue, independent of `and`-part order and key order. Two
 *  suspects whose clue has the same signature show the IDENTICAL hint — which the user
 *  rejects: never the exact same clue twice in one level. The subject ("he/she") is NOT
 *  part of the clue, so "he was not beside a locker" and "she was not beside a locker"
 *  count as the same. */
function clueSig(clue: ClueJson): string {
  if (clue.type === 'and') return `and(${clue.clues.map(clueSig).sort().join('|')})`
  if (clue.type === 'not') return `not(${clueSig(clue.clue)})`
  const params = Object.keys(clue)
    .filter((k) => k !== 'type')
    .sort()
    .map((k) => `${k}=${JSON.stringify((clue as Record<string, unknown>)[k])}`)
  return `${clue.type}(${params.join(',')})`
}

/** How many of these clues are an exact repeat of an earlier one (0 ⇒ all distinct). */
function duplicateClueCount(clues: ClueJson[]): number {
  const seen = new Set<string>()
  let dup = 0
  for (const c of clues) {
    const sig = clueSig(c)
    if (seen.has(sig)) dup++
    else seen.add(sig)
  }
  return dup
}

/** An EXACT-coordinate clue: it pins ONE axis precisely — a fixed row/column, or an exact
 *  cell-distance offset from someone. TWO of them together reveal the exact cell, which the
 *  user forbids ("one offset is great, but never two that give away the direct spot"). */
function isExactAxisClue(clue: ClueJson): boolean {
  const c = clue.type === 'not' ? clue.clue : clue
  if (c.type === 'offset' || c.type === 'inRow' || c.type === 'inCol' || c.type === 'offsetFromObject') {
    return true
  }
  // The object-anchored offsetFrom kinds pin the subject to a FIXED line set (their
  // anchor cells don't move); the trait kind doesn't — its anchor moves with people.
  return c.type === 'offsetFrom' && c.who.kind !== 'attr'
}

/** How many suspects carry a hard relational/social clue. */
function hardClueCount(level: LevelJson): number {
  let n = 0
  for (const s of level.suspects) if ((s.clues ?? []).some(isHardClue)) n++
  return n
}

/** Size-scaled goal for hard: a majority of suspects should carry a hard clue
 *  (4×4 ≈ 2, 6×6 ≈ 3, 9×9 ≈ 5) — "many hard clues, scaled to the board" per the user. */
function wantHardClues(level: LevelJson): number {
  return Math.max(1, Math.round(level.suspects.length * 0.6))
}

/** Honest tier for a solvable candidate. A level ordered as HARD earns the label three ways:
 *  enough hard relational clues, the rank-5 murder rule — or the USER's definition (16.07.,
 *  their sign-off): it clears both bars (Ausdehnung ≥75 %, Breite ≥50 %) and still needs at
 *  least medium-grade deduction. Without the third way the pool's best picks (95–100 %
 *  Ausdehnung, spätes Setzen — hard by the user's own words) shipped labelled "medium":
 *  measured 7 of 8. Saved levels keep their stored label; only fresh ratings use this. */
function tierFor(level: LevelJson, target: GenDifficulty | undefined, maxRank: number): GenDifficulty {
  if (target === 'hard') {
    if (hardClueCount(level) >= wantHardClues(level) || maxRank >= TARGET_RANK.hard) return 'hard'
    if (maxRank >= TARGET_RANK.medium) {
      const cov = startCoverage(loadLevel(level))
      if (
        Math.round(cov.constrainedRatio * 100) >= HARD_COVERAGE_BAR &&
        Math.round(cov.avgBreadth * 100) >= HARD_BREADTH_BAR
      ) {
        return 'hard'
      }
    }
  }
  return rankToTier(maxRank)
}

/**
 * What HARD means, in the user's words: "ein hartes Level macht nicht aus, dass wir harte
 * Hinweise nutzen, sondern es ist der Mix aus logischen Ketten, spätem Setzen von
 * Eindeutigkeiten, viele wenn dann dann, eine gute Ausdehnung dass der Anfang für den
 * Menschen nicht so einfach ist" — and the Ausdehnung must hold for MANY suspects, not one.
 *
 * The two bars are the user's own, from before they were quietly dropped as unreachable (the
 * orphaned doc above `breadthPenalty` is their gravestone). They were unreachable because the
 * construction was broken, not because the numbers were wrong: with the dedup deadlock, the
 * cap repair and the inverted "widening" fixed, candidates now reach 96–100% Ausdehnung.
 * Reference: the hand-made `museum` sits at 98% / 38% and holds out 24 steps.
 */
const HARD_COVERAGE_BAR = 75 // constrainedRatio %: how much board is still in play at the start
const HARD_BREADTH_BAR = 50 // avgBreadth %: and it must be spread over MANY suspects

/** Score a solvable candidate (lower = better).
 *
 *  HARD is a BAR plus a preference. A candidate clearing both bars always beats one that does
 *  not (the user's call: "harte Hürde + Auffangnetz"); below the bar the miss is GRADED, so a
 *  near-miss still wins over a hopeless one and `pickBestLevel` degrades gracefully into the
 *  best available rather than returning nothing. Above the bar the ranking is the user's
 *  definition of hard: hold out before placing anyone, force long chains, keep the board open.
 *
 *  Hard clue TYPES still count and more of them is still better — they are inherently broad, so
 *  they serve the same end ("je mehr harte und je mehr Breite super"). They are just not the
 *  only route to it: `museum`, the user's reference for "logisch aber echt hart", reaches 98%
 *  Ausdehnung with ONE. Breadth is the goal, the clue type a means. The technique rank is only
 *  a floor (stay ≥ medium) — "ich brauche nicht super harte Hinweise (also Level 5)".
 *
 *  Easy/medium keep the rank-nearness score (then few pins, breadth, few line clues). */
function scoreLevel(
  level: LevelJson,
  target: GenDifficulty | undefined,
  maxRank: number,
  pins: number,
  chainSteps = 0,
  openingSteps = 0,
): number {
  const lines = countLineClues(level)
  if (target === 'hard') {
    const cov = startCoverage(loadLevel(level))
    const coverage = Math.round(cov.constrainedRatio * 100)
    const breadth = Math.round(cov.avgBreadth * 100)
    const floorMiss = Math.max(0, TARGET_RANK.medium - maxRank)
    const barMiss =
      Math.max(0, HARD_COVERAGE_BAR - coverage) + Math.max(0, HARD_BREADTH_BAR - breadth)
    return (
      // The RANK FLOOR outranks everything: a level asked for as hard must at least need
      // medium-grade deduction. As a mere 2000-point penalty it was BUYABLE — coverage*10 and
      // openingSteps*100 together offer far more, so wide rank-3 candidates won and shipped
      // labelled "easy" after the user asked for hard (measured: 2 of 8). "Nicht super harte
      // Hinweise (also Level 5)" means rank 5 is no goal — not that rank 3 will do.
      (floorMiss > 0 ? 10_000_000 : 0) +
      floorMiss * 2000 + // graded, so a board that can't do better still yields its best
      (barMiss > 0 ? 1_000_000 : 0) + // the bar: any level clearing it beats any that doesn't
      barMiss * 100 - // graded below it, so the fallback still picks the closest
      openingSteps * 100 - // resist before giving a suspect away (museum 24, generated 8)
      chainSteps * 150 - // "viele wenn dann dann"
      hardClueCount(level) * 200 - // broad by nature, so more of them serves breadth too
      coverage * 10 -
      breadth * 10 +
      pins * 100 +
      lines * 50
    )
  }
  const rankMiss = Math.abs(maxRank - targetRankOf(target))
  // Row/column clues read as dull coordinates — prefer the attempt with fewer (the user
  // wants them rare at easy). The per-attempt line reduction is the main lever; this only
  // breaks ties when several candidates exist.
  return rankMiss * 1000 + pins * 100 + lines * 20 + breadthPenalty(level)
}

/** A candidate good enough to stop the search early. For hard that means it clears BOTH of the
 *  user's bars and reaches the size-scaled hard-clue goal (staying ≥ medium-hard); otherwise it
 *  is the exact target rank. Pins / line clues must be absent either way.
 *
 *  The bars belong here, not just in the score: this stops the hunt, and asking only for hard
 *  clue types let a CRAMPED level end the search the moment it had enough of them — exactly
 *  the levels the user calls "nur bedingt hart". */
function isIdeal(level: LevelJson, target: GenDifficulty | undefined, maxRank: number, pins: number): boolean {
  if (pins !== 0 || countLineClues(level) !== 0) return false
  if (target === 'hard') {
    const cov = startCoverage(loadLevel(level))
    return (
      maxRank >= TARGET_RANK.medium &&
      Math.round(cov.constrainedRatio * 100) >= HARD_COVERAGE_BAR &&
      Math.round(cov.avgBreadth * 100) >= HARD_BREADTH_BAR &&
      hardClueCount(level) >= wantHardClues(level)
    )
  }
  return maxRank === targetRankOf(target)
}

/** Cap on "was in row X / column Y" clues per level (rows + columns combined) — they are
 *  coordinate-y and dull, so keep them scarce. */
const MAX_LINE_CLUES = 1

/** One generation attempt → a candidate level (with its pin count), or null. `strict`
 *  is the variety fail-open switch: true while the search still has comfortable time
 *  (bans/spotlight apply), false once the soft deadline passed without a candidate —
 *  then the attempt searches FREE, so a cooldown can never cause "kein Level". */
type Attempt = (rng: Rng, seedIndex: number, strict: boolean) => { level: LevelJson; pins: number } | null

/**
 * Does any BOARD (global) clue carry nothing — the case cracks without it?
 *
 * The suspect-clue counterpart is `hasRedundantClue`, a hard gate in `pickBestLevel`. Global
 * clues can't work that way in the editor: they are the USER's, so the fill must keep them and
 * cannot prune them (free generation's `pruneClues` does drop the unneeded ones). Gating the
 * fill on them was measured and rejected — 7 of 12 useless clues became 0, but 3 of 12 fills
 * then produced nothing and the wait tripled. So the editor REPORTS it instead of refusing.
 *
 * Same probe and bar as `hasRedundantClue`: the forward engine alone.
 */
export function redundantBoardClues(level: LevelJson): number[] {
  const bcs = level.boardClues ?? []
  const out: number[] = []
  for (let i = 0; i < bcs.length; i++) {
    const without: LevelJson = { ...level, boardClues: bcs.filter((_, j) => j !== i) }
    if (new DeductionEngine(loadLevel(without), { noCaseSplit: true }).solve().solved) out.push(i)
  }
  return out
}

interface PickOptions {
  /** Cap on attempts (default 80). */
  maxAttempts?: number
  /** Soft budget: once a candidate exists, stop hunting for a better one (default 2800ms). */
  timeBudgetMs?: number
  /** Hard cap: give up even with nothing found yet (default: none — keep trying to the
   *  attempt cap). The fixed-board fill sets this so a stubborn board can't hang. */
  hardTimeBudgetMs?: number
}

/**
 * Run many attempts and keep the best PURE-LOGIC candidate for the target tier. Every
 * eligible level is solvable by forward + convergent deduction (⇒ unique) with NO
 * proof-by-contradiction; among those the score prefers the exact target rank, then
 * pin-free, then line-free. A board that can't reach the target rank still yields its
 * loosest human-solvable level (rated honestly by `rankToTier`), so we always return a
 * logical level — never a trial-and-error one. Returns null only if nothing solves.
 */
function pickBestLevel(
  attempt: Attempt,
  baseSeed: number,
  target: GenDifficulty | undefined,
  opts: PickOptions = {},
): LevelJson | null {
  const maxAttempts = opts.maxAttempts ?? 120
  const softDeadline = performance.now() + (opts.timeBudgetMs ?? 3000)
  // Generation must ALWAYS finish well under a minute (user requirement).
  const hardDeadline = performance.now() + (opts.hardTimeBudgetMs ?? 45000)
  let best: LevelJson | null = null
  let bestScore = Infinity
  for (let a = 0; a < maxAttempts; a++) {
    // A crashing attempt counts as a FAILED attempt, nothing more: with ~40s budgets on
    // big boards, one rare edge case in attempt N would otherwise throw away every
    // candidate the run already paid for — and kill the worker with it (exactly how the
    // ">9 rooms" bug turned every 11×11/12×12 run into a 1-second failure).
    try {
      // Variety stays strict while the soft window lasts; attempts past it only ever run
      // when NOTHING was found yet — exactly when the cooldown must yield (fail-open).
      const result = attempt(new Rng(baseSeed + a * 7919), baseSeed + a, performance.now() < softDeadline)
      if (result) {
        const rating = logicRating(result.level)
        // Only human-solvable levels are eligible — the player must be able to solve by a
        // clean forward/convergent chain, never "assume X → contradiction". For hard the
        // score then maximises hard relational clues + breadth (rank only a floor); for
        // easy/medium it prefers the exact target rank. `rating.unique` is the SearchSolver
        // uniqueness check (guarantees uniqueness independent of engine soundness — a dense
        // object layout can shift the solution space, and a non-unique level must never slip).
        // EVERY clue must earn its place from MEDIUM up: a level where some clue could be
        // dropped and the case still cracks is rejected outright, however good it scores.
        // The user's call — they would rather get nothing than a level with a decorative clue.
        // Easy is exempt: its "Vorgaben" ride along on an already-pinned suspect and are
        // redundant BY DESIGN (a relational clue can't pin, and making it load-bearing would
        // push the level past rank 2, i.e. out of "easy").
        //
        // GATE ORDER: cheap before expensive. hasRedundantClue is a handful of forward
        // solves (ms) and rejects the large majority of candidates; rating.unique is a
        // (budgeted) full search that can cost ~0.5s on big boards — and it is LAZY, so
        // putting it last skips it entirely for every redundancy reject. Same conjunction,
        // same verdict, fingerprint-identical.
        const tightnessRequired = target !== 'easy'
        if (rating.solved && !(tightnessRequired && hasRedundantClue(result.level)) && rating.unique) {
          result.level.difficulty = tierFor(result.level, target, rating.maxRank)
          const score = scoreLevel(result.level, target, rating.maxRank, result.pins, rating.chainSteps, rating.openingSteps)
          if (score < bestScore) {
            best = result.level
            bestScore = score
          }
          if (isIdeal(result.level, target, rating.maxRank, result.pins)) break
        }
      }
    } catch {
      // see above — a crashed attempt must never end the hunt
    }
    // Once we hold a candidate, stop at the soft deadline; with nothing yet keep hunting
    // to the attempt cap / hard deadline (the worker passes a long budget, the
    // main-thread fallback a short one).
    if (best && performance.now() > softDeadline) break
    if (performance.now() > hardDeadline) break
  }
  return best
}

/**
 * Final tidy-up before a generated level ships: drop every clue the puzzle does NOT
 * actually need — ESPECIALLY the bonus board (global) clues, which are pure flavour and
 * are usually pointless in a generated level. A clue is removed only while the level stays
 * uniquely & human-solvably (forward deduction ⇒ unique, double-checked with countSolutions)
 * AND keeps its difficulty tier. Each suspect always keeps at least one clue; compound
 * (AND) suspect clues may shed redundant parts. Returns the pruned level.
 */
function pruneClues(level: LevelJson, target: GenDifficulty | undefined): LevelJson {
  const tier = level.difficulty as GenDifficulty
  // A candidate is acceptable iff still unique, human-solvable, and the SAME tier (and for
  // easy: still solvable by the simple rank-≤2 steps that define easy).
  const accepts = (lv: LevelJson): boolean => {
    const r = logicRating(lv)
    if (!r.solved || !r.unique) return false
    if (tierFor(lv, target, r.maxRank) !== tier) return false
    // Shedding an ANDed part must not collapse a clue onto another suspect's clue — the
    // user forbids two identical hints (the dedup is enforced in construction; keep it here).
    if (duplicateClueCount(lv.suspects.flatMap((s) => s.clues ?? [])) > 0) return false
    return tier !== 'easy' || r.maxRank <= 2
  }

  let work = level

  // 1) Board (global) clues — drop any that aren't needed. These are bonus flavour, so
  //    they almost always go (exactly what the user wants).
  if (work.boardClues && work.boardClues.length > 0) {
    const kept: BoardClueJson[] = []
    const all = work.boardClues
    for (let i = 0; i < all.length; i++) {
      const trial: LevelJson = { ...work, boardClues: [...kept, ...all.slice(i + 1)] }
      if (!accepts(trial)) kept.push(all[i]) // needed → keep it
    }
    work = { ...work, boardClues: kept }
  }

  // 2) Suspect clues — shed redundant ANDed parts (never below one clue per suspect).
  //    Committed incrementally so each test sees the already-pruned earlier suspects.
  for (const id of work.suspects.map((s) => s.id)) {
    const clue = work.suspects.find((s) => s.id === id)!.clues?.[0]
    if (!clue || clue.type !== 'and') continue
    let parts = clue.clues
    let changed = false
    for (let i = parts.length - 1; i >= 0 && parts.length > 1; i--) {
      const trial = parts.filter((_, j) => j !== i)
      const trialClue: ClueJson = trial.length === 1 ? trial[0] : { type: 'and', clues: trial }
      const lv: LevelJson = {
        ...work,
        suspects: work.suspects.map((s) => (s.id === id ? { ...s, clues: [trialClue] } : s)),
      }
      if (accepts(lv)) { parts = trial; changed = true }
    }
    if (changed) {
      const newClue: ClueJson = parts.length === 1 ? parts[0] : { type: 'and', clues: parts }
      work = { ...work, suspects: work.suspects.map((s) => (s.id === id ? { ...s, clues: [newClue] } : s)) }
    }
  }

  return work
}

/** Exact-cell pins read from a FINISHED level — the same predicate `countPins` applies to the
 *  construction's clue map (and(inRow+inCol) reveals the spot), just sourced from the JSON. */
function countPinsInLevel(level: LevelJson): number {
  let pins = 0
  for (const s of level.suspects) {
    const clue = (s.clues ?? [])[0]
    if (
      clue?.type === 'and' &&
      clue.clues.some((c) => c.type === 'inRow') &&
      clue.clues.some((c) => c.type === 'inCol')
    ) {
      pins++
    }
  }
  return pins
}

/**
 * Pick the best of several FINISHED levels on the SAME scale `pickBestLevel` used to choose
 * each of them: the worker pool generates one local best per worker (disjoint seed streams),
 * and the main thread must not judge the winners by a different measure than the workers
 * judged their candidates. One full rating per entry — a handful of solves, negligible next
 * to the seconds each worker spent producing its level.
 */
export function selectBestLevel(
  levels: readonly LevelJson[],
  target: GenDifficulty | undefined,
): LevelJson | null {
  let best: LevelJson | null = null
  let bestScore = Infinity
  for (const level of levels) {
    const rating = logicRating(level)
    const score = scoreLevel(level, target, rating.maxRank, countPinsInLevel(level), rating.chainSteps, rating.openingSteps)
    if (score < bestScore) {
      best = level
      bestScore = score
    }
  }
  return best
}

/** Is this the EXACT level safe to hand to a player: uniquely solvable AND crackable by
 *  straight forward deduction (no case split — the generator's fairness bar)? Uses the SAME
 *  `checkLevel` the editor's Check/Save use (DRY) — only `forwardOnly` tightens the bar. */
function isShippable(level: LevelJson): boolean {
  const c = checkLevel(loadLevel(level), { forwardOnly: true, budget: UNIQUE_NODE_BUDGET })
  return c.unique && c.solvable
}

/** Final gate before a generated level is returned: re-verify the EXACT level being shipped
 *  is unique AND forward-solvable, and REFUSE (throw) otherwise — a generation failure is
 *  always better than handing a player an ambiguous or unsolvable case. Should never fire
 *  (earlier stages guarantee it); it exists so a future regression can't ship a broken level. */
function assertShippable(level: LevelJson): LevelJson {
  const c = checkLevel(loadLevel(level), { forwardOnly: true, budget: UNIQUE_NODE_BUDGET })
  if (!c.unique || !c.solvable) {
    throw new Error(`Generated level failed final validation (forwardSolvable=${c.solvable}, unique=${c.unique})`)
  }
  return level
}

/** Generate a uniquely-solvable level. Throws if no seed yields one. */
export function generateLevel(options: GenerateOptions): LevelJson {
  const { width, height, suspects } = options
  const baseSeed = options.seed ?? Math.floor(Math.random() * 1e9)
  const pick = options.budget ? pickOptsFrom(options.budget) : {}

  // EASY is forward-constructed (cleaner, more easy-typical puzzles), but the
  // construction lands far less often on a random, sparsely-furnished board than on
  // a hand-drawn editor board — on some sizes effectively never. So: try the
  // construction up to the budget (fast-failing attempts), and if nothing lands,
  // fall back to generic selection rated nearest to easy so we ALWAYS return a level.
  if (options.difficulty === 'easy') {
    // ONE wall clock for BOTH phases: the construction loop gets ~60% of it, the generic
    // fallback the rest. Each phase used to run its own FULL hardMs, so the two could add
    // up to twice the budget — past the user's "never more than ~45s" line on big boards.
    const totalMs = options.budget?.hardMs ?? 20000
    const start = performance.now()
    const constructDeadline = start + totalMs * 0.6
    const easyCap = options.budget?.easyAttempts ?? 200000
    // Variety fail-open for the easy construction: strict for the first half of the
    // construction window, free afterwards (mirrors pickBestLevel's soft-deadline switch).
    const strictUntil = start + totalMs * 0.3
    for (let a = 0; a < easyCap && performance.now() < constructDeadline; a++) {
      // A crashing attempt counts as a failed one — never end the hunt (see pickBestLevel).
      try {
        const result = tryGenerate(options, new Rng(baseSeed + a * 7919), baseSeed + a, undefined, performance.now() < strictUntil)
        if (result) {
          // The construction already guarantees an easy-typical puzzle (rank ≤ 2,
          // hidden singles at most) — so it IS easy. Label it directly instead of
          // re-rating: difficultyOf treats a hidden single (rank 2) as "medium",
          // which would mislabel almost every constructed easy level.
          result.level.difficulty = 'easy'
          return assertShippable(pruneClues(result.level, 'easy'))
        }
      } catch {
        // crashed attempt — keep hunting
      }
    }
    const remainMs = Math.max(2000, totalMs - (performance.now() - start))
    const fallback = pickBestLevel(
      (rng, seedIndex, strict) => tryGenerate(options, rng, seedIndex, false, strict),
      baseSeed + 104729,
      'easy',
      { ...pick, hardTimeBudgetMs: Math.min(pick.hardTimeBudgetMs ?? remainMs, remainMs) },
    )
    if (fallback) return assertShippable(pruneClues(fallback, 'easy'))
    throw new Error(`Could not generate an easy ${width}x${height} level for ${suspects} suspects`)
  }

  const level = pickBestLevel(
    (rng, seedIndex, strict) => tryGenerate(options, rng, seedIndex, undefined, strict),
    baseSeed,
    options.difficulty,
    pick,
  )
  if (!level) throw new Error(`Could not generate a ${width}x${height} level for ${suspects} suspects`)
  return assertShippable(pruneClues(level, options.difficulty))
}

export interface FillBoardOptions {
  difficulty?: GenDifficulty
  seed?: number
  /** Search budget (see GenBudget). Omitted → historical defaults. */
  budget?: GenBudget
  /** "Zufällig setzen mit Vorgaben": one predicate PER required clue type. Each must be
   *  satisfied by at least one suspect — that suspect is restricted to the matching shape,
   *  everyone else keeps the full vocabulary (the generator fills the rest). Built in the
   *  game layer from the editor's constraint palette. */
  requiredClues?: ((json: ClueJson) => boolean)[]
  /** "Vorgaben" pinned trait values (built in the game layer). The generator seeds the
   *  random trait assignment so ≥ count+1 suspects carry each value — an existence clue
   *  like "≥count others with hair=white in the room" can only hold if enough suspects
   *  actually wear it; pure random assignment over many colours rarely produces enough. */
  requiredAttributes?: { attribute: string; value: AttributeValue; count: number }[]
  /** Keep the board's people exactly as given (names, gender, every styled trait) instead
   *  of rolling fresh identities — the editor's "Personen behalten". Only missing names
   *  are filled in (clue texts need one). The cast is never restyled, so trait seeding is
   *  skipped: a requirement this cast can't satisfy fails honestly instead of mutating it. */
  keepPeople?: boolean
  /** Variety cooldown / spotlight / cap overrides — same semantics as in GenerateOptions.
   *  The client only sends banned/spotlight for fills WITHOUT a "Vorgaben" palette (an
   *  explicit palette outranks the cooldown), and both are fail-open regardless. */
  bannedFamilies?: string[]
  spotlightFamily?: string
  familyCaps?: Record<string, number>
}

/** Translate a caller budget into pickBestLevel's knobs. */
function pickOptsFrom(budget: GenBudget): PickOptions {
  return { maxAttempts: budget.maxAttempts, timeBudgetMs: budget.softMs, hardTimeBudgetMs: budget.hardMs }
}

/**
 * Keep a finished board (rooms / objects / windows / doors / global clues) EXACTLY
 * as given, but (re)generate the people: fresh names + traits and a clue per suspect
 * so the murder puzzle is uniquely solvable at the requested difficulty. Suspect ids
 * and count come from `board.suspects`. Clues are restricted to the editor's flat
 * vocabulary so the result round-trips into the editor. Returns the filled level, or
 * null if no unique arrangement exists on this board.
 */
export function fillBoardClues(board: LevelJson, options: FillBoardOptions = {}): LevelJson | null {
  const suspectIds = board.suspects.map((s) => s.id)
  if (suspectIds.length === 0) return null
  const baseSeed = options.seed ?? Math.floor(Math.random() * 1e9)

  // EASY: every successful attempt is ALREADY a valid easy puzzle (≤2 simple clues, no
  // contradiction). On a hard/uniform board such layouts are rare, so we just keep trying
  // fresh placements until one lands or a generous time budget runs out — taking the first
  // that works (the user chose "search longer" over a guaranteed result).
  if (options.difficulty === 'easy') {
    const deadline = performance.now() + (options.budget?.hardMs ?? 20000)
    const easyCap = options.budget?.easyAttempts ?? 200000
    // Variety fail-open for the easy loop: strict for the first half of the wall clock,
    // free afterwards — mirrors pickBestLevel's soft-deadline switch.
    const strictUntil = performance.now() + (options.budget?.hardMs ?? 20000) * 0.5
    for (let a = 0; a < easyCap && performance.now() < deadline; a++) {
      // A crashing attempt counts as a failed one — never end the hunt (see pickBestLevel).
      try {
        const result = fillAttempt(
          board,
          suspectIds,
          new Rng(baseSeed + a * 7919),
          'easy',
          options.requiredClues,
          options.requiredAttributes,
          options.keepPeople,
          options,
          options.familyCaps,
          performance.now() < strictUntil,
        )
        if (result && isShippable(result.level)) {
          // Constructed easy fill (rank ≤ 2, verified in fillAttempt) — label it easy
          // directly; difficultyOf would mislabel a hidden-single level as "medium".
          result.level.difficulty = 'easy'
          return result.level
        }
      } catch {
        // crashed attempt — keep hunting
      }
    }
    return null
  }

  // The board is fixed, so a fill is harder to land than free generation — give it
  // more attempts but a firm time bound (it runs in a worker with a cancel button).
  const pick = options.budget
    ? pickOptsFrom(options.budget)
    : { maxAttempts: 400, timeBudgetMs: 5000, hardTimeBudgetMs: 20000 }
  const filled = pickBestLevel(
    (rng, _seedIndex, strict) =>
      fillAttempt(
        board,
        suspectIds,
        rng,
        options.difficulty,
        options.requiredClues,
        options.requiredAttributes,
        options.keepPeople,
        options,
        options.familyCaps,
        strict,
      ),
    baseSeed,
    options.difficulty,
    pick,
  )
  // Final gate: only return a fill that is genuinely unique & forward-solvable.
  return filled && isShippable(filled) ? filled : null
}

/** One people-fill attempt on the fixed board: fresh identities, a valid hidden
 *  placement consistent with the board's global clues, and editor-safe clues. */
function fillAttempt(
  board: LevelJson,
  suspectIds: PersonId[],
  rng: Rng,
  difficulty?: GenDifficulty,
  requiredClues?: ((json: ClueJson) => boolean)[],
  requiredAttributes?: { attribute: string; value: AttributeValue; count: number }[],
  keepPeople?: boolean,
  variety?: { bannedFamilies?: string[]; spotlightFamily?: string },
  familyCaps?: Record<string, number>,
  /** Variety fail-open switch (see Attempt): bans/spotlight apply only while true. */
  strict = true,
): { level: LevelJson; pins: number } | null {
  const usedName = new Set<string>()
  if (keepPeople) for (const s of board.suspects) if (s.name) usedName.add(s.name)
  const suspectMeta: SuspectJson[] = suspectIds.map((id, i) => {
    if (keepPeople) {
      // The author's cast, verbatim — only a missing name is rolled (clue texts need one).
      const given = board.suspects[i]
      const gender: 'm' | 'f' = given.attributes?.gender === 'f' ? 'f' : 'm'
      const name = given.name || suspectPerson(i, gender, usedName).name
      return { id, name, attributes: { ...(given.attributes ?? {}), gender }, clues: [] }
    }
    const gender: 'm' | 'f' = rng.chance(0.5) ? 'm' : 'f'
    const person = suspectPerson(i, gender, usedName)
    return { id, name: person.name, attributes: makeAttributes(gender, rng), clues: [] }
  })
  // The palette's seeds AND the board's own global clues — the latter are the user's and are
  // never pruned, so the fill must make them meaningful rather than hope the dice do.
  // A KEPT cast is never restyled: an unsatisfiable seed fails honestly in placeOnBoard /
  // clue construction instead of silently mutating the author's people.
  const seeds = [...(requiredAttributes ?? []), ...boardClueAttrSeeds(board)]
  if (!keepPeople && seeds.length > 0) seedRequiredAttributes(suspectMeta, seeds, rng)
  let victim: { name: string; gender: 'm' | 'f' }
  if (keepPeople) {
    // Keep the author's victim (name + shown gender); the hidden traits below stay
    // covert randomness either way. '?' is the editor's unnamed placeholder.
    const gender: 'm' | 'f' = board.victim.attributes?.gender === 'f' ? 'f' : 'm'
    const name =
      board.victim.name && board.victim.name !== '?' ? board.victim.name : victimPerson(rng, gender).name
    victim = { name, gender }
  } else {
    victim = victimPerson(rng)
  }
  const victimMeta = { name: victim.name, attributes: makeAttributes(victim.gender, rng) }
  const base: LevelJson = { ...board, suspects: suspectMeta, victim: victimMeta }
  const basePuzzle = loadLevel(base)

  const placement = placeOnBoard(basePuzzle, suspectIds, rng)
  if (!placement) return null
  const solution = new Solution(placement)

  const candidates = new Map<PersonId, ClueJson[]>()
  for (const id of suspectIds) {
    const others = suspectIds.filter((o) => o !== id)
    candidates.set(id, candidatesFor(id, solution, basePuzzle, others, true))
  }
  // Variety FIRST, "Vorgaben" second: an explicit palette outranks the cooldown — if a
  // ban starves a required matcher, this attempt dies and the strict=false retries run
  // free. (The client never sends both together anyway.)
  if (!applyVariety(candidates, variety ?? {}, strict, rng, difficulty === 'easy')) return null

  // "Vorgaben": every required clue type must be USED by at least one suspect.
  //
  // MEDIUM/HARD: restrict one distinct suspect per required type to the matching shapes;
  // everyone else keeps the full vocabulary, so a unique solution stays reachable.
  //
  // EASY is different and must NOT be narrowed: its construction pins suspects by
  // INTERSECTING CELL SETS, and a relational clue ("north of Bella") has no cell set at all.
  // Narrowing a host down to such a clue leaves them unpinnable, so every attempt dies and
  // the editor searches forever. constructEasyClues instead pins freely and then ANDs the
  // demanded clue onto an already-pinned suspect — see its `required` pass.
  if (requiredClues && requiredClues.length > 0) {
    if (requiredClues.length > suspectIds.length) return null
    if (difficulty !== 'easy') {
      const taken = new Set<PersonId>()
      // Most-constrained type first (fewest possible hosts) → better greedy matching.
      const byScarcity = requiredClues
        .map((pred) => ({ pred, hosts: suspectIds.filter((id) => candidates.get(id)!.some(pred)) }))
        .sort((a, b) => a.hosts.length - b.hosts.length)
      for (const { pred, hosts } of byScarcity) {
        // Pick a RANDOM qualifying suspect (not always the first), so the constraint isn't
        // always pinned to suspect A — any eligible suspect may carry it.
        const host = rng.shuffle(hosts.filter((id) => !taken.has(id)))[0]
        if (host === undefined) return null
        taken.add(host)
        candidates.set(host, candidates.get(host)!.filter(pred))
      }
    }
  }

  // EASY is built by forward construction (place + pin each suspect in the shrinking board).
  // MEDIUM / HARD use natural clue selection, but the "was in row X / column Y" clue type
  // stays rare: at most TWO such clues across the whole level (rows and columns combined).
  const chosen =
    difficulty === 'easy'
      ? constructEasyClues(base, suspectIds, solution, candidates, rng, requiredClues, familyCaps)
      : constructLogicClues(base, suspectIds, candidates, rng, targetRankOf(difficulty), MAX_LINE_CLUES, difficulty === 'hard', familyCaps)
  if (!chosen) return null

  // Limit how many suspects are obvious from the START (their own clue pins one cell):
  // at most ONE for easy, and NONE from medium up — there you must cross something out
  // before anyone can be placed.
  const maxAnchors = difficulty === 'easy' ? 1 : 0
  if (countAnchors(chosen, suspectIds, basePuzzle.board) > maxAnchors) return null

  const level: LevelJson = {
    ...base,
    suspects: base.suspects.map((s) => ({ ...s, clues: [chosen.get(s.id)!] })),
  }

  // NOTE: a global clue the user placed may end up carrying nothing (measured: 7 of 12 fills),
  // and unlike free generation there is no `pruneClues` here to drop it — it is theirs, so it
  // stays. Refusing such a fill outright was tried and REVERTED: it fixed the clue (7 → 0) but
  // cost 3 of 12 fills and tripled the wait (18.5s → 49.7s), and "no level" is the user's red
  // line. The editor's Check reports it instead, so they can re-roll if they care.
  const finalPuzzle = loadLevel(level)
  // Murder-rule guard on the INTENDED placement — every chosen clue was filtered by
  // test(…, solution, …), so `solution` satisfies the finished level by construction and a
  // SearchSolver.firstSolution() backtracking search here only rediscovered what we already
  // hold. (If the level is ambiguous, uniqueness dies later in pickBestLevel/isShippable —
  // this guard is solely about a well-defined murderer.)
  if (findMurderer(finalPuzzle, solution).suspectId === null) return null
  if (difficulty === 'easy') {
    // Confirm the construction is genuinely unique and solvable by SHORT, simple steps —
    // hidden singles / "only one on X" / row-column cross-out (rank ≤ 2), no harder
    // technique and never a contradiction. Same `checkLevel` the editor / ship-gate use.
    const c = checkLevel(finalPuzzle, { budget: UNIQUE_NODE_BUDGET })
    if (!c.unique || !c.solvable || c.deduction.maxRank > 2) return null
  }
  return { level, pins: countPins(chosen) }
}

/**
 * A random hidden placement of the people. Like the played game, EVERY person sits on a
 * DISTINCT row AND a DISTINCT column (the Sudoku rule — the solver forbids a person's whole
 * row and column for the others), on an occupiable cell, with the victim sharing a room
 * with EXACTLY one suspect (a well-defined murderer) and every global board clue holding.
 * Returns null if no such arrangement turns up.
 */
function placeOnBoard(puzzle: Puzzle, suspectIds: PersonId[], rng: Rng): Map<PersonId, Cell> | null {
  const board = puzzle.board
  const W = board.width
  const H = board.height
  const people = [...suspectIds, VICTIM_ID]
  const p = people.length
  if (p > W || p > H) return null
  // Occupiable columns available in each row (for the distinct-row/column matching).
  const colsByRow: number[][] = []
  for (let r = 0; r < H; r++) {
    const cs: number[] = []
    for (let c = 0; c < W; c++) if (board.isOccupiable(r * W + c)) cs.push(c)
    colsByRow.push(cs)
  }

  for (let attempt = 0; attempt < 4000; attempt++) {
    const rows = rng.shuffle([...Array(H).keys()]).slice(0, p)
    // Backtracking match: give each chosen row a DISTINCT occupiable column.
    const cols = new Array<number>(p).fill(-1)
    const usedCols = new Set<number>()
    const match = (i: number): boolean => {
      if (i === p) return true
      for (const c of rng.shuffle([...colsByRow[rows[i]]])) {
        if (usedCols.has(c)) continue
        usedCols.add(c)
        cols[i] = c
        if (match(i + 1)) return true
        usedCols.delete(c)
      }
      return false
    }
    if (!match(0)) continue

    const order = rng.shuffle([...people])
    const placement = new Map<PersonId, Cell>()
    for (let i = 0; i < p; i++) placement.set(order[i], rows[i] * W + cols[i])
    const victimRoom = board.roomIdOf(placement.get(VICTIM_ID)!)
    const inRoom = suspectIds.filter((id) => board.roomIdOf(placement.get(id)!) === victimRoom)
    if (inRoom.length !== 1) continue
    const solution = new Solution(placement)
    if (puzzle.boardClues.every((bc) => bc.test(solution, puzzle))) return placement
  }
  return null
}

/** A single generation attempt for one seed — for tooling that runs many and
 *  keeps the hardest (see `dev/hardest.ts`). Returns null on a failed attempt. */
export function generateOnce(
  options: GenerateOptions,
  seed: number,
): { level: LevelJson; pins: number } | null {
  return tryGenerate(options, new Rng(seed), seed)
}

function tryGenerate(
  options: GenerateOptions,
  rng: Rng,
  seedIndex: number,
  /** Build the clues by easy forward-construction. Defaults to on for 'easy';
   *  the easy generator turns it OFF for its generic fallback (see generateLevel). */
  easyConstruct = options.difficulty === 'easy',
  /** Variety fail-open switch (see Attempt): bans/spotlight apply only while true. */
  strict = true,
): { level: LevelJson; pins: number } | null {
  const { width, height, suspects } = options
  const baseTheme = THEMES.find((t) => t.id === options.themeId) ?? rng.pick(THEMES)
  // Shuffle the theme's room pool so each level uses a random subset → variety.
  const theme: Theme = {
    id: baseTheme.id,
    rooms: rng.shuffle([...baseTheme.rooms]),
    outdoor: baseTheme.outdoor,
  }

  const rooms = generateRooms(width, height, roomCountFor(suspects, theme.rooms.length, rng), rng)
  const roomOf = (cell: Cell): string => rooms.roomMap[Math.floor(cell / width)][cell % width]
  // Room id → i18n nameKey, computed ONCE and shared by furnishing, outdoor detection,
  // and buildLevel (so the three can never disagree about which room is which).
  const roomNameById = new Map<string, string>()
  rooms.ids.forEach((id, i) => roomNameById.set(id, theme.rooms[i % theme.rooms.length]))
  const roomNameOf = (cell: Cell): string => roomNameById.get(roomOf(cell))!
  const outdoorIds = new Set<string>()
  for (const [id, key] of roomNameById) if (theme.outdoor.includes(key)) outdoorIds.add(id)
  const isOutdoor = (cell: Cell): boolean => outdoorIds.has(roomOf(cell))

  const suspectIds: PersonId[] = Array.from({ length: suspects }, (_, i) => String.fromCharCode(65 + i))
  const peopleIds = [...suspectIds, VICTIM_ID]

  // On half the levels, aim for a placement with no empty room — that is what makes the
  // "no room was empty" clue (and its room bijection) reachable at all. The other half keeps
  // empty rooms, which the emptyRooms clue and EmptyRoomsTechnique feed on. See
  // generateSolution: it is only a preference, never a hard requirement.
  const placed = generateSolution(width, height, roomOf, peopleIds, rng, rng.chance(0.5))
  if (!placed) return null

  const peopleCells = new Set<Cell>(placed.placement.values())
  const allow = new Set(options.objects ?? DEFAULT_OBJECT_TYPES)
  // Semantic furnishing: each room gets objects that fit it, arranged to look built.
  const objects = furnishRooms({ width, height, peopleCells, rng, allow, roomNameOf, isOutdoor, roomIdOf: roomOf })
  // Windows are on by default; when allowed, only some levels get them (then 2–6).
  const windows =
    options.windows === false ? [] : rng.chance(0.5) ? placeWindows(width, height, rng) : []
  // Doors are opt-in; when enabled, a few sit between adjacent rooms.
  const doors = options.doors ? placeDoors(width, height, rooms.roomMap, rng) : []

  const usedName = new Set<string>()
  const suspectMeta: SuspectJson[] = suspectIds.map((id, i) => {
    const gender: 'm' | 'f' = rng.chance(0.5) ? 'm' : 'f'
    const person = suspectPerson(i, gender, usedName)
    return { id, name: person.name, attributes: makeAttributes(gender, rng), clues: [] }
  })

  const victim = victimPerson(rng)
  const victimMeta = { name: victim.name, attributes: makeAttributes(victim.gender, rng) }
  const base = buildLevel(theme, width, height, rooms, roomNameById, objects, windows, doors, suspectMeta, victimMeta, seedIndex)
  const basePuzzle = loadLevel(base)
  const solution = new Solution(placed.placement)

  // HARD: offer several true board (global) clues UP FRONT so the suspect-clue construction
  // leans on them — they end up genuinely needed (and plural), which the user wants. Pruning
  // later keeps only those still required. Medium/easy get at most one bonus clue (below).
  if (options.difficulty === 'hard') {
    const offered = offerHardBoardClues(basePuzzle, solution, rng, suspects)
    if (offered.length > 0) base.boardClues = offered
  }

  const candidates = new Map<PersonId, ClueJson[]>()
  for (const id of suspectIds) {
    const others = suspectIds.filter((o) => o !== id)
    // Easy construction uses the editor's flat clue vocabulary (same as the editor fill).
    candidates.set(id, candidatesFor(id, solution, basePuzzle, others, easyConstruct))
  }
  if (!applyVariety(candidates, options, strict, rng, easyConstruct)) return null

  // EASY is built by forward construction (place + pin each suspect in the shrinking
  // board) — the SAME path the editor's fill uses, which yields cleaner, more
  // easy-typical puzzles than rating-filtering generic attempts. MEDIUM / HARD (and
  // the easy generic fallback) use natural clue selection.
  const chosen = easyConstruct
    ? constructEasyClues(base, suspectIds, solution, candidates, rng, undefined, options.familyCaps)
    : constructLogicClues(base, suspectIds, candidates, rng, targetRankOf(options.difficulty), MAX_LINE_CLUES, options.difficulty === 'hard', options.familyCaps)
  if (!chosen) return null

  // At most ONE suspect may be directly placeable from the start at easy — and NONE from medium
  // up, where you must cross something out before anyone can be placed. This ran for easy only,
  // so free generation shipped hard levels with a suspect nailed to a single cell by their own
  // clue (measured), which is the exact opposite of the "spät setzen von Eindeutigkeiten" that
  // makes a level hard. Same rule and same call as the editor fill (`fillAttempt`).
  //
  // The bar hangs on the DIFFICULTY, not the construction mode (exactly like `fillAttempt`):
  // the easy FALLBACK builds generically (easyConstruct=false) but is still an easy level,
  // where one anchor is allowed. Judged by mode it got the medium bar of ZERO anchors — and
  // since the generic path never widens clues at target rank 1 (the loosen passes cap on the
  // target), suspects keep their tightest 1-cell openers and nearly every fallback attempt
  // died here: measured 0 easy levels out of 4×40s single streams at 11/12.
  const anchorCap = options.difficulty === 'easy' ? 1 : 0
  if (countAnchors(chosen, suspectIds, basePuzzle.board) > anchorCap) return null

  for (const meta of base.suspects) meta.clues = [chosen.get(meta.id)!]
  // Guard: the solution must leave the victim alone with exactly ONE suspect (a well-defined
  // murderer). Checked on the INTENDED placement — every chosen clue passed test(…, solution, …),
  // so `solution` satisfies the finished level by construction; the old firstSolution()
  // backtracking search only rediscovered it. Uniqueness is judged later (pickBestLevel).
  const finalPuzzle = loadLevel(base)
  if (findMurderer(finalPuzzle, solution).suspectId === null) return null

  // Easy: confirm it is genuinely unique AND solvable by short, simple steps
  // (hidden singles / "only one on X" / row-column cross-out — rank ≤ 2, never a
  // contradiction), exactly like the editor's easy fill.
  if (easyConstruct) {
    const c = checkLevel(finalPuzzle, { budget: UNIQUE_NODE_BUDGET })
    if (!c.unique || !c.solvable || c.deduction.maxRank > 2) return null
  }

  // Medium: now and then add ONE board-wide clue as bonus flavour (hard already got a set
  // up front; easy stays clean). True for the unique solution, so the answer is unchanged.
  if (!easyConstruct && options.difficulty !== 'hard' && rng.chance(0.35)) {
    const bc = bonusBoardClue(finalPuzzle, solution, rng)
    if (bc) base.boardClues = [bc]
  }
  return { level: base, pins: countPins(chosen) }
}

/**
 * All board-wide clues that genuinely hold for `solution`: "exactly N people stood on a
 * <object>" (per object type) and "N rooms are empty". The forward deduction engine has
 * techniques for these (BoardCount / EmptyRooms / RoomCoverage), so they can be load-bearing.
 */
function trueBoardClues(puzzle: Puzzle, solution: Solution): BoardClueJson[] {
  const board = puzzle.board
  const candidates: BoardClueJson[] = []

  for (const def of OCCUPIABLE) {
    if (board.cellsWithObject(def.type).size === 0) continue
    let n = 0
    for (const [, cell] of solution.entries()) {
      if (board.tileAt(cell).hasObjectType(def.type)) n++
    }
    if (n > 0) candidates.push({ type: 'countOnObject', object: def.type, count: n })
  }

  const occupied = new Set<string>()
  for (const [, cell] of solution.entries()) occupied.add(board.roomIdOf(cell))
  let empty = 0
  for (const id of board.rooms.keys()) if (!occupied.has(id)) empty++
  // count 0 ("no room was empty") is offered too — it used to be skipped, which quietly made
  // the STRONGEST version of this clue ungeneratable: it is the one that turns the rooms into
  // a Sudoku unit over the suspects (RoomCoverageTechnique's bijection, which additionally
  // needs #rooms == #suspects — see roomCountFor).
  candidates.push({ type: 'emptyRooms', count: empty })

  // Per-room headcount statements, per scope: the true ceiling ("no room held more than N"),
  // the true floor ("every room held at least N"), the uniform case ("every room held exactly
  // N"), and every count NO room happens to have ("no room held exactly N" — e.g. the "no
  // room with just one person" clue). All are offered at their real values; the filter at the
  // end keeps only what actually holds, and pruneClues drops whatever isn't load-bearing.
  for (const scope of ['people', 'suspects'] as const) {
    const ids = scope === 'people' ? puzzle.allIds() : puzzle.suspects.map((s) => s.id)
    const per = new Map<string, number>()
    for (const id of board.rooms.keys()) per.set(id, 0)
    for (const id of ids) {
      const r = board.roomIdOf(solution.cellOf(id))
      per.set(r, (per.get(r) ?? 0) + 1)
    }
    const counts = [...per.values()]
    const max = Math.max(...counts)
    const min = Math.min(...counts)
    // "at most max" / "at least min" only say something below/above the trivial bounds.
    if (max < ids.length) candidates.push({ type: 'roomOccupancy', op: 'atMost', count: max, scope })
    if (min > 0) candidates.push({ type: 'roomOccupancy', op: 'atLeast', count: min, scope })
    if (min === max) candidates.push({ type: 'roomOccupancy', op: 'exactly', count: min, scope })
    // "no room held exactly N", for every N no room actually has. N=0 would just be the
    // emptyRooms clue, which states it more directly.
    const present = new Set(counts)
    for (let n = 1; n <= max; n++) {
      if (!present.has(n)) candidates.push({ type: 'roomOccupancy', op: 'notExactly', count: n, scope })
    }
  }

  // "Exactly N <trait> were inside/outside" — only on a board that HAS both, else vacuous.
  if (board.cellsOutside(true).size > 0 && board.cellsOutside(false).size > 0) {
    const traits: { attribute: string; value: AttributeValue }[] = [
      { attribute: 'gender', value: 'm' },
      { attribute: 'gender', value: 'f' },
      { attribute: 'beard', value: true },
      { attribute: 'glasses', value: true },
      { attribute: 'bald', value: true },
    ]
    // Full catalogue ("IMMER ALLES"): every valued style a suspect actually wears.
    for (const attr of ['hair', 'hairstyle', 'beardStyle', 'glassesShape', 'glassesColor'] as const) {
      const values = new Set<string>()
      for (const s of puzzle.suspects) {
        const v = puzzle.attributesOf(s.id)[attr]
        if (typeof v === 'string') values.add(v)
      }
      for (const v of values) traits.push({ attribute: attr, value: v })
    }
    for (const { attribute, value } of traits) {
      if (!puzzle.suspects.some((s) => puzzle.attributesOf(s.id)[attribute] === value)) continue
      for (const scope of ['people', 'suspects'] as const) {
        // FAIRNESS: scope 'people' counts the victim, whose beard/glasses/bald/hair are
        // hidden from the player — only gender is shown. So a people-scoped clue about any
        // other trait could never be checked and must not exist. (Same rule as usableTrait.)
        if (scope === 'people' && attribute !== 'gender') continue
        const ids = scope === 'people' ? puzzle.allIds() : puzzle.suspects.map((s) => s.id)
        const carriers = ids.filter((id) => puzzle.attributesOf(id)[attribute] === value)
        // A trait count clue needs at least TWO carriers to be a BOARD-WIDE statement. With a
        // single one it silently degenerates into a unary clue about that one person ("the
        // brown-haired one was inside") — the player reads the trait straight off the card —
        // and it carries nothing at all as soon as that suspect's own clue already confines
        // them to the area. Same bar as `usesInsideOutside`: a clue the player cannot get
        // anything out of must not exist.
        if (carriers.length < 2) continue
        for (const area of ['inside', 'outside'] as const) {
          const count = carriers.filter(
            (id) => board.isOutside(solution.cellOf(id)) === (area === 'outside'),
          ).length
          // "0 of them were outside" is really "all were inside" — the other area says it
          // positively, and one of the two is always non-zero.
          if (count === 0) continue
          candidates.push({ type: 'countWithAttr', attribute, value, area, count, scope })
        }
      }
    }
  }

  return candidates.filter((c) => createBoardClue(c).test(solution, puzzle))
}

/** One board-wide clue that holds for `solution` (or null) — bonus flavour for medium/easy. */
function bonusBoardClue(puzzle: Puzzle, solution: Solution, rng: Rng): BoardClueJson | null {
  const valid = trueBoardClues(puzzle, solution)
  return valid.length ? rng.pick(valid) : null
}

/**
 * A diverse handful of true board clues to OFFER a hard level up front (before the suspect
 * clues are built), so the construction leans on them and they become genuinely needed —
 * the user wants hard levels to USE global clues, often more than one. The final pruning
 * keeps exactly those the puzzle still needs. Count scales with the board.
 */
function offerHardBoardClues(puzzle: Puzzle, solution: Solution, rng: Rng, suspects: number): BoardClueJson[] {
  const valid = rng.shuffle(trueBoardClues(puzzle, solution))
  const cap = Math.min(valid.length, 3 + Math.floor(suspects / 3)) // 6×6≈4, 9×9≈5
  return valid.slice(0, cap)
}

// --- board ----------------------------------------------------------------

/** A room can never hold fewer cells than this (a 2-cell closet is the hand-made floor). */
const MIN_ROOM_CELLS = 3

/** Room ids, one SINGLE char each — the roomMap encodes one char per cell, so an id must
 *  never be longer. `String(room + 1)` turned room 10 into the two chars "10" and silently
 *  corrupted the map (the crash surfaced far away, in archetypeOf); 11×11/12×12 allow 10–11
 *  rooms, so every big-board run died within a few attempts. Same alphabet as the editor's
 *  room slots (editorModel.ROOM_IDS) — defined locally because the engine never imports
 *  from game/ — and '1'–'9' stay identical to before, so boards with ≤9 rooms are
 *  byte-for-byte unchanged (fingerprint-proven). */
const ROOM_CHARS = '123456789ABCDEF'

/**
 * How many rooms a level gets, drawn from the shape the 163 hand-made levels actually have:
 * rooms-per-suspect sits between 0.6 and 1.0, and NEVER above 1.0 (not one bundled level has
 * more rooms than suspects). The 1:1 end matters — it is the only case where "no room was
 * empty" / the room bijection can hold at all, and roughly a quarter of the hand-made corpus
 * sits exactly there, which a uniform draw over the range reproduces on its own.
 */
function roomCountFor(suspects: number, themeRoomCount: number, rng: Rng): number {
  const max = Math.min(suspects, themeRoomCount)
  const min = Math.max(2, Math.min(max, Math.round(suspects * 0.6)))
  return min + rng.int(max - min + 1)
}

interface Rect {
  r0: number
  c0: number
  r1: number
  c1: number
}

const rectArea = (x: Rect): number => (x.r1 - x.r0 + 1) * (x.c1 - x.c0 + 1)

/**
 * Cut a rectangle in two, across its LONGER side so rooms stay roughly square instead of
 * degenerating into corridors, and near the MIDDLE so the two halves come out similar in
 * size. Balance matters: the hand-made levels have no 3-cell slivers next to a hall — their
 * smallest room averages ~6–7 cells. Both halves must still be a legal room; returns null
 * when no legal cut exists. `min` is the smallest room this board allows.
 */
function splitRect(x: Rect, min: number, rng: Rng): [Rect, Rect] | null {
  const horiz: [Rect, Rect][] = []
  const vert: [Rect, Rect][] = []
  for (let cut = x.r0; cut < x.r1; cut++) {
    const a: Rect = { ...x, r1: cut }
    const b: Rect = { ...x, r0: cut + 1 }
    if (rectArea(a) >= min && rectArea(b) >= min) horiz.push([a, b])
  }
  for (let cut = x.c0; cut < x.c1; cut++) {
    const a: Rect = { ...x, c1: cut }
    const b: Rect = { ...x, c0: cut + 1 }
    if (rectArea(a) >= min && rectArea(b) >= min) vert.push([a, b])
  }
  const h = x.r1 - x.r0 + 1
  const w = x.c1 - x.c0 + 1
  const prefer = h > w ? horiz : w > h ? vert : rng.chance(0.5) ? horiz : vert
  const pool = prefer.length > 0 ? prefer : horiz.length > 0 ? horiz : vert
  if (pool.length === 0) return null
  // Keep the more balanced half of the cuts, then choose freely among them — even sizes
  // without every plan looking identically halved.
  const ranked = [...pool].sort((p, q) => balance(p) - balance(q))
  return rng.pick(ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2))))
}

/** How lopsided a cut is (0 = perfectly even). */
const balance = ([a, b]: [Rect, Rect]): number => Math.abs(rectArea(a) - rectArea(b))

/**
 * Lay out the rooms by recursively splitting the board into rectangles (a floor plan), then
 * knocking a few cells through a wall so not every room is a plain box.
 *
 * This mirrors what the hand-made levels look like — measured over all 163: 60–90% of their
 * rooms exactly fill their bounding box (i.e. they ARE rectangles), sizes are balanced, and
 * every room borders only a few others. The previous random flood-fill grew amorphous blobs
 * instead, which both looked unlike a building AND made room adjacency near-useless: with
 * everything touching everything, "in a room adjoining the kitchen" says almost nothing.
 *
 * Always splits the LARGEST rectangle, so rooms come out similar in size rather than one
 * hall plus slivers. Returns fewer rooms than asked only if the board cannot be cut further.
 */
export function generateRooms(
  width: number,
  height: number,
  roomCount: number,
  rng: Rng,
): { roomMap: string[]; ids: string[] } {
  // Hard safety: more rooms than ROOM_CHARS has ids cannot be encoded (roomCountFor never
  // asks for more than 11, but this function is exported for tests).
  roomCount = Math.min(roomCount, ROOM_CHARS.length)
  // Floor for a room on THIS board: no sliver next to a hall. Scaled to the average room
  // (≈45% of it) so a 9×9 with 6 rooms won't produce a 3-cell closet, matching the
  // hand-made corpus, whose smallest room averages ~6–7 cells.
  const min = Math.max(MIN_ROOM_CELLS, Math.floor(((width * height) / Math.max(1, roomCount)) * 0.45))
  let rects: Rect[] = [{ r0: 0, c0: 0, r1: height - 1, c1: width - 1 }]
  while (rects.length < roomCount) {
    // Largest first → balanced rooms. Fall through to smaller ones if it can't be cut.
    const order = [...rects].sort((a, b) => rectArea(b) - rectArea(a))
    let split = false
    for (const x of order) {
      const halves = splitRect(x, min, rng)
      if (!halves) continue
      rects = rects.filter((y) => y !== x).concat(halves)
      split = true
      break
    }
    if (!split) break // the board admits no more legal rooms
  }

  const n = width * height
  const assign = new Array<number>(n).fill(0)
  rects.forEach((x, room) => {
    for (let r = x.r0; r <= x.r1; r++) for (let c = x.c0; c <= x.c1; c++) assign[r * width + c] = room
  })

  carveIrregularities(assign, width, height, rects.length, rng)

  const ids = Array.from({ length: rects.length }, (_, room) => ROOM_CHARS[room])
  const roomMap: string[] = []
  for (let r = 0; r < height; r++) {
    let line = ''
    for (let c = 0; c < width; c++) line += ROOM_CHARS[assign[r * width + c]]
    roomMap.push(line)
  }
  return { roomMap, ids }
}

/**
 * Hand off a few border cells to the room across the wall, turning some boxes into L-shapes
 * — the hand-made levels are 60–90% rectangles, not 100%, and pure BSP looks too gridded.
 * A cell only moves when the room losing it stays CONNECTED and legally sized, so no room
 * can be split in two or shrunk away.
 */
function carveIrregularities(
  assign: number[],
  width: number,
  height: number,
  roomCount: number,
  rng: Rng,
): void {
  if (roomCount < 2) return
  const idx = (r: number, c: number): number => r * width + c
  const cellsOf = (room: number): number[] => {
    const out: number[] = []
    for (let i = 0; i < assign.length; i++) if (assign[i] === room) out.push(i)
    return out
  }
  const connected = (cells: number[]): boolean => {
    if (cells.length === 0) return false
    const set = new Set(cells)
    const stack = [cells[0]]
    const seen = new Set([cells[0]])
    while (stack.length > 0) {
      const cur = stack.pop()!
      const r = Math.floor(cur / width)
      const c = cur % width
      for (const [nr, nc] of [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ]) {
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        const nb = idx(nr, nc)
        if (set.has(nb) && !seen.has(nb)) {
          seen.add(nb)
          stack.push(nb)
        }
      }
    }
    return seen.size === cells.length
  }

  // One nibble per FOUR rooms. Each one dents two rooms at once (the donor loses a corner,
  // the receiver gains a bump), so this lands the rectangle share in the hand-made 55–70%
  // band — one per two rooms measured out at 32–47%, far too ragged.
  const attempts = Math.max(1, Math.floor(roomCount / 4))
  for (let a = 0; a < attempts; a++) {
    const order = rng.shuffle([...Array(assign.length).keys()])
    for (const cell of order) {
      const room = assign[cell]
      const r = Math.floor(cell / width)
      const c = cell % width
      const others: number[] = []
      for (const [nr, nc] of [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ]) {
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        const other = assign[idx(nr, nc)]
        if (other !== room && !others.includes(other)) others.push(other)
      }
      if (others.length === 0) continue
      const donor = cellsOf(room)
      if (donor.length - 1 < MIN_ROOM_CELLS) continue
      const target = rng.pick(others)
      assign[cell] = target
      if (connected(donor.filter((x) => x !== cell))) break // kept
      assign[cell] = room // would have torn the room apart — undo and try elsewhere
    }
  }
}

/**
 * A random hidden placement: everyone on a distinct row AND column, with the victim sharing
 * a room with exactly one suspect.
 *
 * `fillEveryRoom` additionally hunts for a placement that leaves NO room empty. Left to pure
 * chance that combination is vanishingly rare (measured: 5% of levels, versus 43% with as
 * many rooms as suspects) — so without aiming for it the "no room was empty" clue, and the
 * room bijection it powers, could effectively never arise. It stays a PREFERENCE: once the
 * hunt budget is spent, any legal placement is accepted, so generation can't fail over it.
 */
function generateSolution(
  width: number,
  height: number,
  roomOf: (cell: Cell) => string,
  peopleIds: PersonId[],
  rng: Rng,
  fillEveryRoom = false,
): { placement: Map<PersonId, Cell>; murderer: PersonId } | null {
  const p = peopleIds.length
  const allRooms = new Set<string>()
  for (let cell = 0; cell < width * height; cell++) allRooms.add(roomOf(cell))
  const HUNT = 3000

  for (let attempt = 0; attempt < 4000; attempt++) {
    const rows = rng.shuffle([...Array(height).keys()]).slice(0, p)
    const cols = rng.shuffle([...Array(width).keys()]).slice(0, p)
    const order = rng.shuffle([...peopleIds])
    const placement = new Map<PersonId, Cell>()
    for (let i = 0; i < p; i++) placement.set(order[i], rows[i] * width + cols[i])

    const victimRoom = roomOf(placement.get(VICTIM_ID)!)
    const inRoom = peopleIds.filter(
      (id) => id !== VICTIM_ID && roomOf(placement.get(id)!) === victimRoom,
    )
    if (inRoom.length !== 1) continue
    if (fillEveryRoom && attempt < HUNT) {
      // The victim never opens a room of its own (it sits with the murderer), so "every room
      // occupied" is decided by the suspects alone.
      const occupied = new Set<string>()
      for (const id of peopleIds) {
        if (id !== VICTIM_ID) occupied.add(roomOf(placement.get(id)!))
      }
      if (occupied.size < allRooms.size) continue
    }
    return { placement, murderer: inRoom[0] }
  }
  return null
}

/**
 * Place a handful of windows on the outer wall (2–6), each owned by a border cell
 * on its outward side. Several windows keep "beside a window" non-unique.
 */
function placeWindows(
  width: number,
  height: number,
  rng: Rng,
): { r: number; c: number; side: Side }[] {
  const border: { r: number; c: number; sides: Side[] }[] = []
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const sides: Side[] = []
      if (r === 0) sides.push('N')
      if (r === height - 1) sides.push('S')
      if (c === 0) sides.push('W')
      if (c === width - 1) sides.push('E')
      if (sides.length > 0) border.push({ r, c, sides })
    }
  }
  const count = Math.min(border.length, 2 + rng.int(5)) // 2..6
  return rng
    .shuffle(border)
    .slice(0, count)
    .map((b) => ({ r: b.r, c: b.c, side: b.sides[rng.int(b.sides.length)] }))
}

/**
 * Place a few doors (1–3) on interior walls between two adjacent, DIFFERENT rooms.
 * A door is anchored at the top/left cell of the shared edge (side 'S' or 'E'); the
 * loader registers it on both cells, so each side counts as "beside a door".
 */
function placeDoors(
  width: number,
  height: number,
  roomMap: string[],
  rng: Rng,
): { r: number; c: number; side: Side }[] {
  const edges: { r: number; c: number; side: Side }[] = []
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (r < height - 1 && roomMap[r][c] !== roomMap[r + 1][c]) edges.push({ r, c, side: 'S' })
      if (c < width - 1 && roomMap[r][c] !== roomMap[r][c + 1]) edges.push({ r, c, side: 'E' })
    }
  }
  if (edges.length === 0) return []
  const count = Math.min(edges.length, 1 + rng.int(3)) // 1..3
  return rng.shuffle(edges).slice(0, count)
}

// --- level json -----------------------------------------------------------

function buildLevel(
  theme: Theme,
  width: number,
  height: number,
  rooms: { roomMap: string[]; ids: string[] },
  roomNameById: Map<string, string>,
  objects: { groundMap: string[]; topMap: string[] },
  windows: { r: number; c: number; side: Side }[],
  doors: { r: number; c: number; side: Side }[],
  suspects: SuspectJson[],
  victim: { name: string; attributes: Record<string, AttributeValue> },
  seedIndex: number,
): LevelJson {
  const roomDefs: Record<string, { nameKey: string; color: string; outside?: boolean }> = {}
  const outdoorKeys = new Set(theme.outdoor)
  rooms.ids.forEach((id, i) => {
    const nameKey = roomNameById.get(id)!
    roomDefs[id] = {
      nameKey,
      color: ROOM_COLORS[i % ROOM_COLORS.length],
      // Flag the theme's outdoor rooms as `outside` so they read as exterior and
      // enable inside/outside clues (previously omitted, so generated outdoor rooms
      // never counted as "outside"). The bear lives only in these wilderness rooms.
      ...(outdoorKeys.has(nameKey) ? { outside: true } : {}),
    }
  })
  const objectDefs: Record<string, { type: string; occupiable: boolean }> = {}
  for (const obj of ALL_OBJECTS) objectDefs[obj.char] = { type: obj.type, occupiable: obj.occupiable }

  return {
    schema: 1,
    id: `gen-${theme.id}-${seedIndex}`,
    difficulty: 'generated',
    size: { width, height },
    rooms: roomDefs,
    objects: objectDefs,
    roomMap: rooms.roomMap,
    groundMap: objects.groundMap,
    topMap: objects.topMap,
    windows,
    doors,
    suspects,
    victim,
  }
}

// --- clues ----------------------------------------------------------------

/**
 * Build the pool of clues that are TRUE for `suspectId` in this solution, tightest
 * first. Covers the full clue vocabulary; the test-filter keeps only true ones.
 * `editorSafe` restricts the pool to shapes the editor's flat clue builder can
 * round-trip (e.g. roomAttribute with excludeSelf).
 * Exported ONLY for the pool-coverage test (candidates.test.ts) — not public API.
 */
export function candidatesFor(
  suspectId: PersonId,
  solution: Solution,
  puzzle: Puzzle,
  otherSuspects: PersonId[],
  editorSafe = false,
): ClueJson[] {
  const board = puzzle.board
  const cell = solution.cellOf(suspectId)
  const { row, col } = board.rc(cell)
  const room = board.roomIdOf(cell)
  const out: ClueJson[] = []

  // A trait may only appear in a clue if a SUSPECT actually carries it (the player can see
  // suspects' looks). For NON-gender traits the VICTIM must NOT carry it either: its
  // beard/glasses/bald/hair are random and hidden, so a clue must never silently hinge on
  // them. (Gender is shown for the victim too, so it may count.) Without this, "east of
  // everyone bald" could appear with no bald suspect — only a bald victim.
  const victimAttrs = puzzle.attributesOf(VICTIM_ID)
  const usableTrait = (attribute: string, value: AttributeValue): boolean =>
    puzzle.suspects.some((s) => puzzle.attributesOf(s.id)[attribute] === value) &&
    (attribute === 'gender' || victimAttrs[attribute] !== value)

  // The FULL trait catalogue (Dirks Regel: "IMMER ALLES"): gender, the boolean traits,
  // and every valued style a suspect actually wears. ONE list feeds every trait-anchored
  // emission below (directionFromAttr, offsetFrom, roomAttribute incl. negations,
  // besideSameObject mates); usableTrait keeps fairness on top (a suspect carries it,
  // hidden victim traits never hinge).
  const allTraitPairs: { attribute: string; value: AttributeValue }[] = [
    { attribute: 'gender', value: 'm' },
    { attribute: 'gender', value: 'f' },
    { attribute: 'beard', value: true },
    { attribute: 'glasses', value: true },
    { attribute: 'bald', value: true },
  ]
  for (const attr of ['hair', 'hairstyle', 'beardStyle', 'glassesShape', 'glassesColor'] as const) {
    const values = new Set<string>()
    for (const s of puzzle.suspects) {
      const v = puzzle.attributesOf(s.id)[attr]
      if (typeof v === 'string') values.add(v)
    }
    for (const v of values) allTraitPairs.push({ attribute: attr, value: v })
  }

  // Traits EVERY person in `ids` shares — same full catalogue. Feeds the "alone with
  // N <trait>" shapes (roomCompanion / aloneWith), which need a value all mates carry.
  const sharedTraits = (ids: PersonId[]): { attribute: string; value: AttributeValue }[] => {
    const attrs = ids.map((id) => puzzle.attributesOf(id))
    const shared: { attribute: string; value: AttributeValue }[] = []
    const g = attrs[0].gender
    if (attrs.every((a) => a.gender === g)) shared.push({ attribute: 'gender', value: g })
    for (const attr of ['beard', 'glasses', 'bald'] as const) {
      if (attrs.every((a) => a[attr] === true)) shared.push({ attribute: attr, value: true })
    }
    for (const attr of ['hair', 'hairstyle', 'beardStyle', 'glassesShape', 'glassesColor'] as const) {
      const v = attrs[0][attr]
      if (typeof v === 'string' && attrs.every((a) => a[attr] === v)) {
        shared.push({ attribute: attr, value: v })
      }
    }
    return shared
  }

  // All eight compass directions and the three room qualifiers the editor offers — the
  // generator now emits the full set (the test-filter at the end keeps only the true ones),
  // so diagonals and "same/other room" variants reach generated levels too.
  const DIRS8 = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const
  const ROOM_RELS = ['any', 'same', 'other'] as const

  // --- object: on / beside ---
  for (const obj of board.tileAt(cell).objects()) {
    if (obj.occupiable) {
      out.push({ type: 'onObject', object: obj.type })
      // "only person on a chair/carpet/…" — kept by the test-filter only if truly unique.
      out.push({ type: 'uniqueOnObject', object: obj.type })
    }
  }
  const nearTypes = new Set<string>()
  for (const nb of board.neighbors4(cell)) {
    if (board.roomIdOf(nb) === room) {
      for (const obj of board.tileAt(nb).objects()) nearTypes.add(obj.type)
    }
  }
  for (const type of nearTypes) {
    out.push({ type: 'nearObject', object: type })
    out.push({ type: 'uniqueNearObject', object: type }) // "only one beside it" (test-filtered)
  }
  // "beside one of several object types" (nearObjectAny) — the editor's multi-select. Offer
  // every pair of nearby types (and the full set); all are true since the subject is beside
  // each member.
  const near = [...nearTypes]
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      out.push({ type: 'nearObjectAny', objects: [near[i], near[j]] })
    }
  }
  if (near.length >= 3) out.push({ type: 'nearObjectAny', objects: near })

  // --- object: same line / direction (objects are fixed → deducible) ---
  // A clue whose candidates already lie in ONE row or column is just a disguised line
  // clue — the honest `in row/col X` (added below) says it instead.
  const collapsesToLine = (json: ClueJson): boolean => {
    const cells = createClue(json).candidateCells(board)
    if (!cells || cells.size === 0) return false
    const rows = new Set<number>()
    const cols = new Set<number>()
    for (const c of cells) {
      const rc = board.rc(c)
      rows.add(rc.row)
      cols.add(rc.col)
    }
    return rows.size === 1 || cols.size === 1
  }
  for (const def of ALL_OBJECTS) {
    const objCells = board.objectCells(def.type)
    if (objCells.length === 0) continue
    // Object line/direction clues ONLY for a UNIQUE object tile — a repeated object
    // would need a "(Z7/S6)" anchor coordinate, which reads badly. And skip the ones
    // that collapse to a single line (those become the plain inRow/inCol clue).
    // "same row/column as a {object}" — for ANY object (several tiles = "as SOME tile").
    // collapsesToLine drops the degenerate single-tile col/row (which is just a line clue).
    // The disguised-line check only matters for the unrestricted ("any room") form; the
    // same/other variants already carry a room constraint, so they're never a bare line.
    const keep = (room: string, json: ClueJson) => room !== 'any' || !collapsesToLine(json)
    for (const line of ['col', 'row', 'either'] as const) {
      for (const room of ROOM_RELS) {
        const json: ClueJson = { type: 'sameLineAsObject', object: def.type, line, room }
        if (keep(room, json)) out.push(json)
      }
    }
    // "{dir} of a {object}" — 8-way, any/same/other room. A SINGLE tile is ∃≡∀ and
    // unambiguous → offered. For SEVERAL tiles (a multi-cell object like a car, or a
    // repeated object) ONLY the ∀ form "{dir} of EVERY {object}" is offered: "{dir} of A
    // {object}" and the per-tile "(Z/S)" anchor leave it unclear WHICH tile is meant —
    // bad puzzling — so neither is ever generated.
    for (const dir of DIRS8) {
      for (const room of ROOM_RELS) {
        if (objCells.length === 1) {
          const some: ClueJson = { type: 'directionFromObject', object: def.type, dir, room }
          if (keep(room, some)) out.push(some)
        } else {
          const all: ClueJson = { type: 'directionFromObject', object: def.type, dir, room, all: true }
          if (keep(room, all)) out.push(all)
        }
      }
    }
    // "beside the SAME object instance as …" — only when the subject is beside one. Each
    // mate is offered with no direction AND with the mate's 8-way direction from the
    // subject (the filter keeps the true direction).
    if (board.cellsNearObject(def.type).has(cell)) {
      const mates: ObjectMate[] = [
        { kind: 'any' },
        ...otherSuspects.map((id): ObjectMate => ({ kind: 'person', of: id })),
        // Full trait catalogue as mates too ("IMMER ALLES") — the filter keeps true ones.
        ...allTraitPairs
          .filter((av) => usableTrait(av.attribute, av.value))
          .map((av): ObjectMate => ({ kind: 'attr', attribute: av.attribute, value: av.value })),
      ]
      for (const mate of mates) {
        out.push({ type: 'besideSameObject', object: def.type, mate })
        for (const dir of DIRS8) out.push({ type: 'besideSameObject', object: def.type, mate, dir })
      }
    }
  }

  // --- position ---
  out.push({ type: 'inRoom', room })
  out.push({ type: 'inRow', row })
  out.push({ type: 'inCol', col })
  // "in a room adjoining X" — for every room the subject's room borders. Broad and fully
  // deducible (fixed layout). The disguised-line guard applies: on a small board the band of
  // neighbours can collapse into one row/column, and then the honest inRow/inCol says it.
  for (const other of board.roomNeighbors(room)) {
    const json: ClueJson = { type: 'inRoomAdjacentTo', room: other }
    if (!collapsesToLine(json)) out.push(json)
  }
  // …and the NEGATION for every room it does NOT border — "she was in a room that does NOT
  // adjoin the kitchen". Broad, fully deducible (the not-clue's definite cells), and exactly
  // what `not(inRoom)` does a few lines down. A room the subject IS in counts as non-adjacent
  // to itself, so its own room is offered too — "not adjoining X" is true when standing in X.
  for (const other of board.rooms.keys()) {
    if (board.roomNeighbors(room).has(other)) continue // borders it → the positive form says so
    const json: ClueJson = { type: 'not', clue: { type: 'inRoomAdjacentTo', room: other } }
    if (!collapsesToLine(json)) out.push(json)
  }
  if (board.isCorner(cell)) out.push({ type: 'corner' })
  if (board.isAtWall(cell)) out.push({ type: 'atWall' })
  if (board.hasWindow(cell)) {
    out.push({ type: 'nearWindow' })
    out.push({ type: 'uniqueNearWindow' }) // "only person beside a window" (test-filtered)
  }
  if (board.hasDoor(cell)) {
    out.push({ type: 'nearDoor' })
    out.push({ type: 'uniqueNearDoor' }) // "only person beside a door" (test-filtered)
  }
  // inside/outside only when the board actually mixes indoor and outdoor rooms.
  if (board.cellsOutside(true).size > 0 && board.cellsOutside(false).size > 0) {
    const outside = board.isOutside(cell)
    out.push(outside ? { type: 'outside' } : { type: 'inside' })
    out.push(outside ? { type: 'uniqueOutside' } : { type: 'uniqueInside' }) // "only one out/inside"
    for (const id of otherSuspects) out.push({ type: 'insideXor', with: id })
  }

  // --- social: relative to other people ---
  const inRoomAll = puzzle.allIds().filter((id) => board.roomIdOf(solution.cellOf(id)) === room)
  if (inRoomAll.length > 1) out.push({ type: 'notAlone' })
  const sameRoom = otherSuspects.filter((id) => board.roomIdOf(solution.cellOf(id)) === room)
  if (sameRoom.length === 0) out.push({ type: 'alone' })
  for (const id of sameRoom) out.push({ type: 'sameRoom', as: id })
  // "alone (just the two) with that one suspect" — only when nobody else, victim
  // included, shares the room (inRoomAll counts everyone present, the subject + 1).
  if (sameRoom.length === 1 && inRoomAll.length === 2) {
    out.push({ type: 'sameRoom', as: sameRoom[0], alone: true })
  }

  // --- room neighbourhood (A2/A3/A4) ---
  const neighborRooms = [...board.roomNeighbors(room)]
  // "X and Y were in adjoining rooms" — and its negation for everyone they were NOT one room
  // over from. The negated form propagates forward exactly like `not(sameRoom)`: once either
  // side is pinned to a room, the other loses that room's neighbours.
  for (const id of otherSuspects) {
    if (neighborRooms.includes(board.roomIdOf(solution.cellOf(id)))) {
      out.push({ type: 'adjacentRooms', as: id })
    } else {
      out.push({ type: 'not', clue: { type: 'adjacentRooms', as: id } })
    }
  }
  // "an empty room adjoined his room" — kept by the test-filter only when one truly is.
  // Its NEGATION ("no neighbour was empty") is the stronger universal form, so offer both.
  if (neighborRooms.length > 0) {
    out.push({ type: 'neighborRoomEmpty' })
    out.push({ type: 'not', clue: { type: 'neighborRoomEmpty' } })
  }
  // "an adjoining room [entirely {dir} of him] held exactly N suspects" — emit the TRUE
  // count for each neighbour, plain and per qualifying direction. count 0 is deliberately
  // skipped: "an empty adjoining room" is exactly the clue above, and reads far better.
  const suspectsPerRoom = new Map<string, number>()
  for (const id of otherSuspects.concat(suspectId)) {
    const r = board.roomIdOf(solution.cellOf(id))
    suspectsPerRoom.set(r, (suspectsPerRoom.get(r) ?? 0) + 1)
  }
  for (const n of neighborRooms) {
    const count = suspectsPerRoom.get(n) ?? 0
    if (count === 0) continue
    const plain: ClueJson = { type: 'neighborRoomCount', count }
    if (!collapsesToLine(plain)) out.push(plain)
    // Cardinals only: lifting a DIAGONAL onto a room means the whole quadrant ("every cell
    // southeast" = every cell south AND every cell east), which is both rare and hard to read
    // off the plan. See NeighborRoomCountClue.
    for (const dir of ['north', 'south', 'east', 'west'] as const) {
      const json: ClueJson = { type: 'neighborRoomCount', count, dir }
      // Only when THIS room really lies entirely that way from the subject's cell.
      if (new NeighborRoomCountClue(count, dir).qualifies(board, cell, n) && !collapsesToLine(json)) {
        out.push(json)
      }
    }
  }

  // --- "(alone) in the same room as an object" (objects are fixed → deducible) ---
  const roomObjects = new Set<string>()
  for (let c = 0; c < board.width * board.height; c++) {
    if (board.roomIdOf(c) === room) for (const obj of board.tileAt(c).objects()) roomObjects.add(obj.type)
  }
  const aloneInRoom = inRoomAll.length === 1 // nobody else at all shares the room
  for (const type of roomObjects) {
    out.push({ type: 'sameRoomAsObject', object: type })
    if (aloneInRoom) out.push({ type: 'sameRoomAsObject', object: type, alone: true })
  }
  // Negation: "his room had NO crate" — offered for every object type the room
  // lacks (editor: "Im selben Raum wie" + Objekt + NICHT; fully deducible via
  // the not-clue's definite cells).
  const boardObjTypes = new Set<string>()
  for (let c = 0; c < board.width * board.height; c++) {
    for (const obj of board.tileAt(c).objects()) boardObjTypes.add(obj.type)
  }
  for (const type of boardObjTypes) {
    if (!roomObjects.has(type)) {
      out.push({ type: 'not', clue: { type: 'sameRoomAsObject', object: type } })
    }
  }
  // "(not) alone in room X" as one clue (mirrors the editor's "Im Raum" + allein).
  out.push({ type: 'inRoom', room, occupancy: aloneInRoom ? 'alone' : 'notAlone' })

  for (const id of otherSuspects) {
    // 8-way direction relative to another suspect — emit all; the filter keeps the true
    // ones, so diagonals ("northeast of X") appear too, not just the four cardinals.
    for (const dir of DIRS8) out.push({ type: 'direction', of: id, dir })
    // "exactly N cells {cardinal} of X" (offset) — measures ONE axis only (column for
    // east/west, row for north/south); the other axis is free. So every other suspect at a
    // different column gives an east/west offset, and a different row a north/south one.
    const o = board.rc(solution.cellOf(id))
    const dc = col - o.col
    if (dc !== 0) out.push({ type: 'offset', of: id, dir: dc > 0 ? 'east' : 'west', distance: Math.abs(dc) })
    const dr = row - o.row
    if (dr !== 0) out.push({ type: 'offset', of: id, dir: dr < 0 ? 'north' : 'south', distance: Math.abs(dr) })
  }

  // "{dir} of {at least one | every} person with a trait" (victim counts) — offer the
  // cardinal that holds, for the FULL trait catalogue. 'some' is forward-deducible via
  // the relational technique's one-sided bound, 'all' via the stronger two-sided bound;
  // the candidate filter keeps only those that actually help.
  for (const { attribute, value } of allTraitPairs) {
    if (!usableTrait(attribute, value)) continue
    const matchers = puzzle
      .allIds()
      .filter((id) => id !== suspectId && puzzle.attributesOf(id)[attribute] === value)
    if (matchers.length === 0) continue
    for (const dir of DIRS8) {
      const inDir = (id: PersonId) => inDirection8(dir, { row, col }, board.rc(solution.cellOf(id)))
      if (matchers.some(inDir)) out.push({ type: 'directionFromAttr', attribute, value, dir, quantifier: 'some' })
      if (matchers.every(inDir)) out.push({ type: 'directionFromAttr', attribute, value, dir, quantifier: 'all' })
    }
  }

  // --- exact offset from an ANONYMOUS anchor (offsetFrom) --------------------------
  // "Exactly N rows/cols {dir} of someone …" — the person on that line is beside/on an
  // object or carries a trait. Emitted from what is actually true here; the pigeonhole
  // reading (that line's occupant MUST qualify) makes these broad but forward-deducible.
  for (const id of puzzle.allIds()) {
    if (id === suspectId) continue
    const oCell = solution.cellOf(id)
    const o = board.rc(oCell)
    const deltas: { dir: Direction; distance: number }[] = []
    if (o.col !== col) deltas.push({ dir: col > o.col ? 'east' : 'west', distance: Math.abs(col - o.col) })
    if (o.row !== row) deltas.push({ dir: row > o.row ? 'south' : 'north', distance: Math.abs(row - o.row) })
    if (deltas.length === 0) continue
    // Object relations this anchor's cell actually satisfies ("on" needs occupiable;
    // "beside" is the board's instance-aware rule).
    const onTypes = [...board.tileAt(oCell).objects()].filter((ob) => ob.occupiable).map((ob) => ob.type)
    const anchorRoom = board.roomIdOf(oCell)
    const nearAnchor = new Set<string>()
    for (const nb of board.neighbors4(oCell)) {
      if (board.roomIdOf(nb) !== anchorRoom) continue
      for (const ob of board.tileAt(nb).objects()) {
        if (board.isBesideObject(oCell, ob.type)) nearAnchor.add(ob.type)
      }
    }
    for (const { dir, distance } of deltas) {
      for (const kind of ['on', 'near'] as const) {
        for (const object of kind === 'on' ? onTypes : nearAnchor) {
          out.push({ type: 'offsetFrom', who: { kind, object }, dir, distance })
          // The suspects-scoped form is only true when this anchor IS a suspect.
          if (id !== VICTIM_ID) {
            out.push({ type: 'offsetFrom', who: { kind, object }, dir, distance, scope: 'suspects' })
          }
        }
      }
      // Trait anchors: every catalogue trait this anchor carries (victim only for
      // gender — usableTrait already bars hidden victim traits from the pool).
      for (const { attribute, value } of allTraitPairs) {
        if (!usableTrait(attribute, value)) continue
        if (puzzle.attributesOf(id)[attribute] !== value) continue
        out.push({ type: 'offsetFrom', who: { kind: 'attr', attribute, value }, dir, distance })
      }
    }
  }

  // --- exact offset from an OBJECT TILE (offsetFromObject, ∃ at least one) ---------
  // Only non-degenerate spreads survive: collapsesToLine drops every candidate that
  // pins a single row/column — that is the honest inRow/inCol clue's job.
  {
    const seen = new Set<string>()
    for (let c = 0; c < board.width * board.height; c++) {
      const o = board.rc(c)
      const pairs: { dir: Direction; distance: number }[] = []
      if (o.col !== col) pairs.push({ dir: col > o.col ? 'east' : 'west', distance: Math.abs(col - o.col) })
      if (o.row !== row) pairs.push({ dir: row > o.row ? 'south' : 'north', distance: Math.abs(row - o.row) })
      if (pairs.length === 0) continue
      for (const obj of board.tileAt(c).objects()) {
        for (const { dir, distance } of pairs) {
          for (const roomRel of ROOM_RELS) {
            const key = `${obj.type}|${dir}|${distance}|${roomRel}`
            if (seen.has(key)) continue
            seen.add(key)
            const json: ClueJson = { type: 'offsetFromObject', object: obj.type, dir, distance, room: roomRel }
            if (!collapsesToLine(json)) out.push(json)
          }
        }
      }
    }
  }

  // --- room-attribute clues: "no one / some / everyone else in the room had X" ---
  // Boolean traits AND gender now round-trip to the editor (gender via the "same room
  // as a man/woman" target). excludeSelf is ALWAYS true: the rendered wording is "ein
  // ANDERER Mann / kein anderer …" (about the OTHERS in the room), the editor's flat
  // builder always sets it, and the editor round-trip forces it — so generating it as
  // false produced a clue whose stored meaning (counts the subject itself) contradicted
  // its own displayed text and flipped under a round-trip. Always true keeps all three
  // (generator / renderer / editor) in agreement.
  // The FULL trait catalogue (allTraitPairs — every valued style a suspect wears, not
  // just hair) feeds this whole block (none/some/all + counted) AND the negation loop
  // below; the test-filter + usableTrait keep only the valid ones. Without the valued
  // styles, the editor's "Vorgaben" for them could never be generated.
  // See [[editor-generator-deduction-parity]].
  const attrPairs = allTraitPairs
  for (const { attribute, value } of attrPairs) {
    if (!usableTrait(attribute, value)) continue
    for (const quantifier of ['none', 'some', 'all'] as const) {
      out.push({ type: 'roomAttribute', quantifier, attribute, value, excludeSelf: true })
    }
  }
  // Counted variants of "some": "in a room with ≥N / exactly N matching others" — only
  // editor-safe (excludeSelf, so the subject never counts), matching the flat builder.
  // The test-filter keeps the ones true for the solution; we cap counts at the actual
  // number present in the room so we never offer a clue that can't hold.
  if (editorSafe) {
    for (const { attribute, value } of attrPairs) {
      if (!usableTrait(attribute, value)) continue
      const matching = inRoomAll.filter(
        (id) => id !== suspectId && puzzle.attributesOf(id)[attribute] === value,
      ).length
      // "at least N" for N ≥ 2 (N = 1 is the plain 'some' above).
      for (let n = 2; n <= matching; n++) {
        out.push({ type: 'roomAttribute', quantifier: 'some', attribute, value, excludeSelf: true, count: n })
      }
      // "exactly N" — only the real count is true, so offer just that one.
      if (matching >= 1) {
        out.push({ type: 'roomAttribute', quantifier: 'some', attribute, value, excludeSelf: true, count: matching, exact: true })
      }
    }
  }
  // "alone with N <attribute>" — about the OTHER suspects sharing the room (never the
  // subject, never the victim). Editor-representable via "alone with" + a trait + count.
  // A trait is usable only if EVERY co-occupant shares it (else "alone with only matching"
  // fails); the count is how many co-occupants there are.
  const othersInRoom = otherSuspects.filter((id) => board.roomIdOf(solution.cellOf(id)) === room)
  if (othersInRoom.length >= 1) {
    const n = othersInRoom.length
    for (const { attribute, value } of sharedTraits(othersInRoom)) {
      out.push({ type: 'roomCompanion', count: n, attribute, value })
    }
  }
  // "alone with a named suspect AND N others sharing a trait" (editor: "Allein mit Person
  // + weiteren"). Only when the victim is NOT in the room — a named co-suspect means ≥2
  // suspects, and the victim shares its room with exactly one suspect, so it can't be
  // here. One room mate is the named person, the rest are the matching extras (extraCount
  // = their number), optionally one of them in a cardinal direction from the subject.
  if (board.roomIdOf(solution.cellOf(VICTIM_ID)) !== room && othersInRoom.length >= 2) {
    const extraInDir = (dir: 'north' | 'south' | 'east' | 'west', ids: PersonId[]): boolean =>
      ids.some((id) => {
        const p = board.rc(solution.cellOf(id))
        return dir === 'north' ? p.row < row : dir === 'south' ? p.row > row : dir === 'east' ? p.col > col : p.col < col
      })
    for (const named of othersInRoom) {
      const extras = othersInRoom.filter((id) => id !== named)
      if (extras.length === 0) continue
      for (const { attribute, value } of sharedTraits(extras)) {
        if (!usableTrait(attribute, value)) continue
        out.push({ type: 'aloneWith', people: [named], attribute, value, extraCount: extras.length })
        for (const dir of ['north', 'south', 'east', 'west'] as const) {
          if (extraInDir(dir, extras)) {
            out.push({ type: 'aloneWith', people: [named], attribute, value, extraCount: extras.length, dir })
          }
        }
      }
    }
  }
  // "in his room someone (anyone / a man / someone with a beard …) was ON or BESIDE
  // an object" — round-trips to the editor's "Im Raum mit jemandem" builder.
  for (const id of othersInRoom) {
    const a = puzzle.attributesOf(id)
    // Every trait this co-occupant actually carries (so the clue is true), the full
    // editor palette: gender, the boolean traits, and the valued styles.
    const whoVariants: ({ attribute: string; value: AttributeValue } | null)[] = [
      null, // anyone
      { attribute: 'gender', value: a.gender },
    ]
    if (a.beard === true) whoVariants.push({ attribute: 'beard', value: true })
    if (a.glasses === true) whoVariants.push({ attribute: 'glasses', value: true })
    if (a.bald === true) whoVariants.push({ attribute: 'bald', value: true })
    for (const attr of ['hair', 'hairstyle', 'beardStyle', 'glassesShape', 'glassesColor'] as const) {
      if (typeof a[attr] === 'string') whoVariants.push({ attribute: attr, value: a[attr] })
    }

    const idCell = solution.cellOf(id)
    const idRoom = board.roomIdOf(idCell)
    const onTypes = [...board.tileAt(idCell).objects()]
      .filter((o) => o.occupiable)
      .map((o) => o.type)
    // "beside": the board's instance-aware rule (a second chair next door counts,
    // the object stood on never does).
    const nearTypes = new Set<string>()
    for (const nb of board.neighbors4(idCell)) {
      if (board.roomIdOf(nb) !== idRoom) continue
      for (const obj of board.tileAt(nb).objects()) {
        if (board.isBesideObject(idCell, obj.type)) nearTypes.add(obj.type)
      }
    }
    // Board positions this co-occupant stands on (corner ⊂ wall, so both can hold).
    const posList: ('corner' | 'wall' | 'window' | 'door')[] = []
    if (board.cornerCells().has(idCell)) posList.push('corner')
    if (board.cellsAtWall().has(idCell)) posList.push('wall')
    if (board.cellsNearWindow().has(idCell)) posList.push('window')
    if (board.cellsNearDoor().has(idCell)) posList.push('door')

    // Each "who" — anyone / a trait / a gender AND the specific NAMED co-occupant —
    // across every place they satisfy: on/beside an object, or a board position.
    const emit = (who: { attribute?: string; value?: AttributeValue; person?: PersonId }) => {
      for (const type of onTypes) out.push({ type: 'roomExists', ...who, object: type, relation: 'on' })
      for (const type of nearTypes) out.push({ type: 'roomExists', ...who, object: type, relation: 'near' })
      for (const relation of posList) out.push({ type: 'roomExists', ...who, relation })
    }
    for (const who of whoVariants) emit(who ? { attribute: who.attribute, value: who.value } : {})
    emit({ person: id })
  }

  // --- negations ("NICHT neben einem Regal / an der Wand / im Garten …") — broad,
  // information-light clues that keep the start board open. The hand-made easy levels
  // use them for elimination, and the broad-first construction starts suspects on
  // them. All of these round-trip into the editor. ---
  const allObjTypes = new Set<string>()
  const standableTypes = new Set<string>() // types one can actually stand ON (occupiable)
  for (let c = 0; c < board.width * board.height; c++) {
    for (const obj of board.tileAt(c).objects()) {
      allObjTypes.add(obj.type)
      if (obj.occupiable) standableTypes.add(obj.type)
    }
  }
  for (const t of allObjTypes) {
    out.push({ type: 'not', clue: { type: 'nearObject', object: t } })
    // "NOT on X" is only meaningful for an object one can stand on. A non-occupiable
    // object (e.g. a checkout / shelf) is never occupied, so "not on it" is true on EVERY
    // cell — a vacuous clue. Mirror the positive `onObject` guard (occupiable only).
    if (standableTypes.has(t)) out.push({ type: 'not', clue: { type: 'onObject', object: t } })
  }
  for (const r of puzzle.board.rooms.keys()) {
    if (r !== room) out.push({ type: 'not', clue: { type: 'inRoom', room: r } })
  }
  out.push({ type: 'not', clue: { type: 'atWall' } })
  out.push({ type: 'not', clue: { type: 'corner' } })
  if (board.cellsNearWindow().size > 0) out.push({ type: 'not', clue: { type: 'nearWindow' } })
  if (board.cellsNearDoor().size > 0) out.push({ type: 'not', clue: { type: 'nearDoor' } })

  // --- "spicy" negations of FORWARD-deducible relational/social/object clues:
  // "nicht im selben Raum wie X", "keine Frau / niemand mit Bart im Raum", "nicht in
  // derselben Zeile/Richtung wie ein Objekt". Broad, make-you-think elimination clues
  // (the user wants "nicht" used now and then for extra deduction). All propagate
  // forward — sameRoom via the different-room rule, the negated room-attribute via
  // not(some)≡none, the object ones via the not-clue's definite cells. The test-filter
  // below keeps only those TRUE here; HARD_CLUE_TYPES counts sameRoom/roomAttribute. ---
  for (const id of otherSuspects) {
    out.push({ type: 'not', clue: { type: 'sameRoom', as: id } })
  }
  for (const { attribute, value } of attrPairs) {
    out.push({
      type: 'not',
      clue: { type: 'roomAttribute', quantifier: 'some', attribute, value, excludeSelf: true },
    })
  }
  for (const def of ALL_OBJECTS) {
    const objCells = board.objectCells(def.type)
    // Same rule as the positive object clues: only a UNIQUE object (no "(Z/S)" anchor)
    // and not when the inner clue is just a disguised single line.
    if (objCells.length !== 1) continue
    for (const line of ['col', 'row', 'either'] as const) {
      const inner: ClueJson = { type: 'sameLineAsObject', object: def.type, line, room: 'any' }
      if (!collapsesToLine(inner)) out.push({ type: 'not', clue: inner })
    }
    for (const dir of DIRS8) {
      const inner: ClueJson = { type: 'directionFromObject', object: def.type, dir, room: 'any' }
      if (!collapsesToLine(inner)) out.push({ type: 'not', clue: inner })
    }
  }

  // Keep only clues TRUE for this solution; sort tightest-first (tightness once each).
  const scored = out
    .filter((json) => createClue(json).test(suspectId, solution, puzzle))
    .map((json) => ({ json, t: tightness(json, puzzle) }))
  scored.sort((a, b) => a.t - b.t)
  return scored.map((s) => s.json)
}

function tightness(json: ClueJson, puzzle: Puzzle): number {
  // Row/column clues are a last resort — prefer object/room/relational clues.
  if (json.type === 'inRow' || json.type === 'inCol') return 150
  const cells = createClue(json).candidateCells(puzzle.board)
  if (cells) return cells.size
  switch (json.type) {
    case 'roomCompanion':
      return 6
    case 'alone':
      return 8
    case 'offset':
      return 12
    // The anonymous anchor makes it broader than a named offset, but the pigeonhole
    // reading still bites hard — well before the room-level clues. (Only the attr kind
    // lands here; the object kinds have real candidateCells and are sized above.)
    case 'offsetFrom':
      return 30
    case 'roomAttribute':
      return 35
    case 'sameRoom':
      return 40
    // One room over is looser than the same room (several neighbours to choose from).
    case 'adjacentRooms':
      return 50
    case 'notAlone':
      return 70
    case 'insideXor':
      return 90
    case 'direction':
      return 100
    case 'directionFromAttr':
      return 110
    default:
      return 60
  }
}

/** Easy-clue palette: simple, self-contained clue types (or their negation) — the same
 *  ones the hand-made easy levels use. No abstract "same line / direction of" or attribute. */
/**
 * Easy-clue palette: simple, self-contained clue types (or their negation) — the same ones the
 * hand-made easy levels use. No abstract "same line / direction of" or attribute.
 *
 * This is a TASTE for FREE generation, not a veto: a type the user explicitly demands via the
 * editor's "Vorgaben" is used at easy too (see `required` in constructEasyClues). Otherwise an
 * explicit "easy + this clue type" could never be built — the demand narrows a suspect to that
 * type, the palette filtered it away, and every attempt died with no clue left to pin them.
 */
const EASY_ALLOWED_TYPES = new Set<string>([
  'onObject', 'uniqueOnObject', 'nearObject', 'inRoom', 'nearWindow', 'uniqueNearWindow',
  'nearDoor', 'corner', 'atWall', 'inside', 'outside', 'inCol', 'inRow',
])
const easyInnerType = (c: ClueJson): string => (c.type === 'not' ? c.clue.type : c.type)
const isLineClue = (c: ClueJson): boolean => {
  const t = easyInnerType(c)
  return t === 'inCol' || t === 'inRow'
}

/**
 * Build an EASY puzzle by FORWARD CONSTRUCTION instead of random search: place suspects
 * one at a time, each pinned to their cell by ≤2 SIMPLE clues that single them out among
 * the cells STILL AVAILABLE — the rows and columns of already-placed people are gone (the
 * Sudoku rule the game enforces). So it solves step by step ("this cell is forced, so that
 * one is too"), with no contradiction and mostly a single clue each. Returns null if some
 * suspect can't be pinned that way on this layout (then a different placement is tried).
 */
function constructEasyClues(
  base: LevelJson,
  suspectIds: PersonId[],
  solution: Solution,
  candidates: Map<PersonId, ClueJson[]>,
  rng: Rng,
  /** The user's "Vorgaben" from the editor. A clue shape demanded here is allowed at easy
   *  EVEN IF it isn't in the easy palette — an explicit instruction outranks the default
   *  taste. Whatever the user asks for must be usable, whichever difficulty they picked. */
  required?: ((json: ClueJson) => boolean)[],
  /** Per-request family-cap overrides (GenerateOptions.familyCaps — e.g. the daily). */
  familyCapOverrides?: Record<string, number>,
): Map<PersonId, ClueJson> | null {
  const capOf = (family: string): number => familyCapOverrides?.[family] ?? familyCap(family)
  const puzzle = loadLevel(base)
  const board = puzzle.board
  // How naturally a clue reads (object/room first; bare "column/row N" only as a last
  // resort; a negation slightly less preferred than its positive).
  const CLARITY: Record<string, number> = {
    onObject: 0, uniqueOnObject: 0, nearObject: 0, inRoom: 0,
    // Names a room like `inRoom`, but you must read the neighbours off the plan first.
    inRoomAdjacentTo: 1,
    corner: 1, atWall: 1, nearWindow: 1, uniqueNearWindow: 1, nearDoor: 1, inside: 1, outside: 1,
    inCol: 2, inRow: 2,
  }
  const clarityOf = (c: ClueJson): number => (CLARITY[easyInnerType(c)] ?? 3) + (c.type === 'not' ? 0.3 : 0)
  // Per-suspect easy candidates: clearest type first, then sharpest (fewest cells).
  // A clue is usable at easy when the palette allows its type OR the user explicitly
  // demanded that shape — an instruction always outranks the default taste.
  const allowed = (json: ClueJson): boolean =>
    EASY_ALLOWED_TYPES.has(easyInnerType(json)) || (required?.some((pred) => pred(json)) ?? false)

  const cand = new Map<PersonId, { json: ClueJson; cells: Set<Cell> }[]>()
  for (const id of suspectIds) {
    const list: { json: ClueJson; cells: Set<Cell> }[] = []
    for (const json of candidates.get(id)!) {
      if (!allowed(json)) continue
      const cells = createClue(json).candidateCells(board)
      if (cells) list.push({ json, cells })
    }
    list.sort((a, b) => clarityOf(a.json) - clarityOf(b.json) || a.cells.size - b.cells.size)
    cand.set(id, list)
  }

  // Suspects never share the victim's row/column (one person per row & column).
  const vr = board.rc(solution.cellOf(VICTIM_ID))
  const availRows = new Set<number>()
  const availCols = new Set<number>()
  for (let r = 0; r < board.height; r++) if (r !== vr.row) availRows.add(r)
  for (let c = 0; c < board.width; c++) if (c !== vr.col) availCols.add(c)
  const inAvail = (cell: Cell): boolean => {
    const { row, col } = board.rc(cell)
    return availRows.has(row) && availCols.has(col)
  }

  const chosen = new Map<PersonId, ClueJson>()
  const remaining = new Set(suspectIds)
  while (remaining.size > 0) {
    let pinnedId: PersonId | null = null
    let pinnedClue: ClueJson | null = null
    for (const id of rng.shuffle([...remaining])) {
      const cell = solution.cellOf(id)
      const list = cand.get(id)!
      const avail = list.map((e) => {
        const s = new Set<Cell>()
        for (const x of e.cells) if (inAvail(x)) s.add(x)
        return s
      })
      // 1) a single clue whose available cells are exactly {cell}.
      let idx: number[] | null = null
      for (let i = 0; i < list.length; i++) {
        if (avail[i].size === 1 && avail[i].has(cell)) {
          idx = [i]
          break
        }
      }
      // 2) else a PAIR whose available cells intersect to exactly {cell} — but never a
      //    column+row pair (that is a bare coordinate pin, which reads ugly).
      for (let i = 0; i < list.length && !idx; i++) {
        if (!avail[i].has(cell)) continue
        for (let j = i + 1; j < list.length; j++) {
          if (!avail[j].has(cell)) continue
          if (isLineClue(list[i].json) && isLineClue(list[j].json)) continue
          let extra = false
          for (const x of avail[i]) {
            if (x !== cell && avail[j].has(x)) {
              extra = true
              break
            }
          }
          if (!extra) {
            idx = [i, j]
            break
          }
        }
      }
      if (idx) {
        pinnedId = id
        pinnedClue = idx.length === 1 ? list[idx[0]].json : { type: 'and', clues: idx.map((k) => list[k].json) }
        break
      }
    }
    if (!pinnedId || !pinnedClue) return null // nobody pinnable with ≤2 simple clues — give up
    chosen.set(pinnedId, pinnedClue)
    const { row, col } = board.rc(solution.cellOf(pinnedId))
    availRows.delete(row)
    availCols.delete(col)
    remaining.delete(pinnedId)
  }

  // The cascade pins everyone DIRECTLY — that is too easy. Loosen most suspects so they
  // need a SHORT elimination chain: give each a clue that leaves only a FEW cells open (so
  // 1–2 cross-outs resolve them), while keeping the WHOLE puzzle solvable by simple forward
  // deduction (hidden singles / "only one on X" / row-column cross-out — rank ≤ 2, never a
  // hard technique or contradiction). Natural object/room clues are preferred over a bare
  // column/row; suspects with no short-chain option stay direct (the anchors).
  const SHORT_CHAIN_CELLS = 4
  const solvableChain = (): boolean => {
    const lvl = { ...base, suspects: base.suspects.map((s) => ({ ...s, clues: [chosen.get(s.id)!] })) }
    const res = new DeductionEngine(loadLevel(lvl)).solve()
    return res.solved && res.maxRank <= 2
  }
  for (const id of rng.shuffle([...suspectIds])) {
    const current = chosen.get(id)!
    const opts = cand
      .get(id)!
      .filter((e) => e.cells.size >= 2 && e.cells.size <= SHORT_CHAIN_CELLS) // a few open cells
      .sort((a, b) => {
        const la = isLineClue(a.json) ? 1 : 0
        const lb = isLineClue(b.json) ? 1 : 0
        return la - lb || b.cells.size - a.cells.size // natural & loosest-within-cap first
      })
    for (const e of opts) {
      if (e.json === current) continue
      chosen.set(id, e.json)
      if (solvableChain()) break
      chosen.set(id, current)
    }
  }

  // VARIETY cap (all difficulties): per `familyCap` — at most ONE line (row/column) clue,
  // at most two of every other capped family. Switch an offender to another easy clue that
  // keeps the short chain solvable; give up on this layout if it can't be met.
  const capTypes = cappedFamilies
  const famCounts = (): Map<string, number> => {
    const m = new Map<string, number>()
    for (const id of suspectIds) for (const t of capTypes(chosen.get(id)!)) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }
  for (let guard = 0; guard < 200; guard++) {
    const over = [...famCounts().entries()].find(([fam, n]) => n > capOf(fam))?.[0]
    if (over === undefined) break
    let fixed = false
    for (const id of rng.shuffle([...suspectIds])) {
      const cur = chosen.get(id)!
      if (!capTypes(cur).includes(over)) continue
      for (const e of cand.get(id)!) {
        if (e.json === cur || capTypes(e.json).includes(over)) continue
        chosen.set(id, e.json)
        if ([...famCounts().entries()].every(([fam, n]) => n <= capOf(fam)) && solvableChain()) {
          fixed = true
          break
        }
        chosen.set(id, cur)
      }
      if (fixed) break
    }
    if (!fixed) return null
  }

  // AVOID line clues: the user finds "in row/column X" dull at EASY and wants it rare
  // (ideally none, occasionally one — not on most suspects). Replace each line-carrying
  // suspect with a NON-line clue that keeps the short chain solvable and within the cap;
  // prefer a few-open-cells clue over a direct pin so it isn't trivialised. Keep the line
  // clue only when nothing else works.
  const hasLine = (c: ClueJson): boolean =>
    c.type === 'and' ? c.clues.some(hasLine) : isLineClue(c)
  for (const id of rng.shuffle([...suspectIds])) {
    const cur = chosen.get(id)!
    if (!hasLine(cur)) continue
    const opts = cand
      .get(id)!
      .filter((e) => e.json !== cur && !hasLine(e.json))
      .sort((a, b) => {
        const sa = a.cells.size >= 2 && a.cells.size <= SHORT_CHAIN_CELLS ? 0 : 1
        const sb = b.cells.size >= 2 && b.cells.size <= SHORT_CHAIN_CELLS ? 0 : 1
        return sa - sb || clarityOf(a.json) - clarityOf(b.json)
      })
    for (const e of opts) {
      chosen.set(id, e.json)
      if ([...famCounts().entries()].every(([fam, n]) => n <= capOf(fam)) && solvableChain()) break
      chosen.set(id, cur)
    }
  }

  // No two suspects may show the IDENTICAL clue (the "he/she" subject is not part of the
  // clue). Switch an offender to another easy clue that keeps the short chain solvable and
  // within the cap, lowering the duplicate count each round; give up on this layout if a
  // duplicate can't be cleared.
  const chosenList = (): ClueJson[] => suspectIds.map((id) => chosen.get(id)!)
  for (let guard = 0; guard < 200; guard++) {
    const before = duplicateClueCount(chosenList())
    if (before === 0) break
    let fixed = false
    for (const id of rng.shuffle([...suspectIds])) {
      const cur = chosen.get(id)!
      for (const e of cand.get(id)!) {
        if (e.json === cur) continue
        chosen.set(id, e.json)
        if (
          duplicateClueCount(chosenList()) < before &&
          [...famCounts().entries()].every(([fam, n]) => n <= capOf(fam)) &&
          solvableChain()
        ) {
          fixed = true
          break
        }
        chosen.set(id, cur)
      }
      if (fixed) break
    }
    if (!fixed) return null
  }

  // The user's "Vorgaben" must LAND, whatever they asked for. The easy palette decides which
  // clue can be the PIN; it must never decide what may appear at all. A relational clue
  // ("north of Bella") has no cell set, so it can't pin anyone — but it rides along on a
  // suspect who is already pinned:
  //  - AndClue.candidateCells ignores a null child and intersects the rest, so the pin holds;
  //  - `propagate` retries the simple techniques FIRST every round and finishes the level
  //    before the relational one is ever reached, so the rank stays ≤2 and it is truly easy;
  //  - a true clue can never cost the solution, so uniqueness is untouched.
  // Each demand is verified with `solvableChain()`; if none of the hosts work, the attempt is
  // abandoned and a fresh placement is tried.
  const clueParts = (c: ClueJson): ClueJson[] => (c.type === 'and' ? c.clues : [c])
  for (const pred of required ?? []) {
    if (suspectIds.some((id) => clueParts(chosen.get(id)!).some(pred))) continue // already there
    let placed = false
    for (const id of rng.shuffle([...suspectIds])) {
      const current = chosen.get(id)!
      for (const json of rng.shuffle(candidates.get(id)!.filter(pred))) {
        chosen.set(id, { type: 'and', clues: [...clueParts(current), json] })
        if (solvableChain()) {
          placed = true
          break
        }
        chosen.set(id, current)
      }
      if (placed) break
    }
    if (!placed) return null
  }

  // EASY: the victim must be placed LAST — ALL suspects pin from their own clues first,
  // then the victim is simply the last free cell. The user dislikes the mid-solve "this
  // lone cell can only be the victim ⇒ now the rest follows" (fine at medium/hard, not
  // easy). Reject layouts where the forward solve places the victim before a suspect.
  const victimPlacedLast = (): boolean => {
    const lvl = { ...base, suspects: base.suspects.map((s) => ({ ...s, clues: [chosen.get(s.id)!] })) }
    const res = new DeductionEngine(loadLevel(lvl)).solve()
    if (!res.solved) return false
    let victimAt = -1
    let lastSuspectAt = -1
    res.steps.forEach((step, i) => {
      if (step.placedCell === undefined || !step.personId) return
      if (step.personId === VICTIM_ID) victimAt = i
      else lastSuspectAt = i
    })
    return victimAt > lastSuspectAt
  }
  if (!victimPlacedLast()) return null
  return chosen
}

/** How many suspects are directly placeable from their OWN clue alone (their clues pin a
 *  single cell, with no need to cross anything out first). */
function countAnchors(
  chosen: Map<PersonId, ClueJson>,
  suspectIds: PersonId[],
  board: Board,
): number {
  let anchors = 0
  for (const id of suspectIds) {
    const cc = createClue(chosen.get(id)!).candidateCells(board)
    if (cc && cc.size === 1) anchors++
  }
  return anchors
}

/**
 * Build each suspect's clue by FORWARD CONSTRUCTION toward a target difficulty, the
 * same spirit as the easy constructor but aimed at the harder tiers. The DeductionEngine
 * is the only oracle: a level it solves by pure forward logic is ALREADY unique, so we
 * never run the old (expensive) prove-uniqueness-by-search loop.
 *
 *   1. TIGHTEN — start each suspect on their tightest natural clue and add more until the
 *      case is human-solvable (forward + convergent, no proof-by-contradiction).
 *   2. LOOSEN  — drop redundant ANDed parts, then widen each single clue toward looser
 *      candidates, RAISING the technique rank the solution needs up to `target`
 *      (medium ⇒ a rank-4 room/count deduction, hard ⇒ the rank-5 murder rule or
 *      convergent case split) while staying human-solvable. Looser clues ⇒ harder.
 *
 * Returns the loosest human-solvable clue set found — its rank may fall short of `target`
 * on a constrained board, and the caller (`pickBestLevel`) rates it honestly and keeps
 * hunting. Returns null only if the board admits no human-solvable forward solution.
 */
/** How many of a suspect's loosest candidate clues the widen pass (2b) tries — bounds
 *  the per-attempt cost on big, clue-rich boards. */
const WIDEN_SCAN = 8

/**
 * How many hard candidates the broadening pass (2a-hard) probes per suspect. A 9x9 suspect
 * offers ~94 of them and a hard clue only sticks at the ~21st on average, so probing all of
 * them cost a FULL DEDUCTION EACH — measured at 79% of the generator's entire runtime, two
 * thirds of it burnt on suspects for whom no hard clue works at all.
 *
 * The budget is spent EVENLY ACROSS the breadth-sorted list (stride = len/budget) rather
 * than on its first N: broad clues break solvability far more often than tight ones, so a
 * head-cap probes exactly the losers and forfeited 60% of all hard clues (measured). Spread
 * out, the cost is nil — a skipped candidate has near-identical neighbours, and the cheaper
 * attempt buys ~1.7x MORE attempts inside the same budget, which `pickBestLevel` turns back
 * into quality: measured 2.9 → 3.1 hard clues per level while Ø 11.5s → 8.3s (worst 18.2s →
 * 8.6s). Raising it does not buy hard clues; it only starves the selection of attempts.
 */
const HARD_SCAN = 24
function constructLogicClues(
  base: LevelJson,
  suspectIds: PersonId[],
  candidates: Map<PersonId, ClueJson[]>,
  rng: Rng,
  target: number,
  maxLineClues: number,
  /** HARD only: actively convert suspects onto broad relational/social clues so the
   *  level leans on MANY hard clues (the user's definition of hard), not on a single
   *  high-rank technique. */
  preferIndirect = false,
  /** Per-request family-cap overrides (GenerateOptions.familyCaps — e.g. the daily). */
  familyCapOverrides?: Record<string, number>,
): Map<PersonId, ClueJson> | null {
  const capOf = (family: string): number => familyCapOverrides?.[family] ?? familyCap(family)
  for (const id of suspectIds) if (candidates.get(id)!.length === 0) return null

  // Parsed ONCE: board, victim, global/board clues never change while clues are being chosen —
  // rate() below rebuilds only the suspects. This keeps ONE Board instance alive for the whole
  // construction, which is what lets the per-board candidateCells memo (see Clue) actually pay:
  // the same leaf Clue instances are rated hundreds of times against the same board.
  const basePuzzle = loadLevel(base)
  const board = basePuzzle.board
  const totalCells = board.occupiableCells().length
  // Each suspect's clue = the AND of their natural candidates at these indices.
  const list = (id: PersonId): ClueJson[] => candidates.get(id)!
  // Leaf Clue instances per candidate (stable JSONs ⇒ stable instances), and composite AND
  // instances per used-combination. Same construction as loadLevel→createClue, just cached.
  const leafInst = new Map<string, Clue>()
  const leafInstAt = (id: PersonId, i: number): Clue => {
    const key = `${id}:${i}`
    let inst = leafInst.get(key)
    if (!inst) {
      inst = createClue(list(id)[i])
      leafInst.set(key, inst)
    }
    return inst
  }
  const comboInst = new Map<string, Clue>()
  const clueInstOf = (id: PersonId): Clue => {
    const u = used.get(id)!
    if (u.length === 1) return leafInstAt(id, u[0])
    const key = `${id}:${u.join(',')}`
    let inst = comboInst.get(key)
    if (!inst) {
      inst = new AndClue(u.map((i) => leafInstAt(id, i)))
      comboInst.set(key, inst)
    }
    return inst
  }

  // Memoised candidate breadth (cells the clue leaves open).
  const breadthCache = new Map<string, number>()
  const breadthAt = (id: PersonId, i: number): number => {
    const key = `${id}:${i}`
    let size = breadthCache.get(key)
    if (size === undefined) {
      size = createClue(list(id)[i]).candidateCells(board)?.size ?? totalCells
      breadthCache.set(key, size)
    }
    return size
  }
  /**
   * Candidate indices ordered by REAL breadth, widest first (memoised per suspect).
   *
   * `candidatesFor` hands the pool over sorted by `tightness`, and that is NOT a breadth
   * order: it returns the true cell count for cell-based clues but hand-picked PRIORITY
   * constants for everything else — a row clue scores 150 ("last resort") while really
   * spanning 9 of 56 cells, and a relational clue scores 6–110 while leaving the WHOLE board
   * open. Treating the list position as breadth therefore "widened" suspects from a 56-cell
   * relational clue onto a 9-cell row clue: measured -17 cells on average, worst -64, with
   * 42% of all "successful" widenings ending up TIGHTER. Anything reasoning about broad vs
   * narrow must go through here, never through the list index.
   */
  const wideFirstCache = new Map<PersonId, number[]>()
  const wideFirst = (id: PersonId): number[] => {
    let idx = wideFirstCache.get(id)
    if (!idx) {
      idx = list(id).map((_, i) => i).sort((a, b) => breadthAt(id, b) - breadthAt(id, a))
      wideFirstCache.set(id, idx)
    }
    return idx
  }
  // The loosest candidate that still says SOMETHING (an uninformative clue covering
  // every cell would make the suspect count as unrestricted) and isn't a dull line.
  const broadestIdx = (id: PersonId): number => {
    for (const i of wideFirst(id)) {
      if (isLine(list(id)[i])) continue
      const size = breadthAt(id, i)
      if (size < totalCells && size > 1) return i
    }
    return 0
  }

  const isLine = (clue: ClueJson): boolean => clue.type === 'inRow' || clue.type === 'inCol'
  // Most suspects start on their TIGHTEST clue (fast, reliably solvable); about a
  // third start on a BROAD one ("nicht neben einer Pflanze", "nicht im Garten") so
  // levels keep using clues that leave much of the board open — a deliberate
  // preference WITHOUT any fixed quota (the user's call).
  // HARD (preferIndirect) starts MORE suspects on a broad clue, leaving gaps the global
  // board clues then resolve — so the offered board clues become genuinely needed (the
  // user wants hard to lean on global clues, often several).
  const broadStartChance = preferIndirect ? 0.5 : 0.35
  const used = new Map<PersonId, number[]>(
    suspectIds.map((id) => [id, [rng.chance(broadStartChance) ? broadestIdx(id) : 0]]),
  )
  const clueOf = (id: PersonId): ClueJson => {
    const parts = used.get(id)!.map((i) => list(id)[i])
    return parts.length === 1 ? parts[0] : { type: 'and', clues: parts }
  }
  // NOTE a rating memo (keyed by a signature of `used`) was tried and REMOVED: hit rate was
  // 0.5–1% over ~4100 rate() calls per run — the passes almost never revisit a clue state, so
  // the cache was proven harmless (identical fixed-seed levels) but useless. Don't rebuild it.
  //
  // The Puzzle is assembled DIRECTLY from the cached pieces (no LevelJson → loadLevel round
  // trip): same board instance, same victim/global/board clues, fresh Suspect wrappers around
  // the CACHED clue instances — identical semantics (verified via fixed-seed fingerprints),
  // but the board is parsed once instead of ~370× per attempt and the clue instances keep
  // their per-board candidateCells memo warm across every solve.
  const rate = () =>
    logicRatingOn(
      new Puzzle(
        basePuzzle.id,
        board,
        basePuzzle.suspects.map((s) => new Suspect(s.id, s.name, s.attributes, [clueInstOf(s.id)])),
        basePuzzle.victim,
        basePuzzle.globalClues,
        basePuzzle.boardClues,
      ),
    )

  // A suspect must carry at most ONE exact-coordinate clue (fixed row/column OR an exact
  // offset from someone): two of them pin the exact cell, which the user forbids
  // ("don't give the direct spot away"). Generalises the old inRow+inCol ban to offsets.
  const tooManyExactPins = (id: PersonId): boolean =>
    used.get(id)!.filter((i) => isExactAxisClue(list(id)[i])).length >= 2
  // No two suspects may show the IDENTICAL clue (same predicate, regardless of who it is
  // about) — the user dislikes e.g. two "was not beside a locker". Passes below judge this
  // as a DELTA ("does my change make it worse?"), never as a level-wide invariant ("is the
  // level clean?"): suspects START on a clue each, and the broad openers repeat across
  // people, so 96% of hard boards already carry a duplicate at birth. A guard demanding a
  // clean level then refuses EVERY candidate and deadlocks a board that was never at fault —
  // measured as 100% of construction give-ups, with ~2170 clues still free and none of them
  // actually tried. Pass 4 clears what remains; `pruneClues` and `pickBestLevel` still refuse
  // to ship a level with a duplicate, so the user's rule holds.
  const dupCount = (): number => duplicateClueCount(suspectIds.map(clueOf))
  const lineSuspects = (): number =>
    suspectIds.filter((id) => used.get(id)!.some((i) => isLine(list(id)[i]))).length
  const hasHardClue = (id: PersonId): boolean =>
    used.get(id)!.some((i) => isHardClue(list(id)[i]))

  // VARIETY: per `familyCap` — at most ONE line clue, at most two of every other capped
  // family (positive and negated count together), across all difficulties — so a level
  // can't lean on one type (e.g. a chain of "north of …"). Object / room / window-door
  // families are EXEMPT (they read as different clues per target); see `UNCAPPED_TYPES`.
  const cappedTypes = cappedFamilies
  const typeCounts = (): Map<string, number> => {
    const m = new Map<string, number>()
    for (const id of suspectIds) for (const t of cappedTypes(clueOf(id))) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }
  // Total overshoot across all capped families (0 ⇒ every cap met). Judged as a DELTA for the
  // same reason as `dupCount` — the suspects' broad openers routinely start a family over its
  // cap, and a guard asking "is every cap met?" of each candidate then refuses them all: the
  // broadening pass silently does nothing, and the repair below cannot take the FIRST of two
  // steps it needs (one swap rarely heals an overshoot of 2). Pass 3 drives this to 0.
  const capOverflow = (): number =>
    [...typeCounts().entries()].reduce((n, [fam, c]) => n + Math.max(0, c - capOf(fam)), 0)
  const capOk = (): boolean => capOverflow() === 0

  // Tightener: AND another part onto a suspect until the case cracks.
  //
  // `stuck` are the suspects the last deduction could NOT place — aim there FIRST. A clue on
  // someone the solver already places adds nothing to the blockage, so the old "whoever has
  // the fewest parts" order spent most of its (expensive, one-full-solve-each) rounds on
  // suspects that were never the problem. Fewest-parts stays as the tie-break within each group.
  const addPart = (stuck: readonly PersonId[]): boolean => {
    const dupBefore = dupCount()
    const blocked = new Set(stuck)
    const order = rng
      .shuffle([...suspectIds])
      .sort(
        (a, b) =>
          Number(!blocked.has(a)) - Number(!blocked.has(b)) ||
          used.get(a)!.length - used.get(b)!.length,
      )
    for (const id of order) {
      const u = used.get(id)!
      for (let i = 0; i < list(id).length; i++) {
        if (u.includes(i)) continue
        u.push(i)
        if (tooManyExactPins(id) || lineSuspects() > maxLineClues || dupCount() > dupBefore) {
          u.pop()
          continue
        }
        return true
      }
    }
    return false
  }

  // 1) TIGHTEN until human-solvable (add a clue to the suspect with the fewest, never
  //    inRow+inCol together, ≤ maxLineClues line clues overall). The default engine is
  //    contradiction-free, so "solved" already means "solvable without trial-and-error".
  for (let guard = 0; guard < 400; guard++) {
    const st = rate()
    if (st.solved) break
    if (!addPart(st.stuck)) return null
  }
  if (!rate().solved) return null // no human-solvable forward chain on this board

  // 2a) LOOSEN: drop redundant ANDed parts — minimal clues ⇒ the hardest forward path —
  //     as long as it stays human-solvable and doesn't overshoot the target rank.
  for (const id of suspectIds) {
    const u = used.get(id)!
    for (let k = u.length - 1; k >= 0 && u.length > 1; k--) {
      const removed = u.splice(k, 1)[0]
      const st = rate()
      if (!(st.solved && st.maxRank <= target)) u.splice(k, 0, removed)
    }
  }

  // 2a-hard) HARD ONLY — make as many suspects as possible carry a BROAD relational/social
  //     clue (one direction from a person, beside the same object as someone, in a room with
  //     someone). These are the "hard" families the user wants piled up; the loosest one
  //     first (wide ⇒ the player must cross-reference more). A switch is kept ONLY while the
  //     level stays human-solvable, so it never turns it unsolvable or ambiguous; suspects
  //     with no workable hard candidate just keep their current clue.
  if (preferIndirect) {
    for (const id of rng.shuffle([...suspectIds])) {
      if (hasHardClue(id)) continue
      const u = used.get(id)!
      if (u.length !== 1) continue
      const current = u[0]
      const dupBefore = dupCount()
      const capBefore = capOverflow()
      const hardIdx = list(id)
        .map((clue, i) => ({ clue, i }))
        .filter(({ clue, i }) => isHardClue(clue) && i !== current)
        .sort((a, b) => breadthAt(id, b.i) - breadthAt(id, a.i))
      // Probe HARD_SCAN candidates spread across the whole breadth range, not the first N.
      const stride = Math.max(1, Math.ceil(hardIdx.length / HARD_SCAN))
      for (let k = 0; k < hardIdx.length; k += stride) {
        const { i } = hardIdx[k]
        u[0] = i
        // CHEAP GUARDS FIRST. These only read `used`/`list`; `rate()` runs a full deduction
        // over the whole level. Asking it before them meant every candidate that a cap was
        // going to reject anyway still cost a solve — measured as the single most expensive
        // loop in the generator (43% of 9x9 hard's runtime).
        if (
          !tooManyExactPins(id) &&
          lineSuspects() <= maxLineClues &&
          capOverflow() <= capBefore &&
          dupCount() <= dupBefore &&
          rate().solved
        ) {
          break
        }
        u[0] = current
      }
    }
  }

  // 2b) LOOSEN: widen EVERY single clue as far as it will go — the loosest candidate that
  //     still leaves the case human-solvable wins, capped so it never tips into a harder tier.
  //
  //     This pass decides how much board is still in play once the player has read every clue
  //     — the user's "Ausdehnung", and what actually makes a level hard for a human ("der
  //     Anfang darf nicht einfach sein", and it must hold for MANY suspects, not one).
  //
  //     It used to be a RANK pass: wrapped in `if (rate().maxRank < target)` and breaking the
  //     moment the rank was reached. On hard the tightener usually hands over a rank-5 level
  //     already, so it never ran ONCE, and every suspect kept the TIGHTEST clue phase 1 gave
  //     them. Measured against the hand-made `museum` (the user's reference for "logical but
  //     hard"): its cell clues span 7–28 cells each and cover 98% of the board between them;
  //     generated ones sat at 1–9 cells and 24%. Widening is the goal now; the rank cap only
  //     stops it overshooting the tier.
  {
    for (const id of rng.shuffle([...suspectIds])) {
      const u = used.get(id)!
      if (u.length !== 1) continue
      const current = u[0]
      const dupBefore = dupCount()
      const capBefore = capOverflow()
      const startBreadth = breadthAt(id, current)
      // Widest first, and only genuinely wider ones — `wideFirst` is sorted, so the first
      // candidate that isn't an improvement ends the scan. WIDEN_SCAN bounds the cost.
      //
      // A candidate that leaves EVERY cell open is skipped, wide as it looks: it stops saying
      // anything about cells, which drops its suspect out of the Ausdehnung entirely (the same
      // rule `broadestIdx` already applies). Chasing raw breadth without it pushed 6 of 8
      // suspects onto relational clues and collapsed Ausdehnung from 39% to 4% while breadth
      // "improved" to 75% — the exact opposite of the hand-made `museum` (7 cell clues of 7–28
      // cells, ONE relational, 98% Ausdehnung). Handing suspects a relational clue is 2a-hard's
      // job; this pass widens what is left.
      let tries = 0
      for (const j of wideFirst(id)) {
        if (breadthAt(id, j) <= startBreadth || tries >= WIDEN_SCAN) break
        if (breadthAt(id, j) >= totalCells) continue // says nothing about cells — 2a-hard's call
        tries++
        u[0] = j
        // Cheap guards before the solve (see the 2a-hard pass).
        if (tooManyExactPins(id) || lineSuspects() > maxLineClues || capOverflow() > capBefore || dupCount() > dupBefore) {
          u[0] = current
          continue
        }
        const st = rate()
        if (st.solved && st.maxRank <= target) break
        u[0] = current
      }
    }
  }

  // 3) VARIETY CAP repair: if any family is still used >2× (e.g. from the broad starts),
  //    switch an offending single-clue suspect to a different family that keeps the level
  //    solvable and within the cap; give up on the board if it can't be met.
  for (let guard = 0; guard < 200 && !capOk(); guard++) {
    const overflowBefore = capOverflow()
    const overType = [...typeCounts().entries()].find(([fam, n]) => n > capOf(fam))?.[0]
    if (overType === undefined) break
    let fixed = false
    for (const id of rng.shuffle([...suspectIds])) {
      const u = used.get(id)!
      if (u.length !== 1 || !cappedTypes(list(id)[u[0]]).includes(overType)) continue
      const current = u[0]
      for (let i = 0; i < list(id).length; i++) {
        if (i === current || cappedTypes(list(id)[i]).includes(overType)) continue
        u[0] = i
        // Cheap guards before the solve (see the 2a-hard pass). The cap bar is PROGRESS, not
        // perfection: demanding a fully compliant level from a single swap made this repair
        // refuse every partial step and give up — measured as 63% of all attempts once the
        // dedup deadlock stopped masking it. Each round strictly lowers the overshoot, so the
        // loop still terminates, and its `capOk()` condition still only exits at zero.
        if (tooManyExactPins(id) || lineSuspects() > maxLineClues || capOverflow() >= overflowBefore) {
          u[0] = current
          continue
        }
        const st = rate()
        if (st.solved && st.maxRank <= target) {
          fixed = true
          break
        }
        u[0] = current
      }
      if (fixed) break
    }
    if (!fixed) return null
  }

  // 4) DEDUPE repair: remove any duplicate clue (two suspects showing the identical hint).
  //    Switch one of the clashing single-clue suspects to a different clue that keeps the
  //    level solvable and within every cap, lowering the duplicate count each round; give up
  //    on the board if the duplicate can't be cleared.
  for (let guard = 0; guard < 300; guard++) {
    const before = duplicateClueCount(suspectIds.map(clueOf))
    if (before === 0) break
    let fixed = false
    for (const id of rng.shuffle([...suspectIds])) {
      const u = used.get(id)!
      if (u.length !== 1) continue
      const current = u[0]
      for (let i = 0; i < list(id).length; i++) {
        if (i === current) continue
        u[0] = i
        // Cheap guards before the solve (see the 2a-hard pass) — including "did this switch
        // actually reduce the duplicates", which is pure bookkeeping and needs no solver.
        if (
          tooManyExactPins(id) ||
          lineSuspects() > maxLineClues ||
          !capOk() ||
          duplicateClueCount(suspectIds.map(clueOf)) >= before
        ) {
          u[0] = current
          continue
        }
        const st = rate()
        if (st.solved && st.maxRank <= target) {
          fixed = true
          break
        }
        u[0] = current
      }
      if (fixed) break
    }
    if (!fixed) return null
  }

  return new Map(suspectIds.map((id) => [id, clueOf(id)]))
}

/** How many suspects use a row/column clue — minimised for variety. */
function countLineClues(level: LevelJson): number {
  let n = 0
  for (const s of level.suspects) {
    const clues = s.clues ?? []
    const flat = clues.flatMap((c) => (c.type === 'and' ? c.clues : [c]))
    if (flat.some((c) => c.type === 'inRow' || c.type === 'inCol')) n++
  }
  return n
}

/** Count "exact cell" coordinate pins (inRow AND inCol) — must be 0. */
function countPins(assignment: Map<PersonId, ClueJson>): number {
  let pins = 0
  for (const clue of assignment.values()) {
    if (
      clue.type === 'and' &&
      clue.clues.some((c) => c.type === 'inRow') &&
      clue.clues.some((c) => c.type === 'inCol')
    ) {
      pins++
    }
  }
  return pins
}

