/**
 * Druckbogen-Export: EIN A4-Querformat-PDF pro Level. Die rechte Spalte läuft über
 * die VOLLE Seitenhöhe — oben das UNGELÖSTE Brett, darunter die SW-Skizze auf ihrem
 * eigenen Zettel und der schräge »Der Mörder ist …«-Akten-Zettel. Links: kompakter
 * Kopf (Titel + Meta + kleiner Stempel), die Verdächtigen (ab 7 Personen
 * zweispaltig), Akten-Notizen, optional die Objekt-Legende als Streifen (Checkbox
 * im PdfDialog, Standard AUS) und die Grundregeln als Fuß.
 *
 * Das Brett rendert über das echte `drawBoard` des Spiels (voller Pfad: Bodentexturen,
 * Möbel, weiße Objekt-Karten, Namens-Pillen) — keine nachgebaute Grafik, damit der
 * Bogen immer exakt so aussieht wie das Spiel. Avatare kommen aus `avatarDataUri`,
 * die Legenden-Kacheln aus `drawObjectIcon` (dieselben Zeichner wie Legende/Editor).
 * Nur der Grund ist Papier statt Nacht: gedeckte Druck-Palette, kaum Flächen.
 * Nennt irgendein Hinweis eine Merkmals-AUSPRÄGUNG (Haarfarbe, Frisur, Bartform,
 * Brillenform/-farbe), steht sie als Text-Chip auf den Karten — „Blond" vs „Weiß"
 * ist auf Papier sonst Raterei (`referencedTraitKinds` + `valueTraitLabels`).
 *
 * Die Seite entsteht als ein 300-dpi-Canvas und wandert als Bild in jsPDF — so
 * tragen alle Texte die Spiel-Schriften (inkl. kyrillischem Fallback) ohne
 * TTF-Einbettung. Web lädt direkt herunter, Android teilt über das Share-Sheet
 * (dasselbe Muster wie der JSON-Export). KEIN Beschnitt — der gehört nur dem
 * KDP-Buch (scripts/make-book.ts legt ihn in seiner withBleed-Stufe an).
 */
import { Capacitor } from '@capacitor/core'
import {
  DeductionEngine,
  MERGE_INSTANCE_TYPES,
  OBJECT_CATALOG,
  VICTIM_ID,
  findMurderer,
  isWaterRoom,
  loadLevel,
  referencedTraitKinds,
  usesInsideOutside,
  type AttributeValue,
  type Clue,
  type DeductionStep,
  type LevelJson,
  type Puzzle,
} from '../engine/index.ts'
import { Renderer } from '../i18n/Renderer.ts'
import { drawBoard, drawDoor, drawObjectIcon, drawWindow } from './boardRender.ts'
import { onArtReady } from './objectArt.ts'
import { avatarDataUri } from './avatar.ts'
import { suspectColor } from './palette.ts'
import type { i18n as I18n } from 'i18next'

// 300 dpi auf A4 quer — flache Farben, als PNG eingebettet bleibt Linienkunst scharf.
const PX = 300 / 25.4
const PAGE_W = Math.round(297 * PX)
const PAGE_H = Math.round(210 * PX)
const MARGIN = Math.round(10 * PX)

// Druck-Palette (Entwurfsmappe Akte 23): warmes Papier, Tinte statt Schwarz.
// Exportiert für scripts/make-book.ts — der Buchdruck trägt dieselbe Palette.
export const PAPER = '#f6f1e4'
export const INK = '#2e2936'
export const DIM = '#6d6577'
export const LINE = '#c9c0ac'
export const CRIMSON = '#b23a31'
export const TEXT = '#4b4454'
export const CARD_BG = 'rgba(255, 255, 255, 0.5)'
/** Board-Pastell hinter den Legenden-Icons — wie ObjectIcon.TILE_BG. */
export const TILE_BG = '#e8d8b0'

// Schrift-Stacks aus src/index.css (--font-display / --font-type / --font-ui).
export const DISPLAY = "'Fraunces Variable', 'Playfair Display Variable', Georgia, serif"
export const TYPE = "'Special Elite', 'PT Mono', 'Courier New', monospace"

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur)
      cur = word
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('avatar image failed'))
    img.src = src
  })
}

/** Erster Buchstabe groß, Schlusspunkt nur wenn nötig — die ClueText-Satzpolitur. */
export function polish(text: string): string {
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1)
  if (text && !/[.!?]$/.test(text.trimEnd())) text += '.'
  return text
}

/** Klartext eines Verdächtigen-Hinweises — exakt die ClueText-Logik (Pronomen-Form,
 *  ' · ' zwischen Teilen, erster Buchstabe groß, Schlusspunkt nur wenn nötig). */
export function clueLine(renderer: Renderer, clues: readonly Clue[], subjectId: string): string {
  const text = clues
    .map((c) =>
      renderer.render(c.describe(), {
        name: subjectId,
        subject: subjectId,
        poss: subjectId,
        subjectObj: subjectId,
      }),
    )
    .join(' · ')
  return polish(text)
}

/** Alle Akten-Notizen des Levels — dieselbe Auswahl wie CluePanel.boardNotes. */
export function boardNotes(puzzle: Puzzle, renderer: Renderer, t: (k: string) => string): string[] {
  const notes: string[] = []
  const outside = [...puzzle.board.rooms.values()].filter((r) => r.outside).map((r) => t(r.nameKey))
  if (usesInsideOutside(puzzle) && outside.length > 0) {
    notes.push(`${t('game.outsideLabel')}: ${outside.join(', ')}`)
  }
  if ([...puzzle.board.rooms.values()].some((r) => isWaterRoom(r.nameKey))) {
    notes.push(t('game.waterWalkable'))
  }
  for (const clue of puzzle.boardClues) notes.push(renderer.render(clue.describe(), {}))
  for (const clue of puzzle.globalClues) notes.push(renderer.render(clue.describe(), {}))
  return notes.filter((n) => n.trim() !== '')
}

/** Ausprägungs-Merkmale, die als TEXT-Chip auf die Karten kommen, mit ihrem
 *  Locale-Katalog (`hair` heißt im Locale `hairColor`). Boolesche Merkmale
 *  (Bart/Brille/Glatze) bleiben Icons, `gender` bleibt das ♂/♀-Zeichen. */
const VALUE_TRAIT_CATALOG: Record<string, string> = {
  hair: 'hairColor',
  hairstyle: 'hairstyle',
  beardStyle: 'beardStyle',
  glassesShape: 'glassesShape',
  glassesColor: 'glassesColor',
}

/** Die Text-Chips einer Person: jede getragene Ausprägung, deren Merkmals-ART
 *  irgendein Hinweis des Levels nennt (`referencedTraitKinds`) — „Blond" und
 *  „Weiß" sind auf Papier sonst nicht zu unterscheiden. Nur Verdächtige: das
 *  Opfer zeigt außer dem Geschlecht nichts (verdeckter Zufall). */
export function valueTraitLabels(
  attributes: Readonly<Record<string, AttributeValue>>,
  kinds: ReadonlySet<string>,
  t: (k: string) => string,
): string[] {
  const out: string[] = []
  for (const [kind, catalog] of Object.entries(VALUE_TRAIT_CATALOG)) {
    const v = attributes[kind]
    if (kinds.has(kind) && typeof v === 'string') out.push(t(`${catalog}.${v}`))
  }
  return out
}

/** Legenden-Einträge wie Legend.tsx: begehbar zuerst, dann blockiert, dann Wandstücke. */
export function legendItems(
  puzzle: Puzzle,
  t: (k: string) => string,
): { type: string; name: string; status: 'occupiable' | 'blocked' | 'wall' }[] {
  const board = puzzle.board
  const catalogOrder = new Map(OBJECT_CATALOG.map((o, i) => [o.type, i]))
  const types = new Map<string, boolean>()
  let hasWindow = false
  let hasDoor = false
  for (let c = 0; c < board.width * board.height; c++) {
    for (const obj of board.tileAt(c).objects()) {
      if (!types.has(obj.type)) types.set(obj.type, obj.occupiable)
    }
    if (board.windowSides(c).length > 0) hasWindow = true
    if (board.doorSides(c).length > 0) hasDoor = true
  }
  const list: { type: string; name: string; status: 'occupiable' | 'blocked' | 'wall' }[] = []
  for (const [type, occ] of types) {
    list.push({ type, name: t(`objName.${type}`), status: occ ? 'occupiable' : 'blocked' })
  }
  if (hasWindow) list.push({ type: 'window', name: t('objName.window'), status: 'wall' })
  if (hasDoor) list.push({ type: 'door', name: t('objName.door'), status: 'wall' })
  const rank = { occupiable: 0, blocked: 1, wall: 2 }
  return list.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (catalogOrder.get(a.type) ?? 999) - (catalogOrder.get(b.type) ?? 999),
  )
}

/** Ein Legenden-Icon wie ObjectIcon: abgerundete Pastell-Kachel, echte Objektzeichnung. */
export function drawLegendTile(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, size: number, occupiable: boolean): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.roundRect(0.5, 0.5, size - 1, size - 1, size * 0.16)
  ctx.clip()
  ctx.fillStyle = TILE_BG
  ctx.fillRect(0, 0, size, size)
  if (type === 'window') drawWindow(ctx, 0, -size / 2, size, 'S')
  else if (type === 'door') drawDoor(ctx, 0, -size / 2, size, 'S')
  else drawObjectIcon(ctx, type, 0, 0, size, occupiable)
  ctx.restore()
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = 'rgba(20, 18, 26, 0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(0.5, 0.5, size - 1, size - 1, size * 0.16)
  ctx.stroke()
  ctx.restore()
}

/** Ein Element des Legende-Streifens: Gruppenwort oder Objekt mit fertiger Breite. */
interface LegendStripToken {
  kind: 'label' | 'item'
  text: string
  w: number
  item?: ReturnType<typeof legendItems>[number]
}

const STRIP_TILE = 52
const STRIP_ITEM_GAP = 18

function legendStripTokens(
  ctx: CanvasRenderingContext2D,
  items: ReturnType<typeof legendItems>,
  t: (k: string) => string,
  nameFont: number,
): LegendStripToken[] {
  const tokens: LegendStripToken[] = []
  let lastStatus = ''
  for (const it of items) {
    if (it.status !== lastStatus) {
      lastStatus = it.status
      const text = t(`legend.${it.status}`).toUpperCase()
      ctx.font = `700 ${Math.round(nameFont * 0.92)}px ${TYPE}`
      tokens.push({ kind: 'label', text, w: ctx.measureText(text).width + 26 })
    }
    ctx.font = `${nameFont}px ${TYPE}`
    tokens.push({
      kind: 'item',
      text: it.name,
      w: Math.max(STRIP_TILE, ctx.measureText(it.name).width) + STRIP_ITEM_GAP,
      item: it,
    })
  }
  return tokens
}

