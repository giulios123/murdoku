import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Renderer } from '../i18n/Renderer.ts'
import { suspectColor } from '../game/palette.ts'
import { useSettings } from '../game/settings.ts'
import AttrIcons from './AttrIcons.tsx'
import Avatar from './Avatar.tsx'
import AppearanceInfo from './AppearanceInfo.tsx'
import ClueText, { BoardClueText } from './ClueText.tsx'
import { collectClueTerms, type ClueTerm } from './clueRich.tsx'
import { faqLookupForBoardClue, faqLookupsForClues } from '../game/faqEntries.ts'
import InfoTip from './InfoTip.tsx'
import { familyOf, FAMILY_META, FAMILY_ORDER, type HintFamily } from './hintFamily.tsx'
import {
  VICTIM_ID,
  isWaterRoom,
  relatedSuspects,
  usesInsideOutside,
  type Cell,
  type HintResult,
  type PersonId,
  type Puzzle,
} from '../engine/index.ts'

/** Touch device (no hover): the Akten-Notiz replaces the hover tooltips there. Evaluated
 *  once — a device doesn't change its primary pointer mid-game. */
const IS_COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

/** The dossier note a face-tap folds out under a clue (mobile only): every concept term the
 *  clue's sentence carries, then the persons it names — the same texts the desktop shows on
 *  hover, gathered in one readable place. Sits INSIDE the card's outer <button>, so it stops
 *  its clicks — a tap into the note must not select the suspect for placement. */
