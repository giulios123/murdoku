import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import LanguageSelect from '../components/LanguageSelect.tsx'
import BloodText from '../components/BloodText.tsx'
import BloodSplatter from '../components/BloodSplatter.tsx'
import DailyName from '../components/DailyName.tsx'
import { dailyLevelId, dayInfo, formatMonthShort, todayKey } from '../game/daily.ts'
import { loadAuthorTools, loadSolved, saveAuthorTools } from '../game/storage.ts'

/* Hand-inked, line-art case-file icons (no emoji): brass strokes via currentColor,
 * crimson accents (threads / pins / fresh stamp) via the .mk-ic-red* classes. */

/** Tutorial — a magnifier examining a fingerprint: "learn to investigate". */
const IconTutorial = (
  <svg className="mk-tile__svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6.5 20.6C6.5 15.9 10.4 12 15.1 12c2 0 3.9.7 5.3 1.9" />
      <path d="M9 21c0-3.3 2.7-6 6-6 1.5 0 2.9.6 4 1.6" />
      <path d="M11.6 21.4c0-1.9 1.6-3.4 3.5-3.4.9 0 1.8.4 2.4 1" />
    </g>
    <circle cx="18.4" cy="13.4" r="6.5" stroke="currentColor" strokeWidth="1.8" />
    <line x1="23.2" y1="18.2" x2="28" y2="23" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
  </svg>
)

/** Editor — a corkboard of pinned notes joined by red thread: "assemble your case". */
const IconEditor = (
  <svg className="mk-tile__svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="3.5" y="5.5" width="25" height="21" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path className="mk-ic-red" d="M9 11 L23 10.5 L15.5 21.7 Z" strokeWidth="1.1" strokeLinejoin="round" />
    <rect x="6.4" y="8.4" width="5.2" height="4" rx="0.6" stroke="currentColor" strokeWidth="1" />
    <rect x="20" y="8" width="5.2" height="4" rx="0.6" stroke="currentColor" strokeWidth="1" />
    <rect x="12.9" y="19.7" width="5.2" height="4" rx="0.6" stroke="currentColor" strokeWidth="1" />
    <circle className="mk-ic-red-fill" cx="9" cy="11" r="1.5" />
    <circle className="mk-ic-red-fill" cx="23" cy="10.5" r="1.5" />
    <circle className="mk-ic-red-fill" cx="15.5" cy="21.7" r="1.5" />
  </svg>
)

/** Userlevel — an envelope with a crimson wax seal: "cases sent in by the community". */
const IconUserLevels = (
  <svg className="mk-tile__svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="3.5" y="7.5" width="25" height="17" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4.5 9 16 17.5 27.5 9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M4.5 23 12.5 16.5M27.5 23 19.5 16.5" stroke="currentColor" strokeWidth="1.1" />
    <circle className="mk-ic-red-fill" cx="16" cy="19.5" r="3.4" opacity="0.9" />
    <path
      d="M16 17.6 l0.6 1.2 1.3.2 -0.95.9 .25 1.3 -1.2 -.6 -1.2.6 .25 -1.3 -.95 -.9 1.3 -.2z"
      fill="#131119"
      stroke="none"
    />
  </svg>
)

/** Level generieren — a rubber stamp pressing a fresh case mark: "a new case is issued". */
const IconGenerate = (
  <svg className="mk-tile__svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="12" y="4.5" width="8" height="5" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
    <path d="M16 9.5V12M11 12h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="9.5" y="12" width="13" height="4.6" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
    <ellipse className="mk-ic-red" cx="16" cy="23.6" rx="9" ry="3.4" strokeWidth="1.3" />
    <path
      className="mk-ic-red"
      d="M16 21.7V25.5M14.3 22.7 17.7 24.5M17.7 22.7 14.3 24.5"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
  </svg>
)