/** Objekt-Legende als kompakter STREIFEN (Icon oben, Name darunter, Gruppenwörter
 *  dazwischen) zeichnen ODER nur die Höhe messen (draw=false). Angestrebt ist EINE
 *  Zeile (Schrift 22 → 18); passt sie nie, bricht der Streifen bei Schrift 20 um,
 *  statt unleserlich zu schrumpfen (Dirks OK, 18.08.2026). Ersetzt die alte
 *  mehrzeilige Block-Legende — Bogen und Buch tragen denselben Streifen. */
export function paintLegendStrip(
  ctx: CanvasRenderingContext2D,
  items: ReturnType<typeof legendItems>,
  t: (k: string) => string,
  x0: number,
  y0: number,
  width: number,
  draw: boolean,
): number {
  if (items.length === 0) return 0
  const layout = (f: number): LegendStripToken[][] => {
    const rows: LegendStripToken[][] = [[]]
    let lx = 0
    for (const tok of legendStripTokens(ctx, items, t, f)) {
      if (lx + tok.w > width && rows[rows.length - 1].length > 0) {
        rows.push([])
        lx = 0
      }
      rows[rows.length - 1].push(tok)
      lx += tok.w
    }
    return rows
  }
  let nameFont = 20
  let rows: LegendStripToken[][] | null = null
  for (let f = 22; f >= 18; f -= 2) {
    const r = layout(f)
    if (r.length === 1) {
      nameFont = f
      rows = r
      break
    }
  }
  rows ??= layout(nameFont)
  const rowH = STRIP_TILE + 8 + nameFont + 14
  if (!draw) return rows.length * rowH
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  rows.forEach((row, ri) => {
    let lx = x0
    const ty = y0 + ri * rowH
    for (const tok of row) {
      if (tok.kind === 'label') {
        ctx.fillStyle = DIM
        ctx.font = `700 ${Math.round(nameFont * 0.92)}px ${TYPE}`
        ctx.textAlign = 'left'
        ctx.fillText(tok.text, lx, ty + STRIP_TILE / 2 + nameFont * 0.35)
      } else {
        const cx = lx + (tok.w - STRIP_ITEM_GAP) / 2
        drawLegendTile(ctx, tok.item!.type, cx - STRIP_TILE / 2, ty, STRIP_TILE, tok.item!.status === 'occupiable')
        ctx.fillStyle = INK
        ctx.font = `${nameFont}px ${TYPE}`
        ctx.textAlign = 'center'
        ctx.fillText(tok.text, cx, ty + STRIP_TILE + 8 + nameFont * 0.82)
      }
      lx += tok.w
    }
  })
  ctx.textAlign = 'left'
  ctx.restore()
  return rows.length * rowH
}

// Skizzen-Palette: Graustufen auf Papier — dunkel = nicht begehbar (Dirks Vorgabe).
const SKETCH_FREE = '#fbf8ee'
const SKETCH_BLOCKED = '#d8d1be'
const SKETCH_GRID = '#b7af9c'
const SKETCH_WALL = '#4b4454'
const SKETCH_OUTLINE = '#948c7d'

/** Zusammenhängende BEGEHBARE Objekte als je eine Bounding-Box — die Skizze umrandet
 *  sie als EINEN Umriss. Getrennt nach Schicht: `top` (Stuhl, Bett, Auto — man steht
 *  AUF dem Objekt, durchgezogener Umriss) und `ground` (Teppich/Weg/Straße — nur
 *  Bodenbelag, gestrichelt; Dirks Vorgabe: „zählen nicht direkt als begehbar"). */
function occupiableComponents(
  board: Puzzle['board'],
): { r0: number; c0: number; r1: number; c1: number; layer: 'ground' | 'top'; cells: Set<number> }[] {
  const W = board.width
  const H = board.height
  const comps: { r0: number; c0: number; r1: number; c1: number; layer: 'ground' | 'top'; cells: Set<number> }[] = []
  for (const layer of ['ground', 'top'] as const) {
    const typeAt: (string | null)[] = []
    for (let c = 0; c < W * H; c++) {
      const obj = board.isVoid(c) ? null : board.tileAt(c)[layer]
      typeAt.push(obj && obj.occupiable ? obj.type : null)
    }
    const seen = new Set<number>()
    for (let c = 0; c < W * H; c++) {
      if (typeAt[c] === null || seen.has(c)) continue
      const ty = typeAt[c]
      const stack = [c]
      seen.add(c)
      const cells = new Set<number>([c])
      // Verschmolzen wird NUR, was die Engine als EINE Instanz kennt (Auto, Bett,
      // Kutsche, Tisch, Teppich, …) — und wie in Board nur im selben Raum. Alles
      // andere (allen voran Stühle) bleibt einzeln: zwei Stühle nebeneinander sind
      // zwei Umrisse, nie einer.
      const merge = MERGE_INSTANCE_TYPES.has(ty!)
      let r0 = H, r1 = -1, c0 = W, c1 = -1
      while (stack.length > 0) {
        const cur = stack.pop()!
        const { row, col } = board.rc(cur)
        r0 = Math.min(r0, row)
        r1 = Math.max(r1, row)
        c0 = Math.min(c0, col)
        c1 = Math.max(c1, col)
        if (!merge) continue
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = row + dr
          const nc = col + dc
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue
          const n = nr * W + nc
          if (!seen.has(n) && typeAt[n] === ty && board.roomIdOf(n) === board.roomIdOf(cur)) {
            seen.add(n)
            cells.add(n)
            stack.push(n)
          }
        }
      }
      comps.push({ r0, c0, r1, c1, layer, cells })
    }
  }
  return comps
}

/**
 * Exakter Umriss einer Zellmenge (auch geknickte Teppiche/Straßen!) als eingerückte
 * Segmente. Endpunkt-Regel je Segment-Ende: Nachbar längs der Kante fehlt → um d
 * einrücken (konvexe Ecke); Nachbar da, Diagonale fehlt → bis zur Zellkante (läuft
 * nahtlos in dessen Segment weiter); beide da → um d hinausragen (konkave Ecke, trifft
 * dort exakt das quer laufende Segment der Diagonalzelle).
 */
function strokeAreaOutline(
  ctx: CanvasRenderingContext2D,
  cells: Set<number>,
  W: number,
  H: number,
  x: number,
  y: number,
  S: number,
  d: number,
): void {
  const has = (r: number, c: number): boolean => r >= 0 && r < H && c >= 0 && c < W && cells.has(r * W + c)
  const end = (alongIn: boolean, diagIn: boolean): number => (alongIn ? (diagIn ? -d : 0) : d)
  ctx.beginPath()
  for (const idx of cells) {
    const r = Math.floor(idx / W)
    const c = idx % W
    const cx = x + c * S
    const cy = y + r * S
    if (!has(r - 1, c)) {
      ctx.moveTo(cx + end(has(r, c - 1), has(r - 1, c - 1)), cy + d)
      ctx.lineTo(cx + S - end(has(r, c + 1), has(r - 1, c + 1)), cy + d)
    }
    if (!has(r + 1, c)) {
      ctx.moveTo(cx + end(has(r, c - 1), has(r + 1, c - 1)), cy + S - d)
      ctx.lineTo(cx + S - end(has(r, c + 1), has(r + 1, c + 1)), cy + S - d)
    }
    if (!has(r, c - 1)) {
      ctx.moveTo(cx + d, cy + end(has(r - 1, c), has(r - 1, c - 1)))
      ctx.lineTo(cx + d, cy + S - end(has(r + 1, c), has(r + 1, c - 1)))
    }
    if (!has(r, c + 1)) {
      ctx.moveTo(cx + S - d, cy + end(has(r - 1, c), has(r - 1, c + 1)))
      ctx.lineTo(cx + S - d, cy + S - end(has(r + 1, c), has(r + 1, c + 1)))
    }
  }
  ctx.stroke()
}

/** Die Schwarz-Weiß-Lösefläche (wie die Skizze im Murdle-Buch): helle begehbare
 *  Felder, dunkle blockierte, dicke Wände an Raumgrenzen, begehbare Objekte als
 *  abgerundete Umrisse (mehrzellige als EIN Umriss). */
export function drawSketch(ctx: CanvasRenderingContext2D, puzzle: Puzzle, x: number, y: number, S: number): void {
  const board = puzzle.board
  const W = board.width
  const H = board.height
  ctx.save()
  for (let c = 0; c < W * H; c++) {
    if (board.isVoid(c)) continue
    const { row, col } = board.rc(c)
    ctx.fillStyle = board.isOccupiable(c) ? SKETCH_FREE : SKETCH_BLOCKED
    ctx.fillRect(x + col * S, y + row * S, S, S)
  }
  ctx.strokeStyle = SKETCH_GRID
  ctx.lineWidth = 1.5
  for (let c = 0; c < W * H; c++) {
    if (board.isVoid(c)) continue
    const { row, col } = board.rc(c)
    ctx.strokeRect(x + col * S + 0.5, y + row * S + 0.5, S, S)
  }
  for (const comp of occupiableComponents(board)) {
    ctx.strokeStyle = SKETCH_OUTLINE
    ctx.lineWidth = Math.max(2.5, S * 0.055)
    if (comp.layer === 'ground') {
      // Bodenbeläge (Teppich/Weg/Straße) gestrichelt und dem ECHTEN Umriss folgend —
      // auch geknickte Flächen (die Bounding-Box überdeckte sonst fremde Zellen).
      ctx.setLineDash([S * 0.14, S * 0.12])
      strokeAreaOutline(ctx, comp.cells, W, H, x, y, S, S * 0.09)
      ctx.setLineDash([])
    } else {
      // Echte Objekte zum Draufstehen (Stuhl, Bett, Auto) massiv und abgerundet —
      // mehrzellige sind im Spiel immer Rechtecke, die Box passt hier exakt.
      const inset = S * 0.16
      ctx.beginPath()
      ctx.roundRect(
        x + comp.c0 * S + inset,
        y + comp.r0 * S + inset,
        (comp.c1 - comp.c0 + 1) * S - 2 * inset,
        (comp.r1 - comp.r0 + 1) * S - 2 * inset,
        S * 0.2,
      )
      ctx.stroke()
    }
  }
  ctx.strokeStyle = SKETCH_WALL
  ctx.lineWidth = Math.max(5, S * 0.1)
  ctx.lineCap = 'square'
  for (let c = 0; c < W * H; c++) {
    if (board.isVoid(c)) continue
    const { row, col } = board.rc(c)
    const cx = x + col * S
    const cy = y + row * S
    const room = board.roomIdOf(c)
    const wallAt = (r2: number, c2: number): boolean =>
      r2 < 0 || r2 >= H || c2 < 0 || c2 >= W ||
      board.isVoid(r2 * W + c2) || board.roomIdOf(r2 * W + c2) !== room
    ctx.beginPath()
    if (wallAt(row - 1, col)) { ctx.moveTo(cx, cy); ctx.lineTo(cx + S, cy) }
    if (wallAt(row + 1, col)) { ctx.moveTo(cx, cy + S); ctx.lineTo(cx + S, cy + S) }
    if (wallAt(row, col - 1)) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + S) }
    if (wallAt(row, col + 1)) { ctx.moveTo(cx + S, cy); ctx.lineTo(cx + S, cy + S) }
    ctx.stroke()
  }
  ctx.restore()
}

