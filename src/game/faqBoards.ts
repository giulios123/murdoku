import type { LevelJson } from '../engine/index.ts'

/**
 * The three hand-built demo boards of the Handakte (FAQ) screen. They are NOT real
 * levels: they live here instead of `levels/` on purpose — `check-all.ts` would demand
 * a unique solution, which a demo board neither has nor needs (it is never solved,
 * only drawn with the marks of the entry being explained).
 *
 * All three are 6×6 with 5 suspects + victim so they LOOK exactly like a real case.
 * Suspects carry deliberate trait mixes (beard/glasses/bald) for the attribute entries.
 */
export type FaqBoardId = 'house' | 'rooms' | 'garden'

/** A small flat: four rooms, two table INSTANCES (kitchen vs dining), chairs, bed,
 *  carpet, window + door. Serves the object / position / social / unique entries.
 *  Geometry that the entries rely on:
 *  - kitchen table (1,2) touches the dining wall → its east neighbour (1,3) is the
 *    flagship "beside, but wrong room" red cell;
 *  - dining table (2,4)-(2,5) is a SECOND table instance whose south neighbours
 *    (3,4) lie in the bedroom (more red);
 *  - all four board corners are free (corner entry shows room corners too). */
const HOUSE: LevelJson = {
  schema: 1,
  id: 'faq-house',
  difficulty: 'tutorial',
  size: { width: 6, height: 6 },
  rooms: {
    K: { nameKey: 'room.kitchen', color: '#e6cda0' },
    D: { nameKey: 'room.dining', color: '#e6c0d2' },
    L: { nameKey: 'room.living', color: '#b9d0e6' },
    B: { nameKey: 'room.bedroom', color: '#cfe0cf' },
  },
  objects: {
    t: { type: 'table', occupiable: false },
    s: { type: 'chair', occupiable: true },
    b: { type: 'bed', occupiable: true },
    p: { type: 'plant', occupiable: false },
    F: { type: 'fridge', occupiable: false },
    L: { type: 'lamp', occupiable: false },
    r: { type: 'carpet', occupiable: true },
  },
  roomMap: ['KKKDDD', 'KKKDDD', 'KKKDDD', 'LLLLBB', 'LLLLBB', 'LLLLBB'],
  groundMap: ['......', '......', '......', '.rr...', '.rr...', '......'],
  topMap: ['......', '..t.ss', 'F...tt', '.....L', '..s.bb', '.p....'],
  windows: [
    { r: 1, c: 0, side: 'W' },
    { r: 5, c: 2, side: 'S' },
  ],
  doors: [{ r: 4, c: 3, side: 'E' }],
  suspects: [
    { id: 'A', name: 'Alma', attributes: { gender: 'f', glasses: true } },
    { id: 'B', name: 'Bruno', attributes: { gender: 'm', beard: true } },
    { id: 'C', name: 'Clara', attributes: { gender: 'f' } },
    { id: 'D', name: 'David', attributes: { gender: 'm', bald: true } },
    { id: 'E', name: 'Erik', attributes: { gender: 'm', beard: true } },
  ],
  victim: { name: 'Viktor', attributes: { gender: 'm' } },
}

/** Dirk's own room layout (the "completely south" misunderstanding that started the
 *  Handakte), widened to 6×6: room 1 the tall west block, 2 top right, 3 mid right,
 *  4 the full south strip. Emil stands at (1,0): rooms 3 AND 4 lie completely south
 *  of him — room 3 also lies east, and that is exactly the point of the lesson.
 *  Generic room names ("Raum 1"…"Raum 4") keep the eye on the geometry. */
const ROOMS: LevelJson = {
  schema: 1,
  id: 'faq-rooms',
  difficulty: 'tutorial',
  size: { width: 6, height: 6 },
  rooms: {
    '1': { nameKey: 'room.editor1', color: '#e8d8b0' },
    '2': { nameKey: 'room.editor2', color: '#b9d0e6' },
    '3': { nameKey: 'room.editor3', color: '#e6c0d2' },
    '4': { nameKey: 'room.editor4', color: '#cfe0cf' },
  },
  objects: {
    g: { type: 'shelf', occupiable: false },
    a: { type: 'tree', occupiable: false },
  },
  roomMap: ['112222', '112222', '113333', '113333', '444444', '444444'],
  topMap: ['.....g', '......', '......', '......', '......', '.....a'],
  suspects: [
    { id: 'E', name: 'Emil', attributes: { gender: 'm' } },
    { id: 'F', name: 'Frida', attributes: { gender: 'f' } },
    { id: 'G', name: 'Gustav', attributes: { gender: 'm', beard: true } },
    { id: 'H', name: 'Helene', attributes: { gender: 'f' } },
    { id: 'I', name: 'Ivo', attributes: { gender: 'm' } },
  ],
  victim: { name: 'Vera', attributes: { gender: 'f' } },
}

/** House + garden + yard + lake: the indoor/outdoor and water lessons. The graphics
 *  never betray the `outside` flag — that is the lesson — so the screen shows the
 *  same "Draußen: …" legend line the game shows. */
const GARDEN: LevelJson = {
  schema: 1,
  id: 'faq-garden',
  difficulty: 'tutorial',
  size: { width: 6, height: 6 },
  rooms: {
    H: { nameKey: 'room.farmhouse', color: '#e6cda0' },
    G: { nameKey: 'room.garden', color: '#cfe0cf', outside: true },
    Y: { nameKey: 'room.yard', color: '#e8d8b0', outside: true },
    S: { nameKey: 'room.lake', color: '#b9d0e6', outside: true },
  },
  objects: {
    a: { type: 'tree', occupiable: false },
    U: { type: 'parasol', occupiable: true },
    o: { type: 'boulder', occupiable: false },
  },
  roomMap: ['HHHGGG', 'HHHGGG', 'HHHGGG', 'YYYGGG', 'YYYSSS', 'YYYSSS'],
  topMap: ['.....a', '......', '......', '....U.', 'o.....', '......'],
  windows: [{ r: 0, c: 0, side: 'W' }],
  doors: [{ r: 1, c: 2, side: 'E' }],
  suspects: [
    { id: 'J', name: 'Jonas', attributes: { gender: 'm' } },
    { id: 'K', name: 'Klara', attributes: { gender: 'f' } },
    { id: 'L', name: 'Lena', attributes: { gender: 'f' } },
    { id: 'M', name: 'Marek', attributes: { gender: 'm', beard: true } },
    { id: 'N', name: 'Nora', attributes: { gender: 'f', glasses: true } },
  ],
  victim: { name: 'Rosa', attributes: { gender: 'f' } },
}

export const FAQ_BOARDS: Record<FaqBoardId, LevelJson> = {
  house: HOUSE,
  rooms: ROOMS,
  garden: GARDEN,
}