function AktenNotiz({
  terms,
  persons,
  lookups,
  onLookup,
}: {
  terms: ClueTerm[]
  persons: { id: PersonId; name: string; attrs: Puzzle['suspects'][number]['attributes']; color: string }[]
  /** Handakte entries this clue touches — one "look it up" row per entry. */
  lookups?: string[]
  onLookup?: (entryId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="mk-note"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mk-note__card">
        {terms.length > 0 && (
          <>
            <p className="mk-note__label">{t('clueNote.terms')}</p>
            {terms.map((term) => (
              <p key={term.tipKey} className="mk-note__row">
                <strong>{term.word}</strong>
                <span>{t(`tip.${term.tipKey}`)}</span>
              </p>
            ))}
          </>
        )}
        {persons.length > 0 && (
          <>
            <p className="mk-note__label">{t('clueNote.persons')}</p>
            {persons.map((p) => (
              <div key={p.id} className="mk-note__person">
                <Avatar className="mk-note__avatar" attrs={p.attrs} color={p.color} letter={p.id} />
                <span className="mk-note__who">
                  <strong>{p.name}</strong>
                  <AppearanceInfo attrs={p.attrs} letter={p.id} />
                </span>
              </div>
            ))}
          </>
        )}
        {/* Sprung in die Handakte, je berührter Hinweisart eine Zeile. Als span mit
            Button-Semantik (die Notiz wohnt IM Karten-<button>, echte Buttons wären
            dort ungültiges HTML — dasselbe Muster wie der FaceHandle). */}
        {onLookup && lookups && lookups.length > 0 && (
          <>
            <p className="mk-note__label">{t('faq.title')}</p>
            {lookups.map((id) => (
              <span
                key={id}
                role="button"
                tabIndex={0}
                className="mk-note__faq"
                onClick={() => onLookup(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onLookup(id)
                  }
                }}
              >
                {t(`faq.e.${id}.title`)}
                <span className="mk-note__faqgo" aria-hidden="true">
                  →
                </span>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** Face/lens handle for the Akten-Notiz — on touch AND desktop (the click complements the
 *  desktop hover tooltips; user's call). Dashed chalk ring = the Kommissar outline language
 *  ("dashed = look here"); desktop shows it on hover only. Rendered as a span with button
 *  semantics because it lives INSIDE the clue card's <button> (nested real buttons are
 *  invalid HTML), and it must swallow the tap so the card does not select the suspect. */
function FaceHandle({
  open,
  onToggle,
  children,
}: {
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="mk-avatarwrap mk-facebtn"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onToggle()
        }
      }}
    >
      {children}
    </span>
  )
}

/** One suspect's clue card. Memoized with FLAT props (booleans instead of the sets/maps
 *  they derive from), so a selection tap re-renders only the cards whose state actually
 *  changed — the old inline card re-ran the rich clue text, the avatar URI and every
 *  tooltip of ALL cards on every tap, a visible part of the tap latency on phones. */
const SuspectCard = memo(function SuspectCard({
  suspect: s,
  idx,
  selected,
  related,
  placed,
  noteOpen,
  renderer,
  gender,
  puzzle,
  suspectIndex,
  onSelect,
  onHoverSuspect,
  onToggleNote,
  onFaqLookup,
}: {
  suspect: Puzzle['suspects'][number]
  idx: number
  selected: boolean
  related: boolean
  placed: boolean
  noteOpen: boolean
  renderer: Renderer
  /** 'f' | 'm' when gender colours are on, undefined when off. */
  gender?: 'f' | 'm'
  puzzle: Puzzle
  suspectIndex: Map<PersonId, number>
  onSelect: (id: PersonId) => void
  onHoverSuspect?: (id: PersonId | null) => void
  onToggleNote: (id: string) => void
  /** In-game jump into the Handakte (absent e.g. during the guided tutorial). */
  onFaqLookup?: (entryId: string) => void
}) {
  const { t } = useTranslation()
  // The dossier note's content (concept terms + the persons the clues name) is collected
  // ONCE per opening and held stable — it used to be re-gathered by every render of an
  // open card, and the rich-renderer walk behind it isn't free on weak phones.
  const noteData = useMemo(() => {
    if (!noteOpen) return null
    return {
      terms: collectClueTerms(renderer, t, s.clues.map((c) => c.describe()), s.id),
      persons: [
        { id: s.id, name: s.name, attrs: s.attributes, color: suspectColor(idx) },
        ...[...relatedSuspects(s.clues, s.id, puzzle)].map((id) => {
          const other = puzzle.suspects.find((o) => o.id === id)!
          return {
            id,
            name: other.name,
            attrs: other.attributes,
            color: suspectColor(suspectIndex.get(id) ?? 0),
          }
        }),
      ],
      lookups: faqLookupsForClues(s.clues),
    }
  }, [noteOpen, renderer, t, s, idx, puzzle, suspectIndex])
  return (
    <button
      type="button"
      className="mk-clue"
      data-suspect={s.id}
      data-gender={gender}
      data-selected={selected}
      data-related={related || undefined}
      data-placed={placed}
      onClick={() => onSelect(s.id)}
      onPointerEnter={() => onHoverSuspect?.(s.id)}
      onPointerLeave={() => onHoverSuspect?.(null)}
    >
      {/* The face is the handle EVERYWHERE (user's call — "das finde ich schick"):
          a click/tap folds the Akten-Notiz out under the clue. Desktop keeps its
          appearance tooltip on hover INSIDE the handle; touch skips the InfoTip
          (its pointerdown would flash a tooltip over the very tap that opens). */}
      <FaceHandle open={noteOpen} onToggle={() => onToggleNote(s.id)}>
        {IS_COARSE ? (
          <Avatar
            className="mk-avatar"
            attrs={s.attributes}
            color={suspectColor(idx)}
            letter={s.id}
          />
        ) : (
          <InfoTip
            anchor=".mk-clue"
            content={<AppearanceInfo attrs={s.attributes} letter={s.id} />}
          >
            <Avatar
              className="mk-avatar"
              attrs={s.attributes}
              color={suspectColor(idx)}
              letter={s.id}
            />
          </InfoTip>
        )}
      </FaceHandle>
      <span className="mk-clue__main">
        <span className="mk-clue__name">
          {s.name}
          {placed && <span className="mk-clue__check">✓</span>}
          <AttrIcons attrs={s.attributes} />
        </span>
        <span className="mk-clue__text">
          <ClueText renderer={renderer} clues={s.clues} subjectId={s.id} />
        </span>
      </span>
      {noteData && (
        <AktenNotiz
          terms={noteData.terms}
          persons={noteData.persons}
          lookups={noteData.lookups}
          onLookup={onFaqLookup}
        />
      )}
    </button>
  )
})

/** True if a clue (or any nested sub-clue) depends on the indoor/outdoor split. */
// (The indoor/outdoor check moved to the engine's `usesInsideOutside` — the editor panel
// needs the exact same rule, and the local copy silently missed UniqueOutsideClue as well as
// every board clue.)

/** Hand-drawn line-art badge for each correction-hint variant (no emoji, on-theme). */
const HINT_GLYPHS: Record<string, ReactNode> = {
  // Note struck out — remove your pencil note.
  note: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      <path d="M8 16 16 8" />
    </svg>
  ),
  // A person crossed out — take the misplaced figure back off.
  figure: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M4 4 20 20" strokeWidth="1.5" />
    </svg>
  ),
  // A bold X — cross these empty cells out.
  cross: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  ),
  // An undo arrow — take a wrong cross back.
  uncross: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 7 5 11l4 4" />
      <path d="M5 11h8a5 5 0 0 1 5 5v2" />
    </svg>
  ),
  // A figure lowered onto a cell — place this person here.
  place: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7" r="3" />
      <path d="M7 20c0-3 2.2-5 5-5s5 2 5 5" />
      <path d="M12 2v3M10.4 3.6 12 5l1.6-1.4" />
    </svg>
  ),
}

