import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsButton from '../components/SettingsButton.tsx'
import BloodText from '../components/BloodText.tsx'
import BloodSplatter from '../components/BloodSplatter.tsx'
import FilterDropdown from '../components/FilterDropdown.tsx'
import Avatar from '../components/Avatar.tsx'
import AttrIcons from '../components/AttrIcons.tsx'
import ClueText, { BoardClueText } from '../components/ClueText.tsx'
import FaqBoard from '../components/FaqBoard.tsx'
import { Renderer } from '../i18n/Renderer.ts'
import { suspectColor } from '../game/palette.ts'
import {
  FAQ_CATEGORIES,
  findFaqEntry,
  resolveVariant,
  type FaqEntry,
  type FaqVariant,
} from '../game/faqEntries.ts'

interface Props {
  onBack: () => void
  /** Open at this entry (the in-game "look it up" jump). */
  initialEntry?: string
  /** Render as a full-screen layer ON TOP of the running game (position fixed +
   *  opaque backdrop) — the level underneath stays mounted, ← simply closes. */
  layer?: boolean
}

/**
 * The Handakte: the investigator's reference binder for every clue kind. Category
 * tabs → the kinds of that category → one dossier card with the REAL clue sentence,
 * a live demo board (marks straight from the engine) and the explanation. Variant
 * chips swap the example clue and recompute the board — the reference is something
 * to poke at, not just to read.
 */