/** Der helle Zettel-Grund der Skizzen- und Mörder-Zettel (heller als das Papier). */
const SLIP_BG = '#fdfaf0'

/** Ziffern-Schriftgrad der Zeilen-/Spaltennummern (skaliert mit der Zelle). */
function boardLabelFont(cell: number): number {
  return Math.max(16, Math.min(26, Math.round(cell * 0.22)))
}

/** Abstand der Ziffern vom Brettrand: Fenster/Türen sitzen MITTIG auf der Wand
 *  und ragen bis zu ~0,10·Zelle + Strich darüber hinaus (sideRect in
 *  boardRender) — 0,14·Zelle + 8 px räumt das bei JEDER Zellgröße frei
 *  (Dirk, 18.08.2026: Fenster verdeckten die Nummern). */
function boardLabelGap(cell: number): number {
  return Math.round(cell * 0.14) + 8
}

/** Platz, den die Ziffernleiste links + oben braucht — aus der (geschätzten)
 *  Zellgröße berechnet: Aufrufer schätzen die Zelle erst OHNE Leiste, holen
 *  hiermit die Reserve und rechnen dann final (die echte Zelle ist ≤ der
 *  Schätzung, die Reserve reicht also immer). IMMER, für alle Brettgrößen. */
export function boardLabelReserve(cell: number): number {
  return boardLabelGap(cell) + boardLabelFont(cell) + 4
}

/** Die Ziffernleiste selbst: Spaltennummern über, Zeilennummern links vom Brett —
 *  gedimmte Typewriter-Ziffern, Abstand räumt den Fenster-/Tür-Überhang frei.
 *  Geteilt mit make-book. */
export function drawBoardLabels(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  x: number,
  y: number,
  cell: number,
): void {
  const font = boardLabelFont(cell)
  const gap = boardLabelGap(cell)
  ctx.save()
  ctx.fillStyle = DIM
  ctx.font = `${font}px ${TYPE}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  for (let c = 0; c < W; c++) ctx.fillText(String(c + 1), x + c * cell + cell / 2, y - gap)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let r = 0; r < H; r++) ctx.fillText(String(r + 1), x - gap, y + r * cell + cell / 2 + 1)
  ctx.restore()
}

/** Zettel-Rand der Skizze — skaliert MIT der Zelle: Er trägt die Zeilen-/
 *  Spaltennummern, und die dicken Skizzen-Wände (lineWidth ≈ 0,1·Zelle, mittig
 *  auf der Kante) ragen ~0,05·Zelle über die Skizzenfläche hinaus. Feste 34 px
 *  ließen bei 4×4 (Riesenzellen) die Ziffern in die Wand rutschen
 *  (Dirks Screenshot, 18.08.2026). */
export function sketchSlipPad(cell: number): number {
  return Math.max(36, Math.round(cell * 0.3))
}

/** Reserve, die Aufrufer um die reine Skizzenfläche einplanen (Rand + Schatten) —
 *  aus der GESCHÄTZTEN Skizzenzelle berechnen (Schätzung ≥ final ⇒ reicht immer). */
export function sketchSlipReserve(cell: number): number {
  return sketchSlipPad(cell) + 14
}

/** Die SW-Skizze auf ihrem eigenen Zettel (weicher Schatten) — „als ob sie auf
 *  einen Zettel gezeichnet wurde", nicht aufs Blatt geklatscht. BEWUSST GERADE:
 *  In die Zellen wird geschrieben, gerade schreibt sich das besser — die leichte
 *  Drehung von früher wurde auf Dirks Wunsch entfernt (18.08.2026; der
 *  Mörder-Zettel bleibt schräg). (x,y) bleibt die SKIZZEN-Ecke wie `drawSketch`. */
export function drawSketchSlip(
  ctx: CanvasRenderingContext2D,
  puzzle: Puzzle,
  x: number,
  y: number,
  cell: number,
): void {
  const sw = cell * puzzle.board.width
  const sh = cell * puzzle.board.height
  const pad = sketchSlipPad(cell)
  const sx = x - pad
  const sy = y - pad
  const w = sw + 2 * pad
  const h = sh + 2 * pad
  ctx.save()
  ctx.save()
  ctx.shadowColor = 'rgba(46, 41, 54, 0.3)'
  ctx.shadowBlur = 20
  ctx.shadowOffsetX = 5
  ctx.shadowOffsetY = 10
  ctx.fillStyle = SLIP_BG
  ctx.beginPath()
  ctx.roundRect(sx, sy, w, h, 6)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(46, 41, 54, 0.1)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(sx, sy, w, h, 6)
  ctx.stroke()
  drawSketch(ctx, puzzle, x, y, cell)
  // Zeilen-/Spaltennummern IM Zettel-Rand (immer) — die Lösefläche ist der Ort,
  // an dem gezählt wird; der Rand existiert schon, es kostet also keinen Platz.
  // Abstand räumt die dicke Skizzen-Wand frei (ragt ~0,05·Zelle über die Kante).
  const gap = Math.round(cell * 0.05) + 8
  const font = Math.max(14, Math.min(26, Math.round(cell * 0.26)))
  ctx.fillStyle = DIM
  ctx.font = `${font}px ${TYPE}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  for (let c = 0; c < puzzle.board.width; c++) {
    ctx.fillText(String(c + 1), x + c * cell + cell / 2, y - gap)
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let r = 0; r < puzzle.board.height; r++) {
    ctx.fillText(String(r + 1), x - gap, y + r * cell + cell / 2 + 1)
  }
  ctx.restore()
}

/** Der »Der Mörder ist …«-Akten-Zettel: schräg mit Schatten, Krimson-Doppelrahmen
 *  in der Stempel-Sprache des Bogens, Büroklammer über der Kante, Tinten-
 *  Fingerabdruck, große gestrichelte Schreiblinie. (cx,cy) = Zettel-MITTE. */
export function drawMurderSlip(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angleDeg = -2.5,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((angleDeg * Math.PI) / 180)

  ctx.save()
  ctx.shadowColor = 'rgba(46, 41, 54, 0.35)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetX = 6
  ctx.shadowOffsetY = 12
  ctx.fillStyle = SLIP_BG
  ctx.beginPath()
  ctx.roundRect(-w / 2, -h / 2, w, h, 6)
  ctx.fill()
  ctx.restore()

  ctx.strokeStyle = CRIMSON
  ctx.globalAlpha = 0.9
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.roundRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 6)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(-w / 2 + 17, -h / 2 + 17, w - 34, h - 34, 4)
  ctx.stroke()
  ctx.globalAlpha = 1

  // Kopfzeile in Typewriter-Großbuchstaben, rechts neben der Büroklammer.
  ctx.fillStyle = CRIMSON
  ctx.font = `34px ${TYPE}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(label.toUpperCase(), -w / 2 + 130, -h / 2 + 68)

  // Große Schreiblinie — endet vor dem Fingerabdruck.
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.setLineDash([16, 12])
  ctx.beginPath()
  ctx.moveTo(-w / 2 + 40, h / 2 - 48)
  ctx.lineTo(w / 2 - 200, h / 2 - 48)
  ctx.stroke()
  ctx.setLineDash([])

  // Tinten-Fingerabdruck unten rechts (feste Bogen-Lücken, keine Zufallsquelle).
  ctx.save()
  ctx.translate(w / 2 - 92, h / 2 - 84)
  ctx.rotate(-0.35)
  ctx.strokeStyle = CRIMSON
  ctx.globalAlpha = 0.32
  ctx.lineWidth = 3.2
  ctx.lineCap = 'round'
  const gaps = [
    [0.4, 1.1], [2.2, 2.9], [4.1, 4.7], [1.0, 1.7], [3.3, 3.9], [5.2, 5.8],
    [0.2, 0.8], [2.6, 3.2], [4.5, 5.1], [1.4, 2.0], [3.7, 4.3],
  ]
  for (let i = 0; i < 11; i++) {
    const r = 9 + i * 6.2
    const [g0, g1] = gaps[i]
    ctx.beginPath()
    ctx.ellipse(0, 0, r, r * 0.76, 0.2 + i * 0.06, g1, g0 + Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  // Büroklammer oben links — klassische Trombone-Form, hängt über die Zettelkante.
  ctx.save()
  ctx.translate(-w / 2 + 70, -h / 2 + 14)
  ctx.rotate(0.12)
  ctx.strokeStyle = '#8b8494'
  ctx.lineWidth = 6.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-16, -36)
  ctx.lineTo(-16, 46)
  ctx.arc(0, 46, 16, Math.PI, 0, true)
  ctx.lineTo(16, -26)
  ctx.arc(0, -26, 16, 0, Math.PI, true)
  ctx.lineTo(-8, 30)
  ctx.arc(0, 30, 8, Math.PI, 0, true)
  ctx.lineTo(8, -14)
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

/** Kompassrose in Linien-Art (Druck-Palette): Kreis mit 45°-Zwischenstrichen,
 *  Nadel mit Krimson-Nordspitze, lokalisierte Himmelsrichtungs-Buchstaben
 *  (legend.compassN/E/S/W — de N/O/S/W, en N/E/S/W, ru С/В/Ю/З …). Sitzt im
 *  freien Raum ÜBER dem Mörder-Zettel: „südlich von …" braucht ein sichtbares
 *  Nord (Dirk, 18.08.2026). Buchstaben ragen ~0,45·r über den Kreis hinaus. */
export function drawCompass(
  ctx: CanvasRenderingContext2D,
  t: (k: string) => string,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.save()
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(2.5, r * 0.045)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = Math.max(1.5, r * 0.03)
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8)
    ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92)
    ctx.stroke()
  }
  // Nadel: Nordspitze gefüllt in Krimson, Südspitze nur Umriss, Querstrich O–W.
  const nLen = r * 0.72
  const nW = r * 0.16
  ctx.beginPath()
  ctx.moveTo(cx, cy - nLen)
  ctx.lineTo(cx + nW, cy)
  ctx.lineTo(cx - nW, cy)
  ctx.closePath()
  ctx.fillStyle = CRIMSON
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx, cy + nLen)
  ctx.lineTo(cx + nW, cy)
  ctx.lineTo(cx - nW, cy)
  ctx.closePath()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.55, cy)
  ctx.lineTo(cx + r * 0.55, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(3, r * 0.06), 0, Math.PI * 2)
  ctx.fillStyle = INK
  ctx.fill()
  const lf = Math.max(18, Math.round(r * 0.42))
  ctx.font = `${lf}px ${TYPE}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const off = r + lf * 0.75
  ctx.fillStyle = CRIMSON
  ctx.fillText(t('legend.compassN'), cx, cy - off)
  ctx.fillStyle = DIM
  ctx.fillText(t('legend.compassE'), cx + off, cy)
  ctx.fillText(t('legend.compassS'), cx, cy + off)
  ctx.fillText(t('legend.compassW'), cx - off, cy)
  ctx.restore()
}

