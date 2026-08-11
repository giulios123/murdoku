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
  MERGE_INSTANCE_TYPES,
  OBJECT_CATALOG,
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

/** Klartext eines Verdächtigen-Hinweises — exakt die ClueText-Logik (Pronomen-Form,
 *  ' · ' zwischen Teilen, erster Buchstabe groß, Schlusspunkt nur wenn nötig). */
function clueLine(renderer: Renderer, clues: readonly Clue[], subjectId: string): string {
  let text = clues
    .map((c) =>
      renderer.render(c.describe(), {
        name: subjectId,
        subject: subjectId,
        poss: subjectId,
        subjectObj: subjectId,
      }),
    )
    .join(' · ')
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1)
  if (text && !/[.!?]$/.test(text.trimEnd())) text += '.'
  return text
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
    if (lx + groupW + tile + 10 + nameW + 30 > x0 + width && lx > x0) {
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

interface PersonCard {
  name: string
  text: string
  accent: string
  /** Avatarbild — fehlt beim Opfer (das bekommt die ☠-Marke wie im Spiel). */
  img?: HTMLImageElement
  gender?: 'm' | 'f'
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
    })),
  )
  const victimGender: 'm' | 'f' = puzzle.victim.attributes.gender === 'f' ? 'f' : 'm'
  cards.push({
    name: puzzle.victim.name,
    text: `${t('game.victim')} — ${t('game.victimStatement')}`,
    accent: CRIMSON,
    gender: victimGender,
  })

  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  const innerW = PAGE_W - 2 * MARGIN

  // ---------------------------------- Kopf ----------------------------------
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
  const diff = t(`difficulty.${json.difficulty ?? 'medium'}`)
  const author = (json.author ?? '').trim()
  const metaLine = `${puzzle.board.width}×${puzzle.board.height} · ${diff}${author ? ` · ${t('game.author', { name: author })}` : ''}`
  ctx.fillStyle = DIM
  ctx.font = `34px ${TYPE}`
  ctx.fillText(metaLine, PAGE_W / 2, y)

  // »Offener Fall«-Stempel oben rechts, leicht gedreht, doppelter Rand.
  const stamp = t('game.pdfStamp').toUpperCase()
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
  const contentTop = y + 36

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
  let fontSize = 42
  let layout: { cardH: number[]; lineH: number; avatar: number; pad: number; noteLines: string[]; noteLineH: number; noteH: number } | null = null
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
    ctx.font = `${fontSize}px ${TYPE}`
    const noteLineH = lineH
    const noteLines = notes.flatMap((n) => wrapText(ctx, n, paneW - pad * 2 - 18))
    const noteH = notes.length > 0 ? noteLines.length * noteLineH + pad * 2 + 20 : 0
    if (maxCol + noteH <= contentH || fontSize === 18) {
      layout = { cardH, lineH, avatar, pad, noteLines, noteLineH, noteH }
      break
    }
  }
  const { cardH, lineH, avatar, pad, noteLines, noteLineH } = layout!
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
    // Kasten: helle Fläche, Hairline, Spielfarben-Falz links (wie die Entwurfsmappe).
    ctx.fillStyle = CARD_BG
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x, cy, colW, h, 10)
    ctx.fill()
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
    // Name + Hinweistext.
    const tx = ax + avatar + 16
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = INK
    ctx.font = `700 ${Math.round(fontSize * 1.15)}px ${DISPLAY}`
    const nameSuffix = card.gender ? `  ${card.gender === 'm' ? '♂' : '♀'}` : ''
    ctx.fillText(card.name + nameSuffix, tx, cy + pad + Math.round(fontSize * 1.05))
    ctx.fillStyle = TEXT
    ctx.font = `${fontSize}px ${TYPE}`
    wrapText(ctx, card.text, colW - pad * 2 - avatar - 16).forEach((line, li) => {
      ctx.fillText(line, tx, cy + pad + Math.round(fontSize * 1.35) + 8 + (li + 1) * lineH - 6)
    })
    if (inCol === rows - 1 || i === cards.length - 1) {
      noteY = Math.max(noteY, cy + h)
    }
  })

  // Akten-Notiz (Draußen-Legende, Wasser-Regel, globale Hinweise) unter den Karten.
  if (noteLines.length > 0) {
    const ny = noteY + 20
    const nh = noteLines.length * noteLineH + pad * 2
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(paneX, ny, paneW, nh, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = CRIMSON
    ctx.fillRect(paneX, ny + 4, 7, nh - 8)
    ctx.fillStyle = TEXT
    ctx.font = `${fontSize}px ${TYPE}`
    ctx.textAlign = 'left'
    noteLines.forEach((line, i) => {
      ctx.fillText(line, paneX + pad + 18, ny + pad + (i + 1) * noteLineH - 8)
    })
  }

  return canvas
}

/** Baut das PDF und lädt es herunter (Web) bzw. öffnet das Share-Sheet (Android). */
export async function exportLevelPdf(json: LevelJson, i18nInst: I18n, title: string): Promise<void> {
  const canvas = await renderSheet(json, i18nInst, title)
  // Dynamisch wie die Capacitor-Plugins: jsPDF (~120 KB gzip) gehört nicht ins
  // Start-Bundle eines selten genutzten Features — der Chunk lädt beim ersten
  // Export (in der App aus den lokalen Assets, funktioniert also auch offline).
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210)

  const base = title.trim().replace(/[^\w-]+/g, '_') || json.id
  const filename = `${base}.pdf`

  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    // Ohne `encoding` schreibt Capacitor base64-Bytes — genau was ein PDF braucht.
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: doc.output('datauristring').split(',')[1],
      directory: Directory.Cache,
    })
    await Share.share({ title: filename, files: [uri], dialogTitle: filename })
    return
  }
  doc.save(filename)
}
