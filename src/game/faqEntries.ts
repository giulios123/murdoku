import {
  AdjacentRoomsClue,
  AloneClue,
  AloneWithClue,
  AndClue,
  AtWallClue,
  BesideSameObjectClue,
  CornerClue,
  CountOnObjectClue,
  CountWithAttrClue,
  DirectionClue,
  DirectionFromAttrClue,
  DirectionFromObjectClue,
  EmptyRoomsClue,
  InColClue,
  InRoomAdjacentToClue,
  InRoomClue,
  InRowClue,
  InsideXorClue,
  NearAnyObjectClue,
  NearDoorClue,
  NearObjectClue,
  NearWindowClue,
  NeighborRoomCountClue,
  NeighborRoomEmptyClue,
  NotAloneClue,
  NotClue,
  OffsetClue,
  OnObjectClue,
  OrClue,
  OutsideClue,
  RoomAttributeClue,
  RoomCompanionClue,
  RoomExistsClue,
  RoomOccupancyClue,
  SameLineAsObjectClue,
  SameRoomAsObjectClue,
  SameRoomClue,
  UniqueNearDoorClue,
  UniqueNearObjectClue,
  UniqueNearWindowClue,
  UniqueOnObjectClue,
  UniqueOutsideClue,
  VICTIM_ID,
  createBoardClue,
  createClue,
  loadLevel,
  type BoardClue,
  type BoardClueJson,
  type Cell,
  type Clue,
  type ClueJson,
  type PersonId,
  type Puzzle,
} from '../engine/index.ts'
import { FAQ_BOARDS, type FaqBoardId } from './faqBoards.ts'

/**
 * The Handakte catalog: every clue kind the game knows, each with a demo board,
 * an example clue rendered by the REAL clue renderer, and marks computed by the
 * REAL engine (candidateCells/violatedBy) — so an illustration can never drift
 * from what the solver actually does. Entries whose semantics depend on other
 * people place reference figures and, where `violatedBy` is too conservative
 * for a partial placement, compute their marks by hand (clearly per entry).
 *
 * Colours follow the game's existing language (Dirk's rule — no new colours):
 * CANDIDATE_BLUE = cells the clue still allows, REF_RED = cells that LOOK
 * possible but do not count. Room outlines / object rings reuse the Kommissar
 * helpMarks vocabulary.
 */

/** What the demo board shows for one variant. All fields optional — text-only
 *  entries (the concept cards) render no board at all. */
export interface FaqMarks {
  /** Cells the clue allows (drawn as the game's blue candidate highlight). */
  blue?: Set<Cell>
  /** Tempting cells that do NOT count (drawn in the game's red). */
  red?: Set<Cell>
  /** Crossed-out cells (the base-rule entry). */
  crosses?: Set<Cell>
  /** Room outlines (reference, like the Kommissar marks). */
  rooms?: Set<string>
  /** Room outlines in red ("this one does not qualify"). */
  redRooms?: Set<string>
  /** Object cells ringed as the reference the clue points at. */
  ring?: Set<Cell>
  /** Light up the window / door symbols. */
  windows?: boolean
  doors?: boolean
}

export interface FaqVariant {
  /** Chip label (i18n key). Omitted when the entry has a single variant. */
  labelKey?: string
  /** Example clue of a suspect (rendered via ClueText). */
  clue?: ClueJson
  /** …or a board-wide clue (rendered via BoardClueText). */
  boardClue?: BoardClueJson
  /** Subject override (defaults to the entry's subject). */
  subject?: PersonId
  /** Reference figures, id → cell (drawn as placed tokens). */
  refs?: Record<string, Cell>
  /** Place the victim (skull token). */
  victimAt?: Cell
  /** Full manual marks — replaces the automatic possible-cells computation. */
  marks?: (puzzle: Puzzle) => FaqMarks
  /** Extra red cells on top of the automatic blue set. */
  red?: (puzzle: Puzzle, blue: Set<Cell>) => Set<Cell>
  /** Extra reference decor (rings / room outlines / portal glow) merged into the marks. */
  decor?: (puzzle: Puzzle) => Partial<FaqMarks>
}

export interface FaqEntry {
  id: string
  board: FaqBoardId | null
  /** Whose clue the example is (the card above the board). */
  subject?: PersonId
  /** Show the coordinate strips (row/column entries). */
  axes?: boolean
  /** Show the game's legend line under the board. */
  legend?: 'outside' | 'water'
  /** The entry explains a trap — rendered as the crimson "Achtung" line. */
  variants: FaqVariant[]
}

export interface FaqCategory {
  id: string
  entries: FaqEntry[]
}

// --- demo puzzles (loaded once — three tiny boards) -------------------------

const puzzles: Partial<Record<FaqBoardId, Puzzle>> = {}

export function faqPuzzle(id: FaqBoardId): Puzzle {
  return (puzzles[id] ??= loadLevel(FAQ_BOARDS[id], { skipClues: true }))
}