export default function FaqScreen({ onBack, initialEntry, layer }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language

  // Opens on "beside an object" (Dirk's choice) — the flagship example, not the
  // rule prose of the basics category. An in-game jump lands on ITS entry instead.
  const initial = initialEntry ? findFaqEntry(initialEntry) : null
  const [catId, setCatId] = useState(initial?.category.id ?? 'objects')
  const [entryId, setEntryId] = useState(initial?.entry.id ?? 'nearObject')
  const [variantIdx, setVariantIdx] = useState(0)

  const category = FAQ_CATEGORIES.find((cat) => cat.id === catId) ?? FAQ_CATEGORIES[0]
  const entry: FaqEntry = category.entries.find((e) => e.id === entryId) ?? category.entries[0]
  const variant: FaqVariant = entry.variants[Math.min(variantIdx, entry.variants.length - 1)]

  const pickCategory = (id: string) => {
    const cat = FAQ_CATEGORIES.find((x) => x.id === id)
    if (!cat) return
    setCatId(id)
    setEntryId(cat.entries[0].id)
    setVariantIdx(0)
  }
  const pickEntry = (id: string) => {
    setEntryId(id)
    setVariantIdx(0)
  }

  // Cheap enough to recompute per render (36 tiny cells) — the React Compiler
  // memoizes what it can, and the canvas layers behind drawBoard are cached anyway.
  const view = resolveVariant(entry, variant)

  // The real clue renderer over the demo puzzle — the sentence IS the in-game text.
  const renderer = view
    ? new Renderer(i18n.getResourceBundle(lang, 'translation'), view.puzzle)
    : null

  const subject = view?.subject ? view.puzzle.suspects.find((s) => s.id === view.subject) : null
  const subjectIdx = subject && view ? view.puzzle.suspects.findIndex((s) => s.id === subject.id) : 0

  // Which legend keys the current marks actually use — no dead legend rows.
  const legendKeys: { key: string; k: string }[] = []
  if (view) {
    const m = view.marks
    if (m.blue?.size) legendKeys.push({ key: 'faq.legendBlue', k: 'blue' })
    if (m.red?.size) legendKeys.push({ key: 'faq.legendRed', k: 'red' })
    if (m.crosses?.size) legendKeys.push({ key: 'faq.legendCross', k: 'cross' })
    if (m.rooms?.size || m.ring?.size || m.windows || m.doors)
      legendKeys.push({ key: 'faq.legendRoom', k: 'room' })
    if (m.redRooms?.size) legendKeys.push({ key: 'faq.legendRoomRed', k: 'roomred' })
  }

  // The same legend lines the game shows when a board relies on them.
  let boardNote: string | null = null
  if (view && entry.legend === 'water') boardNote = t('game.waterWalkable')
  else if (view && entry.legend === 'outside') {
    const outside = [...view.puzzle.board.rooms.values()]
      .filter((r) => r.outside)
      .map((r) => t(r.nameKey))
    boardNote = outside.length > 0 ? `${t('game.outsideLabel')}: ${outside.join(', ')}` : null
  }

  const trapKey = `faq.e.${entry.id}.trap`
  const hasTrap = i18n.exists(trapKey)

  // The two selectors, in the level picker's filter vocabulary: the noir dropdown
  // on desktop, the native <select> on phones (the .mk-filtergroup CSS switches).
  // Dropdowns instead of tabs on purpose — eight category labels never fit in one
  // row in every language, and Spanish already overflowed on desktop.
  const catOptions = FAQ_CATEGORIES.map((cat) => ({ value: cat.id, label: t(`faq.cat.${cat.id}`) }))
  const entryOptions = category.entries.map((e) => ({ value: e.id, label: t(`faq.e.${e.id}.title`) }))
  const selectors: { key: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }[] = [
    { key: 'cat', label: t('faq.filterCat'), value: category.id, options: catOptions, onChange: pickCategory },
    { key: 'entry', label: t('faq.filterEntry'), value: entry.id, options: entryOptions, onChange: pickEntry },
  ]

  return (
    <div className={layer ? 'mk-screen mk-faq-layer' : 'mk-screen'}>
      <div className="mk-faq">
        {/* Title bar + selectors stay pinned while the dossier card scrolls beneath
            them — same recipe as the level picker's head. */}
        <div className="mk-faq__head">
          <header className="mk-topbar">
            <button type="button" className="mk-back" onClick={onBack} aria-label="back">
              ←
            </button>
            <h1>
              <span className="mk-titleblood">
                <BloodSplatter className="mk-titleblood__splatter" />
                <BloodText text={t('faq.title')} />
              </span>
              <small>{t('faq.subtitle')}</small>
            </h1>
            <SettingsButton />
          </header>

          <div className="mk-filters">
            {selectors.map((s) => (
              <div className="mk-filtergroup" key={s.key}>
                <span className="mk-filtergroup__label">{s.label}</span>
                <FilterDropdown
                  label={s.label}
                  value={s.value}
                  options={s.options}
                  onChange={s.onChange}
                />
                <select
                  className="mk-select-input mk-filterselect"
                  aria-label={s.label}
                  value={s.value}
                  onChange={(e) => s.onChange(e.target.value)}
                >
                  {s.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* The dossier card of the selected kind. */}
        <article className="mk-faq__card">
          <h2 className="mk-faq__cardtitle">{t(`faq.e.${entry.id}.title`)}</h2>

          {entry.variants.length > 1 && (
            <div className="mk-faq__variants">
              {entry.variants.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className="mk-faq__variant"
                  data-active={v === variant || undefined}
                  onClick={() => setVariantIdx(i)}
                >
                  {v.labelKey ? t(v.labelKey) : String(i + 1)}
                </button>
              ))}
            </div>
          )}

          {/* The example sentence, exactly as the game renders it. */}
          {view && renderer && subject && view.clue && (
            <div className="mk-faq__quote" data-suspect={subject.id}>
              <Avatar
                className="mk-avatar"
                attrs={subject.attributes}
                color={suspectColor(subjectIdx)}
                letter={subject.id}
              />
              <span className="mk-faq__quotemain">
                <span className="mk-clue__name">
                  {subject.name}
                  <AttrIcons attrs={subject.attributes} />
                </span>
                <span className="mk-clue__text">
                  <ClueText renderer={renderer} clues={[view.clue]} subjectId={subject.id} />
                </span>
              </span>
            </div>
          )}
          {view && renderer && view.boardClue && (
            <div className="mk-faq__quote mk-faq__quote--board">
              <span className="mk-boardclue__icon">🔍</span>
              <span className="mk-clue__text">
                <BoardClueText renderer={renderer} describe={view.boardClue.describe()} />
              </span>
            </div>
          )}

          <div className="mk-faq__detail">
            {view && (
              <div className="mk-faq__boardcol">
                <FaqBoard view={view} axes={entry.axes} />
                {(legendKeys.length > 0 || boardNote) && (
                  <div className="mk-faq__legend">
                    {legendKeys.map(({ key, k }) => (
                      <span key={k} className="mk-faq__key" data-k={k}>
                        {t(key)}
                      </span>
                    ))}
                    {boardNote && <span className="mk-faq__note">{boardNote}</span>}
                  </div>
                )}
              </div>
            )}

            <div className="mk-faq__text">
              {t(`faq.e.${entry.id}.body`)
                .split('\n')
                .map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              {hasTrap && (
                <p className="mk-faq__trap">
                  <strong>{t('faq.trapLabel')}</strong> {t(trapKey)}
                </p>
              )}
            </div>
          </div>
        </article>
      </div>
    </div>
  )
}