/** Gemeinsamer Bogen-Kopf beider Blätter: Wortmarke, eingepasster Titel, Meta-Zeile,
 *  gedrehter Doppelrand-Stempel oben rechts, gestrichelte Trennlinie. Liefert die
 *  Oberkante des Inhaltsbereichs. */
function paintHead(
  ctx: CanvasRenderingContext2D,
  title: string,
  metaLine: string,
  stampText: string,
): number {
  const innerW = PAGE_W - 2 * MARGIN
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  let y = MARGIN + 30
  ctx.fillStyle = DIM
  ctx.font = `30px ${TYPE}`
  ctx.fillText('M U R D O K U', PAGE_W / 2, y)
  y += 78
  let titleSize = 84
  ctx.font = `700 ${titleSize}px ${DISPLAY}`
  while (titleSize > 40 && ctx.measureText(title).width > innerW * 0.66) {
    titleSize -= 4
    ctx.font = `700 ${titleSize}px ${DISPLAY}`
  }
  ctx.fillStyle = INK
  ctx.fillText(title, PAGE_W / 2, y)
  y += 52
  ctx.fillStyle = DIM
  ctx.font = `34px ${TYPE}`
  ctx.fillText(metaLine, PAGE_W / 2, y)

  const stamp = stampText.toUpperCase()
  ctx.save()
  ctx.translate(PAGE_W - MARGIN - 200, MARGIN + 70)
  ctx.rotate((5 * Math.PI) / 180)
  ctx.globalAlpha = 0.75
  ctx.font = `34px ${TYPE}`
  const stampW = ctx.measureText(stamp).width + 64
  ctx.strokeStyle = CRIMSON
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(-stampW / 2, -40, stampW, 80, 14)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(-stampW / 2 + 9, -31, stampW - 18, 62, 9)
  ctx.stroke()
  ctx.fillStyle = CRIMSON
  ctx.textBaseline = 'middle'
  ctx.fillText(stamp, 0, 2)
  ctx.restore()

  y += 34
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.setLineDash([10, 12])
  ctx.beginPath()
  ctx.moveTo(MARGIN, y)
  ctx.lineTo(PAGE_W - MARGIN, y)
  ctx.stroke()
  ctx.setLineDash([])
  return y + 36
}

export type TraitKey = 'beard' | 'glasses' | 'bald'

/** Merkmal-Icons der Karten — 1:1 die Pfade aus AttrIcons.tsx (dort pflegen und
 *  hier spiegeln: der Canvas braucht sie als Image statt JSX). */
export const TRAIT_SVGS: Record<TraitKey, string> = {
  beard:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M6 8 Q12 5.4 18 8 Q15 10.4 12 9.5 Q9 10.4 6 8 Z" fill="#7a4a28"/>' +
    '<path d="M5 8.5 Q5 19 12 22.5 Q19 19 19 8.5 Q16.5 14 13 13.4 L12 15 L11 13.4 Q7.5 14 5 8.5 Z" fill="#7a4a28"/>' +
    '</svg>',
  glasses:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<g fill="none" stroke="#2a2420" stroke-width="1.8" stroke-linejoin="round">' +
    '<rect x="2.5" y="9" width="8" height="6.2" rx="2.6"/>' +
    '<rect x="13.5" y="9" width="8" height="6.2" rx="2.6"/>' +
    '<path d="M10.5 11.5 H13.5"/>' +
    '<path d="M2.5 10.5 L1 10" stroke-linecap="round"/>' +
    '<path d="M21.5 10.5 L23 10" stroke-linecap="round"/>' +
    '</g></svg>',
  bald:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<ellipse cx="4.8" cy="13.6" rx="1.7" ry="2.1" fill="#f0c6a0" stroke="#a8744a" stroke-width="0.8"/>' +
    '<ellipse cx="19.2" cy="13.6" rx="1.7" ry="2.1" fill="#f0c6a0" stroke="#a8744a" stroke-width="0.8"/>' +
    '<path d="M5.8 12.5 Q5.8 3.2 12 3.2 Q18.2 3.2 18.2 12.5 Q18.2 20.5 12 21.5 Q5.8 20.5 5.8 12.5 Z" fill="#f0c6a0" stroke="#a8744a" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M8.4 7.2 Q11 4.9 15.2 6.8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="0.85"/>' +
    '<circle cx="9.6" cy="13.2" r="1.05" fill="#2a2420"/>' +
    '<circle cx="14.4" cy="13.2" r="1.05" fill="#2a2420"/>' +
    '<path d="M9.7 16.6 Q12 18.4 14.3 16.6" fill="none" stroke="#2a2420" stroke-width="1" stroke-linecap="round"/>' +
    '</svg>',
}

/** Die Geschlechts-Tönung der Dossier-Karten — exakt die Spiel-Farbverläufe
 *  (.mk-clue[data-gender] in index.css). */
export const GENDER_TINT: Record<'m' | 'f', [string, string]> = {
  f: ['#f0dade', '#e6c6cd'],
  m: ['#d9e2ee', '#c6d4e4'],
}

export interface PersonCard {
  name: string
  text: string
  accent: string
  /** Avatarbild — fehlt beim Opfer (das bekommt die ☠-Marke wie im Spiel). */
  img?: HTMLImageElement
  gender?: 'm' | 'f'
  /** Sichtbare Merkmale für die Chip-Zeile hinter dem Namen (wie AttrIcons). */
  traits?: TraitKey[]
  /** Ausprägungs-Chips als TEXT („Blond") — nur gesetzt, wenn ein Hinweis des
   *  Levels die Merkmals-Art nennt (`valueTraitLabels`); fehlt = kein Chip. */
  valueTraits?: string[]
}

/** Ein Chip der Namenszeile mit fertiger Breite (bei gegebenem Schrumpf-Faktor). */
interface CardChip {
  kind: 'gender' | 'trait' | 'value'
  pw: number
  trait?: TraitKey
  text?: string
}

/** Alle Chips einer Karte beim Schrumpf-Faktor `scale` vermessen. */
function measureChips(
  ctx: CanvasRenderingContext2D,
  card: PersonCard,
  fontSize: number,
  scale: number,
): { chips: CardChip[]; total: number; chipH: number; gap: number } {
  const chipH = Math.round(fontSize * 1.08 * scale)
  const gap = Math.max(4, Math.round(8 * scale))
  const chips: CardChip[] = []
  if (card.gender) {
    const text = card.gender === 'm' ? '♂' : '♀'
    ctx.font = `${Math.round(fontSize * 0.8 * scale)}px ${TYPE}`
    chips.push({ kind: 'gender', text, pw: ctx.measureText(text).width + chipH * 0.7 })
  }
  for (const trait of card.traits ?? []) chips.push({ kind: 'trait', trait, pw: chipH * 1.35 })
  for (const text of card.valueTraits ?? []) {
    ctx.font = `${Math.round(fontSize * 0.72 * scale)}px ${TYPE}`
    chips.push({ kind: 'value', text, pw: ctx.measureText(text).width + chipH * 0.8 })
  }
  const total = chips.reduce((sum, c) => sum + c.pw, 0) + Math.max(0, chips.length - 1) * gap
  return { chips, total, chipH, gap }
}

/** Unter diesen Faktor dürfen die Chips nicht schrumpfen — die Fit-Schleifen
 *  verwerfen solche Schriftgrade und probieren den nächstkleineren. */
export const MIN_CHIP_SCALE = 0.7

/** Der Schrumpf-Faktor, mit dem die Chip-Zeile hinter dem Namen in EINE Zeile
 *  passt (1 = volle Größe; KEIN Umbruch — Dirks Vorgabe, 18.08.2026). Bogen- und
 *  Buch-Fit prüfen damit jede Karte, drawPersonCard rechnet identisch. */
export function chipRowScale(
  ctx: CanvasRenderingContext2D,
  card: PersonCard,
  w: number,
  o: { fontSize: number; pad: number; avatar: number },
): number {
  ctx.font = `700 ${Math.round(o.fontSize * 1.15)}px ${DISPLAY}`
  const nameW = ctx.measureText(card.name).width
  const avail = w - o.pad - (o.pad + 4 + o.avatar + 16) - nameW - 14
  let s = 1
  let m = measureChips(ctx, card, o.fontSize, s)
  for (let i = 0; i < 2 && m.total > avail; i++) {
    s = Math.max(0.4, (avail / m.total) * s * 0.99)
    m = measureChips(ctx, card, o.fontSize, s)
  }
  return m.total <= avail ? s : 0.39
}

