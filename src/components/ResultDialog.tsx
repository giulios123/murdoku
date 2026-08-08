import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from './Avatar.tsx'
import type { AvatarAttrs } from '../game/avatar.ts'
import { USERLEVEL_TAGS } from '../game/userlevels.ts'
import { keepFieldVisible } from '../game/keyboard.ts'

interface Props {
  win: boolean
  /** On a win: hints used this solve (0 → the "solo" medal; undefined → unknown, no badge). */
  hintsUsed?: number
  murderer: { name: string; room: string } | null
  /** The murderer's avatar (shown alongside the reveal on a win). */
  avatar?: { attrs: AvatarAttrs; color: string; letter: string } | null
  /** On a loss: human-readable clues the current placement fails to satisfy. */
  failures?: string[]
  /** On a win: jump straight to the next level (omitted when none is available). */
  onNext?: () => void
  onRetry: () => void
  /** On a win: replay this level from scratch. */
  onRestart?: () => void
  /** On a win: tuck the verdict away to look at the solved board (tap the board to
   *  bring it back). Omitted on a loss, which stays modal. */
  onDismiss?: () => void
  onBack: () => void
  /** Generated-level extras (only shown on a win of a freshly generated level). */
  generated?: boolean
  saved?: boolean
  defaultName?: string
  onSave: (name: string) => void
  onExport: (name: string) => void
  onNew?: () => void
  /** Community level, first win: offer the one-time rating (1–5 stars, ≤ 2 properties).
   *  Sending is optional — every other action simply skips it. Resolves false when the
   *  server couldn't be reached (rating only works online) — the dialog then says so
   *  and lets the player try again. */
  onRate?: (stars: number, tags: string[]) => Promise<boolean>
  /** Community level: the level's overall verdict (Ø stars + top properties), shown
   *  with the win regardless of whether the player still gets to rate. */
  community?: { stars: number | null; ratings: number; tags: string[]; nologic: boolean } | null
}

