/**
 * Buch-Pipeline für den Amazon-KDP-Druck (Band 1): rendert Buchseiten als
 * 300-dpi-Canvases headless (@napi-rs/canvas) und baut daraus das Innenteil-PDF.
 *
 * Trim-Größe 6,69"×9,61" (16,99×24,41 cm — die KDP-Größe am nächsten an Murdle
 * 17×24), KEIN Beschnitt (weiße Ränder), Bundsteg innen 0,5" (Buch >150 Seiten).
 * Jeder Fall ist eine DOPPELSEITE (Dirks Vorgabe, 13.08.2026): links Fall-Kopf +
 * Verdächtige + Akten-Notizen, rechts Brett · Objekt-Legende · SW-Skizze
 * (Lösefläche) · Mörder-Feld. Die Zeichner kommen aus src/game/pdfExport.ts
 * (geteilt, nie kopiert — Dirk-OK) — das Buch sieht aus wie der Spiel-Druckbogen.
 *
 * Headless-Kniffe (siehe scripts/object-sheet.ts): .png-Importe werden gestubbt,
 * `document.createElement('canvas')` bekommt einen napi-rs-Polyfill (boardRender
 * cached seine Layer über DOM-Canvases), und auf `onArtReady` darf man NICHT
 * warten (ohne DOM-Image feuert es nie — die Zeichen-Fallbacks greifen).
 * Native Addons (@napi-rs/canvas, sharp) MÜSSEN statisch importiert werden:
 * für .node-Dateien liefert die Hook-Kette keine Source (Crash).
 *
 * Usage: npx tsx scripts/make-book.ts probe   → book/probe/*.png
 */
import { registerHooks } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts, loadImage, Image as SkImage, Path2D as SkPath2D } from '@napi-rs/canvas'
import sharp from 'sharp'
import { jsPDF } from 'jspdf'

