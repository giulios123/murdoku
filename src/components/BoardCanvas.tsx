import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Cell, PersonId, Puzzle } from '../engine/index.ts'
import BoardAxes, { AXES_H, AXES_W } from './BoardAxes.tsx'
import { drawBoard, drawBoardOverlay, type RevealInfo } from '../game/boardRender.ts'
import type { HelpMarks } from '../game/helpMarks.ts'
import { onArtReady } from '../game/objectArt.ts'
import { hapticTick } from '../game/haptics.ts'
import { avatarDataUri } from '../game/avatar.ts'
import { suspectColor } from '../game/palette.ts'
import { useSettings } from '../game/settings.ts'
import type { PlayState } from '../game/useGameSession.ts'

/** Hold duration to commit a person (ms). Tune here. */
const LONGPRESS_MS = 1000
/** The progress ring only appears after this hold, so a quick tap shows no ring. */
const RING_DELAY_MS = 200
/** Pointer travel (px) that turns a note press into a drag-paint. Small for a mouse, so
 *  painting feels immediate — but a FINGER trembles by far more than 6px while "holding
 *  still" for the long-press place, and the shared threshold kept flipping the note
 *  instead of placing (user-reported on phones). Touch gets real tremor room; an
 *  intentional drag clears 18px within its first move events anyway. */
const DRAG_THRESHOLD = 6
const TOUCH_DRAG_THRESHOLD = 18

/** The drag threshold for this pointer: fingers tremble, mice don't. */
function dragThreshold(pointerType: string): number {
  return pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD
}

interface Props {
  puzzle: Puzzle
  state: PlayState
  suspectIndex: Map<PersonId, number>
  selectedSuspect: PersonId | null
  highlight: Set<Cell> | null
  highlightColor?: { wash: string; ring: string }
  /** A second highlight layer (selected suspect's candidates) shown beneath the hint. */
  highlight2?: Set<Cell> | null
  highlightColor2?: { wash: string; ring: string }
  /** Opacity of each candidate-highlight layer (1 = full; HIGHLIGHT_DIM when the selected
   *  suspect is already placed, so their now-moot candidates recede). */
  highlightAlpha?: number
  highlightAlpha2?: number
  /** Reduced-help reference marks (object rings, room outlines, window/door glow). */
  helpMarks?: HelpMarks | null
  /** Suspect whose notes pulse bigger (when hovering their clue card). */
  emphasize?: PersonId | null
  xTool: boolean
  /** Eraser armed: a tap or drag wipes each cell it touches. */
  eraseTool: boolean
  reveal: RevealInfo | null
  roomName: (nameKey: string) => string
  occupantAt: (cell: Cell) => PersonId | undefined
  onPlaceMark: (cell: Cell, suspectId: PersonId) => void
  onCommit: (cell: Cell, suspectId: PersonId) => void
  onRemove: (personId: PersonId) => void
  onSetCross: (cell: Cell, value: boolean) => void
  onEraseCell: (cell: Cell) => void
  onSetMark: (cell: Cell, suspectId: PersonId, on: boolean) => void
  onSelectSuspect: (id: PersonId | null) => void
}

interface Layout {
  cell: number
  w: number
  h: number
}