// --- mark helpers -----------------------------------------------------------

/** All boards are 6×6 — cell shorthand for the specs below. */
const c = (row: number, col: number): Cell => row * 6 + col

const occupiableInRooms = (puzzle: Puzzle, rooms: Iterable<string>, taken?: Set<Cell>): Set<Cell> => {
  const wanted = new Set(rooms)
  const out = new Set<Cell>()
  for (const cell of puzzle.board.occupiableCells()) {
    if (wanted.has(puzzle.board.roomIdOf(cell)) && !taken?.has(cell)) out.add(cell)
  }
  return out
}

const roomsWithObject = (puzzle: Puzzle, type: string): Set<string> =>
  new Set(puzzle.board.objectCells(type).map((cell) => puzzle.board.roomIdOf(cell)))

const objectRing = (type: string) => (puzzle: Puzzle) => ({
  ring: new Set(puzzle.board.objectCells(type)),
})

/** Occupiable cells in the given half-plane / quadrant relative to `from`. */
const cellsTowards = (
  puzzle: Puzzle,
  from: Cell,
  test: (dr: number, dc: number) => boolean,
): Set<Cell> => {
  const { row, col } = puzzle.board.rc(from)
  const out = new Set<Cell>()
  for (const cell of puzzle.board.occupiableCells()) {
    const p = puzzle.board.rc(cell)
    if (cell !== from && test(p.row - row, p.col - col)) out.add(cell)
  }
  return out
}

const intersect = (a: Set<Cell>, b: Set<Cell>): Set<Cell> => new Set([...a].filter((x) => b.has(x)))
const union = (a: Set<Cell>, b: Set<Cell>): Set<Cell> => new Set([...a, ...b])

/**
 * The automatic mark computation: every occupiable cell the clue still allows for
 * the subject, given the reference placements — candidateCells as the superset,
 * violatedBy as the per-cell check. Exactly the engine's own pruning, so the
 * picture can never claim something the solver would not.
 */
export function possibleCells(
  puzzle: Puzzle,
  subject: PersonId,
  clue: Clue,
  refs: Record<string, Cell> = {},
): Set<Cell> {
  const board = puzzle.board
  const cand = clue.candidateCells(board) // shared memo — never mutate
  const taken = new Set<Cell>(Object.values(refs))
  const out = new Set<Cell>()
  for (const cell of board.occupiableCells()) {
    if (cand && !cand.has(cell)) continue
    if (taken.has(cell)) continue
    const placement = new Map<PersonId, Cell>(Object.entries(refs))
    placement.set(subject, cell)
    if (clue.violatedBy(subject, placement, puzzle)) continue
    out.add(cell)
  }
  return out
}

/** Resolve a variant into everything the board component needs. */
export interface FaqView {
  puzzle: Puzzle
  subject: PersonId | null
  clue: Clue | null
  boardClue: BoardClue | null
  placements: Map<PersonId, Cell>
  marks: FaqMarks
}

export function resolveVariant(entry: FaqEntry, variant: FaqVariant): FaqView | null {
  if (entry.board === null) return null
  const puzzle = faqPuzzle(entry.board)
  const subject = variant.subject ?? entry.subject ?? null
  const clue = variant.clue ? createClue(variant.clue) : null
  const boardClue = variant.boardClue ? createBoardClue(variant.boardClue) : null

  const placements = new Map<PersonId, Cell>(Object.entries(variant.refs ?? {}))
  if (variant.victimAt !== undefined) placements.set(VICTIM_ID, variant.victimAt)

  let marks: FaqMarks
  if (variant.marks) {
    marks = variant.marks(puzzle)
  } else if (clue && subject) {
    const blue = possibleCells(puzzle, subject, clue, variant.refs)
    marks = { blue, red: variant.red?.(puzzle, blue) }
  } else {
    marks = {}
  }
  if (variant.decor) marks = { ...marks, ...variant.decor(puzzle) }
  return { puzzle, subject, clue, boardClue, placements, marks }
}

// --- per-entry mark functions (house geometry, see faqBoards.ts) ------------

/** Red for the flagship "beside an object": orthogonal neighbours in ANOTHER room
 *  plus same-room DIAGONAL neighbours — the two ways "beside" is misread. */
const nearObjectRed =
  (type: string) =>
  (puzzle: Puzzle, blue: Set<Cell>): Set<Cell> => {
    const board = puzzle.board
    const out = new Set<Cell>()
    const occupiable = new Set(board.occupiableCells())
    for (const oc of board.objectCells(type)) {
      const { row, col } = board.rc(oc)
      for (const [dr, dc] of [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [-1, 1], [1, -1], [1, 1],
      ]) {
        if (!board.inBounds(row + dr, col + dc)) continue
        const cell = board.idx(row + dr, col + dc)
        if (!occupiable.has(cell) || blue.has(cell)) continue
        const diagonal = dr !== 0 && dc !== 0
        // Cross-room diagonals are not tempting; same-room diagonals + any orthogonal are.
        if (diagonal && board.roomIdOf(cell) !== board.roomIdOf(oc)) continue
        out.add(cell)
      }
    }
    return out
  }

