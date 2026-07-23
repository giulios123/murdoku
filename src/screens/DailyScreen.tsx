import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsButton from '../components/SettingsButton.tsx'
import BloodText from '../components/BloodText.tsx'
import BloodSplatter from '../components/BloodSplatter.tsx'
import DailyName from '../components/DailyName.tsx'
import {
  DAILY_START,
  dailyLevelId,
  dailyStreaks,
  dayInfo,
  daysInMonth,
  firstWeekdayColumn,
  formatDayLong,
  formatMonthShort,
  formatMonthYear,
  formatWeekdayShort,
  getDailyLevel,
  makeKey,
  monthPlan,
  solvedDailyDays,
  todayKey,
  weekdayHeaders,
  type DailyHandle,
} from '../game/daily.ts'
import { levelMetaFromJson, type LevelMeta } from '../game/levels.ts'
import { loadResults, loadSolved } from '../game/storage.ts'

interface Props {
  onPick: (level: LevelMeta) => void
  onBack: () => void
  /** Pre-select this day and open it right away (the win dialog's "next daily"). */
  openDay?: string
}

/** Hand-inked crimson check — "this day is closed". */
const CheckMark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 14 12" aria-hidden="true">
    <path
      d="M1.5 6.8 5 10.2 12.5 1.6"
      stroke="var(--crimson)"
      strokeWidth="2.3"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
)

/** Brass star — solved without a single hint (the solo medal, cell-sized). */
const SoloStar = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M6 .8 7.5 4.2 11.2 4.6 8.4 7 9.2 10.7 6 8.8 2.8 10.7 3.6 7 .8 4.6 4.5 4.2z"
      fill="var(--brass)"
    />
  </svg>
)

