import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PersonId } from '../engine/index.ts'
import BoardAxes, { AXES_H, AXES_W } from './BoardAxes.tsx'
import { drawBoard } from '../game/boardRender.ts'
import { onArtReady } from '../game/objectArt.ts'
import { useSettings } from '../game/settings.ts'
import { CANDIDATE_BLUE, REF_RED } from '../game/palette.ts'
import type { FaqView } from '../game/faqEntries.ts'

interface Props {
  view: FaqView
  /** Show the coordinate strips (row/column entries). */
  axes?: boolean
}

interface Layout {
  cell: number
  w: number
  h: number
}

/**
 * The Handakte's static demo board: the REAL board renderer with the entry's marks —
 * blue = cells the clue allows (the game's candidate colour), red = cells that look
 * possible but do not count, plus the Kommissar outline language for references
 * (room outlines, object rings, portal glow). No interaction: it is an illustration.
 */
export default function FaqBoard({ view, axes }: Props) {
  const { t, i18n } = useTranslation()
  const { floorTextures, blockedStyle } = useSettings()
  const board = view.puzzle.board
  const W = board.width
  const H = board.height
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [artTick, setArtTick] = useState(0)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const aw = wrap.clientWidth - (axes ? AXES_W : 0)
      const ah = wrap.clientHeight - (axes ? AXES_H : 0)
      if (aw <= 0 || ah <= 0) return
      const cell = Math.max(14, Math.floor(Math.min(aw / W, ah / H)))
      setLayout({ cell, w: cell * W, h: cell * H })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [W, H, axes])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !layout) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(layout.w * dpr)
    cv.height = Math.round(layout.h * dpr)
    cv.style.width = `${layout.w}px`
    cv.style.height = `${layout.h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, layout.w, layout.h)

    const suspectIndex = new Map<PersonId, number>(view.puzzle.suspects.map((s, i) => [s.id, i]))
    const m = view.marks
    const hasDecor = m.ring?.size || m.rooms?.size || m.redRooms?.size || m.windows || m.doors
    drawBoard(ctx, {
      puzzle: view.puzzle,
      cell: layout.cell,
      origin: { x: 0, y: 0 },
      roomName: (key: string) => t(key),
      suspectIndex,
      placements: view.placements,
      marks: new Map(),
      crosses: m.crosses ?? new Set(),
      highlight: m.blue ?? null,
      highlightColor: CANDIDATE_BLUE,
      highlight2: m.red ?? null,
      highlightColor2: REF_RED,
      reveal: null,
      helpMarks: hasDecor
        ? {
            areas: [],
            ring: m.ring ?? new Set(),
            rooms: m.rooms ?? new Set(),
            windows: m.windows ?? false,
            doors: m.doors ?? false,
            redRing: new Set(),
            redRooms: m.redRooms ?? new Set(),
            redWindows: false,
            redDoors: false,
          }
        : null,
      floorTextures,
      blockedStyle,
    })
  }, [layout, view, artTick, t, i18n.language, floorTextures, blockedStyle])

  // Redraw when bundled board art (e.g. the armchair) finishes loading.
  useEffect(() => onArtReady(() => setArtTick((n) => n + 1)), [])

  return (
    <div ref={wrapRef} className="mk-faq__boardwrap">
      {axes ? (
        <div className="mk-axes">
          {layout && <BoardAxes cols={W} rows={H} cell={layout.cell} active={null} />}
          <canvas ref={canvasRef} />
        </div>
      ) : (
        <canvas ref={canvasRef} />
      )}
    </div>
  )
}