/** Cells of one room (occupiable), minus any reference figure standing there. */
const roomCellsRed =
  (roomId: string, exceptRef?: Cell) =>
  (puzzle: Puzzle): Set<Cell> => {
    const out = occupiableInRooms(puzzle, [roomId])
    if (exceptRef !== undefined) out.delete(exceptRef)
    return out
  }

/** Same row / same column as a reference cell — "level with them does not count". */
const sameLineRed =
  (ref: Cell, axis: 'row' | 'col') =>
  (puzzle: Puzzle, blue: Set<Cell>): Set<Cell> => {
    const board = puzzle.board
    const target = board.rc(ref)
    const out = new Set<Cell>()
    for (const cell of board.occupiableCells()) {
      if (cell === ref || blue.has(cell)) continue
      const p = board.rc(cell)
      if (axis === 'row' ? p.row === target.row : p.col === target.col) out.add(cell)
    }
    return out
  }

// --- the catalog ------------------------------------------------------------

/** House refs used by several social entries (rows and columns stay distinct so a
 *  demo never violates the one-per-line base rule in front of the player). */
const HOUSE_SOCIAL_REFS = { B: c(1, 1), A: c(0, 4) }

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: 'basics',
    entries: [
      {
        id: 'rulePermutation',
        board: 'house',
        variants: [
          {
            refs: { B: c(1, 1), C: c(0, 4) },
            marks: (puzzle) => {
              const board = puzzle.board
              const figures = [c(1, 1), c(0, 4)]
              const crosses = new Set<Cell>()
              const blue = new Set<Cell>()
              for (const cell of board.occupiableCells()) {
                if (figures.includes(cell)) continue
                const p = board.rc(cell)
                const shared = figures.some((f) => {
                  const q = board.rc(f)
                  return q.row === p.row || q.col === p.col
                })
                if (shared) crosses.add(cell)
                else blue.add(cell)
              }
              return { crosses, blue }
            },
          },
        ],
      },
      {
        id: 'ruleMurder',
        board: 'house',
        variants: [
          {
            victimAt: c(3, 4),
            // The victim counts like any person (base rule), so its whole row and
            // column are already crossed out — inside the outlined room only the
            // remaining blue cells can hold the murderer.
            marks: (puzzle) => {
              const board = puzzle.board
              const v = board.rc(c(3, 4))
              const crosses = new Set<Cell>()
              const blue = new Set<Cell>()
              for (const cell of board.occupiableCells()) {
                if (cell === c(3, 4)) continue
                const p = board.rc(cell)
                if (p.row === v.row || p.col === v.col) crosses.add(cell)
                else if (board.roomIdOf(cell) === 'B') blue.add(cell)
              }
              return { rooms: new Set(['B']), crosses, blue }
            },
          },
        ],
      },
      { id: 'termSuspects', board: null, variants: [{}] },
      { id: 'termVictim', board: null, variants: [{}] },
      {
        id: 'termOutside',
        board: 'garden',
        legend: 'outside',
        variants: [{ marks: () => ({ rooms: new Set(['G', 'Y', 'S']) }) }],
      },
      {
        id: 'termWater',
        board: 'garden',
        legend: 'water',
        variants: [{ marks: (puzzle) => ({ blue: occupiableInRooms(puzzle, ['S']) }) }],
      },
    ],
  },
  {
    id: 'objects',
    entries: [
      {
        id: 'onObject',
        board: 'house',
        subject: 'A',
        variants: [
          { labelKey: 'faq.v.bed', clue: { type: 'onObject', object: 'bed' } },
          { labelKey: 'faq.v.chair', clue: { type: 'onObject', object: 'chair' } },
          { labelKey: 'faq.v.carpet', clue: { type: 'onObject', object: 'carpet' } },
          {
            labelKey: 'faq.v.not',
            clue: { type: 'not', clue: { type: 'onObject', object: 'bed' } },
            decor: objectRing('bed'),
          },
        ],
      },
      {
        id: 'nearObject',
        board: 'house',
        subject: 'B',
        variants: [
          {
            labelKey: 'faq.v.table',
            clue: { type: 'nearObject', object: 'table' },
            red: nearObjectRed('table'),
            decor: objectRing('table'),
          },
          {
            labelKey: 'faq.v.not',
            clue: { type: 'not', clue: { type: 'nearObject', object: 'table' } },
            decor: objectRing('table'),
          },
          {
            labelKey: 'faq.v.oneOf',
            clue: { type: 'nearObjectAny', objects: ['table', 'bed'] },
          },
        ],
      },
      {
        id: 'nearPortal',
        board: 'house',
        subject: 'C',
        variants: [
          {
            labelKey: 'faq.v.window',
            clue: { type: 'nearWindow' },
            decor: () => ({ windows: true }),
          },
          {
            labelKey: 'faq.v.door',
            clue: { type: 'nearDoor' },
            decor: () => ({ doors: true }),
          },
        ],
      },
      {
        id: 'sameRoomAsObject',
        board: 'house',
        subject: 'D',
        variants: [
          {
            labelKey: 'faq.v.fridge',
            clue: { type: 'sameRoomAsObject', object: 'fridge' },
            decor: (puzzle) => ({
              ring: new Set(puzzle.board.objectCells('fridge')),
              rooms: roomsWithObject(puzzle, 'fridge'),
            }),
          },
          {
            labelKey: 'faq.v.bed',
            clue: { type: 'sameRoomAsObject', object: 'bed' },
            decor: (puzzle) => ({
              ring: new Set(puzzle.board.objectCells('bed')),
              rooms: roomsWithObject(puzzle, 'bed'),
            }),
          },
          {
            labelKey: 'faq.v.plusAlone',
            clue: { type: 'sameRoomAsObject', object: 'fridge', alone: true },
            decor: objectRing('fridge'),
          },
        ],
      },
      {
        id: 'sameLineAsObject',
        board: 'house',
        subject: 'E',
        axes: true,
        variants: [
          {
            labelKey: 'faq.v.column',
            clue: { type: 'sameLineAsObject', object: 'plant', line: 'col', room: 'any' },
            decor: objectRing('plant'),
          },
          {
            labelKey: 'faq.v.row',
            clue: { type: 'sameLineAsObject', object: 'plant', line: 'row', room: 'any' },
            decor: objectRing('plant'),
          },
          {
            labelKey: 'faq.v.otherRoom',
            clue: { type: 'sameLineAsObject', object: 'plant', line: 'col', room: 'other' },
            decor: objectRing('plant'),
          },
        ],
      },
      {
        id: 'directionFromObject',
        board: 'house',
        subject: 'A',
        variants: [
          {
            labelKey: 'faq.v.north',
            clue: { type: 'directionFromObject', object: 'plant', dir: 'north', room: 'any' },
            red: sameLineRed(c(5, 1), 'row'),
            decor: objectRing('plant'),
          },
          {
            labelKey: 'faq.v.east',
            clue: { type: 'directionFromObject', object: 'plant', dir: 'east', room: 'any' },
            red: sameLineRed(c(5, 1), 'col'),
            decor: objectRing('plant'),
          },
          {
            labelKey: 'faq.v.northeast',
            clue: { type: 'directionFromObject', object: 'plant', dir: 'northeast', room: 'any' },
            decor: objectRing('plant'),
          },
        ],
      },
      {
        id: 'besideSameObject',
        board: 'house',
        subject: 'B',
        variants: [
          {
            clue: { type: 'besideSameObject', object: 'table', mate: { kind: 'person', of: 'C' } },
            refs: { C: c(1, 4) },
            // Clara stands beside the DINING table. The engine's candidateCells is a
            // deliberate superset (any instance), so the picture is computed from the
            // instance geometry itself: blue = beside HER instance, red = beside the
            // kitchen table — same TYPE, different INSTANCE.
            marks: (puzzle) => {
              const board = puzzle.board
              const beside = (comp: Set<Cell>): Set<Cell> => {
                const out = new Set<Cell>()
                for (const cell of comp) {
                  const room = board.roomIdOf(cell)
                  for (const nb of board.neighbors4(cell)) {
                    if (!comp.has(nb) && board.roomIdOf(nb) === room && board.isOccupiable(nb))
                      out.add(nb)
                  }
                }
                return out
              }
              const instances = board.objectInstances('table')
              const mateCell = c(1, 4)
              const withMate = instances.find((comp) => beside(comp).has(mateCell))!
              const blue = beside(withMate)
              blue.delete(mateCell)
              const red = new Set<Cell>()
              for (const comp of instances) {
                if (comp === withMate) continue
                for (const cell of beside(comp)) if (!blue.has(cell)) red.add(cell)
              }
              return { blue, red, ring: new Set(board.objectCells('table')) }
            },
          },
        ],
      },
    ],
  },
  {
    id: 'rooms',
    entries: [
      {
        id: 'inRoom',
        board: 'rooms',
        subject: 'F',
        variants: [
          {
            labelKey: 'faq.v.plain',
            clue: { type: 'inRoom', room: '2' },
            decor: () => ({ rooms: new Set(['2']) }),
          },
          {
            labelKey: 'faq.v.plusAlone',
            clue: { type: 'inRoom', room: '2', occupancy: 'alone' },
            decor: () => ({ rooms: new Set(['2']) }),
          },
          {
            labelKey: 'faq.v.plusNotAlone',
            clue: { type: 'inRoom', room: '2', occupancy: 'notAlone' },
            decor: () => ({ rooms: new Set(['2']) }),
          },
        ],
      },
      {
        id: 'inRoomAdjacentTo',
        board: 'rooms',
        subject: 'F',
        variants: [
          {
            clue: { type: 'inRoomAdjacentTo', room: '1' },
            red: roomCellsRed('1'),
            decor: () => ({ rooms: new Set(['1']) }),
          },
        ],
      },
      {
        id: 'adjacentRooms',
        board: 'rooms',
        subject: 'F',
        variants: [
          {
            clue: { type: 'adjacentRooms', as: 'E' },
            refs: { E: c(1, 0) },
            red: roomCellsRed('1', c(1, 0)),
          },
        ],
      },
      {
        id: 'neighborRoomEmpty',
        board: 'rooms',
        subject: 'F',
        variants: [
          {
            clue: { type: 'neighborRoomEmpty' },
            refs: { F: c(2, 2) },
            marks: () => ({ rooms: new Set(['1', '2', '4']) }),
          },
        ],
      },
      {
        id: 'neighborRoomCount',
        board: 'rooms',
        subject: 'E',
        variants: [
          // Dirk's own motivating example leads: "in einem angrenzenden Raum, der
          // komplett östlich von Emil lag, waren genau 2 Verdächtige".
          {
            labelKey: 'faq.v.east',
            clue: { type: 'neighborRoomCount', count: 2, dir: 'east' },
            refs: { E: c(1, 0) },
            marks: () => ({ rooms: new Set(['2', '3']), redRooms: new Set(['4']) }),
          },
          {
            labelKey: 'faq.v.south',
            clue: { type: 'neighborRoomCount', count: 1, dir: 'south' },
            refs: { E: c(1, 0) },
            // Half-plane over the WHOLE room: rooms 3 AND 4 lie completely south of
            // Emil (room 3 also east — that is the lesson); room 2 does not qualify.
            marks: () => ({ rooms: new Set(['3', '4']), redRooms: new Set(['2']) }),
          },
          {
            labelKey: 'faq.v.noDir',
            clue: { type: 'neighborRoomCount', count: 1 },
            refs: { E: c(1, 0) },
            marks: () => ({ rooms: new Set(['2', '3', '4']) }),
          },
        ],
      },
    ],
  },
  {
    id: 'position',
    entries: [
      {
        id: 'inLine',
        board: 'house',
        subject: 'C',
        axes: true,
        variants: [
          { labelKey: 'faq.v.row', clue: { type: 'inRow', row: 1 } },
          { labelKey: 'faq.v.column', clue: { type: 'inCol', col: 3 } },
        ],
      },
      {
        id: 'corner',
        board: 'house',
        subject: 'D',
        variants: [{ clue: { type: 'corner' } }],
      },
      {
        id: 'atWall',
        board: 'house',
        subject: 'D',
        variants: [{ clue: { type: 'atWall' } }],
      },
      {
        id: 'inout',
        board: 'garden',
        subject: 'J',
        legend: 'outside',
        variants: [
          { labelKey: 'faq.v.inside', clue: { type: 'inside' } },
          { labelKey: 'faq.v.outside', clue: { type: 'outside' } },
          { labelKey: 'faq.v.uniqueOutside', clue: { type: 'uniqueOutside' } },
        ],
      },
    ],
  },
  {
    id: 'direction',
    entries: [
      {
        id: 'direction',
        board: 'house',
        subject: 'A',
        variants: [
          {
            labelKey: 'faq.v.south',
            clue: { type: 'direction', of: 'B', dir: 'south' },
            refs: { B: c(2, 3) },
            red: sameLineRed(c(2, 3), 'row'),
          },
          {
            labelKey: 'faq.v.east',
            clue: { type: 'direction', of: 'B', dir: 'east' },
            refs: { B: c(2, 3) },
            red: sameLineRed(c(2, 3), 'col'),
          },
          {
            labelKey: 'faq.v.southeast',
            clue: { type: 'direction', of: 'B', dir: 'southeast' },
            refs: { B: c(2, 3) },
          },
          {
            labelKey: 'faq.v.northwest',
            clue: { type: 'direction', of: 'B', dir: 'northwest' },
            refs: { B: c(2, 3) },
          },
        ],
      },
      {
        id: 'offset',
        board: 'house',
        subject: 'C',
        axes: true,
        variants: [
          {
            labelKey: 'faq.v.twoWest',
            clue: { type: 'offset', of: 'B', dir: 'west', distance: 2 },
            refs: { B: c(2, 3) },
            // Right direction, wrong distance — every other west column is red.
            red: (puzzle, blue) => {
              const out = new Set<Cell>()
              for (const cell of puzzle.board.occupiableCells()) {
                if (!blue.has(cell) && puzzle.board.rc(cell).col < 3) out.add(cell)
              }
              return out
            },
          },
          {
            labelKey: 'faq.v.oneSouth',
            clue: { type: 'offset', of: 'B', dir: 'south', distance: 1 },
            refs: { B: c(2, 3) },
            red: (puzzle, blue) => {
              const out = new Set<Cell>()
              for (const cell of puzzle.board.occupiableCells()) {
                if (!blue.has(cell) && puzzle.board.rc(cell).row > 2) out.add(cell)
              }
              return out
            },
          },
        ],
      },
      {
        id: 'directionFromAttr',
        board: 'house',
        subject: 'A',
        variants: [
          {
            labelKey: 'faq.v.some',
            clue: { type: 'directionFromAttr', attribute: 'beard', value: true, dir: 'south', quantifier: 'some' },
            refs: { B: c(2, 3), E: c(4, 0) },
            // "South of at least one bearded man" = union of the two half-planes
            // (minus the carriers' own cells — figures stand there).
            marks: (puzzle) => {
              const blue = union(
                cellsTowards(puzzle, c(2, 3), (dr) => dr > 0),
                cellsTowards(puzzle, c(4, 0), (dr) => dr > 0),
              )
              blue.delete(c(2, 3))
              blue.delete(c(4, 0))
              return { blue }
            },
          },
          {
            labelKey: 'faq.v.all',
            clue: { type: 'directionFromAttr', attribute: 'beard', value: true, dir: 'south', quantifier: 'all' },
            refs: { B: c(2, 3), E: c(4, 0) },
            marks: (puzzle) => {
              const blue = intersect(
                cellsTowards(puzzle, c(2, 3), (dr) => dr > 0),
                cellsTowards(puzzle, c(4, 0), (dr) => dr > 0),
              )
              blue.delete(c(2, 3))
              blue.delete(c(4, 0))
              return { blue }
            },
          },
        ],
      },
      {
        id: 'insideXor',
        board: 'garden',
        subject: 'K',
        legend: 'outside',
        variants: [
          {
            labelKey: 'faq.v.mateInside',
            clue: { type: 'insideXor', with: 'J' },
            refs: { J: c(1, 1) },
          },
          {
            labelKey: 'faq.v.mateOutside',
            clue: { type: 'insideXor', with: 'J' },
            refs: { J: c(3, 4) },
          },
        ],
      },
    ],
  },
  {
    id: 'social',
    entries: [
      {
        id: 'alone',
        board: 'house',
        subject: 'C',
        variants: [
          {
            clue: { type: 'alone' },
            refs: HOUSE_SOCIAL_REFS,
          },
        ],
      },
      {
        id: 'notAlone',
        board: 'house',
        subject: 'C',
        variants: [
          {
            clue: { type: 'notAlone' },
            // Every other suspect already placed, so the occupied rooms are known.
            refs: { B: c(1, 1), A: c(0, 4), D: c(3, 0), E: c(5, 3) },
            marks: (puzzle) => ({
              blue: occupiableInRooms(
                puzzle,
                ['K', 'D', 'L'],
                new Set([c(1, 1), c(0, 4), c(3, 0), c(5, 3)]),
              ),
            }),
          },
        ],
      },
      {
        id: 'sameRoom',
        board: 'house',
        subject: 'A',
        variants: [
          {
            labelKey: 'faq.v.plain',
            clue: { type: 'sameRoom', as: 'C' },
            refs: { C: c(4, 1) },
          },
          {
            labelKey: 'faq.v.plusAlone',
            clue: { type: 'sameRoom', as: 'C', alone: true },
            refs: { C: c(4, 1) },
          },
        ],
      },
      {
        id: 'aloneWith',
        board: 'house',
        subject: 'A',
        variants: [
          {
            clue: { type: 'aloneWith', people: ['B'], attribute: 'gender', value: 'f', extraCount: 1 },
            refs: { B: c(1, 1) },
          },
        ],
      },
      {
        id: 'roomAttribute',
        board: 'house',
        subject: 'C',
        variants: [
          {
            labelKey: 'faq.v.none',
            clue: { type: 'roomAttribute', quantifier: 'none', attribute: 'beard', value: true },
            refs: { B: c(1, 1), E: c(0, 4), D: c(3, 0) },
          },
          {
            labelKey: 'faq.v.someone',
            clue: { type: 'roomAttribute', quantifier: 'some', attribute: 'beard', value: true },
            refs: { B: c(1, 1), E: c(0, 4), D: c(3, 0) },
            // violatedBy only prunes 'none' — the rooms holding a bearded figure are known.
            marks: (puzzle) => ({
              blue: occupiableInRooms(puzzle, ['K', 'D'], new Set([c(1, 1), c(0, 4)])),
            }),
          },
          {
            labelKey: 'faq.v.allOthers',
            clue: { type: 'roomAttribute', quantifier: 'all', attribute: 'beard', value: true, excludeSelf: true },
            refs: { B: c(1, 1), E: c(0, 4), D: c(3, 0) },
            marks: (puzzle) => ({
              blue: occupiableInRooms(puzzle, ['K', 'D'], new Set([c(1, 1), c(0, 4)])),
            }),
          },
        ],
      },
      {
        id: 'roomCompanion',
        board: 'house',
        subject: 'C',
        variants: [
          {
            clue: { type: 'roomCompanion', count: 2, attribute: 'beard', value: true },
            refs: { B: c(1, 1), E: c(0, 0) },
            marks: (puzzle) => ({
              blue: occupiableInRooms(puzzle, ['K'], new Set([c(1, 1), c(0, 0)])),
            }),
          },
        ],
      },
      {
        id: 'roomExists',
        board: 'house',
        subject: 'A',
        variants: [
          {
            labelKey: 'faq.v.person',
            clue: { type: 'roomExists', person: 'B', relation: 'on', object: 'chair' },
            refs: { B: c(4, 2) },
            // Bruno stands ON the chair — the subject must share HIS room. (violatedBy
            // is deliberately weak for roomExists, so the true set is written out.)
            marks: (puzzle) => ({
              blue: occupiableInRooms(
                puzzle,
                [puzzle.board.roomIdOf(c(4, 2))],
                new Set([c(4, 2)]),
              ),
              ring: new Set(puzzle.board.objectCells('chair')),
            }),
          },
          {
            labelKey: 'faq.v.trait',
            clue: { type: 'roomExists', attribute: 'beard', value: true, relation: 'near', object: 'table' },
            refs: { B: c(2, 3) },
            marks: (puzzle) => ({
              blue: occupiableInRooms(puzzle, ['D'], new Set([c(2, 3)])),
              ring: new Set(puzzle.board.objectCells('table')),
            }),
          },
        ],
      },
    ],
  },
  {
    id: 'special',
    entries: [
      {
        id: 'not',
        board: 'house',
        subject: 'B',
        variants: [
          {
            labelKey: 'faq.v.notNearTable',
            clue: { type: 'not', clue: { type: 'nearObject', object: 'table' } },
            red: (puzzle) => possibleCells(puzzle, 'B', createClue({ type: 'nearObject', object: 'table' })),
            decor: objectRing('table'),
          },
          {
            labelKey: 'faq.v.notInRoom',
            clue: { type: 'not', clue: { type: 'inRoom', room: 'K' } },
            red: (puzzle) => occupiableInRooms(puzzle, ['K']),
          },
        ],
      },
      {
        id: 'unique',
        board: 'house',
        subject: 'D',
        variants: [
          {
            labelKey: 'faq.v.onChair',
            clue: { type: 'uniqueOnObject', object: 'chair' },
            decor: objectRing('chair'),
          },
          {
            labelKey: 'faq.v.nearTable',
            clue: { type: 'uniqueNearObject', object: 'table' },
            decor: objectRing('table'),
          },
          {
            labelKey: 'faq.v.window',
            clue: { type: 'uniqueNearWindow' },
            decor: () => ({ windows: true }),
          },
          {
            labelKey: 'faq.v.door',
            clue: { type: 'uniqueNearDoor' },
            decor: () => ({ doors: true }),
          },
        ],
      },
      {
        id: 'andOr',
        board: 'house',
        subject: 'E',
        axes: true,
        variants: [
          {
            labelKey: 'faq.v.and',
            clue: { type: 'and', clues: [{ type: 'inRow', row: 0 }, { type: 'nearObject', object: 'table' }] },
            decor: objectRing('table'),
          },
          {
            labelKey: 'faq.v.or',
            clue: { type: 'or', clues: [{ type: 'inRow', row: 0 }, { type: 'nearObject', object: 'table' }] },
            decor: objectRing('table'),
          },
        ],
      },
    ],
  },
  {
    id: 'board',
    entries: [
      {
        id: 'emptyRooms',
        board: 'house',
        variants: [
          {
            labelKey: 'faq.v.oneEmpty',
            boardClue: { type: 'emptyRooms', count: 1 },
            victimAt: c(0, 4),
            refs: { A: c(1, 5), B: c(2, 1), C: c(3, 0), D: c(4, 2), E: c(5, 3) },
            marks: () => ({ rooms: new Set(['B']) }),
          },
          {
            labelKey: 'faq.v.noneEmpty',
            boardClue: { type: 'emptyRooms', count: 0 },
            victimAt: c(5, 4),
            refs: { A: c(0, 2), C: c(1, 3), B: c(2, 1), D: c(3, 0), E: c(4, 5) },
            marks: () => ({}),
          },
        ],
      },
      {
        id: 'countOnObject',
        board: 'house',
        variants: [
          {
            boardClue: { type: 'countOnObject', object: 'chair', count: 1 },
            refs: { E: c(4, 2), B: c(1, 1), A: c(0, 4) },
            marks: (puzzle) => ({ ring: new Set(puzzle.board.objectCells('chair')) }),
          },
        ],
      },
      {
        id: 'roomOccupancy',
        board: 'rooms',
        variants: [
          {
            labelKey: 'faq.v.atMost',
            boardClue: { type: 'roomOccupancy', op: 'atMost', count: 2, scope: 'people' },
            marks: () => ({ rooms: new Set(['1', '2', '3', '4']) }),
          },
          {
            labelKey: 'faq.v.atLeast',
            boardClue: { type: 'roomOccupancy', op: 'atLeast', count: 1, scope: 'people' },
            marks: () => ({ rooms: new Set(['1', '2', '3', '4']) }),
          },
          {
            labelKey: 'faq.v.notExactly',
            boardClue: { type: 'roomOccupancy', op: 'notExactly', count: 2, scope: 'suspects' },
            marks: () => ({ rooms: new Set(['1', '2', '3', '4']) }),
          },
        ],
      },
      {
        id: 'countWithAttr',
        board: 'garden',
        legend: 'outside',
        variants: [
          {
            boardClue: { type: 'countWithAttr', attribute: 'gender', value: 'f', area: 'outside', count: 2, scope: 'people' },
            refs: { K: c(3, 3), L: c(4, 4), M: c(1, 1), J: c(0, 2) },
            marks: () => ({ rooms: new Set(['G', 'Y', 'S']) }),
          },
        ],
      },
    ],
  },
]

