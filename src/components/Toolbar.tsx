import { memo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  xTool: boolean
  onToggleX: () => void
  /** Eraser armed: tapping/dragging cells wipes them. Mutually exclusive with the X tool. */
  eraseTool: boolean
  onToggleErase: () => void
  onUndo: () => void
  canUndo: boolean
  /** The eraser's BIG reach — wipes the whole board (fires on a long press). */
  onReset: () => void
  onHint: () => void
  onSubmit: () => void
  allPlaced: boolean
  /** Level already finished and being reviewed: the editing tools (X, reset, undo, hint)
   *  are disabled — there's nothing left to solve. */
  locked?: boolean
  legend?: React.ReactNode
}

const HOLD_MS = 700

/**
 * A button with two reaches of the SAME action: a tap fires `onTap`, holding it for HOLD_MS
 * fires `onComplete` instead (the ring shows the escalation). The tap only counts when the
 * hold has NOT completed — so a long press never also triggers the tap.
 */
function HoldButton({
  onComplete,
  onTap,
  className,
  disabled,
  active,
  children,
}: {
  onComplete: () => void
  onTap?: () => void
  className: string
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  const [progress, setProgress] = useState(0)
  const raf = useRef<number | null>(null)
  const start = useRef(0)
  /** Set once the hold completed, so the following pointer-up isn't read as a tap. */
  const fired = useRef(false)

  const stop = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    start.current = 0
    setProgress(0)
  }
  // `now` is the high-res timestamp requestAnimationFrame passes in — no impure call.
  const tick = (now: number) => {
    if (start.current === 0) start.current = now
    const p = Math.min(1, (now - start.current) / HOLD_MS)
    setProgress(p)
    if (p >= 1) {
      fired.current = true
      stop()
      onComplete()
    } else {
      raf.current = requestAnimationFrame(tick)
    }
  }
  const begin = () => {
    if (disabled) return
    fired.current = false
    start.current = 0
    raf.current = requestAnimationFrame(tick)
  }
  /** Released before the ring filled → it was a tap, so the small action runs. */
  const release = () => {
    const wasHolding = raf.current !== null
    stop()
    if (wasHolding && !fired.current) onTap?.()
  }

  return (
    <button
      type="button"
      className={className}
      data-active={active}
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={release}
      // Leaving/cancelling aborts BOTH reaches — sliding off the button is how you back out.
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      {progress > 0 && (
        <span className="mk-tool__ring" style={{ ['--p' as string]: String(progress) }} />
      )}
      {children}
    </button>
  )
}

/**
 * A hand-drawn eraser, in the same case-file line art as the hint badges — never an emoji.
 * Held at a slant mid-stroke: the sleeve band across it, the worn nose down on the paper,
 * the desk line it rubs along, and two crumbs kicked out behind. The crumbs are what make it
 * read as *erasing* rather than as a blank block — and they suit a detective rubbing
 * something out of the file.
 */
const ERASER_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {/* the rubber block, tilted as if held mid-stroke */}
    <path d="M10.4 18.6 4.9 13.1a1.5 1.5 0 0 1 0-2.1l7.4-7.4a1.5 1.5 0 0 1 2.1 0l5.5 5.5a1.5 1.5 0 0 1 0 2.1l-6.3 6.3a1.5 1.5 0 0 1-1.1.5h-2.1Z" />
    {/* the sleeve band — the line every eraser has across its middle */}
    <path d="M9.1 7.2 16.8 14.9" strokeWidth="1.5" />
    {/* the desk/paper line it is rubbing along */}
    <path d="M3.5 21h13" />
    {/* crumbs kicked out behind the stroke */}
    <path d="M19.4 19.6h.01M21.6 17.1h.01" strokeWidth="2.2" />
  </svg>
)

function Toolbar({
  xTool,
  onToggleX,
  eraseTool,
  onToggleErase,
  onUndo,
  canUndo,
  onReset,
  onHint,
  onSubmit,
  allPlaced,
  locked = false,
  legend,
}: Props) {
  const { t } = useTranslation()

  return (
    <aside className="mk-tools">
      <span className="mk-tools__label">{t('game.tools')}</span>

      <button
        type="button"
        className="mk-tool mk-tool--x"
        data-active={xTool}
        onClick={onToggleX}
        disabled={locked}
      >
        <span className="mk-tool__icon">✕</span>
        <span>{t('tool.x')}</span>
        <span className="mk-tool__sub">{t('tool.xSub')}</span>
      </button>

      {/* One verb, two reaches: a tap arms the eraser for single cells, holding it wipes the
          whole board. The ring that fills while holding is what teaches the escalation. */}
      <HoldButton
        className="mk-tool mk-tool--erase"
        onComplete={onReset}
        onTap={onToggleErase}
        active={eraseTool}
        disabled={locked}
      >
        <span className="mk-tool__icon">{ERASER_ICON}</span>
        <span>{t('tool.erase')}</span>
        <span className="mk-tool__sub">{t(eraseTool ? 'tool.eraseActive' : 'tool.eraseHold')}</span>
      </HoldButton>

      <button type="button" className="mk-tool mk-tool--undo" onClick={onUndo} disabled={locked || !canUndo}>
        <span className="mk-tool__icon">↶</span>
        <span>{t('tool.undo')}</span>
      </button>

      <button type="button" className="mk-tool mk-tool--hint" onClick={onHint} disabled={locked}>
        <span className="mk-tool__icon">💡</span>
        <span>{t('tool.hint')}</span>
      </button>

      {legend}

      <button
        type="button"
        className="mk-tool mk-tool--submit"
        onClick={onSubmit}
        disabled={!allPlaced}
      >
        <span>{t('tool.submit')}</span>
        {!allPlaced && <span className="mk-tool__sub">{t('tool.submitLocked')}</span>}
      </button>
    </aside>
  )
}

// Memoized: the game screen re-renders on selection/hint state the toolbar doesn't care
// about — its own inputs (tool flags + stable handlers) rarely move.
export default memo(Toolbar)
