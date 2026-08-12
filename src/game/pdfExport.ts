/**
 * Druckbogen-Export: EIN A4-Querformat-PDF pro Level — Titel & Autor oben, die
 * Verdächtigen links (ab 7 Personen zweispaltig), das UNGELÖSTE Brett rechts.
 *
 * Das Brett rendert über das echte `drawBoard` des Spiels (voller Pfad: Bodentexturen,
 * Möbel, weiße Objekt-Karten, Namens-Pillen) — keine nachgebaute Grafik, damit der
 * Bogen immer exakt so aussieht wie das Spiel. Avatare kommen aus `avatarDataUri`,
 * die Objekt-Legende aus `drawObjectIcon` (dieselben Zeichner wie Legende/Editor).
 * Nur der Grund ist Papier statt Nacht: gedeckte Druck-Palette, kaum Flächen.
 *
 * Die Seite entsteht als ein 300-dpi-Canvas und wandert als Bild in jsPDF — so
 * tragen alle Texte die Spiel-Schriften (inkl. kyrillischem Fallback) ohne
 * TTF-Einbettung. Web lädt direkt herunter, Android teilt über das Share-Sheet
 * (dasselbe Muster wie der JSON-Export).
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
  usesInsideOutside,
  type Clue,
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
const PAPER = '#f6f1e4'
const INK = '#2e2936'
const DIM = '#6d6577'
const LINE = '#c9c0ac'
const CRIMSON = '#b23a31'
const TEXT = '#4b4454'
const CARD_BG = 'rgba(255, 255, 255, 0.5)'
/** Board-Pastell hinter den Legenden-Icons — wie ObjectIcon.TILE_BG. */
const TILE_BG = '#e8d8b0'

// Schrift-Stacks aus src/index.css (--font-display / --font-type / --font-ui).
const DISPLAY = "'Fraunces Variable', 'Playfair Display Variable', Georgia, serif"
const TYPE = "'Special Elite', 'PT Mono', 'Courier New', monospace"

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
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
function polish(text: string): string {
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1)
  if (text && !/[.!?]$/.test(text.trimEnd())) text += '.'
  return text
}

/** Klartext eines Verdächtigen-Hinweises — exakt die ClueText-Logik (Pronomen-Form,
 *  ' · ' zwischen Teilen, erster Buchstabe groß, Schlusspunkt nur wenn nötig). */