registerHooks({
  load(url, context, nextLoad) {
    // Bild-Importe (armchair.png): der Stub exportiert den ECHTEN Dateipfad — das
    // Image-Polyfill unten lädt ihn synchron, damit der Stuhl auch headless die
    // richtige Zeichnung bekommt (vorher: grauer Fallback-Klotz im Druck).
    if (url.endsWith('.png')) {
      return { format: 'module', source: `export default ${JSON.stringify(fileURLToPath(url))}`, shortCircuit: true }
    }
    // pdfExport importiert @capacitor/core (CJS — die Hook-Kette liefert dafür keine
    // Source). Headless wird nur `Capacitor.isNativePlatform()` nie aufgerufen — Stub.
    if (url.includes('@capacitor')) {
      return {
        format: 'module',
        source: 'export const Capacitor = { isNativePlatform: () => false, getPlatform: () => "web" }',
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})

type SkCanvas = ReturnType<typeof createCanvas>

// boardRender cached Boden-/Möbel-Layer über document.createElement('canvas') —
// headless genügt dieser minimale Polyfill (napi-rs-Canvas ist API-kompatibel).
;(globalThis as { document?: unknown }).document = {
  createElement(tag: string): SkCanvas {
    if (tag !== 'canvas') throw new Error(`document.createElement('${tag}') nicht unterstützt`)
    return createCanvas(1, 1)
  },
}

/** DOM-Image-Polyfill für objectArt: lädt Pfade SYNCHRON als Buffer und liefert
 *  die Browser-Felder (`complete`/`naturalWidth`), die die Art-Guards prüfen. */
class HeadlessImage extends SkImage {
  declare onload: (() => void) | null
  get complete(): boolean {
    return this.width > 0
  }
  get naturalWidth(): number {
    return this.width
  }
  // Die Basisklasse nimmt Buffer — Pfad-Strings (aus dem .png-Stub) lesen wir selbst.
  override set src(v: string | Buffer) {
    super.src = typeof v === 'string' ? readFileSync(v) : v
    this.onload?.()
  }
  override get src(): Buffer {
    return super.src as Buffer
  }
}
;(globalThis as { Image?: unknown }).Image = HeadlessImage
// Path2D nutzt z. B. drawSlide (Rutsche) — napi-rs bringt eine eigene Klasse mit.
;(globalThis as { Path2D?: unknown }).Path2D = SkPath2D

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fontFile = (pkg: string, file: string): string => resolve(root, 'node_modules', pkg, 'files', file)
// Exakt die Familiennamen, die boardRender/pdfExport im ctx.font verlangen.
GlobalFonts.registerFromPath(fontFile('@fontsource-variable/fraunces', 'fraunces-latin-wght-normal.woff2'), 'Fraunces Variable')
GlobalFonts.registerFromPath(fontFile('@fontsource-variable/fraunces', 'fraunces-latin-wght-italic.woff2'), 'Fraunces Variable')
GlobalFonts.registerFromPath(fontFile('@fontsource-variable/spline-sans', 'spline-sans-latin-wght-normal.woff2'), 'Spline Sans Variable')
GlobalFonts.registerFromPath(fontFile('@fontsource/special-elite', 'special-elite-latin-400-normal.woff2'), 'Special Elite')

const { loadLevel, DeductionEngine, findMurderer, VICTIM_ID } = await import('../src/engine/index.ts')
const { drawBoard } = await import('../src/game/boardRender.ts')
const { Renderer } = await import('../src/i18n/Renderer.ts')
const { avatarSvg } = await import('../src/game/avatar.ts')
const { suspectColor } = await import('../src/game/palette.ts')
// Die geteilten Druck-Zeichner + Palette des Spiel-Druckbogens.
const art = await import('../src/game/pdfExport.ts')
import type { LevelJson, Puzzle } from '../src/engine/index.ts'
import type { PersonCard, TraitKey } from '../src/game/pdfExport.ts'

// ---------------------------------------------------------------- Buch-Maße

/** 300 dpi; Trim 6,69"×9,61" (KDP), keine Beschnittzugabe. */
const PAGE_W = Math.round(6.69 * 300) // 2007
const PAGE_H = Math.round(9.61 * 300) // 2883
/** Bundsteg (innen) 0,5" — Pflicht bei 151–300 Seiten; außen/oben/unten großzügig. */
const GUTTER = Math.round(0.5 * 300)
const OUTER = Math.round(0.45 * 300)
const TOP = Math.round(0.5 * 300)
const BOTTOM = Math.round(0.55 * 300)

type Ctx = CanvasRenderingContext2D

interface Page {
  canvas: SkCanvas
  ctx: Ctx
  side: 'left' | 'right'
  /** Nutzfläche — hängt davon ab, ob der Bund links (rechte Seite) oder rechts liegt. */
  x0: number
  x1: number
}

/** Neue Buchseite. `side`: 'left' = Verso (Bund rechts), 'right' = Recto (Bund links). */
function newPage(side: 'left' | 'right'): Page {
  const canvas = createCanvas(PAGE_W, PAGE_H)
  const ctx = canvas.getContext('2d') as unknown as Ctx
  ctx.fillStyle = art.PAPER
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  const x0 = side === 'right' ? GUTTER : OUTER
  const x1 = side === 'right' ? PAGE_W - OUTER : PAGE_W - GUTTER
  return { canvas, ctx, side, x0, x1 }
}

/** Seitenzahl in der äußeren unteren Ecke (Buchkonvention, wie im Referenzfoto).
 *  Mindestens 0,4" von der Schnittkante — näher dran riskiert die KDP-Randprüfung
 *  und bei Schneide-Toleranz (±0,125") ein angeschnittenes Blatt. */
function paintPageNo(page: Page, no: number): void {
  const { ctx } = page
  ctx.fillStyle = art.DIM
  ctx.font = `30px ${art.TYPE}`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = page.side === 'left' ? 'left' : 'right'
  ctx.fillText(String(no), page.side === 'left' ? page.x0 : page.x1, PAGE_H - Math.round(0.4 * 300))
  ctx.textAlign = 'left'
}

// ---------------------------------------------------------------- i18n (de)

const de = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/de.json'), 'utf8')) as Record<string, unknown>
/** Mini-t(): verschachtelter Key-Pfad im Locale-JSON + {{param}}-Ersetzung.
 *  (Reicht für die statischen Labels; Hinweistexte laufen über den echten Renderer.) */
function t(key: string, params?: Record<string, string | number>): string {
  let node: unknown = de
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node !== 'string') return key
  return node.replace(/\{\{(\w+)\}\}/g, (m, p: string) => (params && p in params ? String(params[p]) : m))
}

// ------------------------------------------------------- Bilder (SVG → PNG)

/** SVG-String → napi-rs-Image in Zielauflösung (der sharp-Umweg rastert sauber). */
async function svgImage(svg: string, size: number): Promise<HTMLImageElement> {
  const png = await sharp(Buffer.from(svg), { density: (72 * size) / 100 }).resize(size, size).png().toBuffer()
  return (await loadImage(png)) as unknown as HTMLImageElement
}

/** Merkmal-Icons (Bart/Brille/Glatze) einmal für alle Seiten. */
const traitImgs = new Map<TraitKey, HTMLImageElement>()
for (const k of ['beard', 'glasses', 'bald'] as const) {
  traitImgs.set(k, await svgImage(art.TRAIT_SVGS[k], 96))
}

/** ☠ als Tinten-Zeichnung: Skias Font-Fallback liefert für U+2620 nur Tofu —
 *  also zeichnen wir den Schädel selbst (Krimson-Münze, weißer Schädel). */
const SKULL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<circle cx="50" cy="50" r="48" fill="#b23a31"/>' +
  '<path d="M50 20 C32 20 23 33 23 46 C23 55 28 62 35 65 L35 71 C35 75 38 78 42 78 L58 78 C62 78 65 75 65 71 L65 65 C72 62 77 55 77 46 C77 33 68 20 50 20 Z" fill="#fff"/>' +
  '<ellipse cx="39.5" cy="46" rx="6.5" ry="8" fill="#b23a31"/>' +
  '<ellipse cx="60.5" cy="46" rx="6.5" ry="8" fill="#b23a31"/>' +
  '<path d="M50 53 L45 61 L55 61 Z" fill="#b23a31"/>' +
  '<path d="M44 78 L44 71 M50 78 L50 70 M56 78 L56 71" stroke="#b23a31" stroke-width="3" stroke-linecap="round"/>' +
  '</svg>'

/** Personen-Karten wie im Spiel-Druckbogen: Verdächtige in Spielreihenfolge,
 *  das Opfer als letzte Karte (☠ — es wird mitgerätselt, nie auf dem Brett). */
async function personCards(puzzle: Puzzle, renderer: InstanceType<typeof Renderer>): Promise<PersonCard[]> {
  const cards: PersonCard[] = await Promise.all(
    puzzle.suspects.map(async (s, i) => ({
      name: s.name,
      text: art.clueLine(renderer, s.clues, s.id),
      accent: suspectColor(i),
      img: await svgImage(avatarSvg(s.attributes, suspectColor(i), s.id), 260),
      gender: s.attributes.gender === 'm' ? ('m' as const) : s.attributes.gender === 'f' ? ('f' as const) : undefined,
      traits: (['beard', 'glasses', 'bald'] as const).filter((k) => s.attributes[k] === true),
    })),
  )
  cards.push({
    name: puzzle.victim.name,
    text: `${t('game.victim')} — ${t('game.victimStatement')}`,
    accent: art.CRIMSON,
    img: await svgImage(SKULL_SVG, 260),
    gender: puzzle.victim.attributes.gender === 'f' ? 'f' : 'm',
  })
  return cards
}

/** Spiel-Avatare fürs gelöste Brett (Lösungsseiten). */
async function avatarImages(puzzle: Puzzle): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>()
  await Promise.all(
    puzzle.suspects.map(async (s, i) => {
      map.set(s.id, await svgImage(avatarSvg(s.attributes, suspectColor(i), s.id), 200))
    }),
  )
  return map
}

// ------------------------------------------------------------ Fall-Kopf links

/** Kopf der linken Fallseite: „FALL N"-Zeile, eingepasster Titel, Meta-Zeile,
 *  gestrichelte Trennlinie. Liefert die Oberkante des Karten-Bereichs. */
function paintCaseHead(page: Page, caseNo: number, title: string, metaLine: string): number {
  const { ctx } = page
  const cx = (page.x0 + page.x1) / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  let y = TOP + 10
  ctx.fillStyle = art.CRIMSON
  ctx.font = `34px ${art.TYPE}`
  ctx.fillText(`— ${t('book.case', { no: caseNo }).toUpperCase()} —`, cx, y)
  y += 86
  const innerW = page.x1 - page.x0
  let titleSize = 76
  ctx.font = `700 ${titleSize}px ${art.DISPLAY}`
  while (titleSize > 40 && ctx.measureText(title).width > innerW * 0.94) {
    titleSize -= 4
    ctx.font = `700 ${titleSize}px ${art.DISPLAY}`
  }
  ctx.fillStyle = art.INK
  ctx.fillText(title, cx, y)
  y += 56
  ctx.fillStyle = art.DIM
  ctx.font = `32px ${art.TYPE}`
  ctx.fillText(metaLine, cx, y)
  y += 40
  ctx.strokeStyle = art.LINE
  ctx.lineWidth = 2
  ctx.setLineDash([10, 12])
  ctx.beginPath()
  ctx.moveTo(page.x0, y)
  ctx.lineTo(page.x1, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.textAlign = 'left'
  return y + 36
}

/** Dünne Kopfzeile der rechten Brettseite (Orientierung beim Blättern). */
function paintMiniHead(page: Page, text: string): number {
  const { ctx } = page
  let y = TOP + 4
  ctx.fillStyle = art.DIM
  ctx.font = `28px ${art.TYPE}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, (page.x0 + page.x1) / 2, y)
  y += 26
  ctx.strokeStyle = art.LINE
  ctx.lineWidth = 2
  ctx.setLineDash([10, 12])
  ctx.beginPath()
  ctx.moveTo(page.x0, y)
  ctx.lineTo(page.x1, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.textAlign = 'left'
  return y + 40
}

// --------------------------------------------------- Verdächtigen-Seite links

/** Verdächtigen-Karten + Akten-Notizen in die Fläche einpassen (Schrift-Stufen-Fit
 *  wie der A4-Bogen: erst 2 Spalten ab 7 Karten, Schrift 42→18). */
function paintSuspectPane(
  ctx: Ctx,
  cards: PersonCard[],
  notes: string[],
  area: { x: number; w: number; top: number; bottom: number },
): void {
  const colGap = 22
  const cols = cards.length > 6 ? 2 : 1
  const colW = Math.floor((area.w - (cols - 1) * colGap) / cols)
  const contentH = area.bottom - area.top

  interface NoteBox {
    lines: string[]
    h: number
  }
  // Größer als der A4-Start (42): die Buchseite gehört den Karten allein — sie
  // dürfen die Seite füllen. Bei vollen Besetzungen schrumpft der Fit wie gehabt.
  let fontSize = 52
  let layout: { cardH: number[]; lineH: number; avatar: number; pad: number; noteBoxes: NoteBox[] } | null = null
  for (; fontSize >= 18; fontSize -= 2) {
    const pad = Math.round(fontSize * 0.6)
    const avatar = Math.round(fontSize * 3.4)
    const lineH = Math.round(fontSize * 1.42)
    const textW = colW - pad * 2 - avatar - 16
    const cardH = cards.map((card) => {
      ctx.font = `${fontSize}px ${art.TYPE}`
      const lines = art.wrapText(ctx, card.text, textW)
      const textH = Math.round(fontSize * 1.35) + 8 + lines.length * lineH
      return Math.max(avatar + pad * 2, textH + pad * 2)
    })
    const rows = Math.ceil(cards.length / cols)
    let maxCol = 0
    for (let c0 = 0; c0 < cols; c0++) {
      const colH = cardH.slice(c0 * rows, (c0 + 1) * rows).reduce((sum, h) => sum + h + 16, 0)
      maxCol = Math.max(maxCol, colH)
    }
    ctx.font = `${fontSize}px ${art.TYPE}`
    const notePad = Math.round(fontSize * 0.5)
    const lens = Math.round(fontSize * 1.35)
    const noteBoxes: NoteBox[] = notes.map((n) => {
      const lines = art.wrapText(ctx, n, area.w - notePad * 2 - lens - 14)
      return { lines, h: Math.max(lines.length * lineH, lens) + notePad * 2 }
    })
    const noteH = notes.length > 0 ? noteBoxes.reduce((sum, b) => sum + b.h + 12, 0) + 8 : 0
    if (maxCol + noteH <= contentH || fontSize === 18) {
      layout = { cardH, lineH, avatar, pad, noteBoxes }
      break
    }
  }
  const { cardH, lineH, avatar, pad, noteBoxes } = layout!
  const rows = Math.ceil(cards.length / cols)

  let noteY = area.top
  cards.forEach((card, i) => {
    const col = Math.floor(i / rows)
    const x = area.x + col * (colW + colGap)
    let cy = area.top
    for (let k = col * rows; k < i; k++) cy += cardH[k] + 16
    art.drawPersonCard(ctx, card, x, cy, colW, cardH[i], { fontSize, pad, avatar, lineH, traitImgs })
    noteY = Math.max(noteY, cy + cardH[i])
  })

  let ny = noteY + 20
  noteBoxes.forEach((box) => {
    art.drawNoteBox(ctx, box, area.x, ny, area.w, { fontSize, lineH })
    ny += box.h + 12
  })
}

// --------------------------------------------------------- Brett-Seite rechts

/** Rechte Fallseite: Brett · Objekt-Legende · SW-Skizze (Lösefläche) · Mörder-Feld,
 *  gemeinsam in die Seitenhöhe eingepasst (dieselbe Logik wie der A4-Bogen). */
function paintBoardPage(page: Page, puzzle: Puzzle, contentTop: number): void {
  const { ctx } = page
  const innerW = page.x1 - page.x0
  const contentBottom = PAGE_H - BOTTOM
  const contentH = contentBottom - contentTop
  const W = puzzle.board.width
  const H = puzzle.board.height

  const items = art.legendItems(puzzle, t)
  const legendH = art.paintLegend(ctx, items, t, page.x0, 0, innerW, false)
  const LEGEND_GAP = 54
  const SKETCH_GAP = 48
  const FIELD_W = 430
  const FIELD_H = 150
  const FIELD_GAP = 24
  // Brett- und Skizzenzellen gemeinsam einpassen (Skizze = Lösefläche, nie zu klein).
  let cell = Math.floor(innerW / Math.max(W, H))
  let sketchCell = 50
  let fieldBeside = true
  for (; cell >= 40; cell--) {
    sketchCell = Math.max(50, Math.round(cell * 0.62))
    if (sketchCell * W > innerW) continue
    fieldBeside = innerW - sketchCell * W >= FIELD_W + FIELD_GAP
    const total =
      cell * H + LEGEND_GAP + legendH + SKETCH_GAP + sketchCell * H + (fieldBeside ? 0 : FIELD_GAP + FIELD_H)
    if (total <= contentH) break
  }
  const bw = cell * W
  const bh = cell * H
  const boardX = page.x0 + Math.round((innerW - bw) / 2)
  const boardY = contentTop
  drawBoard(ctx, {
    puzzle,
    cell,
    origin: { x: boardX, y: boardY },
    roomName: (key) => t(key),
    suspectIndex: new Map(),
    placements: new Map(), // leer: IMMER das ungelöste Brett — das Opfer wird mitgerätselt
    marks: new Map(),
    crosses: new Set(),
    highlight: null,
    reveal: null,
  })
  art.paintLegend(ctx, items, t, page.x0, boardY + bh + LEGEND_GAP, innerW, true)

  const sketchY = boardY + bh + LEGEND_GAP + legendH + SKETCH_GAP
  const sketchW = sketchCell * W
  if (fieldBeside) {
    const groupW = sketchW + FIELD_GAP + FIELD_W
    const sketchX = page.x0 + Math.max(0, Math.round((innerW - groupW) / 2))
    art.drawSketch(ctx, puzzle, sketchX, sketchY, sketchCell)
    art.drawMurderField(ctx, t, sketchX + sketchW + FIELD_GAP, sketchY + sketchCell * H - FIELD_H, FIELD_W, FIELD_H)
  } else {
    const sketchX = page.x0 + Math.max(0, Math.round((innerW - sketchW) / 2))
    const fw = Math.min(FIELD_W, innerW)
    art.drawSketch(ctx, puzzle, sketchX, sketchY, sketchCell)
    art.drawMurderField(ctx, t, page.x0 + Math.round((innerW - fw) / 2), sketchY + sketchCell * H + FIELD_GAP, fw, FIELD_H)
  }
}

// ------------------------------------------------------------- Fall-Doppelseite

function readLevelFile(file: string): LevelJson {
  return JSON.parse(readFileSync(resolve(root, 'levels', file), 'utf8')) as LevelJson
}

/** Baut die Doppelseite eines Falls: [links, rechts]. `pageNo` = Nummer der LINKEN Seite. */
async function caseSpread(file: string, caseNo: number, pageNo: number): Promise<[Page, Page]> {
  const json = readLevelFile(file)
  const puzzle = loadLevel(json)
  const renderer = new Renderer(de, puzzle)
  const title = json.titles?.de ?? json.title ?? file
  const diff = t(`difficulty.${json.difficulty ?? 'medium'}`)
  const author = (json.author ?? '').trim()
  const metaLine = `${puzzle.board.width}×${puzzle.board.height} · ${diff}${author ? ` · ${t('game.author', { name: author })}` : ''}`

  // Linke Seite: Kopf + Verdächtige + Akten-Notizen.
  const left = newPage('left')
  const cardsTop = paintCaseHead(left, caseNo, title, metaLine)
  const cards = await personCards(puzzle, renderer)
  const notes = art.boardNotes(puzzle, renderer, t)
  paintSuspectPane(left.ctx, cards, notes, {
    x: left.x0,
    w: left.x1 - left.x0,
    top: cardsTop,
    bottom: PAGE_H - BOTTOM,
  })
  paintPageNo(left, pageNo)

  // Rechte Seite: Mini-Kopf + Brett-Spalte.
  const right = newPage('right')
  const contentTop = paintMiniHead(right, `${t('book.case', { no: caseNo }).toUpperCase()} · ${title.toUpperCase()}`)
  paintBoardPage(right, puzzle, contentTop)
  paintPageNo(right, pageNo + 1)

  return [left, right]
}

// ------------------------------------------------------------- Lösungsseiten

/** Eine halbe Lösungsseite: Kopfzeile, nummeriertes Deduktions-Protokoll links,
 *  gelöstes Brett (Avatare, Kreuze, Mörder-Ring) rechts — wie das Referenzbuch. */
async function paintSolutionHalf(
  page: Page,
  file: string,
  caseNo: number,
  area: { top: number; bottom: number },
): Promise<void> {
  const { ctx } = page
  const json = readLevelFile(file)
  const puzzle = loadLevel(json)
  const renderer = new Renderer(de, puzzle)
  const result = new DeductionEngine(puzzle).solve()
  if (!result.solved || !result.solution) {
    throw new Error(`${file}: kein reiner Vorwärts-Lösungsweg — für das Buch ungeeignet`)
  }
  const solution = result.solution
  const title = json.titles?.de ?? json.title ?? file
  const innerW = page.x1 - page.x0

  // Kopfzeile: Fall-Nummer + Titel, der Mörder-Name folgt im Verdikt-Kasten.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = art.INK
  ctx.font = `700 40px ${art.DISPLAY}`
  ctx.fillText(`${t('book.case', { no: caseNo })} · ${title}`, page.x0, area.top + 40)
  const contentTop = area.top + 76

  // Gelöstes Brett rechts: Kreuz auf jedem begehbaren Feld ohne Person.
  const W = puzzle.board.width
  const H = puzzle.board.height
  const boardMax = Math.min(Math.round(innerW * 0.4), area.bottom - contentTop)
  const cell = Math.floor(boardMax / Math.max(W, H))
  const bw = cell * W
  const bh = cell * H
  const boardX = page.x1 - bw
  const boardY = contentTop + Math.max(0, Math.round((area.bottom - contentTop - bh) / 2))
  const suspectIndex = new Map(puzzle.suspects.map((s, i) => [s.id, i] as const))
  const avatars = await avatarImages(puzzle)
  const placements = new Map(solution.entries())
  const occupied = new Set(placements.values())
  const crosses = new Set<number>()
  for (let c = 0; c < W * H; c++) {
    if (puzzle.board.isOccupiable(c) && !occupied.has(c)) crosses.add(c)
  }
  const m = findMurderer(puzzle, solution)
  drawBoard(ctx, {
    puzzle,
    cell,
    origin: { x: boardX, y: boardY },
    roomName: (key) => t(key),
    suspectIndex,
    placements,
    marks: new Map(),
    crosses,
    highlight: null,
    reveal: { victimCell: solution.cellOf(VICTIM_ID), murdererId: m.suspectId },
    avatars,
    objectBadges: true,
  })

  // Protokoll links: Schrift-/Spalten-Fit wie das A4-Auflösungsblatt.
  // Der ☠-Chip des Opfers entfällt im Buch: headless liefert kein Font-Fallback
  // für U+2620 (Tofu-Kasten im Druck) — und der Schritt-Text nennt das Opfer ohnehin.
  const { steps: rawSteps, verdictText } = art.buildStepLines(result.steps, renderer)
  const steps = rawSteps.map((s) => (s.person === VICTIM_ID ? { ...s, person: undefined } : s))
  const verdict = { text: verdictText, person: m.suspectId ?? undefined }
  const stepArea = { x: page.x0, w: innerW - bw - 44, top: contentTop, bottom: area.bottom }
  let chosen: { font: number; cols: number } | null = null
  for (let font = 26; font >= 16 && !chosen; font -= 2) {
    for (const cols of [2, 3]) {
      if (art.paintSteps(ctx, steps, verdict, suspectIndex, { ...stepArea, font, cols }, false)) {
        chosen = { font, cols }
        break
      }
    }
  }
  chosen ??= { font: 15, cols: 3 }
  art.paintSteps(ctx, steps, verdict, suspectIndex, { ...stepArea, ...chosen }, true)
}

/** Lösungsseite mit ZWEI Fällen übereinander (→ 4 pro Doppelseite, Dirks Vorgabe). */
async function solutionPage(
  cases: { file: string; caseNo: number }[],
  side: 'left' | 'right',
  pageNo: number,
): Promise<Page> {
  const page = newPage(side)
  const contentTop = paintMiniHead(page, t('game.pdfSolutionPath').toUpperCase())
  const contentBottom = PAGE_H - BOTTOM
  const halfH = Math.floor((contentBottom - contentTop) / 2)
  await paintSolutionHalf(page, cases[0].file, cases[0].caseNo, { top: contentTop, bottom: contentTop + halfH - 40 })
  if (cases[1]) {
    const midY = contentTop + halfH
    page.ctx.strokeStyle = art.LINE
    page.ctx.lineWidth = 2
    page.ctx.setLineDash([10, 12])
    page.ctx.beginPath()
    page.ctx.moveTo(page.x0, midY - 20)
    page.ctx.lineTo(page.x1, midY - 20)
    page.ctx.stroke()
    page.ctx.setLineDash([])
    await paintSolutionHalf(page, cases[1].file, cases[1].caseNo, { top: midY, bottom: contentBottom })
  }
  paintPageNo(page, pageNo)
  return page
}

// ------------------------------------------------------------ Tutorial Spread 1

/** Panel-Kasten des Tutorials: abgerundete Karte, zentrierte Fraunces-Überschrift,
 *  TYPE-Fließtext. Liefert die verbrauchte Höhe. */
function tutorialPanel(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  head: string,
  body: string[],
  o: { fontSize: number; draw: boolean },
): number {
  const pad = 34
  const lineH = Math.round(o.fontSize * 1.45)
  ctx.font = `${o.fontSize}px ${art.TYPE}`
  const lines = body.flatMap((p) => art.wrapText(ctx, p, w - pad * 2))
  const headH = head ? 64 : 0
  const h = pad + headH + lines.length * lineH + pad
  if (!o.draw) return h
  ctx.fillStyle = art.CARD_BG
  ctx.strokeStyle = art.LINE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 14)
  ctx.fill()
  ctx.stroke()
  ctx.textBaseline = 'alphabetic'
  let ty = y + pad
  if (head) {
    ctx.fillStyle = art.INK
    ctx.font = `700 44px ${art.DISPLAY}`
    ctx.textAlign = 'center'
    ctx.fillText(head, x + w / 2, ty + 36)
    ty += headH
  }
  ctx.fillStyle = art.TEXT
  ctx.font = `${o.fontSize}px ${art.TYPE}`
  ctx.textAlign = 'left'
  lines.forEach((line, i) => ctx.fillText(line, x + pad, ty + o.fontSize + i * lineH))
  return h
}

/** Krimson-Etikett mit Pfeil zu einem Punkt (die Annotationen des Referenz-Tutorials). */
function annotate(ctx: Ctx, label: string, tx: number, ty: number, px: number, py: number): void {
  ctx.save()
  ctx.strokeStyle = art.CRIMSON
  ctx.fillStyle = art.CRIMSON
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  const mx = (tx + px) / 2
  ctx.quadraticCurveTo(mx, (ty + py) / 2 - 26, px, py)
  ctx.stroke()
  const ang = Math.atan2(py - ((ty + py) / 2 - 26), px - mx)
  ctx.beginPath()
  ctx.moveTo(px, py)
  ctx.lineTo(px - 18 * Math.cos(ang - 0.42), py - 18 * Math.sin(ang - 0.42))
  ctx.lineTo(px - 18 * Math.cos(ang + 0.42), py - 18 * Math.sin(ang + 0.42))
  ctx.closePath()
  ctx.fill()
  ctx.font = `700 30px ${art.TYPE}`
  ctx.textBaseline = 'middle'
  ctx.fillText(label, tx + 12, ty)
  ctx.restore()
}

/** Tutorial-Doppelseite 1: links „Willkommen, Detektiv!" (Ziel + Tatort-Regeln),
 *  rechts „Schritt für Schritt" — die echten Tutorial-Karten, das annotierte
 *  4×4-Brett und die »neben«-HINWEIS-Box (Spiel-Tooltip, nichts Erfundenes). */
async function tutorialSpread1(pageNo: number): Promise<[Page, Page]> {
  const json = readLevelFile('demo-4x4.json')
  const puzzle = loadLevel(json)
  const renderer = new Renderer(de, puzzle)

  // ---- Linke Seite: Willkommen / Ziel / Regeln als ERMITTLUNGSWAND ----
  // (Dirks Feedback: reine Textseite war zu trocken.) Die drei Panels hängen
  // leicht gedreht mit Klebestreifen an der Wand, der rote Faden mit Messing-
  // Pins verbindet sie, daneben die angehefteten Münzen der echten Tutorial-
  // Verdächtigen + Ollis Schädel-Münze und eine große Tinten-Lupe.
  const left = newPage('left')
  const { ctx } = left
  const innerW = left.x1 - left.x0
  const panelW = innerW - 210
  const FONT = 38
  const panels: { x: number; y: number; h: number; deg: number; head: string; body: string[] }[] = [
    { x: left.x0, y: 0, h: 0, deg: -0.9, head: t('book.tut.welcomeHead'), body: [t('book.tut.welcome1'), t('book.tut.welcome2')] },
    { x: left.x0 + 210, y: 0, h: 0, deg: 0.8, head: t('book.tut.goalHead'), body: [t('book.tut.goal')] },
    // Getippte Ziffern statt ①②③④ — die Kreis-Glyphen fehlen der Typewriter-Schrift
    // (headless kein Font-Fallback, sie fielen einfach weg).
    { x: left.x0, y: 0, h: 0, deg: -0.5, head: t('book.tut.sceneHead'), body: [
      `1. ${t('rule.oneEachLine')}`,
      `2. ${t('rule.aloneWithVictim')}`,
      `3. ${t('book.tut.rule3')}`,
      `4. ${t('book.tut.rule4')}`,
    ] },
  ]
  let py = TOP + 30
  for (const p of panels) {
    p.h = tutorialPanel(ctx, p.x, py, panelW, p.head, p.body, { fontSize: FONT, draw: false })
    p.y = py
    py += p.h + 64
  }
  // Roter Faden UNTER den Panels, von Pin zu Pin.
  const pins: [number, number][] = [
    [panels[0].x + panelW - 60, panels[0].y + panels[0].h - 24],
    [panels[1].x + 46, panels[1].y + 30],
    [panels[1].x + panelW - 70, panels[1].y + panels[1].h - 20],
    [panels[2].x + panelW - 50, panels[2].y + 36],
  ]
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = art.CRIMSON
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(pins[0][0], pins[0][1])
  for (let i = 1; i < pins.length; i++) {
    const [ax, ay] = pins[i - 1]
    const [bx2, by2] = pins[i]
    ctx.quadraticCurveTo((ax + bx2) / 2 + 60, (ay + by2) / 2, bx2, by2)
  }
  ctx.stroke()
  ctx.restore()
  // Panels gedreht + Klebestreifen, danach die Pins OBENAUF.
  for (const p of panels) {
    ctx.save()
    ctx.translate(p.x + panelW / 2, p.y + p.h / 2)
    ctx.rotate((p.deg * Math.PI) / 180)
    tutorialPanel(ctx, -panelW / 2, -p.h / 2, panelW, p.head, p.body, { fontSize: FONT, draw: true })
    ctx.restore()
    tapeStrip(ctx, p.x + panelW / 2, p.y - 2, 230, p.deg * 3)
  }
  for (const [px2, py2] of pins) {
    ctx.fillStyle = '#c9a35c'
    ctx.strokeStyle = '#8a6428'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(px2, py2, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  // Angepinnte Beweis-Münzen: die echten Verdächtigen des Falls + Ollis Schädel.
  const coinImgs = await avatarImages(puzzle)
  const skull = await svgImage(SKULL_SVG, 220)
  const coins: { img: HTMLImageElement; x: number; y: number; s: number; deg: number }[] = [
    { img: coinImgs.get(puzzle.suspects[0].id)!, x: left.x1 - 172, y: panels[0].y + 26, s: 158, deg: 6 },
    { img: coinImgs.get(puzzle.suspects[2].id)!, x: left.x1 - 156, y: panels[0].y + 250, s: 140, deg: -5 },
    { img: coinImgs.get(puzzle.suspects[1].id)!, x: left.x0 + 8, y: panels[1].y + 14, s: 150, deg: -6 },
    { img: skull, x: left.x1 - 168, y: panels[2].y + 60, s: 148, deg: 5 },
  ]
  for (const c of coins) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 22
    ctx.shadowOffsetY = 8
    ctx.translate(c.x + c.s / 2, c.y + c.s / 2)
    ctx.rotate((c.deg * Math.PI) / 180)
    ctx.drawImage(c.img, -c.s / 2, -c.s / 2, c.s, c.s)
    ctx.restore()
    ctx.fillStyle = '#c9a35c'
    ctx.strokeStyle = '#8a6428'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(c.x + c.s / 2, c.y + 6, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  // Große Tinten-Lupe in der freien Fläche unter der Wand.
  const lupeR = 120
  const lx = left.x1 - 320
  const ly = Math.min(py + 90, PAGE_H - BOTTOM - 260)
  ctx.strokeStyle = art.INK
  ctx.lineWidth = 16
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.85
  ctx.beginPath()
  ctx.arc(lx, ly, lupeR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(lx + lupeR * 0.72, ly + lupeR * 0.72)
  ctx.lineTo(lx + lupeR * 1.65, ly + lupeR * 1.65)
  ctx.stroke()
  ctx.fillStyle = 'rgba(120, 150, 210, 0.10)'
  ctx.beginPath()
  ctx.arc(lx, ly, lupeR - 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  paintPageNo(left, pageNo)

  // ---- Rechte Seite: Schritt für Schritt ----
  const right = newPage('right')
  const rctx = right.ctx
  const rInnerW = right.x1 - right.x0
  let ry = TOP + 20
  ry += tutorialPanel(rctx, right.x0, ry, rInnerW, t('book.tut.stepHead'), [
    t('book.tut.stepIntro'),
  ], { fontSize: 34, draw: true }) + 44

  // Die vier Personen-Karten als 2×2-Gitter (Spielreihenfolge, Opfer zuletzt).
  const cards = await personCards(puzzle, renderer)
  const cardFont = 30
  const pad = Math.round(cardFont * 0.6)
  const avatarS = Math.round(cardFont * 3.4)
  const lineH = Math.round(cardFont * 1.42)
  const colGap = 22
  const colW = Math.floor((rInnerW - colGap) / 2)
  rctx.font = `${cardFont}px ${art.TYPE}`
  const cardH = cards.map((card) => {
    const lines = art.wrapText(rctx, card.text, colW - pad * 2 - avatarS - 16)
    return Math.max(avatarS + pad * 2, Math.round(cardFont * 1.35) + 8 + lines.length * lineH + pad * 2)
  })
  const rowH = [Math.max(cardH[0] ?? 0, cardH[1] ?? 0), Math.max(cardH[2] ?? 0, cardH[3] ?? 0)]
  cards.forEach((card, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    art.drawPersonCard(rctx, card, right.x0 + col * (colW + colGap), ry + row * (rowH[0] + 16), colW, cardH[i], {
      fontSize: cardFont,
      pad,
      avatar: avatarS,
      lineH,
      traitImgs,
    })
  })
  ry += rowH[0] + 16 + rowH[1] + 56

  // Das echte 4×4-Brett, mittig, mit Krimson-Annotationen wie im Referenz-Tutorial.
  const cell = Math.floor((rInnerW - 340) / 4)
  const bw = cell * 4
  const boardX = right.x0 + Math.round((rInnerW - bw) / 2)
  drawBoard(rctx, {
    puzzle,
    cell,
    origin: { x: boardX, y: ry },
    roomName: (key) => t(key),
    suspectIndex: new Map(),
    placements: new Map(),
    marks: new Map(),
    crosses: new Set(),
    highlight: null,
    reveal: null,
  })
  annotate(rctx, t('book.tut.labelScene').toUpperCase(), boardX + bw + 40, ry + 60, boardX + bw + 6, ry + 24)
  annotate(rctx, t('book.tut.labelRooms', { count: 2 }).toUpperCase(), right.x0 + 8, ry + cell * 2 + 90, boardX - 6, ry + cell * 2)
  annotate(rctx, t('book.tut.labelWindow').toUpperCase(), boardX + bw + 40, ry + cell * 2.9 + 80, boardX + bw + 8, ry + Math.round(cell * 2.5))
  ry += cell * 4 + 60

  // HINWEIS-Box: das Schlüsselwort »neben« — exakt der Begriffs-Tooltip des Spiels.
  const hint = t('book.tut.hint', { tip: t('tip.nearObject') })
  rctx.font = `30px ${art.TYPE}`
  const hintLines = art.wrapText(rctx, hint, rInnerW - 30 * 2 - Math.round(30 * 1.35) - 14)
  const hintBox = { lines: hintLines, h: Math.max(hintLines.length * Math.round(30 * 1.42), Math.round(30 * 1.35)) + 30 }
  art.drawNoteBox(rctx, hintBox, right.x0, ry, rInnerW, { fontSize: 30, lineH: Math.round(30 * 1.42) })
  paintPageNo(right, pageNo + 1)

  return [left, right]
}

// ------------------------------------------- Tutorial-Walkthrough (Spreads 2–4)

interface Snap {
  caption: string
  placements: Map<string, number>
  crosses: Set<number>
  marks: Map<number, Set<string>>
  reveal: { victimCell: number; murdererId: string | null } | null
}

/** Kandidaten-Brett + Schnappschüsse eines Falls — die Engine wird EXAKT
 *  nachgespielt (Domains aller Personen inkl. Opfer): Ausgangslage-Schritte
 *  bilden das Kandidaten-Brett, danach wird JEDER Engine-Schritt mit sichtbarer
 *  Wirkung ein eigener Schnappschuss — auch reine Streich-Schritte wie „A und B
 *  können nur in Zeile 1/2 sein" (Dirks Feedback: ohne die ist der Weg für
 *  Anfänger nicht nachvollziehbar). Captions: Setz-Schritte im Referenzbuch-
 *  Wortlaut, alles andere mit der echten (lokalisierten) Engine-Begründung. */
function walkthrough(puzzle: Puzzle, renderer: InstanceType<typeof Renderer>): { cand: Snap; snaps: Snap[] } {
  const result = new DeductionEngine(puzzle).solve()
  if (!result.solved || !result.solution) throw new Error(`${puzzle.id}: kein reiner Vorwärts-Lösungsweg`)
  const board = puzzle.board
  const occupiable: number[] = []
  for (let c = 0; c < board.width * board.height; c++) if (board.isOccupiable(c)) occupiable.push(c)

  const domains = new Map<string, Set<number>>(
    [...puzzle.suspects.map((s) => s.id), VICTIM_ID].map((id) => [id, new Set(occupiable)]),
  )
  const placed = new Map<string, number>()

  // Sichtbarer Zustand: Bleistift-Notizen = Domains der ungesetzten Verdächtigen,
  // Kreuze = Felder, auf die NIEMAND mehr kann (auch das Opfer nicht).
  const view = (): Pick<Snap, 'placements' | 'crosses' | 'marks'> => {
    const marks = new Map<number, Set<string>>()
    for (const s of puzzle.suspects) {
      if (placed.has(s.id)) continue
      for (const c of domains.get(s.id)!) {
        const set = marks.get(c) ?? new Set<string>()
        set.add(s.id)
        marks.set(c, set)
      }
    }
    const taken = new Set(placed.values())
    const crosses = new Set<number>()
    for (const c of occupiable) {
      if (taken.has(c)) continue
      if (![...domains.values()].some((d) => d.has(c))) crosses.add(c)
    }
    return { placements: new Map(placed), crosses, marks }
  }
  const visKey = (v: ReturnType<typeof view>): string =>
    JSON.stringify([
      [...v.placements.entries()].sort(),
      [...v.crosses].sort((a, b) => a - b),
      [...v.marks.entries()].map(([c, s]) => [c, [...s].sort()]).sort((a, b) => (a[0] as number) - (b[0] as number)),
    ])

  const place = (id: string, cell: number): void => {
    placed.set(id, cell)
    domains.set(id, new Set([cell]))
    const { row, col } = board.rc(cell)
    for (const [pid, dom] of domains) {
      if (pid === id) continue
      dom.delete(cell)
      for (const c of [...dom]) {
        const rc = board.rc(c)
        if (rc.row === row || rc.col === col) dom.delete(c)
      }
    }
  }

  let snaps: Snap[] = []
  let cand: Snap | null = null
  let lastKey = ''
  for (const step of result.steps) {
    if (step.technique === 'murderer' || step.technique === 'stuck') continue
    if (step.technique === 'clueCandidates') {
      if (step.personId !== undefined && step.candidates) {
        const dom = domains.get(step.personId)
        if (dom) domains.set(step.personId, new Set(step.candidates.filter((c) => dom.has(c))))
      }
      continue
    }
    if (cand === null) {
      const v = view()
      lastKey = visKey(v)
      cand = { caption: t('book.tut.candidates'), ...v, reveal: null }
    }
    for (const el of step.eliminated ?? []) {
      const dom = domains.get(el.personId)
      if (dom) for (const c of el.cells) dom.delete(c)
    }
    const placing = step.placedCell !== undefined && step.personId !== undefined
    if (placing) place(step.personId!, step.placedCell!)
    const v = view()
    const key = visKey(v)
    if (key === lastKey) continue // ohne sichtbare Änderung kein eigener Schritt
    lastKey = key
    if (placing && step.personId === VICTIM_ID) continue // das Opfer gehört ins Finale
    snaps.push({
      caption: placing && step.technique === 'nakedSingle'
        ? t('book.tut.place', { name: puzzle.nameOf(step.personId!) })
        : art.polish(renderer.render(step.explanation)),
      ...v,
      reveal: null,
    })
  }

  // Finale: ab dem Moment, in dem der letzte Verdächtige steht, wird alles EIN
  // Schnappschuss — gelöstes Brett mit Opfer und Mörder-Ring.
  const doneIdx = snaps.findIndex((s) => s.placements.size >= puzzle.suspects.length)
  if (doneIdx >= 0) snaps = snaps.slice(0, doneIdx)
  const solution = result.solution
  const victimCell = solution.cellOf(VICTIM_ID)
  const m = findMurderer(puzzle, solution)
  const lastSuspect = [...placed.keys()].filter((id) => id !== VICTIM_ID).pop() ?? puzzle.suspects[0].id
  placed.set(VICTIM_ID, victimCell)
  const taken = new Set(placed.values())
  const allCrosses = new Set<number>()
  for (const c of occupiable) if (!taken.has(c)) allCrosses.add(c)
  snaps.push({
    caption: t('book.tut.finale', {
      name: puzzle.nameOf(lastSuspect),
      victim: puzzle.victim.name,
      murderer: m.suspectId ? puzzle.nameOf(m.suspectId) : '?',
    }),
    placements: new Map(placed),
    crosses: allCrosses,
    marks: new Map(),
    reveal: { victimCell, murdererId: m.suspectId },
  })
  return { cand: cand!, snaps }
}

/** Klebestreifen-Deko über der Brett-Oberkante (die Polaroid-Optik der Store-Grafik). */
function tapeStrip(ctx: Ctx, cx: number, cy: number, w: number, deg: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.fillStyle = 'rgba(236, 230, 218, 0.82)'
  ctx.strokeStyle = 'rgba(120, 110, 96, 0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.rect(-w / 2, -24, w, 48)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

interface SnapOpts {
  cellMax: number
  suspectIndex: Map<string, number>
  avatars: Map<string, HTMLImageElement>
  /** 'left'/'right' = Brett auf dieser Seite, Sprechpanel daneben (die lockere
   *  Form, Dirks Feedback); 'center' = Text oben, Brett darunter (ruhig — fürs
   *  Kandidaten-Brett). */
  align: 'left' | 'right' | 'center'
  draw: boolean
}

/** Ein Walkthrough-Schnappschuss: Krimson-Nummern-Münze, Bildunterschrift im
 *  Panel, Brett mit Klebestreifen. Liefert die verbrauchte Höhe (draw=false misst nur). */
function paintSnap(page: Page, puzzle: Puzzle, snap: Snap, no: number, y: number, o: SnapOpts): number {
  const { ctx } = page
  const innerW = page.x1 - page.x0
  const W = puzzle.board.width
  const H = puzzle.board.height
  const COIN = 62
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const coin = (cx: number, cy: number): void => {
    ctx.fillStyle = art.CRIMSON
    ctx.beginPath()
    ctx.arc(cx, cy, COIN / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(COIN * 0.56)}px ${art.DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(no), cx, cy + 2)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  const board = (bx: number, by: number, cell: number): void => {
    drawBoard(ctx, {
      puzzle,
      cell,
      origin: { x: bx, y: by },
      roomName: (k) => t(k),
      suspectIndex: o.suspectIndex,
      placements: snap.placements,
      marks: snap.marks,
      crosses: snap.crosses,
      highlight: null,
      reveal: snap.reveal,
      avatars: o.avatars,
    })
    tapeStrip(ctx, bx + cell * W * 0.5, by - 2, Math.min(250, cell * W * 0.45), o.align === 'right' ? 2.5 : -3)
  }

  if (o.align === 'center') {
    const cell = Math.min(o.cellMax, Math.floor(innerW / W))
    const bw = cell * W
    ctx.font = `32px ${art.TYPE}`
    const lines = art.wrapText(ctx, snap.caption, innerW - COIN - 30)
    const textH = Math.max(COIN, lines.length * 44)
    const by = y + textH + 30
    if (o.draw) {
      coin(page.x0 + COIN / 2, y + COIN / 2)
      ctx.fillStyle = art.TEXT
      ctx.font = `32px ${art.TYPE}`
      lines.forEach((l, i) => ctx.fillText(l, page.x0 + COIN + 30, y + 38 + i * 44))
      board(page.x0 + Math.round((innerW - bw) / 2), by, cell)
    }
    return by + cell * H + 44 - y
  }

  // Neben-Layout: Brett links ODER rechts, Sprechpanel gegenüber, beides
  // vertikal zueinander zentriert — der Blick springt beim Blättern hin und her.
  const cell = Math.max(40, Math.min(o.cellMax, Math.floor((innerW - 460) / W)))
  const bw = cell * W
  const bh = cell * H
  const panelW = innerW - bw - 56
  const pad = 30
  ctx.font = `30px ${art.TYPE}`
  const lines = art.wrapText(ctx, snap.caption, panelW - pad * 2)
  const panelH = pad * 2 + Math.max(lines.length * 42, 40)
  const h = Math.max(bh + 26, panelH + COIN / 2 + 10)
  if (o.draw) {
    const bx = o.align === 'left' ? page.x0 : page.x1 - bw
    const px = o.align === 'left' ? page.x0 + bw + 56 : page.x0
    const by = y + 14 + Math.max(0, Math.round((h - 26 - bh) / 2))
    const py = y + COIN / 2 + Math.max(0, Math.round((h - COIN / 2 - panelH) / 2))
    ctx.fillStyle = art.CARD_BG
    ctx.strokeStyle = art.LINE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(px, py, panelW, panelH, 16)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = art.TEXT
    ctx.font = `30px ${art.TYPE}`
    const textTop = py + (panelH - lines.length * 42) / 2
    lines.forEach((l, i) => ctx.fillText(l, px + pad, textTop + 30 + i * 42))
    // Die Nummern-Münze sitzt ÜBER der Panel-Ecke (angeheftet, nicht gesetzt).
    coin(o.align === 'left' ? px + 8 : px + panelW - 8, py - 4)
    board(bx, by, cell)
  }
  return h + 34
}

/** Schnappschüsse fließend auf so viele Seiten wie nötig setzen — Brett-Seite
 *  wechselt pro Schritt (links/rechts), die Seitenzahl läuft mit. */
const measurePage = newPage('left')
function flowSnapPages(
  puzzle: Puzzle,
  snaps: Snap[],
  startNo: number,
  firstPageNo: number,
  o: { cellMax: number; suspectIndex: Map<string, number>; avatars: Map<string, HTMLImageElement> },
): Page[] {
  const pages: Page[] = []
  let pg: Page | null = null
  let yy = 0
  const bottom = PAGE_H - BOTTOM
  snaps.forEach((snap, i) => {
    const align: 'left' | 'right' = (startNo + i) % 2 === 0 ? 'right' : 'left'
    const no = startNo + i
    const h = paintSnap(measurePage, puzzle, snap, no, 0, { ...o, align, draw: false })
    if (pg === null || yy + h > bottom) {
      const side: 'left' | 'right' = (firstPageNo + pages.length) % 2 === 0 ? 'left' : 'right'
      pg = newPage(side)
      paintPageNo(pg, firstPageNo + pages.length)
      pages.push(pg)
      yy = TOP + 10
    }
    paintSnap(pg, puzzle, snap, no, yy, { ...o, align, draw: true })
    yy += h
  })
  return pages
}

/** 4×4-Minigitter der WICHTIG-Box: leeres Gitter mit Figuren-Münze; optional die
 *  Krimson-Kreuze auf der gesperrten Zeile + Spalte (das Referenzbuch-Diagramm). */
function miniGrid(
  ctx: Ctx,
  x: number,
  y: number,
  S: number,
  coin: { row: number; col: number; label: string; color: string },
  crossed: boolean,
): void {
  const N = 4
  ctx.save()
  ctx.fillStyle = '#fbf8ee'
  ctx.fillRect(x, y, N * S, N * S)
  ctx.strokeStyle = art.LINE
  ctx.lineWidth = 2
  for (let i = 0; i <= N; i++) {
    ctx.beginPath()
    ctx.moveTo(x + i * S, y)
    ctx.lineTo(x + i * S, y + N * S)
    ctx.moveTo(x, y + i * S)
    ctx.lineTo(x + N * S, y + i * S)
    ctx.stroke()
  }
  if (crossed) {
    ctx.strokeStyle = art.CRIMSON
    ctx.lineWidth = Math.max(3, S * 0.09)
    ctx.lineCap = 'round'
    const cross = (r: number, c: number): void => {
      const p = S * 0.26
      ctx.beginPath()
      ctx.moveTo(x + c * S + p, y + r * S + p)
      ctx.lineTo(x + (c + 1) * S - p, y + (r + 1) * S - p)
      ctx.moveTo(x + (c + 1) * S - p, y + r * S + p)
      ctx.lineTo(x + c * S + p, y + (r + 1) * S - p)
      ctx.stroke()
    }
    for (let i = 0; i < N; i++) {
      if (i !== coin.col) cross(coin.row, i)
      if (i !== coin.row) cross(i, coin.col)
    }
  }
  const cx = x + coin.col * S + S / 2
  const cy = y + coin.row * S + S / 2
  ctx.fillStyle = coin.color
  ctx.beginPath()
  ctx.arc(cx, cy, S * 0.36, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(20, 18, 26, 0.35)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `700 ${Math.round(S * 0.42)}px ${art.DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(coin.label, cx, cy + S * 0.02)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Tutorial-Doppelseite 2: links „Sehen wir uns die Hinweise an." + Kandidaten-
 *  Brett + WICHTIG-Box mit den zwei Minigittern; rechts die Setz-Schritte bis zum
 *  gelösten Fall — alles aus dem echten Lösungsweg des 4×4-Tutorials. */
async function tutorialSpread2(pageNo: number): Promise<Page[]> {
  const json = readLevelFile('demo-4x4.json')
  const puzzle = loadLevel(json)
  const renderer = new Renderer(de, puzzle)
  const suspectIndex = new Map(puzzle.suspects.map((s, i) => [s.id, i] as const))
  const avatars = await avatarImages(puzzle)
  const { cand, snaps } = walkthrough(puzzle, renderer)

  const left = newPage('left')
  const innerW = left.x1 - left.x0
  let y = TOP + 20
  y += tutorialPanel(left.ctx, left.x0, y, innerW, t('book.tut.cluesHead'), [], { fontSize: 34, draw: true }) + 36
  y += paintSnap(left, puzzle, cand, 1, y, { cellMax: 200, suspectIndex, avatars, align: 'center', draw: true }) + 16

  // WICHTIG-Box: Regel + „Wenn … dann"-Minigitter (wie im Referenzbuch).
  const { ctx } = left
  const boxPad = 34
  const gridS = 58
  const gridW = gridS * 4
  const name = puzzle.suspects[0].name
  ctx.font = `32px ${art.TYPE}`
  const ruleLines = art.wrapText(ctx, t('rule.oneEachLine'), innerW - boxPad * 2)
  const capW = Math.floor((innerW - boxPad * 2 - 60) / 2)
  const cap1 = art.wrapText(ctx, t('book.tut.ifHere', { name }), capW)
  const cap2 = art.wrapText(ctx, t('book.tut.thenNot'), capW)
  const capLines = Math.max(cap1.length, cap2.length)
  const boxH = boxPad + 58 + ruleLines.length * 46 + 26 + gridW + 18 + capLines * 40 + boxPad
  ctx.fillStyle = 'rgba(178, 58, 49, 0.06)'
  ctx.strokeStyle = art.CRIMSON
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(left.x0, y, innerW, boxH, 14)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = art.CRIMSON
  ctx.font = `700 40px ${art.DISPLAY}`
  ctx.fillText(t('book.tut.importantHead'), left.x0 + boxPad, y + boxPad + 24)
  ctx.fillStyle = art.INK
  ctx.font = `32px ${art.TYPE}`
  ruleLines.forEach((l, i) => ctx.fillText(l, left.x0 + boxPad, y + boxPad + 58 + (i + 1) * 46 - 14))
  const gy = y + boxPad + 58 + ruleLines.length * 46 + 26
  const g1x = left.x0 + boxPad + Math.round((capW - gridW) / 2)
  const g2x = left.x0 + boxPad + capW + 60 + Math.round((capW - gridW) / 2)
  const coin = { row: 1, col: 1, label: puzzle.suspects[0].id, color: suspectColor(0) }
  miniGrid(ctx, g1x, gy, gridS, coin, false)
  miniGrid(ctx, g2x, gy, gridS, coin, true)
  ctx.fillStyle = art.TEXT
  ctx.font = `28px ${art.TYPE}`
  cap1.forEach((l, i) => ctx.fillText(l, left.x0 + boxPad, gy + gridW + 40 + i * 40))
  cap2.forEach((l, i) => ctx.fillText(l, left.x0 + boxPad + capW + 60, gy + gridW + 40 + i * 40))
  paintPageNo(left, pageNo)

  return [left, ...flowSnapPages(puzzle, snaps, 2, pageNo + 1, { cellMax: 170, suspectIndex, avatars })]
}

/** Tutorial-Spreads 3+4: das 6×6 „Tutorial Wohnung" — erst Fall-Vorstellung
 *  (Karten + Akten-Notizen), dann der komplette Lösungsweg in 2er-Blöcken. */
async function tutorialSpread34(firstPageNo: number): Promise<Page[]> {
  const json = readLevelFile('Tutorial_Wohnung.json')
  const puzzle = loadLevel(json)
  const renderer = new Renderer(de, puzzle)
  const suspectIndex = new Map(puzzle.suspects.map((s, i) => [s.id, i] as const))
  const avatars = await avatarImages(puzzle)
  const { cand, snaps } = walkthrough(puzzle, renderer)

  const p1 = newPage('left')
  const innerW = p1.x1 - p1.x0
  let y = TOP + 20
  y += tutorialPanel(p1.ctx, p1.x0, y, innerW, t('book.tut.part2Head'), [t('book.tut.part2Intro')], {
    fontSize: 34,
    draw: true,
  }) + 36
  const cards = await personCards(puzzle, renderer)
  const notes = art.boardNotes(puzzle, renderer, t)
  paintSuspectPane(p1.ctx, cards, notes, { x: p1.x0, w: innerW, top: y, bottom: PAGE_H - BOTTOM })
  paintPageNo(p1, firstPageNo)

  return [p1, ...flowSnapPages(puzzle, [cand, ...snaps], 1, firstPageNo + 1, { cellMax: 150, suspectIndex, avatars })]
}

// ------------------------------------------------------------ Cover & Rückseite

const AUTHOR = 'Dirk Aporius'

/** Die Buch-Wortmarke (Krimdoku/Crimedoku — Krimson-O wie das Spiel-Logo),
 *  zentriert und auf die verfügbare Breite eingepasst. */
function paintBrand(ctx: Ctx, centerX: number, baseline: number, pxStart: number, maxW: number, bone: string, crimson: string): void {
  const brand = t('book.brand').toUpperCase()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (!brand.endsWith('OKU')) {
    ctx.font = `900 ${pxStart}px ${art.DISPLAY}`
    ctx.fillStyle = bone
    ctx.textAlign = 'center'
    ctx.fillText(brand, centerX, baseline)
    ctx.textAlign = 'left'
    return
  }
  const pre = brand.slice(0, -3)
  let px = pxStart
  const widths = (): [number, number, number] => {
    ctx.font = `900 ${px}px ${art.DISPLAY}`
    const wPre = ctx.measureText(pre).width
    const wKu = ctx.measureText('KU').width
    ctx.font = `italic 900 ${px}px ${art.DISPLAY}`
    return [wPre, ctx.measureText('O').width, wKu]
  }
  let [wPre, wO, wKu] = widths()
  while (px > 60 && wPre + wO + wKu > maxW) {
    px -= 8
    ;[wPre, wO, wKu] = widths()
  }
  const x0 = centerX - (wPre + wO + wKu) / 2
  ctx.font = `900 ${px}px ${art.DISPLAY}`
  ctx.fillStyle = bone
  ctx.fillText(pre, x0, baseline)
  ctx.font = `italic 900 ${px}px ${art.DISPLAY}`
  ctx.fillStyle = crimson
  ctx.fillText('O', x0 + wPre, baseline)
  ctx.font = `900 ${px}px ${art.DISPLAY}`
  ctx.fillStyle = bone
  ctx.fillText('KU', x0 + wPre + wO, baseline)
}

/** Cover-ENTWURF (Vollfarbe): Tinten-Nacht, Wortmarke, Untertitel, Beweis-Polaroid
 *  mit echtem Brett-Screenshot, Band-Stempel. Das finale Wraparound-Cover (mit
 *  Rücken) entsteht erst, wenn die Seitenzahl feststeht (KDP-Cover-Rechner). */
async function coverPage(): Promise<Page> {
  const { INK: INKC, BRASS, BONE, CRIMSON: CRIM } = await import('./portrait.ts')
  const page = newPage('right')
  const { ctx } = page

  // Tinten-Nacht wie der StartScreen (elliptischer Verlauf).
  const grad = ctx.createRadialGradient(PAGE_W * 0.5, PAGE_H * 0.34, 0, PAGE_W * 0.5, PAGE_H * 0.34, PAGE_H * 0.9)
  grad.addColorStop(0, INKC.c0)
  grad.addColorStop(0.58, INKC.c1)
  grad.addColorStop(1, INKC.c2)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = BRASS
  ctx.font = `44px ${art.TYPE}`
  ctx.fillText(t('book.cover.eyebrow').toUpperCase(), PAGE_W / 2, 360)

  // Wortmarke (Krimdoku/Crimedoku) mit dem Krimson-O — wie das Spiel-Logo.
  paintBrand(ctx, PAGE_W / 2, 620, 236, PAGE_W - 200, BONE, CRIM)

  ctx.textAlign = 'center'
  ctx.fillStyle = BONE
  ctx.font = `700 84px ${art.DISPLAY}`
  ctx.fillText(t('book.cover.subtitle'), PAGE_W / 2, 780)
  ctx.fillStyle = BRASS
  ctx.font = `46px ${art.TYPE}`
  ctx.fillText(t('book.cover.tagline'), PAGE_W / 2, 872)

  // Beweis-Polaroid: echter Brett-Screenshot, leicht gedreht, mit Schatten.
  const shot = await loadImage(resolve(root, 'screenshots', 'murdoku_level_9x9.jpg'))
  const pw = 1280
  const ph = Math.round((pw * shot.height) / shot.width)
  const cardW = pw + 44
  const cardH = ph + 110
  ctx.save()
  ctx.translate(PAGE_W / 2, 980 + cardH / 2)
  ctx.rotate((-2.5 * Math.PI) / 180)
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 24
  ctx.fillStyle = art.PAPER
  ctx.beginPath()
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.drawImage(shot as unknown as CanvasImageSource, -pw / 2, -cardH / 2 + 22, pw, ph)
  ctx.fillStyle = art.DIM
  ctx.font = `34px ${art.TYPE}`
  ctx.fillText(t('book.cover.evidence').toUpperCase(), 0, cardH / 2 - 34)
  ctx.restore()

  // Band-Stempel WEIT OBEN (Dirks Feedback: unten fiel er kaum auf) + Autor.
  ctx.save()
  ctx.translate(PAGE_W - 330, 220)
  ctx.rotate((7 * Math.PI) / 180)
  ctx.strokeStyle = CRIM
  ctx.lineWidth = 6
  ctx.font = `44px ${art.TYPE}`
  const volume = t('book.cover.volume').toUpperCase()
  const stampW = ctx.measureText(volume).width + 84
  ctx.globalAlpha = 0.92
  ctx.beginPath()
  ctx.roundRect(-stampW / 2, -54, stampW, 108, 16)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(-stampW / 2 + 10, -44, stampW - 20, 88, 10)
  ctx.stroke()
  ctx.fillStyle = CRIM
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(volume, 0, 3)
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = BONE
  ctx.font = `52px ${art.TYPE}`
  ctx.fillText(AUTHOR, PAGE_W / 2, PAGE_H - 250)
  ctx.fillStyle = BRASS
  ctx.font = `36px ${art.TYPE}`
  ctx.fillText('apo-games.de', PAGE_W / 2, PAGE_H - 170)
  return page
}

/** Der dunkle Abschluss („Akte geschlossen" · „Alle Fälle gelöst?" · Seerose-
 *  Polaroid · Wortmarke) an beliebigem Ursprung — GETEILT zwischen dem Rückcover
 *  des Wraparounds (die dunklen Seiten gehören nur AUSSEN hin, Dirks Vorgabe)
 *  und der letzten Seite der Testansicht. `fill` = Fläche für den Tinten-Verlauf
 *  (beim Cover inkl. Beschnitt); `barcodeSafe` rückt die unteren Zeilen nach
 *  links, damit die KDP-Barcode-Fläche frei bleibt. */
async function paintClosing(
  ctx: Ctx,
  ox: number,
  oy: number,
  fill: { x: number; y: number; w: number; h: number },
  barcodeSafe: boolean,
): Promise<void> {
  const { INK: INKC, BRASS, BONE, CRIMSON: CRIM } = await import('./portrait.ts')
  const cx = ox + PAGE_W / 2
  const grad = ctx.createRadialGradient(cx, oy + PAGE_H * 0.3, 0, cx, oy + PAGE_H * 0.3, PAGE_H * 0.9)
  grad.addColorStop(0, INKC.c0)
  grad.addColorStop(0.58, INKC.c1)
  grad.addColorStop(1, INKC.c2)
  ctx.fillStyle = grad
  ctx.fillRect(fill.x, fill.y, fill.w, fill.h)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = CRIM
  ctx.font = `42px ${art.TYPE}`
  ctx.fillText(`— ${t('book.back.closed').toUpperCase()} —`, cx, oy + 340)
  ctx.fillStyle = BONE
  ctx.font = `700 96px ${art.DISPLAY}`
  ctx.fillText(t('book.back.head'), cx, oy + 480)
  ctx.font = `38px ${art.TYPE}`
  const body = art.wrapText(ctx, t('book.back.body', { brand: t('book.brand') }), Math.round(PAGE_W * 0.82))
  body.forEach((l, i) => ctx.fillText(l, cx, oy + 590 + i * 56))

  // Abschieds-Beweisstück: ein echtes Level (Die Seerose), headless gerendert,
  // als gedrehtes Polaroid — dasselbe Muster wie die Front.
  const sp = loadLevel(readLevelFile('Die_Seerose.json'))
  const cell = 138
  const bw = cell * sp.board.width
  const bh = cell * sp.board.height
  const boardCanvas = createCanvas(bw + 4, bh + 4)
  const bctx = boardCanvas.getContext('2d') as unknown as Ctx
  bctx.fillStyle = art.PAPER
  bctx.fillRect(0, 0, bw + 4, bh + 4)
  drawBoard(bctx, {
    puzzle: sp,
    cell,
    origin: { x: 2, y: 2 },
    roomName: (k) => t(k),
    suspectIndex: new Map(),
    placements: new Map(),
    marks: new Map(),
    crosses: new Set(),
    highlight: null,
    reveal: null,
  })
  const cardW = bw + 64
  const cardH = bh + 150
  ctx.save()
  ctx.translate(cx, oy + 900 + cardH / 2)
  ctx.rotate((-2.5 * Math.PI) / 180)
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 24
  ctx.fillStyle = art.PAPER
  ctx.beginPath()
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.drawImage(boardCanvas as unknown as CanvasImageSource, -bw / 2, -cardH / 2 + 30, bw, bh)
  ctx.fillStyle = art.DIM
  ctx.font = `34px ${art.TYPE}`
  ctx.fillText(t('book.back.evidence').toUpperCase(), 0, cardH / 2 - 36)
  ctx.restore()

  // Unterer Block: mit Barcode-Fläche rückt er nach links, sonst mittig.
  const bx2 = barcodeSafe ? ox + Math.round(PAGE_W * 0.34) : cx
  paintBrand(ctx, bx2, oy + PAGE_H - 330, 110, barcodeSafe ? Math.round(PAGE_W * 0.56) : PAGE_W - 400, BONE, CRIM)
  ctx.textAlign = 'center'
  ctx.fillStyle = BRASS
  ctx.font = `40px ${art.TYPE}`
  ctx.fillText('apo-games.de', bx2, oy + PAGE_H - 240)
  ctx.fillStyle = 'rgba(240, 234, 214, 0.55)'
  ctx.font = `30px ${art.TYPE}`
  ctx.fillText(t('book.back.credit', { year: 2026, name: AUTHOR }), bx2, oy + PAGE_H - 150)
  ctx.textAlign = 'left'
}

/** Die dunkle Abschluss-Seite — NUR für die Testansicht (im gedruckten Buch ist
 *  dieses Motiv das Rückcover; der Innenteil endet hell). */
async function backPage(): Promise<Page> {
  const page = newPage('left')
  await paintClosing(page.ctx, 0, 0, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, false)
  return page
}

/** Wraparound-Cover für KDP: [Rückseite | Buchrücken | Front], alles MIT 0,125"-
 *  Beschnitt. Rückenbreite = Innenteil-Seiten × 0,002252" (Standard-Farbe,
 *  KDP-Formel). Unten rechts auf der Rückseite bleibt die weiße Barcode-Fläche
 *  frei (KDP druckt dort die ISBN). */
async function wrapCover(interiorPages: number): Promise<{ canvas: SkCanvas; wIn: number; hIn: number }> {
  const { INK: INKC, BONE } = await import('./portrait.ts')
  const BLEED = Math.round(0.125 * 300)
  const spineIn = interiorPages * 0.002252
  const spineW = Math.round(spineIn * 300)
  const W = BLEED + PAGE_W + spineW + PAGE_W + BLEED
  const H = BLEED + PAGE_H + BLEED
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d') as unknown as Ctx

  // EIN durchgehender Tinten-Verlauf mit exakt den Verlaufs-Parametern der Front —
  // die separat gerenderte Frontseite fügt sich dadurch nahtlos ein.
  const fx = BLEED + PAGE_W + spineW
  const grad = ctx.createRadialGradient(fx + PAGE_W * 0.5, BLEED + PAGE_H * 0.34, 0, fx + PAGE_W * 0.5, BLEED + PAGE_H * 0.34, PAGE_H * 0.9)
  grad.addColorStop(0, INKC.c0)
  grad.addColorStop(0.58, INKC.c1)
  grad.addColorStop(1, INKC.c2)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Front = die fertige Coverseite 1:1.
  const front = await coverPage()
  ctx.drawImage(front.canvas as unknown as CanvasImageSource, fx, BLEED)

  // Buchrücken: Wortmarke + Band, vertikal (Freiraum-Regel: Text schmaler als Rücken − 0,125").
  const spineFont = Math.min(58, spineW - Math.round(0.125 * 300))
  if (spineFont >= 34) {
    ctx.save()
    ctx.translate(BLEED + PAGE_W + spineW / 2, H / 2)
    ctx.rotate(Math.PI / 2)
    ctx.font = `700 ${spineFont}px ${art.DISPLAY}`
    ctx.fillStyle = BONE
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${t('book.brand').toUpperCase()} — ${t('book.cover.volume').toUpperCase()}`, 0, 2)
    ctx.restore()
  }

  // Rückseite (linkes Panel) = EXAKT das dunkle Abschluss-Motiv („Alle Fälle
  // gelöst?" + Seerose-Polaroid) — Dirks Vorgabe: die dunklen Seiten sind NUR
  // außen, Front und Ende bilden den Umschlag. Der Verlauf deckt Panel + äußere
  // Beschnitte ab (am Rücken sind beide Verläufe längst flach ausgelaufen — nahtlos).
  await paintClosing(ctx, BLEED, BLEED, { x: 0, y: 0, w: BLEED + PAGE_W, h: H }, true)
  const bcW = Math.round(2 * 300)
  const bcH = Math.round(1.2 * 300)
  const m = Math.round(0.25 * 300)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(BLEED + PAGE_W - m - bcW, H - BLEED - m - bcH, bcW, bcH)
  return { canvas, wIn: 0.25 + 6.69 * 2 + spineIn, hIn: 9.86 }
}

// -------------------------------------------------------- Titelei: Danksagung

/** Danksagungs-Seite (rechts, nach der Leerseite — Dirks Vorgabe): Familie +
 *  Manuel Garand für die Grundidee. */
function thanksPage(): Page {
  const page = newPage('right')
  const { ctx } = page
  const cx = (page.x0 + page.x1) / 2
  const innerW = page.x1 - page.x0
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = art.CRIMSON
  ctx.font = `36px ${art.TYPE}`
  ctx.fillText(`— ${t('book.thanks.head').toUpperCase()} —`, cx, 760)
  ctx.fillStyle = art.TEXT
  ctx.font = `36px ${art.TYPE}`
  let y = 900
  for (const key of ['book.thanks.family', 'book.thanks.garand']) {
    const lines = art.wrapText(ctx, t(key), Math.round(innerW * 0.82))
    lines.forEach((l, i) => ctx.fillText(l, cx, y + i * 56))
    y += lines.length * 56 + 70
  }
  ctx.fillStyle = art.INK
  ctx.font = `italic 700 58px ${art.DISPLAY}`
  ctx.fillText(AUTHOR, cx, y + 30)
  // Impressum (Pflichtangabe fürs veröffentlichte Buch): ladungsfähige Anschrift.
  ctx.fillStyle = art.DIM
  ctx.font = `28px ${art.TYPE}`
  const imprint = [`© 2026 ${AUTHOR}`, 'Westring 14 · 39110 Magdeburg', 'apo-games.de']
  imprint.forEach((l, i) => ctx.fillText(l, cx, PAGE_H - 380 + i * 44))
  ctx.textAlign = 'left'
  return page
}

// ------------------------------------------------------------ Die 60 Fälle

/** Band 1 (Dirk, 13.08.2026): 20 leicht / 20 mittel / 20 schwer, Themen-Mix,
 *  bewusst viele 9×9 (Dirks Wunsch), Finale 12×12. NIE Garand-Level. */
const BOOK_CASES: string[] = [
  // Leicht (Fälle 1–20)
  'Schulstart.json', 'MikroMakro_1_5.json', 'Camping_im_Freien.json', 'Wei_e_M_rder.json',
  'Der_Buchladen.json', 'Unfall_beim_Baden.json', 'Arbeitskollegen.json', 'Rondeln_ins_Ungl_ck.json',
  'Bei_Reparatur_Mord.json', 'Der_Restaurantbesuch.json', 'Mord_am_Hof.json', 'Tod_unter_Tieren.json',
  'Der_einfache_Wohnungsmord_Teil_2.json', 'Mord_bei_Ford.json', 'Volle_Bettenauslastung.json',
  'Sommerferien.json', 'Der_einfache_Fall_im_Hotel.json', 'Der_einfache_Brettspielmord.json',
  'Mord_in_der_Wohnung.json', 'Der_wirklich_andere_Supermarkt.json',
  // Mittel (Fälle 21–40)
  'Hotelzimmer_13_Check_In.json', 'Mord_im_Dunkeln.json', 'Der_kleine_Bauernhof.json', 'Der_Museumsmord.json',
  'Der_Unfall_in_der_Burg.json', 'Camping_ins_Ungl_ck.json', 'Spa_im_Freibad.json', 'Die_Skier_bringen_Mord.json',
  'Tiere_und_ein_Mord.json', 'Mord_im_Polizeirevier.json', 'Der_schmutzige_Pausenhof.json', 'Im_Supermarkt.json',
  'Die_s_en_Tiere.json', 'Ach_du_dickes_Ei.json', 'Der_Bauernhofsmord.json', 'Der_Fall_im_Hotel.json',
  'Der_Brettspielmord.json', 'Der_Mord_daheim.json', 'Mord_mit_gutem_Essen.json', 'Die_H_tte_im_Wald.json',
  // Schwer (Fälle 41–60)
  'Der_Burgfall.json', 'Mord_im_Revier.json', 'T_dliche_Werkstatt.json', 'Mord_im_OP.json',
  'Fertig_geplanscht.json', 'Die_Schule_der_M_rder.json', 'Skiungl_ck.json', 'Niemand_h_rt_dich_schreien.json',
  'Ein_Bauer_auf_Abwegen.json', 'War_es_ein_Tier_.json', 'Der_etwas_schwere_Fall_im_Hotel.json',
  'Leckeres_Essen.json', 'Alleine_mit_M_rdern.json', 'Der_schwere_Brettspielmord.json',
  'Der_t_dliche_leere_Raum.json', 'Mord_im_Herrenhaus.json', 'Der_Einkauf_des_Todes.json',
  'Der_Besuch_des_B_ren.json', 'Villa_Kunterbunt.json', 'Bademord.json',
]

// ---------------------------------------------------------------- Buchlauf

// KDP-Beschnitt: Unsere Seiten sind VOLLFLÄCHIGE Bilder (Papier-Tönung bis zur
// Kante) — bei „Kein Beschnitt" lehnt der Previewer deshalb JEDE Seite ab
// („Bild befindet sich außerhalb der Ränder"). Also liefern wir randabfallend:
// Seitengröße = Trim + 0,125" außen/oben/unten (NIE am Bund), KDP-Einstellung
// „Beschnittzugabe (Bleed)".
const BLEED_PX = Math.round(0.125 * 300)
const BLEED_W_IN = 6.69 + 0.125
const BLEED_H_IN = 9.61 + 0.25
const BLEED_W = PAGE_W + BLEED_PX
const BLEED_H = PAGE_H + 2 * BLEED_PX

/** Seite auf Beschnitt-Format bringen: erst minimal skaliert über die GANZE
 *  Fläche (füllt die Beschnittstreifen mit den Randfarben — funktioniert für
 *  Papier-Creme UND die dunklen Seiten der Testansicht), dann exakt auf
 *  Trim-Position. Beschnitt liegt IMMER außen, nie am Bund. */
function withBleed(page: Page): SkCanvas {
  const canvas = createCanvas(BLEED_W, BLEED_H)
  const ctx = canvas.getContext('2d') as unknown as Ctx
  ctx.drawImage(page.canvas as unknown as CanvasImageSource, 0, 0, BLEED_W, BLEED_H)
  ctx.drawImage(page.canvas as unknown as CanvasImageSource, page.side === 'left' ? BLEED_PX : 0, BLEED_PX)
  return canvas
}

// Jede fertige Seite wandert SOFORT als JPEG ins PDF und wird dann verworfen —
// 164 volle 300-dpi-Canvases gleichzeitig wären ~4 GB Speicher.
const outDir = resolve(root, 'book')
mkdirSync(outDir, { recursive: true })
const doc = new jsPDF({ unit: 'in', format: [BLEED_W_IN, BLEED_H_IN], compress: true })
let emitted = 0
function emit(page: Page): void {
  if (emitted > 0) doc.addPage([BLEED_W_IN, BLEED_H_IN])
  const jpeg = withBleed(page).toBuffer('image/jpeg', 92)
  doc.addImage(`data:image/jpeg;base64,${jpeg.toString('base64')}`, 'JPEG', 0, 0, BLEED_W_IN, BLEED_H_IN)
  emitted++
}

const MODE = process.argv[2] === 'probe' ? 'probe' : 'full'

if (MODE === 'probe') {
  // Schnelle Sichtprüfung: Auswahl-Seiten als PNGs + Kurz-PDF (wie bisher).
  const probeDir = resolve(outDir, 'probe')
  mkdirSync(probeDir, { recursive: true })
  const save = (page: Page, name: string): void => {
    writeFileSync(resolve(probeDir, `${name}.png`), page.canvas.toBuffer('image/png'))
    console.log('wrote', `${name}.png`)
  }
  const parts: Page[] = []
  parts.push(await coverPage(), newPage('left'), thanksPage())
  parts.push(...(await tutorialSpread1(4)))
  parts.push(...(await tutorialSpread2(6)))
  const [l1, r1] = await caseSpread('Schulstart.json', 1, 14)
  const [l2, r2] = await caseSpread('Der_schwere_Brettspielmord.json', 54, 120)
  parts.push(l1, r1, l2, r2)
  parts.push(await solutionPage([{ file: 'Schulstart.json', caseNo: 1 }, { file: 'Der_schwere_Brettspielmord.json', caseNo: 54 }], 'left', 138))
  parts.push(await backPage())
  parts.forEach((pg, i) => {
    save(pg, `probe-${String(i).padStart(2, '0')}`)
    emit(pg)
  })
  writeFileSync(resolve(probeDir, 'murdoku-buch-probe.pdf'), Buffer.from(doc.output('arraybuffer')))
  console.log('wrote murdoku-buch-probe.pdf')
} else {
  // ---- Das komplette Buch, ZWEI Ausgaben in einem Lauf:
  // ---- krimdoku-band1.pdf           = Testansicht (mit Cover + Leerseite)
  // ---- krimdoku-band1-innenteil.pdf = KDP-Innenteil (beginnt mit der Danksagung —
  // ----   die „leere Seite links" ist im gedruckten Buch die Umschlag-Innenseite)
  const interior = new jsPDF({ unit: 'in', format: [BLEED_W_IN, BLEED_H_IN], compress: true })
  let interiorPages = 0
  const addJpeg = (d: jsPDF, isFirst: boolean, jpeg: Buffer): void => {
    if (!isFirst) d.addPage([BLEED_W_IN, BLEED_H_IN])
    d.addImage(`data:image/jpeg;base64,${jpeg.toString('base64')}`, 'JPEG', 0, 0, BLEED_W_IN, BLEED_H_IN)
  }
  const emitBoth = (page: Page): void => {
    const jpeg = withBleed(page).toBuffer('image/jpeg', 92)
    addJpeg(doc, emitted === 0, jpeg)
    emitted++
    addJpeg(interior, interiorPages === 0, jpeg)
    interiorPages++
  }
  emit(await coverPage()) // nur Testansicht
  emit(newPage('left')) // nur Testansicht (im Druck: Umschlag-Innenseite)
  emitBoth(thanksPage()) // Innenteil S. 1
  let pageNo = 2
  const t1 = await tutorialSpread1(pageNo)
  t1.forEach(emitBoth)
  pageNo += t1.length
  const t2 = await tutorialSpread2(pageNo)
  t2.forEach(emitBoth)
  pageNo += t2.length
  const t34 = await tutorialSpread34(pageNo)
  t34.forEach(emitBoth)
  pageNo += t34.length
  // Jeder Fall beginnt auf einer LINKEN Seite (gerade Seitenzahl) — ggf. auffüllen.
  if (pageNo % 2 === 1) {
    emitBoth(newPage('right'))
    pageNo++
  }
  for (const [i, file] of BOOK_CASES.entries()) {
    const [left, right] = await caseSpread(file, i + 1, pageNo)
    emitBoth(left)
    emitBoth(right)
    pageNo += 2
    console.log(`Fall ${i + 1}/60 gesetzt (${file}) — Seite ${pageNo - 2}/${pageNo - 1}`)
  }
  for (let i = 0; i < BOOK_CASES.length; i += 2) {
    const pair = [
      { file: BOOK_CASES[i], caseNo: i + 1 },
      { file: BOOK_CASES[i + 1], caseNo: i + 2 },
    ]
    emitBoth(await solutionPage(pair, pageNo % 2 === 0 ? 'left' : 'right', pageNo))
    pageNo++
  }
  // Der Innenteil endet HELL — das dunkle Abschluss-Motiv ist das RÜCKCOVER
  // (Dirks Vorgabe: dunkle Seiten nur außen). Auf gerade Seitenzahl auffüllen,
  // damit das letzte Blatt vollständig ist; die Testansicht zeigt danach noch
  // das Rückcover-Motiv zum Durchblättern.
  if (interiorPages % 2 === 1) emitBoth(newPage(pageNo % 2 === 0 ? 'left' : 'right'))
  emit(await backPage())
  writeFileSync(resolve(outDir, 'krimdoku-band1.pdf'), Buffer.from(doc.output('arraybuffer')))
  writeFileSync(resolve(outDir, 'krimdoku-band1-innenteil.pdf'), Buffer.from(interior.output('arraybuffer')))
  console.log(`wrote krimdoku-band1.pdf (Testansicht, ${emitted} S.) + krimdoku-band1-innenteil.pdf (KDP, ${interiorPages} S.)`)

  // Wraparound-Cover mit der FINALEN Innenteil-Seitenzahl (Rückenbreite!).
  const wrap = await wrapCover(interiorPages)
  const coverDoc = new jsPDF({ unit: 'in', format: [wrap.wIn, wrap.hIn], orientation: 'landscape', compress: true })
  const coverJpeg = wrap.canvas.toBuffer('image/jpeg', 95)
  coverDoc.addImage(`data:image/jpeg;base64,${coverJpeg.toString('base64')}`, 'JPEG', 0, 0, wrap.wIn, wrap.hIn)
  writeFileSync(resolve(outDir, 'krimdoku-band1-cover.pdf'), Buffer.from(coverDoc.output('arraybuffer')))
  writeFileSync(resolve(outDir, 'krimdoku-band1-cover.png'), wrap.canvas.toBuffer('image/png'))
  console.log(
    `wrote krimdoku-band1-cover.pdf/.png — ${wrap.wIn.toFixed(3)}"×${wrap.hIn.toFixed(2)}" ` +
      `(Rücken ${(interiorPages * 0.002252).toFixed(3)}" bei ${interiorPages} Innenseiten)`,
  )
}