/** Flat lookup: entry id → { category, entry }. */
export function findFaqEntry(id: string): { category: FaqCategory; entry: FaqEntry } | null {
  for (const category of FAQ_CATEGORIES) {
    const entry = category.entries.find((e) => e.id === id)
    if (entry) return { category, entry }
  }
  return null
}

// --- in-game lookup: clue instance → Handakte entry --------------------------

type ClueCtor = abstract new (...args: never[]) => unknown

/** Leaf clue class → the entry explaining it. UniqueOutside lands on the
 *  inside/outside entry (its "only one outside" chip lives there); the other
 *  unique forms share the "the only one …" entry. */
const LEAF_ENTRY: ReadonlyArray<readonly [ClueCtor, string]> = [
  [OnObjectClue, 'onObject'],
  [NearObjectClue, 'nearObject'],
  [NearAnyObjectClue, 'nearObject'],
  [NearWindowClue, 'nearPortal'],
  [NearDoorClue, 'nearPortal'],
  [OutsideClue, 'inout'],
  [InRoomClue, 'inRoom'],
  [InRoomAdjacentToClue, 'inRoomAdjacentTo'],
  [InRowClue, 'inLine'],
  [InColClue, 'inLine'],
  [CornerClue, 'corner'],
  [AtWallClue, 'atWall'],
  [UniqueOnObjectClue, 'unique'],
  [UniqueNearObjectClue, 'unique'],
  [UniqueNearWindowClue, 'unique'],
  [UniqueNearDoorClue, 'unique'],
  [UniqueOutsideClue, 'inout'],
  [AloneClue, 'alone'],
  [NotAloneClue, 'notAlone'],
  [NeighborRoomEmptyClue, 'neighborRoomEmpty'],
  [NeighborRoomCountClue, 'neighborRoomCount'],
  [AloneWithClue, 'aloneWith'],
  [RoomAttributeClue, 'roomAttribute'],
  [RoomCompanionClue, 'roomCompanion'],
  [RoomExistsClue, 'roomExists'],
  [DirectionClue, 'direction'],
  [DirectionFromAttrClue, 'directionFromAttr'],
  [InsideXorClue, 'insideXor'],
  [OffsetClue, 'offset'],
  [SameRoomClue, 'sameRoom'],
  [AdjacentRoomsClue, 'adjacentRooms'],
  [SameLineAsObjectClue, 'sameLineAsObject'],
  [SameRoomAsObjectClue, 'sameRoomAsObject'],
  [DirectionFromObjectClue, 'directionFromObject'],
  [BesideSameObjectClue, 'besideSameObject'],
]