function clueLine(renderer: Renderer, clues: readonly Clue[], subjectId: string): string {
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
function boardNotes(puzzle: Puzzle, renderer: Renderer, t: (k: string) => string): string[] {
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

/** Legenden-Einträge wie Legend.tsx: begehbar zuerst, dann blockiert, dann Wandstücke. */
function legendItems(
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
function drawLegendTile(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, size: number, occupiable: boolean): void {
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

/** Objekt-Legende zeichnen ODER nur ihre Höhe messen (draw=false) — die Höhe wird
 *  gebraucht, BEVOR Brett- und Skizzengröße eingepasst werden können. */
function paintLegend(
  ctx: CanvasRenderingContext2D,
  items: ReturnType<typeof legendItems>,
  t: (k: string) => string,
  x0: number,
  y0: number,
  width: number,
  draw: boolean,
): number {
  if (items.length === 0) return 0
  const tile = 56
  const rowH = tile + 14
  const font = `26px ${TYPE}`
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let lx = x0
  let rows = 1
  let lastStatus = ''
  for (const it of items) {
    ctx.font = font
    const groupLabel = it.status !== lastStatus ? `${t(`legend.${it.status}`)}: ` : ''
    const groupW = groupLabel ? ctx.measureText(groupLabel).width + 6 : 0
    const nameW = ctx.measureText(it.name).width
    // Jede Gruppe (betretbar / blockiert / an der Wand) beginnt auf ihrer EIGENEN
    // Zeile — sonst verschwimmt die Legende zu einem Band (Dirks Feedback).
    // Innerhalb der Gruppe bricht weiterhin die Breite um.
    if ((groupLabel || lx + groupW + tile + 10 + nameW + 30 > x0 + width) && lx > x0) {
      lx = x0
      rows++
    }
    const ly = y0 + (rows - 1) * rowH
    if (groupLabel) {
      lastStatus = it.status
      if (draw) {
        ctx.fillStyle = DIM
        ctx.fillText(groupLabel, lx, ly + tile / 2)
      }
      lx += groupW
    }
    if (draw) drawLegendTile(ctx, it.type, lx, ly, tile, it.status === 'occupiable')
    lx += tile + 10
    if (draw) {
      ctx.fillStyle = INK
      ctx.font = font
      ctx.fillText(it.name, lx, ly + tile / 2)
    }
    lx += nameW + 30
  }
  ctx.restore()
  return rows * rowH
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
function drawSketch(ctx: CanvasRenderingContext2D, puzzle: Puzzle, x: number, y: number, S: number): void {
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

/** Das »Der Mörder ist …«-Feld zum Selbst-Eintragen: helle Karte mit Schreiblinie. */
function drawMurderField(
  ctx: CanvasRenderingContext2D,
  t: (k: string) => string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 10)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = TEXT
  ctx.font = `30px ${TYPE}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(t('game.pdfMurderer'), x + 26, y + 54)
  ctx.strokeStyle = SKETCH_OUTLINE
  ctx.beginPath()
  ctx.moveTo(x + 26, y + h - 36)
  ctx.lineTo(x + w - 26, y + h - 36)
  ctx.stroke()
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

type TraitKey = 'beard' | 'glasses' | 'bald'

/** Merkmal-Icons der Karten — 1:1 die Pfade aus AttrIcons.tsx (dort pflegen und
 *  hier spiegeln: der Canvas braucht sie als Image statt JSX). */
const TRAIT_SVGS: Record<TraitKey, string> = {
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
const GENDER_TINT: Record<'m' | 'f', [string, string]> = {
  f: ['#f0dade', '#e6c6cd'],
  m: ['#d9e2ee', '#c6d4e4'],
}

interface PersonCard {
  name: string
  text: string
  accent: string
  /** Avatarbild — fehlt beim Opfer (das bekommt die ☠-Marke wie im Spiel). */
  img?: HTMLImageElement
  gender?: 'm' | 'f'
  /** Sichtbare Merkmale für die Chip-Zeile hinter dem Namen (wie AttrIcons). */
  traits?: TraitKey[]
}

/** Baut den fertigen Druckbogen als Canvas (300 dpi, A4 quer). */
async function renderSheet(json: LevelJson, i18nInst: I18n, title: string): Promise<HTMLCanvasElement> {
  const t = (key: string, params?: Record<string, unknown>): string => i18nInst.t(key, params) as string
  const lang = i18nInst.resolvedLanguage ?? i18nInst.language
  const puzzle = loadLevel(json)
  const renderer = new Renderer(i18nInst.getResourceBundle(lang, 'translation'), puzzle)

  // Beides muss fertig sein, bevor Pixel entstehen: Spiel-Schriften + Board-Art.
  await document.fonts.ready
  await new Promise<void>((resolve) => onArtReady(resolve))

  // Personen-Karten: Verdächtige in Spielreihenfolge, das Opfer als letzte Karte
  // (wie im CluePanel). Avatare über die unveränderte Spiel-Zeichnung.
  const cards: PersonCard[] = await Promise.all(
    puzzle.suspects.map(async (s, i) => ({
      name: s.name,
      text: clueLine(renderer, s.clues, s.id),
      accent: suspectColor(i),
      img: await loadImage(avatarDataUri(s.attributes, suspectColor(i), s.id)),
      gender: s.attributes.gender === 'm' ? ('m' as const) : s.attributes.gender === 'f' ? ('f' as const) : undefined,
      traits: (['beard', 'glasses', 'bald'] as const).filter((k) => s.attributes[k] === true),
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

  // ---------------------------------- Kopf ----------------------------------
  const diff = t(`difficulty.${json.difficulty ?? 'medium'}`)
  const author = (json.author ?? '').trim()
  const metaLine = `${puzzle.board.width}×${puzzle.board.height} · ${diff}${author ? ` · ${t('game.author', { name: author })}` : ''}`
  const contentTop = paintHead(ctx, title, metaLine, t('game.pdfStamp'))

  // ---------------------------------- Fuß ----------------------------------
  // Die zwei Grundregeln links, Absender rechts — beides in der Typewriter-Type.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `27px ${TYPE}`
  const ruleMaxW = innerW * 0.72
  const ruleLines = [
    ...wrapText(ctx, `① ${t('rule.oneEachLine')}`, ruleMaxW),
    ...wrapText(ctx, `② ${t('rule.aloneWithVictim')}`, ruleMaxW),
  ]
  const footLineH = 36
  const footTop = PAGE_H - MARGIN - ruleLines.length * footLineH
  ctx.strokeStyle = LINE
  ctx.setLineDash([10, 12])
  ctx.beginPath()
  ctx.moveTo(MARGIN, footTop - 22)
  ctx.lineTo(PAGE_W - MARGIN, footTop - 22)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = DIM
  ruleLines.forEach((line, i) => ctx.fillText(line, MARGIN, footTop + 28 + i * footLineH))
  ctx.textAlign = 'right'
  ctx.fillText('murdoku · apo-games.de', PAGE_W - MARGIN, PAGE_H - MARGIN)
  const contentBottom = footTop - 50
  const contentH = contentBottom - contentTop

  // ----------- Rechte Spalte: Brett · Legende · Skizze · Mörder-Feld -----------
  const W = puzzle.board.width
  const H = puzzle.board.height
  const rightW = Math.round(innerW * 0.46)
  const rightX = PAGE_W - MARGIN - rightW
  const items = legendItems(puzzle, t)
  // Höhe der Legende vorab messen — sie hängt nur von der Spaltenbreite ab.
  const legendH = paintLegend(ctx, items, t, rightX, 0, rightW, false)
  const LEGEND_GAP = 60 // Dirks Feedback: die Legende klebte am Brett
  const SKETCH_GAP = 48
  const FIELD_W = 430
  const FIELD_H = 150
  const FIELD_GAP = 24
  // Brett- und Skizzenzellen gemeinsam einpassen. Die Skizze ist die Lösefläche:
  // ihre Zellen bleiben beschreibbar (≈62 % der Brettzelle, nie unter ~4 mm).
  let cell = Math.floor(rightW / Math.max(W, H))
  let sketchCell = 50
  let fieldBeside = true
  for (; cell >= 40; cell--) {
    sketchCell = Math.max(50, Math.round(cell * 0.62))
    if (sketchCell * W > rightW) continue
    fieldBeside = rightW - sketchCell * W >= FIELD_W + FIELD_GAP
    const total =
      cell * H + LEGEND_GAP + legendH + SKETCH_GAP + sketchCell * H +
      (fieldBeside ? 0 : FIELD_GAP + FIELD_H)
    if (total <= contentH) break
  }
  const bw = cell * W
  const bh = cell * H
  const boardX = rightX + Math.round((rightW - bw) / 2)
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
  paintLegend(ctx, items, t, rightX, boardY + bh + LEGEND_GAP, rightW, true)

  // Skizzen-Brett zum Lösen auf Papier + »Der Mörder ist …« daneben (unten bündig,
  // wie im Murdle-Buch). Die Gruppe sitzt MITTIG in der Spalte (Dirks Feedback:
  // nicht links kleben); passt das Feld nicht daneben, rutscht es darunter.
  const sketchY = boardY + bh + LEGEND_GAP + legendH + SKETCH_GAP
  const sketchW = sketchCell * W
  if (fieldBeside) {
    const groupW = sketchW + FIELD_GAP + FIELD_W
    const sketchX = rightX + Math.max(0, Math.round((rightW - groupW) / 2))
    drawSketch(ctx, puzzle, sketchX, sketchY, sketchCell)
    drawMurderField(ctx, t, sketchX + sketchW + FIELD_GAP, sketchY + sketchCell * H - FIELD_H, FIELD_W, FIELD_H)
  } else {
    const sketchX = rightX + Math.max(0, Math.round((rightW - sketchW) / 2))
    const fw = Math.min(FIELD_W, rightW)
    drawSketch(ctx, puzzle, sketchX, sketchY, sketchCell)
    drawMurderField(ctx, t, rightX + Math.round((rightW - fw) / 2), sketchY + sketchCell * H + FIELD_GAP, fw, FIELD_H)
  }

  // ------------------------------- Verdächtige -------------------------------
  const paneX = MARGIN
  const paneW = rightX - 44 - paneX
  const cols = cards.length > 6 ? 2 : 1
  const colGap = 22
  const colW = Math.floor((paneW - (cols - 1) * colGap) / cols)
  const notes = boardNotes(puzzle, renderer, t)

  // Schrift so groß wie möglich, aber ALLES muss in die Inhaltshöhe passen — bei
  // wenigen Verdächtigen wachsen die Karten und nutzen den freien Platz.
  interface NoteBox {
    lines: string[]
    h: number
  }
  let fontSize = 42
  let layout: { cardH: number[]; lineH: number; avatar: number; pad: number; noteBoxes: NoteBox[]; noteH: number } | null = null
  for (; fontSize >= 18; fontSize -= 2) {
    const pad = Math.round(fontSize * 0.6)
    const avatar = Math.round(fontSize * 3.4)
    const lineH = Math.round(fontSize * 1.42)
    const textW = colW - pad * 2 - avatar - 16
    const cardH = cards.map((card) => {
      ctx.font = `${fontSize}px ${TYPE}`
      const lines = wrapText(ctx, card.text, textW)
      const textH = Math.round(fontSize * 1.35) + 8 + lines.length * lineH
      return Math.max(avatar + pad * 2, textH + pad * 2)
    })
    // Spaltenweise füllen (erst Spalte 1 voll, dann Spalte 2) — höchste Spalte zählt.
    const rows = Math.ceil(cards.length / cols)
    let maxCol = 0
    for (let c0 = 0; c0 < cols; c0++) {
      const colH = cardH
        .slice(c0 * rows, (c0 + 1) * rows)
        .reduce((sum, h) => sum + h + 16, 0)
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
    if (maxCol + noteH <= contentH || fontSize === 18) {
      layout = { cardH, lineH, avatar, pad, noteBoxes, noteH }
      break
    }
  }
  const { cardH, lineH, avatar, pad, noteBoxes } = layout!
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
    const x = paneX + col * (colW + colGap)
    let cy = cardsTop
    for (let k = col * rows; k < i; k++) cy += cardH[k] + 16
    const h = cardH[i]
    // Kasten: Hairline + Spielfarben-Falz links; Verdächtige tragen die
    // Geschlechts-Tönung des Spiels (rosé/blau) — auf Papier nur als HAUCH über
    // der hellen Karte (α 0.35, Dirks Feedback: voll deckend lenkt vom Text ab).
    ctx.fillStyle = CARD_BG
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x, cy, colW, h, 10)
    ctx.fill()
    if (card.img && card.gender) {
      const tint = ctx.createLinearGradient(x, cy, x, cy + h)
      tint.addColorStop(0, GENDER_TINT[card.gender][0])
      tint.addColorStop(1, GENDER_TINT[card.gender][1])
      ctx.save()
      ctx.globalAlpha = 0.35
      ctx.fillStyle = tint
      ctx.fill()
      ctx.restore()
    }
    ctx.stroke()
    ctx.fillStyle = card.accent
    ctx.beginPath()
    ctx.roundRect(x, cy, 9, h, [10, 0, 0, 10])
    ctx.fill()
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
    // Name + Merkmal-Chips (♂/♀, Bart, Brille, Glatze — wie AttrIcons im Spiel).
    const tx = ax + avatar + 16
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = INK
    ctx.font = `700 ${Math.round(fontSize * 1.15)}px ${DISPLAY}`
    const nameBase = cy + pad + Math.round(fontSize * 1.05)
    ctx.fillText(card.name, tx, nameBase)
    let chipX = tx + ctx.measureText(card.name).width + 14
    const chipH = Math.round(fontSize * 1.08)
    const chipTop = nameBase - chipH + Math.round(fontSize * 0.14)
    const pill = (w: number): void => {
      ctx.fillStyle = 'rgba(42, 35, 23, 0.1)'
      ctx.strokeStyle = 'rgba(42, 35, 23, 0.22)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(chipX, chipTop, w, chipH, chipH / 2)
      ctx.fill()
      ctx.stroke()
    }
    if (card.gender) {
      const glyph = card.gender === 'm' ? '♂' : '♀'
      ctx.font = `${Math.round(fontSize * 0.8)}px ${TYPE}`
      const w = ctx.measureText(glyph).width + chipH * 0.7
      pill(w)
      ctx.fillStyle = INK
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(glyph, chipX + w / 2, chipTop + chipH * 0.56)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      chipX += w + 8
    }
    for (const trait of card.traits ?? []) {
      const w = chipH * 1.35
      pill(w)
      const icon = chipH * 0.74
      ctx.drawImage(traitImgs.get(trait)!, chipX + (w - icon) / 2, chipTop + (chipH - icon) / 2, icon, icon)
      chipX += w + 8
    }
    ctx.fillStyle = TEXT
    ctx.font = `${fontSize}px ${TYPE}`
    wrapText(ctx, card.text, colW - pad * 2 - avatar - 16).forEach((line, li) => {
      ctx.fillText(line, tx, cy + pad + Math.round(fontSize * 1.35) + 8 + (li + 1) * lineH - 6)
    })
    if (inCol === rows - 1 || i === cards.length - 1) {
      noteY = Math.max(noteY, cy + h)
    }
  })

  // Akten-Notizen (Draußen-Legende, Wasser-Regel, globale Hinweise) unter den
  // Karten — jede in ihrer eigenen blau getönten Box mit Lupe, wie im Spiel.
  if (noteBoxes.length > 0) {
    const notePad = Math.round(fontSize * 0.5)
    const lens = Math.round(fontSize * 1.35)
    let ny = noteY + 20
    noteBoxes.forEach((box) => {
      ctx.fillStyle = 'rgba(120, 150, 210, 0.14)'
      ctx.strokeStyle = 'rgba(95, 122, 175, 0.6)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(paneX, ny, paneW, box.h, 10)
      ctx.fill()
      ctx.stroke()
      // Die Lupe (Tinten-Zeichnung, kein Emoji): Glas + Griff, mittig zur Box.
      const lx = paneX + notePad
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
        ctx.fillText(line, paneX + notePad + lens + 14, textTop + fontSize + li * lineH - 2)
      })
      ny += box.h + 12
    })
  }

  return canvas
}

// ─────────────────────────── Blatt 2: Die Auflösung ───────────────────────────

/** Eine Protokoll-Zeile des Lösungswegs (ein Deduktionsschritt der Engine). */
interface StepLine {
  text: string
  /** Verdächtigen-Buchstabe bzw. VICTIM_ID — malt den Farb-Chip vor der Zeile. */
  person?: string
  /** Setz-Schritt („X muss auf … stehen") — fett, Feldangabe in Krimson. */
  place: boolean
  /** Die lokalisierte Feldangabe (renderer.cell), fürs Krimson-Highlight. */
  cellText?: string
}

/** Chip-Farbe/-Buchstabe: Verdächtige in Spielfarbe, das Opfer als ☠ in Krimson. */
function chipStyle(
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
function paintSteps(
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
function drawMurderCard(
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

  // Schritte wie Strg+B, aber druckreif: Ausgangslage-Zählzeilen (clueCandidates)
  // raus, exakt wiederholte Zeilen nur beim ersten Mal, der Mörder-Schritt wird
  // zum Verdikt-Kasten. (Dirks Regeln für den Druckbogen.)
  const steps: StepLine[] = []
  const seen = new Set<string>()
  let verdictText = ''
  for (const step of result.steps) {
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
  let cell = Math.floor(rightW / Math.max(W, H))
  while (cell > 40 && LABEL_H + cell * H + CARD_GAP + CARD_H > contentH) cell--
  const bw = cell * W
  const bh = cell * H
  const boardX = rightX + Math.round((rightW - bw) / 2)
  const boardY = contentTop + LABEL_H

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
 *  `opts.solution` hängt Blatt 2 (die Auflösung) an. Das Zeichnen der Bogen braucht
 *  den DOM (Schriften, Bilder) und bleibt im Hauptthread; alles Teure danach
 *  (PNG-Encoding + jsPDF) läuft im Worker, damit die UI nie einfriert. */
export async function exportLevelPdf(
  json: LevelJson,
  i18nInst: I18n,
  title: string,
  opts: { solution?: boolean } = {},
): Promise<void> {
  await nextPaint()
  const pages = [await renderSheet(json, i18nInst, title)]
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