export default function StartScreen({
  onPlay,
  onDaily,
  onGenerate,
  onTutorial,
  onUserLevels,
  onEditor,
  onFaq,
  onQuit,
}: {
  onPlay: () => void
  onDaily: () => void
  onGenerate: () => void
  onTutorial: () => void
  onUserLevels: () => void
  onEditor: () => void
  /** Opens the Handakte (the clue reference / FAQ). */
  onFaq: () => void
  /** Native app only: quit Murdoku (no system back bar in immersive mode). */
  onQuit?: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  // Today's case for the ticket — pure date math (the level is never generated here).
  const [daily] = useState(() => {
    const key = todayKey()
    return { info: dayInfo(key), solved: loadSolved().has(dailyLevelId(key)) }
  })

  // Geheime Geste: 5× schnell auf das Wortzeichen tippen schaltet die Autoren-
  // Werkzeuge (JSON-Export-Icons) um. Die Bestätigung schwebt absolut unter dem
  // Wortzeichen — nichts im Layout springt.
  const taps = useRef({ count: 0, last: 0 })
  const [authorNote, setAuthorNote] = useState<string | null>(null)
  const noteTimer = useRef(0)
  const wordmarkTap = () => {
    const now = Date.now()
    taps.current.count = now - taps.current.last < 1500 ? taps.current.count + 1 : 1
    taps.current.last = now
    if (taps.current.count < 5) return
    taps.current.count = 0
    const on = !loadAuthorTools()
    saveAuthorTools(on)
    setAuthorNote(t(on ? 'start.authorOn' : 'start.authorOff'))
    window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setAuthorNote(null), 2200)
  }

  return (
    <div className="mk-screen">
      {/* Handakte: the clue reference, tucked into the top-left corner like the
          in-game legend trigger (round, brass "?"). */}
      <button type="button" className="mk-start__faq" onClick={onFaq} title={t('faq.title')}>
        ?
      </button>
      <svg className="mk-start__thread" preserveAspectRatio="none" viewBox="0 0 100 100">
        <line x1="8" y1="14" x2="92" y2="78" stroke="#cf463c" strokeWidth="0.18" opacity="0.5" />
        <line x1="90" y1="10" x2="14" y2="86" stroke="#cf463c" strokeWidth="0.18" opacity="0.5" />
        <circle cx="8" cy="14" r="0.7" fill="#e2b75e" />
        <circle cx="92" cy="78" r="0.7" fill="#e2b75e" />
        <circle cx="90" cy="10" r="0.7" fill="#e2b75e" />
        <circle cx="14" cy="86" r="0.7" fill="#e2b75e" />
      </svg>

      <main className="mk-start">
        <div className="mk-start__inner">
          <p className="mk-start__kicker">{t('start.kicker')}</p>
          <h1 className="mk-wordmark" onClick={wordmarkTap}>
            MURD<em>O</em>KU
            {authorNote && <span className="mk-authorchip">{authorNote}</span>}
          </h1>
          <div className="mk-credits">
            <p className="mk-credits__line">
              {t('start.original_idea')}{' '}
              <a
                className="mk-credits__name"
                href="https://murdoku.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Manuel Garand
              </a>
            </p>
            <p className="mk-credits__line">
              {t('start.fan_version')}{' '}
              <a
                className="mk-credits__name"
                href="https://apo-games.de/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Dirk Aporius
              </a>
            </p>
          </div>
          <p className="mk-start__tag">
            <BloodSplatter className="mk-start__splatter" />
            <BloodText text={t('app.subtitle')} />
          </p>
          <div className="mk-start__cta">
            <button type="button" className="mk-btn mk-btn--primary" onClick={onPlay}>
              {t('start.play')}
            </button>
          </div>
          {/* The daily case as a slim ticket: pinned tear-off calendar leaf, the full
              name ("Schweres Rätsel des Tages"), facts in the typewriter line. A brass
              spine (not the tiles' crimson) marks it as the special of the day. */}
          <button
            type="button"
            className="mk-daily"
            onClick={onDaily}
            data-solved={daily.solved || undefined}
          >
            <span className="mk-leaf mk-leaf--mini" aria-hidden="true">
              <span className="mk-leaf__band">
                {formatMonthShort(daily.info.year, daily.info.month, lang)}
              </span>
              <span className="mk-leaf__day">{daily.info.day}</span>
            </span>
            <span className="mk-daily__text">
              <span className="mk-daily__pre">
                {t('daily.today')} · {t('daily.caseNo', { n: daily.info.caseNo })} ·{' '}
                {daily.info.size}×{daily.info.size}
              </span>
              <span className="mk-daily__title">
                <DailyName difficulty={daily.info.difficulty} />
              </span>
            </span>
            {daily.solved ? (
              <span className="mk-stamp">{t('select.solved')}</span>
            ) : (
              <span className="mk-daily__go">›</span>
            )}
          </button>
          <div className="mk-start__more">
            <button type="button" className="mk-tile" onClick={onTutorial}>
              <span className="mk-tile__icon">{IconTutorial}</span>
              <span className="mk-tile__label">{t('start.tutorial')}</span>
              <span className="mk-tile__no">№ 001</span>
            </button>
            <button type="button" className="mk-tile" onClick={onUserLevels}>
              <span className="mk-tile__icon">{IconUserLevels}</span>
              <span className="mk-tile__label">{t('start.userlevels')}</span>
              <span className="mk-tile__no">№ 002</span>
            </button>
            <button type="button" className="mk-tile" onClick={onEditor}>
              <span className="mk-tile__icon">{IconEditor}</span>
              <span className="mk-tile__label">{t('start.editor')}</span>
              <span className="mk-tile__no">№ 003</span>
            </button>
            <button type="button" className="mk-tile" onClick={onGenerate}>
              <span className="mk-tile__icon">{IconGenerate}</span>
              <span className="mk-tile__label">{t('start.generate')}</span>
              <span className="mk-tile__no">№ 004</span>
            </button>
          </div>
          <div className="mk-start__lang">
            <LanguageSelect dropUp />
          </div>
          {onQuit && (
            <button type="button" className="mk-start__quit" onClick={onQuit}>
              {t('start.quit')}
            </button>
          )}
        </div>
      </main>
      <p className="mk-start__credit">{t('start.credit')}</p>
    </div>
  )
}