export default function ResultDialog({
  win,
  hintsUsed,
  murderer,
  avatar,
  failures,
  onNext,
  onRetry,
  onRestart,
  onDismiss,
  onBack,
  generated,
  saved,
  defaultName,
  onSave,
  onExport,
  onNew,
  onRate,
  community,
}: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  const showGen = win && generated
  // One-time community rating: the five (initially hollow) stars are always visible —
  // one slim, universally readable "rate me" row. Only once a star is tapped do the
  // property dropdowns + send button unfold, so the verdict stays short on small
  // phones without hiding the invitation behind a button.
  const [stars, setStars] = useState(0)
  const [tag1, setTag1] = useState('')
  const [tag2, setTag2] = useState('')
  const [rateSent, setRateSent] = useState(false)
  const [rateSending, setRateSending] = useState(false)
  const [rateFailed, setRateFailed] = useState(false)
  // The "back" button is the only secondary when there's no restart sibling and no
  // generated save/export pair (i.e. a loss) — then it spans the full row instead of
  // sitting in one half of the 2-column grid.
  const backAlone = !showGen && !(win && onRestart)
  const [name, setName] = useState(defaultName ?? '')
  const value = () => name.trim() || (defaultName ?? '')
  // A touch device pops the on-screen keyboard when the field auto-focuses, which is
  // annoying right after a generated win (mobile browser AND the Android app). Only
  // auto-focus where a physical keyboard exists (fine pointer = desktop mouse/trackpad).
  const autoFocusName =
    typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches

  return (
    <div
      className="mk-overlay"
      data-dismissible={onDismiss ? 'true' : undefined}
      // Tapping the dimmed backdrop (never the card itself) tucks the verdict away so
      // the solved board is visible. `onClick` already ignores a scroll/drag on touch.
      onClick={onDismiss ? (e) => e.target === e.currentTarget && onDismiss() : undefined}
    >
      <div className="mk-dialog" role="dialog" aria-modal="true">
        {win && hintsUsed === 0 && (
          <span className="mk-dialog__medal" aria-hidden="true">
            <svg viewBox="0 0 40 46" fill="none" stroke="currentColor" strokeLinejoin="round">
              <path className="mk-dialog__ribbon" d="M14 3 L17 20 M26 3 L23 20" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="20" cy="30" r="13" strokeWidth="2.2" fill="rgba(226,183,94,0.1)" />
              <circle cx="20" cy="30" r="9" strokeWidth="0.9" />
              <path d="M20 23.5 l1.9 3.9 4.3.6 -3.1 3 .8 4.3 -3.8 -2 -3.8 2 .8 -4.3 -3.1 -3 4.3 -.6z" fill="currentColor" stroke="none" />
            </svg>
          </span>
        )}
        <span className="mk-dialog__stamp" data-win={win}>
          {win ? t('result.winStamp') : t('result.loseStamp')}
        </span>
        <h3>{win ? t('result.winTitle') : t('result.loseTitle')}</h3>
        <p>{win ? t('result.winBody') : t('result.loseBody')}</p>
        {win && hintsUsed !== undefined && (
          <p className="mk-dialog__solo" data-solo={hintsUsed === 0}>
            {hintsUsed === 0 ? t('result.soloHonor') : t('result.hintsUsed', { count: hintsUsed })}
          </p>
        )}
        {win && murderer && (
          <div className="mk-dialog__murderer">
            {avatar && (
              <Avatar
                className="mk-dialog__avatar"
                attrs={avatar.attrs}
                color={avatar.color}
                letter={avatar.letter}
              />
            )}
            <p>{t('result.winMurderer', { name: murderer.name, room: murderer.room })}</p>
          </div>
        )}
        {win && community && (
          // The case's community verdict — same vocabulary as the picker cards.
          <p className="mk-dialog__community">
            <span className="mk-dialog__community-label">{t('rate.community')}</span>
            <span className="mk-ul-stars" data-unrated={community.stars === null || undefined}>
              {community.stars === null
                ? '★ –'
                : `★ ${community.stars.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${community.ratings})`}
            </span>
            {community.tags.map((tag) => (
              <span key={tag} className="mk-ul-tag">
                {t(`tag.${tag}`)}
              </span>
            ))}
            {community.nologic && (
              <span className="mk-ul-tag" data-nologic="true">
                {t('tag.nologic')}
              </span>
            )}
          </p>
        )}
        {win && onRate && (
          // After sending NOTHING is swapped out — the chosen stars stay, the inputs
          // freeze, only the send button turns into the green confirmation. The dialog
          // keeps its exact height, so the verdict never "flashes"/re-centres.
          <div className="mk-rate" data-sent={rateSent || undefined}>
            <div className="mk-rate__row">
              <span className="mk-rate__yours">{t('rate.yours')}</span>
              <div className="mk-rate__stars" role="radiogroup" aria-label={t('rate.starsLabel')}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="mk-rate__star"
                    data-on={n <= stars || undefined}
                    role="radio"
                    aria-checked={stars === n}
                    aria-label={`${n} ★`}
                    disabled={rateSent || rateSending}
                    onClick={() => setStars(n)}
                  >
                    {n <= stars ? '★' : '☆'}
                  </button>
                ))}
              </div>
            </div>
            {stars > 0 && (
              <>
                <p className="mk-rate__tagslabel">{t('rate.tagsLabel')}</p>
                <div className="mk-rate__tagrow">
                  {[
                    { value: tag1, set: setTag1, other: tag2 },
                    { value: tag2, set: setTag2, other: tag1 },
                  ].map(({ value, set, other }, i) => (
                    <select
                      key={i}
                      className="mk-select-input mk-rate__select"
                      aria-label={`${t('rate.tagsLabel')} ${i + 1}`}
                      value={value}
                      disabled={rateSent || rateSending}
                      onChange={(e) => set(e.target.value)}
                    >
                      <option value="">–</option>
                      {USERLEVEL_TAGS.filter((tag) => tag !== other).map((tag) => (
                        <option key={tag} value={tag}>
                          {t(`tag.${tag}`)}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
                {rateFailed && !rateSent && (
                  <p className="mk-rate__failed">{t('rate.failed')}</p>
                )}
                <button
                  type="button"
                  className="mk-btn mk-btn--ghost mk-btn--wide mk-rate__send"
                  data-sent={rateSent || undefined}
                  disabled={rateSending || rateSent}
                  onClick={() => {
                    setRateSending(true)
                    setRateFailed(false)
                    void onRate(stars, [tag1, tag2].filter((tag) => tag !== '')).then((sent) => {
                      setRateSending(false)
                      if (sent) setRateSent(true)
                      else setRateFailed(true)
                    })
                  }}
                >
                  {rateSending ? '…' : rateSent ? `✓ ${t('rate.sent')}` : t('rate.send')}
                </button>
              </>
            )}
          </div>
        )}
        {/* A plain rule between the rating row and the regular verdict buttons.
            (Not .mk-divider: the dialog grid centers children at content width,
            which collapses a label-less divider to 0px — this one is full width.) */}
        {win && onRate && <div className="mk-dialog__rule" aria-hidden="true" />}
        {!win && failures && failures.length > 0 && (
          <div className="mk-dialog__clues">
            <p className="mk-dialog__clues-title">{t('result.loseClues')}</p>
            <ul>
              {failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {showGen && (
          // "Save level" section: the header sits above the name field (naming IS part of
          // saving), then the name input, then the Keep / As JSON buttons.
          <div className="mk-savegroup">
            <div className="mk-divider">
              <span className="mk-divider__label">{t('result.groupSave')}</span>
            </div>
            <div className="mk-nameform">
              <label htmlFor="mk-lvlname">{t('result.nameLabel')}</label>
              <input
                id="mk-lvlname"
                type="text"
                autoFocus={autoFocusName}
                value={name}
                maxLength={40}
                placeholder={t('result.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
                onFocus={keepFieldVisible}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !saved) onSave(value())
                }}
              />
            </div>
            <div className="mk-actiongrid">
              <button
                type="button"
                className="mk-btn mk-btn--ghost"
                onClick={() => onSave(value())}
                disabled={saved}
              >
                {/* the "saved" label already carries a ✓ — drop the leading icon then */}
                {!saved && <span className="mk-btn__ic" aria-hidden="true">✓</span>}
                {saved ? t('result.saved') : t('result.save')}
              </button>
              <button type="button" className="mk-btn mk-btn--ghost" onClick={() => onExport(value())}>
                <span className="mk-btn__ic" aria-hidden="true">↧</span>
                {t('result.export')}
              </button>
            </div>
          </div>
        )}

        {showGen ? (
          // Generated win, "play on" section (the save section with its own header sits
          // above, grouped with the name field). New level is the primary action.
          <div className="mk-actiongrid">
            <div className="mk-divider">
              <span className="mk-divider__label">{t('result.groupPlay')}</span>
            </div>
            <button type="button" className="mk-btn mk-btn--primary mk-btn--wide" onClick={onNew}>
              <span className="mk-btn__ic" aria-hidden="true">✦</span>
              {t('result.new')}
            </button>
            {onRestart && (
              <button
                type="button"
                className="mk-btn mk-btn--ghost mk-btn--restart"
                onClick={onRestart}
              >
                <span className="mk-btn__ic" aria-hidden="true">↻</span>
                {t('result.restart')}
              </button>
            )}
            <button type="button" className="mk-btn mk-btn--ghost" onClick={onBack}>
              <span className="mk-btn__ic" aria-hidden="true">←</span>
              {t('result.backGen')}
            </button>
          </div>
        ) : (
          // Loss / non-generated win: one grid, primary full width on top, the rest 2-column.
          <div className="mk-actiongrid">
            {!win && (
              <button type="button" className="mk-btn mk-btn--primary mk-btn--wide" onClick={onRetry}>
                <span className="mk-btn__ic" aria-hidden="true">⌕</span>
                {t('result.retry')}
              </button>
            )}
            {win && onNext && (
              <button type="button" className="mk-btn mk-btn--primary mk-btn--wide" onClick={onNext}>
                <span className="mk-btn__ic" aria-hidden="true">→</span>
                {t('result.nextLevel')}
              </button>
            )}
            {win && onRestart && (
              <button
                type="button"
                className="mk-btn mk-btn--ghost mk-btn--restart"
                onClick={onRestart}
              >
                <span className="mk-btn__ic" aria-hidden="true">↻</span>
                {t('result.restart')}
              </button>
            )}
            <button
              type="button"
              className={[
                'mk-btn',
                win && !generated && !onNext ? 'mk-btn--primary' : 'mk-btn--ghost',
                backAlone ? 'mk-btn--wide' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={onBack}
            >
              <span className="mk-btn__ic" aria-hidden="true">←</span>
              {t('result.back')}
            </button>
          </div>
        )}

        {onDismiss && (
          <button
            type="button"
            className="mk-dialog__peek"
            // Only the generated verdict is tall enough to feel cramped on a phone —
            // drop the footnote there; other verdicts keep it (they have room).
            data-gen={showGen ? 'true' : undefined}
            onClick={onDismiss}
          >
            {t('result.peekHint')}
          </button>
        )}
      </div>
    </div>
  )
}
