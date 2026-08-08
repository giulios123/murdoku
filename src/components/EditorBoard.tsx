import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { loadLevel, type Cell } from '../engine/index.ts'
import BoardAxes, { AXES_H, AXES_W } from './BoardAxes.tsx'
import { drawBoard } from '../game/boardRender.ts'
import { onArtReady } from '../game/objectArt.ts'
import { useSettings } from '../game/settings.ts'
import { buildEditorLevel, type EditorState } from '../game/editorModel.ts'

interface Props {
  state: EditorState
  onPaint: (cell: Cell) => void
  /** In window mode, a click toggles a window; fx,fy are the fractional position in the cell. */
  windowMode?: boolean
  onPaintWindow?: (cell: Cell, fx: number, fy: number) => void
  /** In door mode, a click toggles a door on the nearest edge (same geometry as windows). */
  doorMode?: boolean
  onPaintDoor?: (cell: Cell, fx: number, fy: number) => void
}

interface Layout {
  cell: number
  w: number
  h: number
}

/** The editable board: live preview of the editor state + click/drag to paint. */
export default function EditorBoard({ state, onPaint, windowMode, onPaintWindow, doorMode, onPaintDoor }: Props) {
  const { t, i18n } = useTranslation()
  // The floor-pattern setting applies here too — the editor board must go plain
  // (and redraw) the moment it's switched off in the gear menu.
  const { floorTextures, blockedStyle } = useSettings()
  const W = state.size
  const H = state.size
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [artTick, setArtTick] = useState(0)
  const [hoverRC, setHoverRC] = useState<{ row: number; col: number } | null>(null)
  const painting = useRef(false)
  const lastCell = useRef<Cell | null>(null)

  const puzzle = useMemo(() => {
    try {
      return loadLevel(buildEditorLevel(state))
    } catch {
      return null
    }
  }, [state])

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

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !layout || !puzzle) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(layout.w * dpr)
    cv.height = Math.round(layout.h * dpr)
    cv.style.width = `${layout.w}px`
    cv.style.height = `${layout.h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, layout.w, layout.h)
    drawBoard(ctx, {
      puzzle,
      cell: layout.cell,
      origin: { x: 0, y: 0 },
      roomName: (key: string) => t(key),
      suspectIndex: new Map(),
      placements: new Map(),
      marks: new Map(),
      crosses: new Set(),
      highlight: null,
      reveal: null,
      floorTextures,
      blockedStyle,
    })
  }, [layout, puzzle, artTick, t, i18n.language, floorTextures, blockedStyle])

  // Redraw when bundled board art (e.g. the armchair) finishes loading.
  useEffect(() => onArtReady(() => setArtTick((t) => t + 1)), [])

  const cellAt = (e: ReactPointerEvent<HTMLCanvasElement>): Cell | null => {
    if (!layout) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const col = Math.floor((e.clientX - rect.left) / layout.cell)
    const row = Math.floor((e.clientY - rect.top) / layout.cell)
    if (col < 0 || col >= W || row < 0 || row >= H) return null
    return row * W + col
  }

  /** Hovered cell for the axis labels (the canvas has no hover visuals here). */
  const hover = (cell: Cell | null) =>
    setHoverRC(cell === null ? null : { row: Math.floor(cell / W), col: cell % W })

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cell = cellAt(e)
    hover(cell) // light the labels on touch/press too
    if (cell === null || !layout) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (windowMode || doorMode) {
      const rect = e.currentTarget.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / layout.cell - (cell % W)
      const fy = (e.clientY - rect.top) / layout.cell - Math.floor(cell / W)
      if (doorMode) onPaintDoor?.(cell, fx, fy)
      else onPaintWindow?.(cell, fx, fy)
      return
    }
    painting.current = true
    lastCell.current = cell
    onPaint(cell)
  }
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cell = cellAt(e)
    hover(cell)
    if (!painting.current) return
    if (cell === null || cell === lastCell.current) return
    lastCell.current = cell
    onPaint(cell)
  }
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    painting.current = false
    lastCell.current = null
    if (e.pointerType === 'touch') hover(null) // no resting cursor on touch
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
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={() => hover(null)}
        />
      </div>
    </div>
  )
}