/**
 * The Handakte entries a suspect's clues touch, in reading order and deduped —
 * the dossier note offers one "look it up" row per entry. NOT recurses into its
 * inner clue (every entry explains its negated form); AND/OR list their parts
 * plus the AND/OR entry itself (the intersection-vs-union lesson).
 */
export function faqLookupsForClues(clues: readonly Clue[]): string[] {
  const out: string[] = []
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id)
  }
  const walk = (clue: Clue): void => {
    if (clue instanceof NotClue) return walk(clue.inner)
    if (clue instanceof AndClue || clue instanceof OrClue) {
      add('andOr')
      for (const child of clue.clues) walk(child)
      return
    }
    for (const [ctor, id] of LEAF_ENTRY) {
      if (clue instanceof ctor) return add(id)
    }
  }
  for (const clue of clues) walk(clue)
  return out
}

/** The Handakte entry for a board-wide clue (null for unknown kinds). */
export function faqLookupForBoardClue(clue: BoardClue): string | null {
  if (clue instanceof CountOnObjectClue) return 'countOnObject'
  if (clue instanceof EmptyRoomsClue) return 'emptyRooms'
  if (clue instanceof RoomOccupancyClue) return 'roomOccupancy'
  if (clue instanceof CountWithAttrClue) return 'countWithAttr'
  return null
}