/** Hint kinds that render as the coloured verdict box (not the legacy plain text). Each
 *  maps to its accent variant + uppercase action label; `person` = show the suspect token.
 *  `place` (set a figure) is the positive action; the rest are corrections/cross-outs. */
const HINT_FAMILY: Partial<Record<HintResult['kind'], { variant: string; label: string; person: boolean }>> = {
  place: { variant: 'place', label: 'tool.place', person: true },
  unmark: { variant: 'note', label: 'tool.removeNote', person: true },
  unplace: { variant: 'figure', label: 'tool.removeFigure', person: true },
  exclude: { variant: 'cross', label: 'tool.crossOut', person: false },
  uncross: { variant: 'uncross', label: 'tool.removeCrossLabel', person: false },
}

interface HintReason {
  text: string
  family: HintFamily | null
}
/** Everything the verdict box needs, per variant (fields unused by a variant stay undefined). */
interface HintBoxData {
  variant: string
  label: string
  personId?: PersonId
  personName?: string
  /** The suspect's own colour — token + name (place: keeps it while the accent turns green). */
  accent?: string
  /** place: the target cell chip. */
  goalCell?: string
  /** note/figure/cross/uncross: the cell chips. */
  cells?: string[]
  /** cross: render chips with an X. */
  crossed?: boolean
  /** note/figure: show the "kann nicht auf" connective before the chips. */
  cantBeOn?: boolean
  /** place: one-line summary above the reasoning. */
  subline?: string
  /** place: which reasoning families the eliminations use, with counts. */
  famSummary?: { family: HintFamily; count: number }[]
  /** place & cross: family-tagged reasoning rows. */
  reasons?: HintReason[]
  /** place & cross: hide the reasoning behind a toggle. */
  collapse?: boolean
  /** i18n key for the collapse toggle label (varies place vs cross). */
  toggle?: string
  /** note/figure/uncross: plain reason lines. */
  why?: string[]
}

interface Props {
  puzzle: Puzzle
  suspectIndex: Map<PersonId, number>
  placements: Map<PersonId, Cell>
  selectedSuspect: PersonId | null
  /** Other suspects the selected one's clues are "about" — their cards pulse with a ring. */
  related?: Set<PersonId> | null
  onSelect: (id: PersonId) => void
  onHoverSuspect?: (id: PersonId | null) => void
  /** A face tap opened the Akten-Notiz for this id (tutorial listens; else omitted). */
  onNoteOpen?: (id: string) => void
  /** Opens the in-game Handakte at an entry — the dossier notes offer one "look it
   *  up" row per touched clue kind. Omitted (e.g. guided tutorial) = no rows. */
  onFaqLookup?: (entryId: string) => void
  hint: string | null
  /** Optional step-by-step reasoning chain shown under the hint. */
  hintChain?: string[] | null
  /** Render the chain as plain reason lines (no numbering, no gold "conclusion" line) — for
   *  player-error hints, whose lines are equal reasons, not a numbered deduction. */
  hintPlain?: boolean
  /** The raw active hint. Correction hints (remove note/figure, cross out, remove cross)
   *  render as the coloured verdict box instead of the plain text + chain. */
  activeHint?: HintResult | null
  /** Bumped each time the player requests a hint — scrolls it into view. */
  hintRequestId?: number
}