/** Eine Dossier-Karte: Rahmen KOMPLETT in der Spielfarbe der Person (Dirks Wahl
 *  18.08.2026 — ersetzt Hairline + Farb-Falz links; so unterscheiden sich die
 *  Karten auf einen Blick), Geschlechts-Hauch, Avatar bzw. ☠-Marke des Opfers,
 *  Name + Merkmal-Chips, Hinweistext — geteilt zwischen A4-Druckbogen und
 *  Buch-Skript (scripts/make-book.ts). Inhalt IMMER oben verankert — vertikales
 *  Zentrieren in gestreckten Karten wurde probiert und verworfen (mal mittig,
 *  mal oben wirkt unruhig). */
export function drawPersonCard(
  ctx: CanvasRenderingContext2D,
  card: PersonCard,
  x: number,
  cy: number,
  w: number,
  h: number,
  o: { fontSize: number; pad: number; avatar: number; lineH: number; traitImgs: Map<TraitKey, HTMLImageElement> },
): void {
  const { fontSize, pad, avatar, lineH, traitImgs } = o
  // Kasten: Hairline + Spielfarben-Falz links; alle Personen (auch das Opfer)
  // tragen die Geschlechts-Tönung des Spiels (rosé/blau) — auf Papier nur als
  // HAUCH über der hellen Karte (α 0.35, Dirks Feedback: voll deckend lenkt
  // vom Text ab).
  ctx.fillStyle = CARD_BG
  ctx.beginPath()
  ctx.roundRect(x, cy, w, h, 10)
  ctx.fill()
  if (card.gender) {
    const tint = ctx.createLinearGradient(x, cy, x, cy + h)
    tint.addColorStop(0, GENDER_TINT[card.gender][0])
    tint.addColorStop(1, GENDER_TINT[card.gender][1])
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = tint
    ctx.fill()
    ctx.restore()
  }
  ctx.strokeStyle = card.accent
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.roundRect(x, cy, w, h, 10)
  ctx.stroke()
  // Avatar (Spiel-SVG) oder ☠-Marke des Opfers.
  const ax = x + pad + 4
  const ay = cy + pad
  if (card.img) {
    ctx.drawImage(card.img, ax, ay, avatar, avatar)
  } else {
    ctx.fillStyle = CRIMSON
    ctx.beginPath()
    ctx.arc(ax + avatar / 2, ay + avatar / 2, avatar / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.round(avatar * 0.52)}px ${DISPLAY}`
    ctx.fillText('☠', ax + avatar / 2, ay + avatar / 2 + avatar * 0.03)
  }
  // Name + Merkmal-Chips (♂/♀, Bart, Brille, Glatze, Wert-Texte — wie AttrIcons).
  // Die Zeile bleibt IMMER einzeilig (Dirks Vorgabe, 18.08.2026): passt sie nicht,
  // schrumpfen die CHIPS (nie der Name), und die Fit-Schleifen haben Schriftgrade
  // mit Faktor < MIN_CHIP_SCALE vorher verworfen — ein Chip ragt NIE über den Rand.
  const tx = ax + avatar + 16
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = INK
  ctx.font = `700 ${Math.round(fontSize * 1.15)}px ${DISPLAY}`
  const nameBase = cy + pad + Math.round(fontSize * 1.05)
  ctx.fillText(card.name, tx, nameBase)
  const nameW = ctx.measureText(card.name).width
  const availChips = x + w - pad - (tx + nameW + 14)
  let s = 1
  let m = measureChips(ctx, card, fontSize, s)
  for (let i = 0; i < 2 && m.total > availChips; i++) {
    s = Math.max(0.4, (availChips / m.total) * s * 0.99)
    m = measureChips(ctx, card, fontSize, s)
  }
  const { chips, chipH, gap } = m
  const chipTop = Math.round(nameBase - fontSize * 0.4 - chipH / 2)
  let chipX = tx + nameW + 14
  for (const chip of chips) {
    if (chipX + chip.pw > x + w - pad + 0.5) break // Notbremse: nie über den Rand
    ctx.fillStyle = 'rgba(42, 35, 23, 0.1)'
    ctx.strokeStyle = 'rgba(42, 35, 23, 0.22)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(chipX, chipTop, chip.pw, chipH, chipH / 2)
    ctx.fill()
    ctx.stroke()
    if (chip.kind === 'trait') {
      const icon = chipH * 0.74
      ctx.drawImage(traitImgs.get(chip.trait!)!, chipX + (chip.pw - icon) / 2, chipTop + (chipH - icon) / 2, icon, icon)
    } else {
      ctx.fillStyle = INK
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font =
        chip.kind === 'gender'
          ? `${Math.round(fontSize * 0.8 * s)}px ${TYPE}`
          : `${Math.round(fontSize * 0.72 * s)}px ${TYPE}`
      ctx.fillText(chip.text!, chipX + chip.pw / 2, chipTop + chipH * (chip.kind === 'gender' ? 0.56 : 0.58))
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }
    chipX += chip.pw + gap
  }
  ctx.fillStyle = TEXT
  ctx.font = `${fontSize}px ${TYPE}`
  wrapText(ctx, card.text, w - pad * 2 - avatar - 16).forEach((line, li) => {
    ctx.fillText(line, tx, cy + pad + Math.round(fontSize * 1.35) + 8 + (li + 1) * lineH - 6)
  })
}

/** Kompakter Bogen-Kopf NUR über der linken Spalte: eingepasster Titel, Meta-Zeile,
 *  kleiner gedrehter Doppelrand-Stempel rechts, gestrichelte Trennlinie. Liefert
 *  die Oberkante des Karten-Bereichs. (Blatt 2 behält den breiten `paintHead` —
 *  dort gibt es keine volle rechte Spalte zu schützen.) */
function paintSheetHead(
  ctx: CanvasRenderingContext2D,
  title: string,
  metaLine: string,
  stampText: string,
  x: number,
  w: number,
): number {
  const stamp = stampText.toUpperCase()
  ctx.font = `28px ${TYPE}`
  const stampW = ctx.measureText(stamp).width + 56
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let titleSize = 64
  ctx.font = `700 ${titleSize}px ${DISPLAY}`
  while (titleSize > 36 && ctx.measureText(title).width > w - stampW - 60) {
    titleSize -= 4
    ctx.font = `700 ${titleSize}px ${DISPLAY}`
  }
  const titleBase = MARGIN + 56
  ctx.fillStyle = INK
  ctx.fillText(title, x, titleBase)
  ctx.fillStyle = DIM
  ctx.font = `28px ${TYPE}`
  ctx.fillText(metaLine, x, titleBase + 44)

  ctx.save()
  ctx.translate(x + w - stampW / 2 - 8, MARGIN + 44)
  ctx.rotate((4 * Math.PI) / 180)
  ctx.globalAlpha = 0.75
  ctx.strokeStyle = CRIMSON
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.roundRect(-stampW / 2, -34, stampW, 68, 12)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(-stampW / 2 + 8, -26, stampW - 16, 52, 8)
  ctx.stroke()
  ctx.fillStyle = CRIMSON
  ctx.font = `28px ${TYPE}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(stamp, 0, 2)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const divY = titleBase + 70
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.setLineDash([10, 12])
  ctx.beginPath()
  ctx.moveTo(x, divY)
  ctx.lineTo(x + w, divY)
  ctx.stroke()
  ctx.setLineDash([])
  return divY + 34
}

/** Baut den fertigen Druckbogen als Canvas (300 dpi, A4 quer). Exportiert für
 *  headless Werkzeuge (Vorschau-/Probe-Renderings, Muster wie make-book.ts). */
export async function renderSheet(
  json: LevelJson,
  i18nInst: I18n,
  title: string,
  opts: { legend?: boolean } = {},
): Promise<HTMLCanvasElement> {
  const t = (key: string, params?: Record<string, unknown>): string => i18nInst.t(key, params) as string
  const lang = i18nInst.resolvedLanguage ?? i18nInst.language
  const puzzle = loadLevel(json)
  const renderer = new Renderer(i18nInst.getResourceBundle(lang, 'translation'), puzzle)

  // Beides muss fertig sein, bevor Pixel entstehen: Spiel-Schriften + Board-Art.
  await document.fonts.ready
  await new Promise<void>((resolve) => onArtReady(resolve))

  // Personen-Karten: Verdächtige in Spielreihenfolge, das Opfer als letzte Karte
  // (wie im CluePanel). Avatare über die unveränderte Spiel-Zeichnung; genannte
  // Merkmals-Ausprägungen als Text-Chips (das Opfer nie — verdeckter Zufall).
  const traitKinds = referencedTraitKinds(puzzle)
  const cards: PersonCard[] = await Promise.all(
    puzzle.suspects.map(async (s, i) => ({
      name: s.name,
      text: clueLine(renderer, s.clues, s.id),
      accent: suspectColor(i),
      img: await loadImage(avatarDataUri(s.attributes, suspectColor(i), s.id)),
      gender: s.attributes.gender === 'm' ? ('m' as const) : s.attributes.gender === 'f' ? ('f' as const) : undefined,
      traits: (['beard', 'glasses', 'bald'] as const).filter((k) => s.attributes[k] === true),
      valueTraits: valueTraitLabels(s.attributes, traitKinds, t),
    })),
  )
  const victimGender: 'm' | 'f' = puzzle.victim.attributes.gender === 'f' ? 'f' : 'm'
  cards.push({
    name: puzzle.victim.name,
    text: `${t('game.victim')} — ${t('game.victimStatement')}`,
    accent: CRIMSON,
    gender: victimGender,
  })
  // Die Merkmal-Icons (Bart/Brille/Glatze) einmal als Images vorbereiten.
  const traitImgs = new Map<TraitKey, HTMLImageElement>()
  await Promise.all(
    (['beard', 'glasses', 'bald'] as const).map(async (k) => {
      traitImgs.set(k, await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(TRAIT_SVGS[k])}`))
    }),
  )

  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  const innerW = PAGE_W - 2 * MARGIN

  // ------- Rechte Spalte: VOLLE Seitenhöhe — Brett · Skizzen-Zettel · Mörder-Zettel
  // Kopf und Fuß gehören nur der linken Spalte (Dirk, 18.08.2026): das Brett und
  // die Skizze sind der Fokus des Bogens. Brett- und Skizzenzelle teilen sich die
  // Höhe über EINE Formel (Skizze ≈70 % der Brettzelle — Lösefläche, beschreibbar).
  const W = puzzle.board.width
  const H = puzzle.board.height
  const rightW = Math.round(innerW * 0.52)
  const rightX = PAGE_W - MARGIN - rightW
  const GAP = 48
  const SKETCH_RATIO = 0.7
  const SLIP_H = 260
  const SLIP_GAP = 56
  const availH0 = PAGE_H - 2 * MARGIN - GAP
  const cellEst = Math.floor(Math.min(availH0 / (H * (1 + SKETCH_RATIO)), rightW / W))
  const labels = boardLabelReserve(cellEst)
  const slipReserve = sketchSlipReserve(Math.round(cellEst * SKETCH_RATIO))
  const cell = Math.floor(
    Math.min((availH0 - labels - 2 * slipReserve) / (H * (1 + SKETCH_RATIO)), (rightW - labels) / W),
  )
  const sketchCell = Math.round(cell * SKETCH_RATIO)
  const bw = cell * W
  const bh = cell * H
  const boardX = rightX + labels + Math.round((rightW - labels - bw) / 2)
  const boardY = MARGIN + labels
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
  drawBoardLabels(ctx, W, H, boardX, boardY, cell)

  // Skizzen-Zettel + Mörder-Zettel nebeneinander, als Gruppe zentriert; der
  // Mörder-Zettel sitzt unten bündig mit der Skizze (wie im Murdle-Buch).
  const sketchW = sketchCell * W
  const sketchH = sketchCell * H
  const slipPad = sketchSlipPad(sketchCell)
  const slipW = Math.min(660, rightW - 2 * slipPad - sketchW - SLIP_GAP)
  const groupW = 2 * slipPad + sketchW + SLIP_GAP + slipW
  const sketchX = rightX + slipPad + Math.max(0, Math.round((rightW - groupW) / 2))
  const sketchY = boardY + bh + GAP + slipReserve
  drawSketchSlip(ctx, puzzle, sketchX, sketchY, sketchCell)
  const slipCx = sketchX + sketchW + slipPad + SLIP_GAP + slipW / 2
  const slipTop = sketchY + sketchH - SLIP_H - 30
  drawMurderSlip(ctx, t('game.pdfMurderer'), slipCx, slipTop + SLIP_H / 2, slipW, SLIP_H)
  // Kompass im freien Raum ÜBER dem Zettel — „südlich von …" braucht ein Nord.
  const compassR = Math.min(84, Math.floor((slipTop - sketchY) / 2) - 46)
  if (compassR >= 30) drawCompass(ctx, t, slipCx, sketchY + (slipTop - sketchY) / 2, compassR)

  // ------------------------- Linke Spalte: Kopf + Fuß -------------------------
  const paneX = MARGIN
  const paneW = rightX - 56 - paneX
  const diff = t(`difficulty.${json.difficulty ?? 'medium'}`)
  const author = (json.author ?? '').trim()
  const metaLine = `${W}×${H} · ${diff}${author ? ` · ${t('game.author', { name: author })}` : ''}`
  const contentTop = paintSheetHead(ctx, title, metaLine, t('game.pdfStamp'), paneX, paneW)

  // Fuß: die zwei Grundregeln + Absender — nur in der linken Spalte.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `26px ${TYPE}`
  const ruleLines = [
    ...wrapText(ctx, `① ${t('rule.oneEachLine')}`, paneW),
    ...wrapText(ctx, `② ${t('rule.aloneWithVictim')}`, paneW),
  ]
  const footLineH = 34
  const footTop = PAGE_H - MARGIN - ruleLines.length * footLineH - 30
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.setLineDash([10, 12])
  ctx.beginPath()
  ctx.moveTo(paneX, footTop - 20)
  ctx.lineTo(paneX + paneW, footTop - 20)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = DIM
  ruleLines.forEach((line, i) => ctx.fillText(line, paneX, footTop + 20 + i * footLineH))
  ctx.textAlign = 'right'
  ctx.fillText('murdoku · apo-games.de', paneX + paneW, PAGE_H - MARGIN)
  ctx.textAlign = 'left'

  // Objekt-Legende als Streifen direkt über dem Fuß — nur auf Wunsch (Checkbox
  // im PdfDialog, Standard AUS). Die Akten-Notizen unten bleiben davon unberührt.
  let legendTop = footTop - 20
  if (opts.legend) {
    const items = legendItems(puzzle, t)
    const lh = paintLegendStrip(ctx, items, t, paneX, 0, paneW, false)
    legendTop = footTop - 20 - 24 - lh
    paintLegendStrip(ctx, items, t, paneX, legendTop, paneW, true)
  }
  const contentBottom = legendTop - 28
  const contentH = contentBottom - contentTop - 30

  // ------------------------------- Verdächtige -------------------------------
  const cols = cards.length > 6 ? 2 : 1
  const notes = boardNotes(puzzle, renderer, t)

  // Die LESEgröße ist gedeckelt (Schleifen-Start = Deckel): riesige Schrift wirkt
  // gequetscht, nicht großzügig. EIN Abstand überall — zwischen den Karten UND
  // zwischen den Spalten derselbe Wert, Karten individuell hoch, Inhalt immer
  // oben (Dirks Wahl, 18.08.2026: „einheitlich" — Zeilen-Ausrichtung und
  // Einheitshöhe wurden probiert und verworfen, das Zentrier-Gehopse der Avatare
  // wirkte unruhiger als ungleiche Kanten). Der Block startet OBEN — auch das
  // vertikale Zentrieren flog wieder raus; Rest-Luft bleibt als ruhiger Rand unten.
  interface NoteBox {
    lines: string[]
    h: number
  }
  let fontSize = 42
  let layout: { cardH: number[]; colW: number; gap: number; lineH: number; avatar: number; pad: number; noteBoxes: NoteBox[]; noteH: number } | null = null
  for (; fontSize >= 18; fontSize -= 2) {
    const pad = Math.round(fontSize * 0.7)
    const avatar = Math.round(fontSize * 3.4)
    const lineH = Math.round(fontSize * 1.5)
    const gap = Math.round(fontSize * 0.7)
    const colW = Math.floor((paneW - (cols - 1) * gap) / cols)
    const textW = colW - pad * 2 - avatar - 16
    const cardH = cards.map((card) => {
      ctx.font = `${fontSize}px ${TYPE}`
      const lines = wrapText(ctx, card.text, textW)
      const textH = Math.round(fontSize * 1.35) + 8 + lines.length * lineH
      return Math.max(avatar + pad * 2, textH + pad * 2)
    })
    // Jede Chip-Zeile muss EINZEILIG hinter den Namen passen (Chips schrumpfen
    // höchstens auf MIN_CHIP_SCALE) — sonst den nächstkleineren Schriftgrad.
    const chipsOk = cards.every((card) => chipRowScale(ctx, card, colW, { fontSize, pad, avatar }) >= MIN_CHIP_SCALE)
    // Spaltenweise füllen (erst Spalte 1 voll, dann Spalte 2) — höchste Spalte zählt.
    const rows = Math.ceil(cards.length / cols)
    let maxCol = 0
    for (let c0 = 0; c0 < cols; c0++) {
      const colH = cardH
        .slice(c0 * rows, (c0 + 1) * rows)
        .reduce((sum, h) => sum + h + gap, 0)
      maxCol = Math.max(maxCol, colH)
    }
    // Jede Akten-Notiz als EIGENE Box (wie die mk-boardclue-Kacheln im Spiel) —
    // zusammengeschoben gingen „Wasserflächen …" und „Kein Raum war leer" unter.
    ctx.font = `${fontSize}px ${TYPE}`
    const notePad = Math.round(fontSize * 0.5)
    const lens = Math.round(fontSize * 1.35)
    const noteBoxes: NoteBox[] = notes.map((n) => {
      const lines = wrapText(ctx, n, paneW - notePad * 2 - lens - 14)
      return { lines, h: Math.max(lines.length * lineH, lens) + notePad * 2 }
    })
    const noteH = notes.length > 0 ? noteBoxes.reduce((sum, b) => sum + b.h + 12, 0) + 8 : 0
    if ((maxCol + noteH <= contentH && chipsOk) || fontSize === 18) {
      layout = { cardH, colW, gap, lineH, avatar, pad, noteBoxes, noteH }
      break
    }
  }
  const { cardH, colW, gap, lineH, avatar, pad, noteBoxes } = layout!
  const rows = Math.ceil(cards.length / cols)

  // Überschrift »Verdächtige« als kleine Zeile über den Karten.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = CRIMSON
  ctx.font = `26px ${TYPE}`
  ctx.fillText(t('game.suspects').toUpperCase(), paneX, contentTop + 8)
  const cardsTop = contentTop + 30

  let noteY = cardsTop
  cards.forEach((card, i) => {
    const col = Math.floor(i / rows)
    const inCol = i % rows
    const x = paneX + col * (colW + gap)
    let cy = cardsTop
    for (let k = col * rows; k < i; k++) cy += cardH[k] + gap
    const h = cardH[i]
    drawPersonCard(ctx, card, x, cy, colW, h, { fontSize, pad, avatar, lineH, traitImgs })
    if (inCol === rows - 1 || i === cards.length - 1) {
      noteY = Math.max(noteY, cy + h)
    }
  })

  // Akten-Notizen (Draußen-Legende, Wasser-Regel, globale Hinweise) unter den
  // Karten — jede in ihrer eigenen blau getönten Box mit Lupe, wie im Spiel.
  if (noteBoxes.length > 0) {
    let ny = noteY + gap
    noteBoxes.forEach((box) => {
      drawNoteBox(ctx, box, paneX, ny, paneW, { fontSize, lineH })
      ny += box.h + 12
    })
  }

  return canvas
}

/** Eine Akten-Notiz-Box (blau getönt, mit Tinten-Lupe, Text vertikal zentriert) —
 *  geteilt zwischen A4-Druckbogen und Buch-Skript. `box.h` misst der Aufrufer
 *  vorab (wrapText), damit er den Platz VOR dem Zeichnen einplanen kann. */
export function drawNoteBox(
  ctx: CanvasRenderingContext2D,
  box: { lines: string[]; h: number },
  x: number,
  ny: number,
  w: number,
  o: { fontSize: number; lineH: number },
): void {
  const { fontSize, lineH } = o
  const notePad = Math.round(fontSize * 0.5)
  const lens = Math.round(fontSize * 1.35)
  ctx.fillStyle = 'rgba(120, 150, 210, 0.14)'
  ctx.strokeStyle = 'rgba(95, 122, 175, 0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x, ny, w, box.h, 10)
  ctx.fill()
  ctx.stroke()
  // Die Lupe (Tinten-Zeichnung, kein Emoji): Glas + Griff, mittig zur Box.
  const lx = x + notePad
  const ly = ny + (box.h - lens) / 2
  const r = lens * 0.34
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(2, lens * 0.09)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(lx + r + lens * 0.06, ly + r + lens * 0.06, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(lx + r + lens * 0.06 + r * 0.72, ly + r + lens * 0.06 + r * 0.72)
  ctx.lineTo(lx + lens * 0.96, ly + lens * 0.96)
  ctx.stroke()
  // Text neben der Lupe, vertikal im Kasten zentriert.
  ctx.fillStyle = INK
  ctx.font = `${fontSize}px ${TYPE}`
  ctx.textAlign = 'left'
  const textTop = ny + (box.h - box.lines.length * lineH) / 2
  box.lines.forEach((line, li) => {
    ctx.fillText(line, x + notePad + lens + 14, textTop + fontSize + li * lineH - 2)
  })
}

// ─────────────────────────── Blatt 2: Die Auflösung ───────────────────────────

/** Eine Protokoll-Zeile des Lösungswegs (ein Deduktionsschritt der Engine). */
export interface StepLine {
  text: string
  /** Verdächtigen-Buchstabe bzw. VICTIM_ID — malt den Farb-Chip vor der Zeile. */
  person?: string
  /** Setz-Schritt („X muss auf … stehen") — fett, Feldangabe in Krimson. */
  place: boolean
  /** Die lokalisierte Feldangabe (renderer.cell), fürs Krimson-Highlight. */
  cellText?: string
}

/** Druckreifes Protokoll aus den Engine-Schritten (wie Strg+B, aber für Papier):
 *  Ausgangslage-Zählzeilen (clueCandidates) raus, exakt wiederholte Zeilen nur beim
 *  ersten Mal, der Mörder-Schritt wird zum Verdikt. (Dirks Regeln für den Bogen;
 *  geteilt zwischen A4-Auflösungsblatt und den Buch-Lösungsseiten.) */
export function buildStepLines(
  engineSteps: readonly DeductionStep[],
  renderer: Renderer,
): { steps: StepLine[]; verdictText: string } {
  const steps: StepLine[] = []
  const seen = new Set<string>()
  let verdictText = ''
  for (const step of engineSteps) {
    if (step.technique === 'murderer') {
      verdictText = polish(renderer.render(step.explanation))
      continue
    }
    if (step.technique === 'clueCandidates' || step.technique === 'stuck') continue
    const raw = renderer.render(step.explanation)
    if (raw.trim() === '' || seen.has(raw)) continue
    seen.add(raw)
    steps.push({
      text: polish(raw),
      person: step.personId,
      place: step.placedCell !== undefined,
      cellText: step.placedCell !== undefined ? renderer.cell(step.placedCell) : undefined,
    })
  }
  return { steps, verdictText }
}

/** Chip-Farbe/-Buchstabe: Verdächtige in Spielfarbe, das Opfer als ☠ in Krimson. */
export function chipStyle(
  person: string,
  suspectIndex: Map<string, number>,
): { color: string; label: string } {
  if (person === VICTIM_ID) return { color: CRIMSON, label: '☠' }
  return { color: suspectColor(suspectIndex.get(person) ?? 0), label: person }
}

/**
 * Das nummerierte Protokoll in `cols` Spalten setzen ODER nur messen (draw=false):
 * spaltenweise gefüllt, Setz-Schritte fett mit Personen-Chip, das Verdikt als
 * Krimson-Kasten am Ende. Liefert false, wenn es NICHT in die Höhe passt — die
 * Einpass-Schleife des Aufrufers verkleinert dann (und nur dann) die Schrift.
 */
export function paintSteps(
  ctx: CanvasRenderingContext2D,
  steps: StepLine[],
  verdict: { text: string; person?: string },
  suspectIndex: Map<string, number>,
  o: { x: number; w: number; top: number; bottom: number; font: number; cols: number },
  draw: boolean,
): boolean {
  const COLGAP = 44
  const colW = Math.floor((o.w - (o.cols - 1) * COLGAP) / o.cols)
  const lineH = Math.round(o.font * 1.4)
  const stepGap = Math.round(o.font * 0.55)
  const chip = Math.round(o.font * 1.15)
  const numFont = `${Math.round(o.font * 0.78)}px ${TYPE}`
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = numFont
  const numW = Math.ceil(ctx.measureText('00').width) + 10

  const drawChip = (person: string, cx: number, cy: number): void => {
    const { color, label } = chipStyle(person, suspectIndex)
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, chip / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(20, 18, 26, 0.35)'
    ctx.lineWidth = Math.max(1.5, o.font * 0.06)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(chip * 0.62)}px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx, cy + chip * 0.04)
    ctx.restore()
  }

  let col = 0
  let y = o.top
  const colX = (): number => o.x + col * (colW + COLGAP)
  // Platz reservieren, in den ein Block der Höhe h noch passen muss — sonst
  // Spaltenwechsel; sind die Spalten aufgebraucht, passt das Layout nicht.
  const fit = (h: number): boolean => {
    if (y + h <= o.bottom || y === o.top) return true
    col++
    y = o.top
    return col < o.cols
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const font = s.place ? `700 ${o.font}px ${TYPE}` : `${o.font}px ${TYPE}`
    const textX = numW + (s.person ? chip + 10 : 0)
    ctx.font = font
    const lines = wrapText(ctx, s.text, colW - textX)
    const stepH = lines.length * lineH
    if (!fit(stepH + stepGap)) {
      ctx.restore()
      return false
    }
    if (draw) {
      const x0 = colX()
      ctx.fillStyle = DIM
      ctx.font = numFont
      ctx.fillText(String(i + 1).padStart(2, '0'), x0, y + o.font)
      if (s.person) drawChip(s.person, x0 + numW + chip / 2, y + o.font * 0.62)
      ctx.font = font
      lines.forEach((line, li) => {
        // Wortweise, damit die Feldangabe eines Setz-Schritts Krimson trägt.
        let wx = x0 + textX
        const ly = y + o.font + li * lineH
        for (const word of line.split(' ')) {
          ctx.fillStyle =
            s.cellText && word.includes(s.cellText) ? CRIMSON : s.place ? INK : TEXT
          ctx.fillText(word, wx, ly)
          wx += ctx.measureText(`${word} `).width
        }
      })
    }
    y += stepH + stepGap
  }

  // Verdikt-Kasten: der Mörder-Schritt der Engine, gerahmt wie ein Stempelfeld.
  const pad = Math.round(o.font * 0.6)
  ctx.font = `700 ${o.font}px ${TYPE}`
  const vTextX = pad + (verdict.person ? chip + 12 : 0)
  const vLines = wrapText(ctx, verdict.text, colW - vTextX - pad)
  const boxH = pad * 2 + vLines.length * lineH
  if (!fit(boxH + 8)) {
    ctx.restore()
    return false
  }
  if (draw) {
    const x0 = colX()
    y += 8
    ctx.fillStyle = 'rgba(178, 58, 49, 0.07)'
    ctx.strokeStyle = CRIMSON
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.roundRect(x0, y, colW, boxH, 12)
    ctx.fill()
    ctx.stroke()
    if (verdict.person) drawChip(verdict.person, x0 + pad + chip / 2, y + pad + o.font * 0.62)
    ctx.fillStyle = CRIMSON
    ctx.font = `700 ${o.font}px ${TYPE}`
    vLines.forEach((line, li) => {
      ctx.fillText(line, x0 + vTextX, y + pad + o.font + li * lineH)
    })
    // Gestrichelte Trennlinien zwischen den benutzten Spalten (wie der Bogen-Kopf).
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2
    ctx.setLineDash([10, 12])
    for (let b = 1; b <= col; b++) {
      const bx = o.x + b * (colW + COLGAP) - COLGAP / 2
      ctx.beginPath()
      ctx.moveTo(bx, o.top - 6)
      ctx.lineTo(bx, o.bottom)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }
  ctx.restore()
  return true
}

/** Die Mörder-Karte unter dem Brett — der Sieg-Dialog des Spiels in Papierform:
 *  der echte Avatar-Kopf (mit Buchstaben-Plakette) neben dem »Der Mörder war …«-Satz,
 *  dazu der gedrehte Schuldspruch-Stempel. */
export function drawMurderCard(
  ctx: CanvasRenderingContext2D,
  o: { x: number; y: number; w: number; h: number; img: HTMLImageElement; sentence: string; stamp: string },
): void {
  ctx.save()
  ctx.fillStyle = CARD_BG
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(o.x, o.y, o.w, o.h, 12)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = CRIMSON
  ctx.beginPath()
  ctx.roundRect(o.x, o.y, 9, o.h, [12, 0, 0, 12])
  ctx.fill()

  const pad = 28
  const A = o.h - 2 * pad
  ctx.drawImage(o.img, o.x + pad + 8, o.y + pad, A, A)

  // Stempel oben rechts — seine Breite bleibt dem Satz durchgehend reserviert,
  // damit sich Text und Stempel nie überlappen (Papier-Regel: nichts kollidiert).
  const stamp = o.stamp.toUpperCase()
  ctx.font = `26px ${TYPE}`
  const stampW = ctx.measureText(stamp).width + 44
  ctx.save()
  ctx.translate(o.x + o.w - stampW / 2 - 26, o.y + 48)
  ctx.rotate((-8 * Math.PI) / 180)
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = CRIMSON
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(-stampW / 2, -30, stampW, 60, 10)
  ctx.stroke()
  ctx.fillStyle = CRIMSON
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(stamp, 0, 2)
  ctx.restore()

  const tx = o.x + pad + 8 + A + 24
  const textW = o.w - (tx - o.x) - pad - stampW - 20
  ctx.font = `30px ${TYPE}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const lines = wrapText(ctx, o.sentence, Math.max(textW, o.w * 0.3))
  const lineH = 42
  let ty = o.y + (o.h - lines.length * lineH) / 2 + 30
  ctx.fillStyle = CRIMSON
  for (const line of lines) {
    ctx.fillText(line, tx, ty)
    ty += lineH
  }
  ctx.restore()
}

/**
 * Blatt 2 — die Auflösung: links das nummerierte Ermittlungsprotokoll (die
 * Deduktionsschritte der Engine wie in Strg+B, ohne Ausgangslage-Zeilen und ohne
 * Wiederholungen), rechts das komplett gelöste Brett über das echte drawBoard —
 * alle Figuren als Spiel-Avatare, jedes übrige begehbare Feld ausgekreuzt, der
 * Mörder im Krimson-Ring (exakt die Auflösung im Spiel). `null`, wenn das Level
 * keinen reinen Vorwärts-Lösungsweg hat (der Dialog sperrt die Option vorher).
 */
async function renderSolutionSheet(
  json: LevelJson,
  i18nInst: I18n,
  title: string,
): Promise<HTMLCanvasElement | null> {
  const t = (key: string, params?: Record<string, unknown>): string => i18nInst.t(key, params) as string
  const lang = i18nInst.resolvedLanguage ?? i18nInst.language
  const puzzle = loadLevel(json)
  const renderer = new Renderer(i18nInst.getResourceBundle(lang, 'translation'), puzzle)
  const result = new DeductionEngine(puzzle).solve()
  if (!result.solved || !result.solution) return null
  const solution = result.solution

  await document.fonts.ready
  await new Promise<void>((resolve) => onArtReady(resolve))

  const suspectIndex = new Map(puzzle.suspects.map((s, i) => [s.id, i] as const))
  const avatars = new Map<string, HTMLImageElement>()
  await Promise.all(
    puzzle.suspects.map(async (s, i) => {
      avatars.set(s.id, await loadImage(avatarDataUri(s.attributes, suspectColor(i), s.id)))
    }),
  )

  const { steps, verdictText } = buildStepLines(result.steps, renderer)

  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  const innerW = PAGE_W - 2 * MARGIN

  // Kopf wie Blatt 1 — nur Titel-Schema und Stempel wechseln.
  const diff = t(`difficulty.${json.difficulty ?? 'medium'}`)
  const metaLine = `${puzzle.board.width}×${puzzle.board.height} · ${diff} · ${t('game.pdfSheet2')}`
  const contentTop = paintHead(ctx, t('game.pdfSolutionTitle', { title }), metaLine, t('game.pdfStampSolved'))

  // Fuß: statt der Grundregeln die Vertraulich-Zeile (links) + Absender (rechts).
  const footRuleY = PAGE_H - MARGIN - 58
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.setLineDash([10, 12])
  ctx.beginPath()
  ctx.moveTo(MARGIN, footRuleY)
  ctx.lineTo(PAGE_W - MARGIN, footRuleY)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `27px ${TYPE}`
  ctx.fillStyle = CRIMSON
  ctx.fillText(t('game.pdfConfidential'), MARGIN, PAGE_H - MARGIN)
  ctx.fillStyle = DIM
  ctx.textAlign = 'right'
  ctx.fillText('murdoku · apo-games.de', PAGE_W - MARGIN, PAGE_H - MARGIN)
  const contentBottom = footRuleY - 40
  const contentH = contentBottom - contentTop

  // ---- Rechte Spalte: das gelöste Brett + die Mörder-Karte darunter ----
  const W = puzzle.board.width
  const H = puzzle.board.height
  const rightW = Math.round(innerW * 0.42)
  const rightX = PAGE_W - MARGIN - rightW
  const LABEL_H = 38
  const CARD_GAP = 44
  const CARD_H = 230
  const labels = boardLabelReserve(Math.floor(rightW / Math.max(W, H)))
  let cell = Math.floor((rightW - labels) / Math.max(W, H))
  while (cell > 40 && LABEL_H + labels + cell * H + CARD_GAP + CARD_H > contentH) cell--
  const bw = cell * W
  const bh = cell * H
  const boardX = rightX + labels + Math.round((rightW - labels - bw) / 2)
  const boardY = contentTop + LABEL_H + labels

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = CRIMSON
  ctx.font = `26px ${TYPE}`
  ctx.fillText(t('game.pdfSolutionBoard').toUpperCase(), boardX, contentTop + 8)

  // Kreuz auf jedem begehbaren Feld ohne Person — der Zustand nach dem Lösen.
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
  drawBoardLabels(ctx, W, H, boardX, boardY, cell)

  if (m.suspectId) {
    const room = puzzle.board.rooms.get(m.roomId)
    drawMurderCard(ctx, {
      x: boardX,
      y: boardY + bh + CARD_GAP,
      w: bw,
      h: CARD_H,
      img: avatars.get(m.suspectId)!,
      sentence: t('result.winMurderer', {
        name: puzzle.nameOf(m.suspectId),
        room: room ? t(room.nameKey) : m.roomId,
      }),
      stamp: t('game.pdfConvicted'),
    })
  }

  // ---- Linke Spalte: der Lösungsweg ----
  const paneX = MARGIN
  const paneW = rightX - 44 - paneX
  ctx.textAlign = 'left'
  ctx.fillStyle = CRIMSON
  ctx.font = `26px ${TYPE}`
  ctx.fillText(t('game.pdfSolutionPath').toUpperCase(), paneX, contentTop + 8)

  // Grundgröße wie Blatt 1; verkleinert wird NUR, wenn der Weg sonst nicht passt
  // (erst Schriftgrad, dann dritte Spalte — nie in den Fuß laufen).
  const verdict = { text: verdictText, person: m.suspectId ?? undefined }
  const area = { x: paneX, w: paneW, top: contentTop + LABEL_H, bottom: contentBottom }
  let chosen: { font: number; cols: number } | null = null
  for (let font = 30; font >= 18 && !chosen; font -= 2) {
    for (const cols of [2, 3]) {
      if (paintSteps(ctx, steps, verdict, suspectIndex, { ...area, font, cols }, false)) {
        chosen = { font, cols }
        break
      }
    }
  }
  if (!chosen) {
    chosen = { font: 16, cols: paintSteps(ctx, steps, verdict, suspectIndex, { ...area, font: 16, cols: 3 }, false) ? 3 : 4 }
  }
  paintSteps(ctx, steps, verdict, suspectIndex, { ...area, ...chosen }, true)

  return canvas
}

/** Gibt es für das Level einen reinen Vorwärts-Lösungsweg (und damit ein Blatt 2)?
 *  Nein z. B. bei „Ausprobieren"-Userleveln — der Export-Dialog sperrt die Option. */
export function hasSolutionSheet(json: LevelJson): boolean {
  try {
    const result = new DeductionEngine(loadLevel(json)).solve()
    return result.solved && result.solution !== null
  } catch {
    return false
  }
}

/** Doppel-rAF: erst nach dem nächsten Paint weitermachen — so ist der
 *  „Wird erstellt …"-Zustand des Dialogs sichtbar, BEVOR der Hauptthread die
 *  300-dpi-Seiten zeichnet, und zwischen den Blättern bleibt die UI ansprechbar. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/** PNG-Encoding + jsPDF im Web Worker — die beiden teuren Schritte (je Seite
 *  ~8,7 Mio. Pixel) blockieren so nie den Hauptthread. Die Seiten wandern als
 *  ImageBitmap (Transfer, keine Kopie) hinein, das fertige PDF als ArrayBuffer
 *  heraus. Wirft, wenn Worker/OffscreenCanvas fehlen oder der Worker stirbt —
 *  der Aufrufer fällt dann auf den Inline-Weg zurück. */
function buildPdfInWorker(pages: HTMLCanvasElement[]): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      reject(new Error('worker unavailable'))
      return
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    const done = (fn: () => void): void => {
      worker.terminate()
      fn()
    }
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { ok: true; pdf: ArrayBuffer } | { ok: false; error: string }
      done(() => (msg.ok ? resolve(msg.pdf) : reject(new Error(msg.error))))
    }
    worker.onerror = (e) => done(() => reject(new Error(e.message || 'pdf worker failed')))
    Promise.all(pages.map((c) => createImageBitmap(c))).then(
      (bitmaps) => worker.postMessage({ pages: bitmaps }, bitmaps),
      (err: unknown) => done(() => reject(err instanceof Error ? err : new Error(String(err)))),
    )
  })
}