function BoardCanvas(props: Props) {
  const { puzzle } = props
  const { t } = useTranslation()
  const { objectBadges, floorTextures, blockedStyle } = useSettings()
  const W = puzzle.board.width
  const H = puzzle.board.height

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Transparent animation layer stacked exactly over the board canvas: pulsing note
  // letters + the long-press ring repaint ONLY this near-empty canvas per frame.
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  // Hovered cell mirrored into state so the coordinate margins can light up the
  // matching row/col label (the canvas itself keeps reading hoverRef).
  const [hoverRC, setHoverRC] = useState<{ row: number; col: number } | null>(null)
  // Tooltip naming the placed person (if any) + object(s) under the cursor, plus
  // whether the tile is walkable (shown as a small begehbar/blockiert status line).
  const [objTip, setObjTip] = useState<{
    person?: string
    types: string[]
    walkable: boolean
    x: number
    y: number
    left: boolean
  } | null>(null)

  // Latest props/layout, read by the rAF loop and async image loads.
  const propsRef = useRef(props)
  propsRef.current = props
  const layoutRef = useRef<Layout | null>(layout)
  layoutRef.current = layout
  // Mirrored so the rAF/async redraws also see the current setting values.
  const badgesRef = useRef(objectBadges)
  badgesRef.current = objectBadges
  const texturesRef = useRef(floorTextures)
  texturesRef.current = floorTextures
  const blockedRef = useRef(blockedStyle)
  blockedRef.current = blockedStyle

  const pressRef = useRef<{
    cell: Cell
    start: number
    x: number
    y: number
    mode: 'commit' | 'remove'
    personId?: PersonId
    /** Whether the "long-press recognised" haptic has already fired for this press. */
    buzzed?: boolean
  } | null>(null)
  const rafRef = useRef<number | null>(null)
  // Both drag-paints remember the previous pointer position (`last`, canvas-relative) so
  // each move can walk the line since then — a fast swipe must not skip cells.
  const paintRef = useRef<{ value: boolean; visited: Set<Cell>; last: { x: number; y: number } } | null>(null)
  /** Eraser drag-paint — same line-walk as the X tool, so a fast swipe wipes every cell it
   *  crosses instead of only the ones a throttled move event happened to sample. */
  const erasePaintRef = useRef<{ visited: Set<Cell>; last: { x: number; y: number } } | null>(null)
  const markPaintRef = useRef<{ personId: PersonId; on: boolean; visited: Set<Cell>; last: { x: number; y: number } } | null>(null)
  const hoverRef = useRef<Cell | null>(null)
  // Mobile "what is this?" tap: set on a pointer-down that triggers NO game action
  // (no X-tool, no occupant, no selected suspect); shown as a short-lived tooltip on
  // release. Desktop keeps its hover tooltip — this is the touch equivalent.
  const inertTapRef = useRef<Cell | null>(null)
  const tipTimerRef = useRef<number | undefined>(undefined)
  const avatarsRef = useRef<Map<PersonId, HTMLImageElement>>(new Map())
  const emphPulseRef = useRef(0)
  // The active long-press ring, drawn on the overlay (never on the board canvas).
  const overlayPressRef = useRef<{ cell: Cell; progress: number } | null>(null)

  function redraw() {
    const cv = canvasRef.current
    const L = layoutRef.current
    if (!cv || !L) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const p = propsRef.current
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, L.cell * W, L.cell * H)
    drawBoard(ctx, {
      puzzle: p.puzzle,
      cell: L.cell,
      origin: { x: 0, y: 0 },
      roomName: p.roomName,
      suspectIndex: p.suspectIndex,
      placements: p.state.placements,
      marks: p.state.marks,
      crosses: p.state.crosses,
      highlight: p.highlight,
      highlightColor: p.highlightColor,
      highlight2: p.highlight2,
      highlightColor2: p.highlightColor2,
      highlightAlpha: p.highlightAlpha,
      highlightAlpha2: p.highlightAlpha2,
      helpMarks: p.helpMarks,
      objectBadges: badgesRef.current,
      floorTextures: texturesRef.current,
      blockedStyle: blockedRef.current,
      reveal: p.reveal,
      avatars: avatarsRef.current,
      hover: hoverRef.current,
      emphasizeMarks: p.emphasize ?? null,
    })
  }

  /** Repaint just the animation layer (pulsing letters + press ring). */
  function redrawOverlay() {
    const cv = overlayRef.current
    const L = layoutRef.current
    if (!cv || !L) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const p = propsRef.current
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, L.cell * W, L.cell * H)
    if (!p.emphasize && !overlayPressRef.current) return
    drawBoardOverlay(ctx, {
      puzzle: p.puzzle,
      cell: L.cell,
      origin: { x: 0, y: 0 },
      suspectIndex: p.suspectIndex,
      marks: p.state.marks,
      placements: p.state.placements,
      emphasize: p.emphasize ?? null,
      pulse: emphPulseRef.current,
      press: overlayPressRef.current,
    })
  }

  // Build head-avatar images for the suspects; redraw as each loads.
  useEffect(() => {
    const map = new Map<PersonId, HTMLImageElement>()
    puzzle.suspects.forEach((s, i) => {
      const img = new Image()
      img.onload = () => redraw()
      img.src = avatarDataUri(s.attributes, suspectColor(i), s.id)
      map.set(s.id, img)
    })
    avatarsRef.current = map
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle])

  // Fit the board to the available space.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      // Leave room for the coordinate margins (top + left strips).
      const aw = wrap.clientWidth - AXES_W
      const ah = wrap.clientHeight - AXES_H
      if (aw <= 0 || ah <= 0) return
      const cell = Math.max(14, Math.floor(Math.min(aw / W, ah / H)))
      setLayout({ cell, w: cell * W, h: cell * H })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [W, H])

  /** Match both backing stores (board + overlay) to the layout and devicePixelRatio.
   *  Assigning canvas width/height CLEARS the canvas and reallocates its backing store —
   *  even when the value is unchanged — so it only happens on a REAL size change, never
   *  per interaction (that reallocation was a big part of the tap latency on phones). */
  function ensureBackingSize() {
    const cv = canvasRef.current
    const ov = overlayRef.current
    const L = layoutRef.current
    if (!cv || !ov || !L) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(L.w * dpr)
    const h = Math.round(L.h * dpr)
    for (const el of [cv, ov]) {
      if (el.width !== w) el.width = w
      if (el.height !== h) el.height = h
      const cssW = `${L.w}px`
      const cssH = `${L.h}px`
      if (el.style.width !== cssW) el.style.width = cssW
      if (el.style.height !== cssH) el.style.height = cssH
    }
  }

  // Redraw on any input change. useLayoutEffect, so the board repaints in the SAME frame
  // as the DOM commit (e.g. the tapped suspect card turning selected) — with useEffect the
  // highlight landed a paint later than the card, which read as lag on phones.
  useLayoutEffect(() => {
    ensureBackingSize()
    redraw()
    redrawOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, props.state, props.selectedSuspect, props.highlight, props.highlight2, props.highlightAlpha, props.highlightAlpha2, props.helpMarks, props.reveal, objectBadges, floorTextures, blockedStyle])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelPress(), [])
  useEffect(() => () => window.clearTimeout(tipTimerRef.current), [])

  // Redraw once bundled board art (e.g. the armchair) finishes loading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onArtReady(() => redraw()), [])

  // Pulse the hovered suspect's notes while their clue card is hovered. The rAF loop
  // repaints ONLY the overlay; the board canvas just hides/shows those letters once.
  useEffect(() => {
    redraw() // base letters of the emphasized suspect hide (overlay owns them) / return
    if (!props.emphasize) {
      emphPulseRef.current = 0
      redrawOverlay()
      return
    }
    // Paint the letters on the overlay right away — without this they'd blink for
    // one frame (base already hides them, the rAF hasn't drawn them yet).
    emphPulseRef.current = 0
    redrawOverlay()
    let raf = 0
    const tick = (now: number) => {
      emphPulseRef.current = Math.sin(now / 350) * 0.5 + 0.5
      redrawOverlay()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      emphPulseRef.current = 0
      redrawOverlay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.emphasize])

  /** Update the hovered cell: ref for the canvas, state for the axis labels. */
  function setHover(cell: Cell | null) {
    hoverRef.current = cell
    setHoverRC(cell === null ? null : puzzle.board.rc(cell))
  }

  function cancelPress() {
    pressRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // Drop the ring from the animation layer (the board canvas never carried it).
    if (overlayPressRef.current) {
      overlayPressRef.current = null
      redrawOverlay()
    }
  }

  function tick(now: number) {
    const press = pressRef.current
    if (!press) return
    const elapsed = now - press.start
    if (elapsed >= LONGPRESS_MS) {
      const p = propsRef.current
      cancelPress()
      if (press.mode === 'remove' && press.personId) p.onRemove(press.personId)
      else if (press.mode === 'commit' && p.selectedSuspect) p.onCommit(press.cell, p.selectedSuspect)
      redraw()
      return
    }
    // Show the progress ring only after a short hold, so a quick tap shows nothing.
    if (elapsed >= RING_DELAY_MS) {
      // The moment the press reads as a long-press (ring appears), a light haptic tick
      // confirms "you're placing" — once per press. Fills the gap the Android WebView
      // leaves (mobile browsers buzz on their own; hapticTick is native-only).
      if (!press.buzzed) {
        press.buzzed = true
        hapticTick()
      }
      // Animate on the overlay only — the board underneath stays untouched.
      overlayPressRef.current = { cell: press.cell, progress: (elapsed - RING_DELAY_MS) / (LONGPRESS_MS - RING_DELAY_MS) }
      redrawOverlay()
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function cellAt(e: ReactPointerEvent<HTMLCanvasElement>): Cell | null {
    const L = layoutRef.current
    if (!L) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const col = Math.floor((e.clientX - rect.left) / L.cell)
    const row = Math.floor((e.clientY - rect.top) / L.cell)
    if (col < 0 || col >= W || row < 0 || row >= H) return null
    return row * W + col
  }

  /** The pointer position relative to the board canvas. */
  function ptOf(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /**
   * Apply a drag-paint step along the pointer's ACTUAL path: all coalesced samples the
   * browser batched into this move event, with a line-walk between consecutive samples.
   * Touch move events arrive throttled, so a fast swipe otherwise skips cells — this
   * guarantees every crossed cell is painted. `apply` receives each cell (may repeat).
   */
  function strokeTo(
    e: ReactPointerEvent<HTMLCanvasElement>,
    last: { x: number; y: number },
    apply: (cell: Cell) => void,
  ): void {
    const L = layoutRef.current
    if (!L) return
    const rect = e.currentTarget.getBoundingClientRect()
    const native = e.nativeEvent
    const coalesced = native.getCoalescedEvents?.() ?? []
    const events: { clientX: number; clientY: number }[] = coalesced.length ? coalesced : [native]
    const step = L.cell / 2
    for (const ev of events) {
      const tx = ev.clientX - rect.left
      const ty = ev.clientY - rect.top
      const n = Math.max(1, Math.ceil(Math.hypot(tx - last.x, ty - last.y) / step))
      for (let k = 1; k <= n; k++) {
        const col = Math.floor((last.x + ((tx - last.x) * k) / n) / L.cell)
        const row = Math.floor((last.y + ((ty - last.y) * k) / n) / L.cell)
        if (col >= 0 && col < W && row >= 0 && row < H) apply(row * W + col)
      }
      last.x = tx
      last.y = ty
    }
  }

  /**
   * The hover outline while drag-painting: a mouse keeps it under the cursor, a finger
   * gets NONE — it used to stick to the stroke's start cell for the whole drag (the
   * pointer-down set it, the paint branches never updated it), which read as a stuck
   * white ring on mobile. The finger covers the cell anyway.
   */
  function syncPaintHover(e: ReactPointerEvent<HTMLCanvasElement>) {
    const cell = e.pointerType === 'mouse' ? cellAt(e) : null
    if (cell !== hoverRef.current) {
      setHover(cell)
      redraw()
    }
  }

  /** Show/hide the "what's this object" tooltip beside the hovered cell. */
  function updateObjTip(cell: Cell | null) {
    const cv = canvasRef.current
    const L = layoutRef.current
    if (cell === null || !cv || !L) return setObjTip(null)
    const objs = puzzle.board.tileAt(cell).objects() // [ground, top] — stacked
    const occ = props.occupantAt(cell)
    const person = occ ? puzzle.nameOf(occ) : undefined
    if (objs.length === 0 && !person) return setObjTip(null)
    const rect = cv.getBoundingClientRect()
    const { row, col } = puzzle.board.rc(cell)
    const left = rect.left + col * L.cell
    const top = rect.top + row * L.cell
    const flip = left + L.cell + 140 > window.innerWidth
    setObjTip({
      person,
      types: objs.map((o) => o.type),
      walkable: puzzle.board.isOccupiable(cell),
      x: flip ? left - 8 : left + L.cell + 8,
      y: top + 4,
      left: flip,
    })
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const cell = cellAt(e)
    if (cell === null) return
    e.currentTarget.setPointerCapture(e.pointerId)
    window.clearTimeout(tipTimerRef.current)
    inertTapRef.current = null
    setObjTip(null) // hide while interacting

    // The eraser wins over every other press: while it is armed, a touch on the board can
    // only ever mean "wipe this", never place or select.
    if (props.eraseTool) {
      setHover(e.pointerType === 'mouse' ? cell : null)
      erasePaintRef.current = { visited: new Set([cell]), last: ptOf(e) }
      props.onEraseCell(cell)
      return
    }
    if (props.xTool) {
      // No hover ring for a finger — it would stick to the stroke's start cell.
      setHover(e.pointerType === 'mouse' ? cell : null)
      const value = !props.state.crosses.has(cell)
      paintRef.current = { value, visited: new Set([cell]), last: ptOf(e) }
      props.onSetCross(cell, value)
      return
    }
    setHover(cell) // show blocked outline on touch/press too

    const occ = props.occupantAt(cell)
    if (occ !== undefined) {
      // occupied cell → tap selects the occupant, hold removes them
      pressRef.current = { cell, start: e.timeStamp, x: e.clientX, y: e.clientY, mode: 'remove', personId: occ }
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    if (props.selectedSuspect && props.puzzle.board.isOccupiable(cell)) {
      pressRef.current = { cell, start: e.timeStamp, x: e.clientX, y: e.clientY, mode: 'commit' }
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    // Inert press (no action follows). On touch WITHOUT a selected suspect this arms
    // the "what is this?" tap tooltip shown on release (Dirk: never while placing
    // notes, i.e. never with a suspect selected — and touch only).
    if (e.pointerType === 'touch' && !props.selectedSuspect) inertTapRef.current = cell
    redraw() // non-occupiable / empty without selection → just hover feedback
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (erasePaintRef.current) {
      const ep = erasePaintRef.current
      strokeTo(e, ep.last, (c) => {
        if (!ep.visited.has(c)) {
          ep.visited.add(c)
          props.onEraseCell(c)
        }
      })
      syncPaintHover(e)
      return
    }
    if (paintRef.current) {
      const paint = paintRef.current
      strokeTo(e, paint.last, (c) => {
        if (!paint.visited.has(c)) {
          paint.visited.add(c)
          props.onSetCross(c, paint.value)
        }
      })
      syncPaintHover(e)
      return
    }
    if (markPaintRef.current) {
      const mp = markPaintRef.current
      strokeTo(e, mp.last, (c) => {
        if (!mp.visited.has(c)) {
          mp.visited.add(c)
          props.onSetMark(c, mp.personId, mp.on)
        }
      })
      syncPaintHover(e)
      return
    }
    if (pressRef.current) {
      const press = pressRef.current
      const cell = cellAt(e)
      if (press.mode === 'commit' && props.selectedSuspect) {
        // A note press becomes a drag-paint as soon as the pointer moves a little — even
        // while still over the START cell — so its note flips immediately. The start cell
        // decides the mode (had no note → ADD, had one → REMOVE). Moving means it's not a
        // long-press, so the figure is NOT placed.
        // Touch: ONLY the (generous) travel distance counts. Crossing a cell border is no
        // signal there — a finger resting near an edge crosses it by pure tremor, which
        // turned an intended long-press place into a note flip on the neighbour cell.
        const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y)
        if (moved > dragThreshold(e.pointerType) || (e.pointerType !== 'touch' && cell !== null && cell !== press.cell)) {
          const suspect = props.selectedSuspect
          const on = !(props.state.marks.get(press.cell)?.has(suspect) ?? false)
          cancelPress()
          const visited = new Set<Cell>([press.cell])
          markPaintRef.current = { personId: suspect, on, visited, last: ptOf(e) }
          props.onSetMark(press.cell, suspect, on)
          if (cell !== null && cell !== press.cell) {
            visited.add(cell)
            props.onSetMark(cell, suspect, on)
          }
          syncPaintHover(e) // drops the ring stuck on the start cell (touch)
          redraw()
        }
        return // small movement within the start cell → keep the long-press alive
      }
      // Occupied-cell press: moving off the cell cancels the select/remove gesture — with
      // the same tremor room for a finger, so holding to REMOVE near a cell border doesn't
      // silently abort on micro-movement.
      if (cell !== press.cell) {
        const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y)
        if (e.pointerType === 'touch' && moved <= TOUCH_DRAG_THRESHOLD) return
        cancelPress()
        redraw()
      }
      return
    }
    // hover (desktop): outline cells + name the object under the cursor
    const cell = cellAt(e)
    if (inertTapRef.current !== null && cell !== inertTapRef.current) {
      inertTapRef.current = null // finger slid off the cell → not a tap
    }
    if (cell !== hoverRef.current) {
      setHover(cell)
      redraw()
      updateObjTip(cell)
    }
  }

  function endPointer(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (erasePaintRef.current) {
      erasePaintRef.current = null
    } else if (paintRef.current) {
      paintRef.current = null
    } else if (markPaintRef.current) {
      markPaintRef.current = null
    } else {
      const press = pressRef.current
      if (press) {
        const p = propsRef.current
        cancelPress()
        if (press.mode === 'remove' && press.personId) {
          p.onSelectSuspect(press.personId) // short tap on a token selects it
        } else if (press.mode === 'commit' && p.selectedSuspect) {
          p.onPlaceMark(press.cell, p.selectedSuspect) // released early → pencil mark
        }
      }
    }
    if (e.pointerType === 'touch') {
      setHover(null)
      const tap = inertTapRef.current
      inertTapRef.current = null
      if (tap !== null && tap === cellAt(e)) {
        // The touch stand-in for the desktop hover tooltip: a short-lived chip naming
        // the object(s) + walkable status, then it tidies itself away.
        updateObjTip(tap)
        window.clearTimeout(tipTimerRef.current)
        tipTimerRef.current = window.setTimeout(() => setObjTip(null), 1800)
      } else {
        setObjTip(null)
      }
    }
    redraw()
  }

  function onPointerLeave(e: ReactPointerEvent<HTMLCanvasElement>) {
    inertTapRef.current = null
    setHover(null)
    // A touch pointer ALWAYS "leaves" right after pointer-up (the finger ceases to
    // exist) — clearing here killed the tap tooltip the moment endPointer showed it
    // (it only flickered for a frame). Only a mouse actually leaves the board.
    if (e.pointerType !== 'touch') setObjTip(null)
    redraw()
  }

  return (
    <div
      ref={wrapRef}
      style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', minWidth: 0, minHeight: 0 }}
    >
      <div className="mk-axes">
        {layout && <BoardAxes cols={W} rows={H} cell={layout.cell} active={hoverRC} />}
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={onPointerLeave}
        />
        {/* Animation layer: same grid slot as the board canvas (`.mk-axes > canvas`
            stacks them), so it overlays exactly; input passes through to the board. */}
        <canvas ref={overlayRef} style={{ pointerEvents: 'none' }} aria-hidden="true" />
      </div>
      {objTip &&
        createPortal(
          <span
            className="mk-tip"
            data-side={objTip.left ? 'left' : 'right'}
            style={{ left: objTip.x, top: objTip.y }}
          >
            {objTip.person && (
              <span style={{ display: 'block', fontWeight: 700, color: 'var(--brass)' }}>
                {objTip.person}
              </span>
            )}
            {objTip.types.map((ty) => (
              <span key={ty} style={{ display: 'block' }}>
                {t(`objName.${ty}`)}
              </span>
            ))}
            <span
              style={{
                display: 'block',
                fontSize: '0.85em',
                letterSpacing: '0.04em',
                color: objTip.walkable ? '#6fae88' : '#d95c4f',
              }}
            >
              {t(objTip.walkable ? 'legend.occupiable' : 'legend.blocked')}
            </span>
          </span>,
          document.body,
        )}
    </div>
  )
}

export default memo(BoardCanvas)