function CluePanel({
  puzzle,
  suspectIndex,
  placements,
  selectedSuspect,
  related,
  onSelect,
  onHoverSuspect,
  onNoteOpen,
  onFaqLookup,
  hint,
  hintChain,
  hintPlain,
  activeHint,
  hintRequestId,
}: Props) {
  const { t, i18n } = useTranslation()
  const { genderColors } = useSettings()

  // The hint bar sits above the suspects, so on a scrolled-down or mobile panel
  // it's off-screen when requested. Each hint request smoothly brings it into
  // view: `nearest` aligns it to the top edge when scrolled past it, and skips
  // the scroll entirely when it's already visible.
  const hintBarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hintRequestId) return
    hintBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [hintRequestId])

  const lang = i18n.resolvedLanguage ?? i18n.language
  const renderer = useMemo(
    () => new Renderer(i18n.getResourceBundle(lang, 'translation'), puzzle),
    [i18n, lang, puzzle],
  )

  // The victim carries a gender too — shown as info the player can use (older
  // levels without it default to male, matching the editor's default).
  const victimGender: 'm' | 'f' = puzzle.victim.attributes.gender === 'f' ? 'f' : 'm'

  // The mobile "Akten-Notiz": on touch there is no hover, so tapping the FACE of a clue card
  // (or the lens of a global clue) folds the card's dossier note out underneath — every
  // concept explanation plus the persons the clue names. Exactly ONE note at a time; a second
  // tap on the same face or a tap anywhere else closes it. Scrolling deliberately does NOT
  // close (a long note must stay readable while you scroll it into view) — user's call.
  const [noteFor, setNoteFor] = useState<string | null>(null)
  useEffect(() => {
    if (noteFor === null) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null
      // Taps on any face handle or inside a note are handled by their own logic.
      if (el?.closest('.mk-facebtn, .mk-note')) return
      // Taps inside the Handakte layer (opened FROM this very note) must not count
      // as "elsewhere": coming back has to look exactly as before the jump — the
      // note the player left from stays open (user-requested).
      if (el?.closest('.mk-faq-layer')) return
      // A tap (or scroll-drag) on the card of the very person whose note is open must
      // NOT close it — on phones you scroll back up and tap that card, and losing the
      // open note there is jarring (user-reported). Anywhere else still closes.
      if (el?.closest(`[data-suspect="${noteFor}"]`)) return
      setNoteFor(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [noteFor])
  // Not a pure updater on purpose: opening reports to `onNoteOpen` (the tutorial's face
  // step), and side effects inside setState updaters would fire twice in StrictMode.
  const toggleNote = useCallback(
    (id: string) => {
      const next = noteFor === id ? null : id
      setNoteFor(next)
      if (next !== null) onNoteOpen?.(next)
    },
    [noteFor, onNoteOpen],
  )

  // Board-wide notes shown above the suspects: which rooms are outdoors + any
  // board clues ("exactly one person on a mud puddle", …). Board clues carry their
  // collected concept terms along for the Akten-Notiz.
  const boardNotes = useMemo(() => {
    const notes: { node: ReactNode; terms?: ClueTerm[]; lookup?: string }[] = []
    // Only show the indoor/outdoor legend when a clue actually relies on it — the shared
    // check covers suspect clues, global clues AND board clues ("2 women were outside").
    const outside = [...puzzle.board.rooms.values()].filter((r) => r.outside).map((r) => t(r.nameKey))
    if (usesInsideOutside(puzzle) && outside.length > 0) {
      notes.push({ node: `${t('game.outsideLabel')}: ${outside.join(', ')}`, lookup: 'termOutside' })
    }
    // A water room is drawn as a lake but is a NORMAL, walkable room — say so as a
    // global rule so players know someone can stand in the water too.
    if ([...puzzle.board.rooms.values()].some((r) => isWaterRoom(r.nameKey))) {
      notes.push({ node: t('game.waterWalkable'), lookup: 'termWater' })
    }
    // Board clues render RICH (bold words + concept tooltips), not through renderer.render —
    // that strips the [[word:tipKey]] markers, which silently ate e.g. the "Personen" tooltip.
    // The terms are collected UP FRONT: a clue whose sentence carries no explainable term
    // must not offer a tappable lens that opens an empty dossier note (user-reported).
    for (const clue of puzzle.boardClues) {
      const describe = clue.describe()
      const terms = collectClueTerms(renderer, t, [describe])
      notes.push({
        node: <BoardClueText renderer={renderer} describe={describe} />,
        terms,
        lookup: faqLookupForBoardClue(clue) ?? undefined,
      })
    }
    return notes
  }, [puzzle, renderer, t])

  // Deduction & correction hints render as the coloured verdict box: the action label +
  // WHO/WHERE (in the person's own colour) first, the reasoning under it. A "place" verdict
  // leads with SETZEN X → cell, a family summary, and the eliminations (family-tagged) behind
  // a toggle; a cross-out tags its argument by family too. Only the "no hint" text falls back
  // to the legacy plain box.
  const hintBox = useMemo((): HintBoxData | null => {
    if (!activeHint) return null
    const fam = HINT_FAMILY[activeHint.kind]
    if (!fam) return null
    const step = activeHint.step
    const kind = activeHint.kind
    // nameSubject=true: a reason stands alone, so NAME the subject ("Alysson war 1 Spalte
    // westlich von George") instead of the card-perspective pronoun ("sie war …").
    const toReason = (e: Parameters<typeof renderer.render>[0]) => ({
      text: renderer.render(e, {}, true),
      family: familyOf(e.key),
    })

    let personId: PersonId | undefined
    let personName: string | undefined
    let accent: string | undefined
    if (fam.person && step.personId) {
      personId = step.personId
      personName = puzzle.suspects.find((x) => x.id === personId)?.name
      accent = suspectColor(suspectIndex.get(step.personId) ?? 0)
    }

    const base = { variant: fam.variant, label: fam.label, personId, personName, accent }
    // Which reasoning families a set of reasons uses, with counts (stable order).
    const famSummaryOf = (reasons: HintReason[]) => {
      const counts = new Map<HintFamily, number>()
      for (const r of reasons) if (r.family) counts.set(r.family, (counts.get(r.family) ?? 0) + 1)
      return FAMILY_ORDER.filter((f) => counts.has(f)).map((f) => ({ family: f, count: counts.get(f)! }))
    }

    if (kind === 'place') {
      const goalCell = activeHint.focus.length ? renderer.cell(activeHint.focus[0]) : ''
      // The eliminations of every OTHER candidate cell — minus the "→ so X goes on Y"
      // conclusion, which the verdict header now carries.
      const reasons = (step.chain ?? []).filter((e) => e.key !== 'why.only').map(toReason)
      const subline = reasons.length > 0 ? t('tool.placeAllElse', { name: personName }) : t('tool.placeFromNotesWhy')
      return { ...base, goalCell, subline, famSummary: famSummaryOf(reasons), reasons, collapse: true, toggle: 'tool.reasonsTogglePlace' }
    }

    if (kind === 'exclude') {
      const cells = activeHint.focus.map((c) => renderer.cell(c))
      // The deduction, minus the redundant "→ cross these out" conclusion the header carries.
      const reasons = [
        toReason(step.explanation),
        ...(step.chain ?? []).filter((e) => e.key !== 'why.crossThis').map(toReason),
      ]
      return { ...base, cells, crossed: true, famSummary: famSummaryOf(reasons), reasons, collapse: true, toggle: 'tool.reasonsToggleCross' }
    }

    // Corrections: remove note / figure / wrong cross — a plain short reason.
    const cells = activeHint.focus.map((c) => renderer.cell(c))
    let why: string[]
    if (kind === 'uncross') why = [t('tool.uncrossWhy')]
    else if (step.chain && step.chain.length > 0) why = step.chain.map((e) => renderer.render(e, {}, true))
    else why = [t('tool.figureWrongWhy')]
    return { ...base, cells, cantBeOn: kind === 'unmark' || kind === 'unplace', why }
  }, [activeHint, puzzle, suspectIndex, renderer, t])

  // Family-tagged reasoning rows (a place hint's eliminations, a cross-out's argument): a
  // small coloured family glyph in front of each line so its KIND of logic reads at a glance.
  const renderReasons = (reasons: HintReason[]) => (
    <ul className="mk-hintbox__reasons">
      {reasons.map((r, i) => (
        <li key={i}>
          <span>
            {r.family && (
              <span className="mk-fam mk-fam--dot" data-f={r.family}>
                {FAMILY_META[r.family].icon}
              </span>
            )}
          </span>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="mk-clues">
      <p className="mk-clues__title">{t('game.suspects')}</p>
      <p className="mk-clues__hint">{t('game.selectPrompt')}</p>

      {boardNotes.length > 0 && (
        <div className="mk-boardclues">
          {boardNotes.map((note, i) => {
            const noteId = `bc-${i}`
            const lens = <span className="mk-boardclue__icon">🔍</span>
            // The lens is tappable when the note would show ANYTHING: concept terms,
            // or a Handakte jump (the outside/water legend rows carry one too).
            const hasNote =
              (note.terms?.length ?? 0) > 0 || (note.lookup !== undefined && !!onFaqLookup)
            return (
              <div key={i} className="mk-boardclue">
                {hasNote ? (
                  <FaceHandle open={noteFor === noteId} onToggle={() => toggleNote(noteId)}>
                    {lens}
                  </FaceHandle>
                ) : (
                  lens
                )}
                {/* ONE child for the flex row: the rich clue text is many inline nodes, and
                    the container's gap would otherwise wedge 0.5rem between every piece —
                    including one right before the final period (user-reported). */}
                <span>{note.node}</span>
                {noteFor === noteId && hasNote && (
                  <AktenNotiz
                    terms={note.terms ?? []}
                    persons={[]}
                    lookups={note.lookup ? [note.lookup] : []}
                    onLookup={onFaqLookup}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {hintBox ? (
        <div
          className="mk-hintbox"
          data-variant={hintBox.variant}
          ref={hintBarRef}
          style={
            hintBox.accent
              ? (hintBox.variant === 'place'
                  ? ({ ['--hint-person']: hintBox.accent } as CSSProperties)
                  : ({ ['--hint-accent']: hintBox.accent } as CSSProperties))
              : undefined
          }
        >
          <div className="mk-hintbox__head">
            <span className="mk-hintbox__badge">{HINT_GLYPHS[hintBox.variant]}</span>
            <span className="mk-hintbox__label">{t(hintBox.label)}</span>
          </div>

          <div className="mk-hintbox__verdict">
            {hintBox.personId && <span className="mk-tok">{hintBox.personId}</span>}
            {hintBox.variant === 'place' ? (
              <>
                {hintBox.personName && <span className="mk-hintbox__name">{hintBox.personName}</span>}
                <span className="mk-hintbox__arrow">→</span>
                <span className="mk-cellchip mk-cellchip--goal">{hintBox.goalCell}</span>
              </>
            ) : (
              <>
                {hintBox.cantBeOn && hintBox.personName && (
                  <span>
                    <span className="mk-hintbox__name">{hintBox.personName}</span>{' '}
                    <span className="mk-hintbox__neg">{t('tool.cantBeOn')}</span>
                  </span>
                )}
                {hintBox.cells?.map((label, i) => (
                  <span
                    key={i}
                    className={hintBox.crossed ? 'mk-cellchip mk-cellchip--x' : 'mk-cellchip'}
                  >
                    {label}
                  </span>
                ))}
              </>
            )}
          </div>

          {/* Deduction reasoning (place + cross). A SINGLE reason shows inline; only 2+
              reasons get the family summary + collapse toggle (uniform place & cross). */}
          {(hintBox.variant === 'place' || hintBox.variant === 'cross') && (
            <>
              {hintBox.subline && <p className="mk-hintbox__subline">{hintBox.subline}</p>}
              {(hintBox.reasons?.length ?? 0) >= 2 ? (
                <>
                  {hintBox.famSummary && hintBox.famSummary.length > 0 && (
                    <div className="mk-hintbox__famsum">
                      {hintBox.famSummary.map(({ family, count }) => (
                        <span key={family} className="mk-fam" data-f={family}>
                          {FAMILY_META[family].icon}
                          {t(FAMILY_META[family].labelKey)}
                          <span className="mk-fam__n">{count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <details>
                    <summary>
                      <span className="mk-chev">▸</span>
                      {t(hintBox.toggle ?? 'tool.reasonsTogglePlace')} · {hintBox.reasons!.length}
                    </summary>
                    {renderReasons(hintBox.reasons!)}
                  </details>
                </>
              ) : (
                hintBox.reasons?.length === 1 && renderReasons(hintBox.reasons)
              )}
            </>
          )}

          {hintBox.why && hintBox.why.length > 0 && (
            <div className="mk-hintbox__why">
              {hintBox.why.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </div>
      ) : hint ? (
        <div className="mk-hintbar" ref={hintBarRef}>
          <strong>{t('tool.hint')}</strong>
          {hint}
          {hintChain && hintChain.length > 0 && (
            hintPlain ? (
              hintChain.map((line, i) => (
                <p key={i} className="mk-hintreason">
                  {line}
                </p>
              ))
            ) : (
              <ol className="mk-hintchain">
                {hintChain.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            )
          )}
        </div>
      ) : null}

      {puzzle.suspects.map((s) => (
        <SuspectCard
          key={s.id}
          suspect={s}
          idx={suspectIndex.get(s.id) ?? 0}
          selected={selectedSuspect === s.id}
          related={related?.has(s.id) ?? false}
          placed={placements.has(s.id)}
          noteOpen={noteFor === s.id}
          renderer={renderer}
          gender={genderColors ? (s.attributes.gender === 'f' ? 'f' : 'm') : undefined}
          puzzle={puzzle}
          suspectIndex={suspectIndex}
          onSelect={onSelect}
          onHoverSuspect={onHoverSuspect}
          onToggleNote={toggleNote}
          onFaqLookup={onFaqLookup}
        />
      ))}

      <button
        type="button"
        className="mk-clue mk-clue--victim"
        data-suspect={VICTIM_ID}
        data-selected={selectedSuspect === VICTIM_ID}
        data-placed={placements.has(VICTIM_ID)}
        onClick={() => onSelect(VICTIM_ID)}
      >
        <InfoTip
          className="mk-avatarwrap"
          anchor=".mk-clue"
          content={
            <span className="mk-tipinfo">
              <span>
                {victimGender === 'm' ? '♂' : '♀'}{' '}
                {t(victimGender === 'm' ? 'info.male' : 'info.female')}
              </span>
            </span>
          }
        >
          <span className="mk-token mk-token--victim">☠</span>
        </InfoTip>
        <span className="mk-clue__main">
          <span className="mk-clue__name">
            <span className="mk-victimname" data-gender={genderColors ? victimGender : undefined}>
              {puzzle.victim.name}
            </span>
            {placements.has(VICTIM_ID) && <span className="mk-clue__check">✓</span>}
            <span className="mk-attr">{victimGender === 'm' ? '♂' : '♀'}</span>
          </span>
          <span className="mk-clue__text">
            {t('game.victim')} — {t('game.victimStatement')}
          </span>
        </span>
      </button>
    </div>
  )
}

// Memoized: the game screen re-renders on plenty of local state (selection, hints,
// tools) — the panel itself only needs to when one of its actual inputs moved.
export default memo(CluePanel)