/** Inline-Fallback (der alte Weg): jsPDF auf dem Hauptthread — nur wenn der
 *  Worker-Pfad nicht verfügbar ist. Dynamisch wie die Capacitor-Plugins: jsPDF
 *  (~120 KB gzip) gehört nicht ins Start-Bundle eines selten genutzten Features. */
async function buildPdfInline(pages: HTMLCanvasElement[]): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  pages.forEach((canvas, i) => {
    if (i > 0) doc.addPage('a4', 'landscape')
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210)
  })
  return doc.output('arraybuffer')
}

/** Web lädt direkt herunter, Android teilt über das Share-Sheet (dasselbe
 *  Muster wie der JSON-Export). base64 entsteht per FileReader asynchron. */
async function deliverPdf(pdf: ArrayBuffer, filename: string): Promise<void> {
  const blob = new Blob([pdf], { type: 'application/pdf' })
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('read failed'))
      reader.readAsDataURL(blob)
    })
    // Ohne `encoding` schreibt Capacitor base64-Bytes — genau was ein PDF braucht.
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: dataUri.split(',')[1],
      directory: Directory.Cache,
    })
    await Share.share({ title: filename, files: [uri], dialogTitle: filename })
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Baut das PDF und lädt es herunter (Web) bzw. öffnet das Share-Sheet (Android).
 *  `opts.solution` hängt Blatt 2 (die Auflösung) an, `opts.legend` setzt die
 *  Objekt-Legende als Streifen auf Blatt 1 (Standard AUS). Das Zeichnen der Bogen
 *  braucht den DOM (Schriften, Bilder) und bleibt im Hauptthread; alles Teure
 *  danach (PNG-Encoding + jsPDF) läuft im Worker, damit die UI nie einfriert. */
export async function exportLevelPdf(
  json: LevelJson,
  i18nInst: I18n,
  title: string,
  opts: { solution?: boolean; legend?: boolean } = {},
): Promise<void> {
  await nextPaint()
  const pages = [await renderSheet(json, i18nInst, title, { legend: opts.legend })]
  if (opts.solution) {
    await nextPaint()
    const solutionCanvas = await renderSolutionSheet(json, i18nInst, title)
    if (solutionCanvas) pages.push(solutionCanvas)
  }
  await nextPaint()
  let pdf: ArrayBuffer
  try {
    pdf = await buildPdfInWorker(pages)
  } catch {
    pdf = await buildPdfInline(pages)
  }
  const base = title.trim().replace(/[^\w-]+/g, '_') || json.id
  await deliverPdf(pdf, `${base}.pdf`)
}