export default function DailyScreen({ onPick, onBack, openDay }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language

  const [today] = useState(() => todayKey())
  const [selected, setSelected] = useState(openDay ?? today)
  const [view, setView] = useState(() => {
    const [y, m] = (openDay ?? today).split('-').map(Number)
    return { year: y, month: m }
  })
  const [solved] = useState(() => loadSolved())
  const [results] = useState(() => loadResults())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<DailyHandle | null>(null)

  // Legend + catch-up hint are nice-to-haves that yield when height runs out —
  // decided by MEASURING, not by guessed breakpoints (the real column height
  // varies: 5- vs 6-row months, an extra hero line, …). After layout, if the
  // screen would scroll, drop the hint first, then the legend (2 → 1 → 0); any
  // layout input change re-opens the question. Never scroll is the hard rule.
  const screenRef = useRef<HTMLDivElement>(null)
  const [extras, setExtras] = useState(2)
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional re-measure trigger
    setExtras(2)
  }, [view, selected, lang])
  useLayoutEffect(() => {
    const el = screenRef.current
    if (!el) return
    if (el.scrollHeight > el.clientHeight + 1 && extras > 0) {
      setExtras(extras - 1) // converges in ≤2 steps (2 → 1 → 0), then stops
    }
  }, [extras, view, selected, lang])
  useEffect(() => {
    const onResize = () => setExtras(2)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const info = useMemo(() => dayInfo(selected), [selected])
  const selectedId = dailyLevelId(selected)
  const selectedSolved = solved.has(selectedId)
  const selectedHints = results[selectedId]?.hints

  const plan = useMemo(() => monthPlan(view.year, view.month), [view])
  const days = daysInMonth(view.year, view.month)
  const offset = firstWeekdayColumn(view.year, view.month)
  const headers = useMemo(() => weekdayHeaders(lang), [lang])

  // Month navigation is clamped to [July 2026, current month].
  const ym = view.year * 12 + view.month
  const minYm = DAILY_START.year * 12 + DAILY_START.month
  const [ty, tm] = today.split('-').map(Number)
  const maxYm = ty * 12 + tm
  const shiftMonth = (delta: number) => {
    const next = ym + delta
    if (next < minYm || next > maxYm) return
    const year = Math.floor((next - 1) / 12)
    setView({ year, month: next - year * 12 })
  }

  // Stats: solved count over the VIEWED month's elapsed days + the streaks.
  const monthStats = useMemo(() => {
    let done = 0
    let elapsed = 0
    for (let d = 1; d <= days; d++) {
      const key = makeKey(view.year, view.month, d)
      if (key > today) break
      elapsed++
      if (solved.has(dailyLevelId(key))) done++
    }
    return { done, elapsed }
  }, [view, days, today, solved])
  const streaks = useMemo(() => dailyStreaks(solvedDailyDays(solved), today), [solved, today])

  const open = () => {
    setError(null)
    setBusy(true)
    const handle = getDailyLevel(selected)
    handleRef.current = handle
    handle.promise
      .then((level) => {
        handleRef.current = null
        onPick(levelMetaFromJson(level))
      })
      .catch((err: Error) => {
        handleRef.current = null
        setBusy(false)
        if (err.message !== 'cancelled') setError(t('generate.failed'))
      })
  }

  const cancel = () => {
    handleRef.current?.cancel()
    handleRef.current = null
    setBusy(false)
  }

  // "Next daily" from the win dialog: the player already chose to play on, so the
  // pre-selected day opens straight away. The ref guards against a second run
  // (React StrictMode remounts effects in dev); Cancel just stays on this screen.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (openDay && !autoOpened.current) {
      autoOpened.current = true
      open()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mk-screen" ref={screenRef}>
      <div className="mk-dailyscr">
        <header className="mk-topbar">
          <button type="button" className="mk-back" onClick={onBack} aria-label="back">
            ←
          </button>
          <h1>
            <span className="mk-titleblood">
              <BloodSplatter className="mk-titleblood__splatter" />
              <BloodText text={t('daily.title')} />
            </span>
            <small>{t('daily.subtitle')}</small>
          </h1>
          <SettingsButton />
        </header>

        {/* The selected day as an opened dossier (today by default). */}
        <div className="mk-dailyhero">
          <span className="mk-leaf mk-leaf--big" aria-hidden="true">
            <span className="mk-leaf__band">{formatMonthShort(info.year, info.month, lang)}</span>
            <span className="mk-leaf__day">{info.day}</span>
            <span className="mk-leaf__wd">{formatWeekdayShort(selected, lang)}</span>
          </span>
          <div className="mk-dailyhero__text">
            <span className="mk-dailyhero__kicker">
              {selected === today ? `${t('daily.today')} · ` : ''}
              {formatDayLong(selected, lang)} · {t('daily.caseNo', { n: info.caseNo })}
            </span>
            <span className="mk-dailyhero__title">
              <DailyName difficulty={info.difficulty} />
            </span>
            <span className="mk-dailyhero__meta">
              <span className="mk-pill" data-d={info.difficulty}>
                {t(`difficulty.${info.difficulty}`)}
              </span>
              <span>
                {info.size}×{info.size}
              </span>
              {selectedSolved ? (
                <>
                  <span className="mk-stamp">{t('select.solved')}</span>
                  {selectedHints === 0 && (
                    <span className="mk-dailyhero__solo">
                      <SoloStar /> {t('select.solo')}
                    </span>
                  )}
                  {selectedHints !== undefined && selectedHints > 0 && (
                    <span>{t('select.hintCount', { count: selectedHints })}</span>
                  )}
                </>
              ) : (
                <span>{t('daily.unsolved')}</span>
              )}
            </span>
          </div>
          <button type="button" className="mk-btn mk-btn--primary" onClick={open} disabled={busy}>
            {t('start.play')}
          </button>
        </div>

        {error && <p className="mk-generr">{error}</p>}

        <div className="mk-dailycal">
          <div className="mk-dailycal__nav">
            <button
              type="button"
              className="mk-back"
              onClick={() => shiftMonth(-1)}
              disabled={ym <= minYm}
              aria-label={t('daily.prevMonth')}
            >
              ‹
            </button>
            <span className="mk-dailycal__month">
              {formatMonthYear(view.year, view.month, lang)}
            </span>
            <button
              type="button"
              className="mk-back"
              onClick={() => shiftMonth(1)}
              disabled={ym >= maxYm}
              aria-label={t('daily.nextMonth')}
            >
              ›
            </button>
          </div>
          <div className="mk-dailycal__grid">
            {headers.map((h, i) => (
              <span className="mk-dailycal__wd" key={i}>
                {h}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span className="mk-day mk-day--blank" key={`b${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1
              const key = makeKey(view.year, view.month, d)
              if (key > today) {
                return (
                  <span className="mk-day" data-future="" key={key}>
                    <span className="mk-day__n">{d}</span>
                  </span>
                )
              }
              const id = dailyLevelId(key)
              const isSolved = solved.has(id)
              const solo = isSolved && results[id]?.hints === 0
              return (
                <button
                  type="button"
                  className="mk-day"
                  key={key}
                  data-solved={isSolved || undefined}
                  data-today={key === today || undefined}
                  data-selected={key === selected || undefined}
                  aria-label={formatDayLong(key, lang)}
                  aria-current={key === today ? 'date' : undefined}
                  onClick={() => {
                    setSelected(key)
                    setError(null)
                  }}
                >
                  {isSolved && (solo ? <SoloStar className="mk-day__mark" /> : <CheckMark className="mk-day__mark" />)}
                  <span className="mk-day__n">{d}</span>
                  <i className="mk-day__dot" data-d={plan.difficulties[i]} />
                  {key === today && <span className="mk-day__today">{t('daily.today')}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {extras >= 1 && (
          <div className="mk-dailylegend">
            <span>
              <i className="mk-day__dot" data-d="easy" /> {t('difficulty.easy')}
            </span>
            <span>
              <i className="mk-day__dot" data-d="medium" /> {t('difficulty.medium')}
            </span>
            <span>
              <i className="mk-day__dot" data-d="hard" /> {t('difficulty.hard')}
            </span>
            <span>
              <CheckMark /> {t('daily.legendSolved')}
            </span>
            <span>
              <SoloStar /> {t('daily.legendSolo')}
            </span>
          </div>
        )}
        {extras >= 2 && <p className="mk-dailyhint">{t('daily.catchup')}</p>}

        <div className="mk-dailystats">
          <div className="mk-dailystat">
            <span className="mk-dailystat__n">
              {monthStats.done}
              <small>/{monthStats.elapsed}</small>
            </span>
            <span className="mk-dailystat__l">{t('daily.statSolved')}</span>
          </div>
          <div className="mk-dailystat">
            <span className="mk-dailystat__n">{streaks.current}</span>
            <span className="mk-dailystat__l">{t('daily.statStreak')}</span>
          </div>
          <div className="mk-dailystat">
            <span className="mk-dailystat__n">{streaks.best}</span>
            <span className="mk-dailystat__l">{t('daily.statBest')}</span>
          </div>
        </div>
      </div>

      {busy && (
        <div className="mk-overlay">
          <div className="mk-dialog">
            <span className="mk-spinner" />
            <p>{t('generate.generating')}</p>
            <button type="button" className="mk-btn mk-btn--ghost" onClick={cancel}>
              {t('generate.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
