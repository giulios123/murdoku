import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TutorialRules from './TutorialRules.tsx'
import type { CoachView } from '../game/useTutorialFlow.ts'

/**
 * Tutorial coach card. For info/select steps it dims the screen and spotlights
 * the targeted element; for note/place steps it leaves the board bright (the
 * dark-blue candidates are drawn on the board) and just shows the card.
 */
export default function Coach({ view }: { view: CoachView }) {
  const { t } = useTranslation()
  const [rect, setRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const el = view.dim && view.target ? document.querySelector(view.target) : null
      // A target that exists but is display:none (the other layout's element after a
      // mid-script resize) measures 0×0 — treat it like a missing target: full dim
      // instead of a spotlight hole at 0,0.
      if (!el || el.getBoundingClientRect().width === 0) {
        setRect(null)
        return
      }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      setRect(el.getBoundingClientRect())
    }
    measure()
    if (!view.dim || !view.target) return
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const id = window.setInterval(measure, 400)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.clearInterval(id)
    }
  }, [view.target, view.dim])

  // Steps that spotlight a centered dialog pin the card to the top (clear of the dialog
  // and its buttons below). Bright steps use the computed cardSide; dim steps sit opposite
  // their spotlight.
  const placement = view.dialogStep
    ? 'top'
    : !view.dim
      ? view.cardSide
      : rect
        ? rect.top + rect.height / 2 < window.innerHeight / 2
          ? 'bottom'
          : 'top'
        : 'center'

  return (
    <div className="mk-coach">
      {view.dim &&
        (rect ? (
          <div
            className="mk-coach__hole"
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
              width: rect.width + 12,
              height: rect.height + 12,
            }}
          />
        ) : (
          <div className="mk-coach__dim" />
        ))}

      <div
        className="mk-coach__card"
        data-placement={placement}
        data-dialog={view.dialogStep ? 'true' : undefined}
        data-visual={view.visual}
      >
        <div className="mk-coach__head">
          <span className="mk-coach__badge">🕵️</span>
          <span className="mk-coach__step">{view.stepLabel}</span>
          <button type="button" className="mk-coach__skip" onClick={view.onSkip}>
            {t('tutorial.skip')}
          </button>
        </div>
        <h3>{view.title}</h3>
        <p>{view.body}</p>
        {view.visual === 'rules' && <TutorialRules />}
        {view.error && <p className="mk-coach__error">{view.error}</p>}
        {view.showNext && (
          <div className="mk-coach__nav">
            <button type="button" className="mk-btn mk-btn--primary" onClick={view.onNext}>
              {t('tutorial.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
