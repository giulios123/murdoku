import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DeductionEngine,
  SearchSolver,
  Solution,
  findMurderer,
  loadLevel,
  relatedSuspects,
  unsatisfiedClues,
  VICTIM_ID,
  type Cell,
  type HintResult,
  type PersonId,
} from '../engine/index.ts'
import { Renderer } from '../i18n/Renderer.ts'
import { useDebugSolveKey } from '../game/debugSolve.ts'
import { useGameSession } from '../game/useGameSession.ts'
import { useNarrowLayout } from '../game/useNarrowLayout.ts'
import { useTutorialFlow } from '../game/useTutorialFlow.ts'
import { CANDIDATE_BLUE, HIGHLIGHT_DIM, HINT_BLACK, suspectColor } from '../game/palette.ts'
import {
  clearElapsed,
  clearHintsUsed,
  loadElapsed,
  loadHintsUsed,
  markSolved,
  saveCustomLevel,
  saveElapsed,
  saveHintsUsed,
  exportLevelJson,
  eraseHintSeen,
  isCustomSaved,
  loadCustomLevels,
  loadFilter,
  loadShowHiddenAuthor,
  loadSolved,
  markEraseHintSeen,
} from '../game/storage.ts'
import { dailyKeyOf, isDailyId, nextOpenDailyKey, todayKey } from '../game/daily.ts'
import {
  averageStars,
  isRated,
  loadUserLevels,
  rateUserLevel,
  topTags,
  type UserLevelTag,
} from '../game/userlevels.ts'
import {
  DEFAULT_FILTER,
  levelMetaFromJson,
  nextLevel,
  prevLevel,
  pickerLevels,
  titleOf,
  type LevelMeta,
} from '../game/levels.ts'
import PdfDialog from '../components/PdfDialog.tsx'
import FaqScreen from './FaqScreen.tsx'
import BloodText from '../components/BloodText.tsx'
import BoardCanvas from '../components/BoardCanvas.tsx'
import CluePanel from '../components/CluePanel.tsx'
import Toolbar from '../components/Toolbar.tsx'
import Legend from '../components/Legend.tsx'
import ResultDialog from '../components/ResultDialog.tsx'
import SettingsButton from '../components/SettingsButton.tsx'
import UlStars from '../components/UlStars.tsx'
import Coach from '../components/Coach.tsx'
import { useSettings } from '../game/settings.ts'
import { hasMarks, helpMarks, type HelpMarks } from '../game/helpMarks.ts'
import { useBackInterceptor } from '../game/backHandler.ts'

const NOOP = () => {}

interface Props {
  meta: LevelMeta
  onBack: () => void
  /** True when this level was just generated (offers save/export/new on a win). */
  generated?: boolean
  onNew?: () => void
  /** Open the current level in the editor to tweak it. */
  onEdit?: () => void
  /** Play another level after a win (omitted for generated / editor test-plays). */
  onNext?: (level: LevelMeta) => void
  /** Daily case only: open the given day (the next still-open one up to today).
   *  The win dialog's "next level" then walks the catch-up days instead of the
   *  bundled list; on today's case there is no target and the button hides. */
  onNextDaily?: (day: string) => void
  /** True when this is a community level (id `ul-<n>`): a win offers the one-time
   *  star/property rating, and "next level" walks the community list instead. */
  userLevel?: boolean
  onNextUser?: (level: LevelMeta) => void
  /** Tutorial mode: fresh start, separate storage slot (doesn't touch the demo). */
  tutorial?: boolean
  /** Which tutorial level is running: 1 = demo, 2 = Tutorial Wohnung. */
  tutorialPhase?: 1 | 2
  /** From the phase-1 verdict step: advance to the second tutorial level. */
  onTutorialAdvance?: () => void
}

interface Result {
  win: boolean
  murderer: { name: string; room: string; id: PersonId | null } | null
  victimCell: Cell | null
  /** On a loss: the clues the current placement doesn't satisfy. */
  failures?: string[]
  /** On a win: the next level matching the saved filter (null if none). */
  next?: LevelMeta | null
  /** On a win in a daily case: the next still-open day up to today (null if none). */
  nextDaily?: string | null
  /** On a win in a community level: the next one to play (unsolved first, newest first). */
  nextUser?: LevelMeta | null
  /** On a win in a community level: offer the one-time rating block. */
  rate?: boolean
  /** On a win in a community level: the level's community verdict (shown in the dialog). */
  community?: { stars: number | null; ratings: number; tags: string[]; nologic: boolean } | null
  /** On a win: how many hints were used this solve (0 = solo, earns the medal). */
  hintsUsed?: number
}

function formatTime(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The play clock, isolated so its per-second tick re-renders ONLY this tiny span —
 *  never the whole game screen (that full-tree render every second was real jank on
 *  phones). With the timer display switched off it keeps counting and persisting (a
 *  resumed level must not lose time) but triggers no render at all; switching the
 *  display on catches it up to the real count. */
const GameClock = memo(function GameClock({
  storageId,
  tutorial,
  running,
  resetToken,
}: {
  storageId: string
  tutorial: boolean
  /** Ticks while true; a win freezes the clock (the win handler clears the slot). */
  running: boolean
  /** Bumped by restart — resets the clock to zero. */
  resetToken: number
}) {
  const show = useSettings().timer
  const [elapsed, setElapsed] = useState(() => (tutorial ? 0 : loadElapsed(storageId)))
  const elapsedRef = useRef(elapsed)
  const showRef = useRef(show)

  useEffect(() => {
    if (resetToken === 0) return
    elapsedRef.current = 0
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine external reset signal
    setElapsed(0)
  }, [resetToken])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      elapsedRef.current += 1
      // Persist every tick (a tiny write) so the clock survives leaving the level,
      // a reload, or the app being killed.
      if (!tutorial) saveElapsed(storageId, elapsedRef.current)
      // Repaint only when the timer is actually shown — hidden, the tick costs nothing.
      if (showRef.current) setElapsed(elapsedRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [running, storageId, tutorial])

  // Track the setting for the interval, and switched on mid-game → catch the
  // display up to the real (silently kept) count.
  useEffect(() => {
    showRef.current = show
    if (show) setElapsed(elapsedRef.current)
  }, [show])

  if (!show) return null
  return <span className="mk-timer">{formatTime(elapsed)}</span>
})

export default function GameScreen({
  meta,
  onBack,
  generated,
  onNew,
  onEdit,
  onNext,
  onNextDaily,
  userLevel,
  onNextUser,
  tutorial,
  tutorialPhase,
  onTutorialAdvance,
}: Props) {
  const { t, i18n } = useTranslation()
  const storageId = tutorial ? '__tutorial__' : meta.id
  // Community level: the DB id is baked into the level id (`ul-<n>`).
  const userDbId = userLevel ? Number(/^ul-(\d+)$/.exec(meta.id)?.[1] ?? 0) : 0
  // Its community verdict (Ø stars + top properties) from the local sync cache —
  // read once on mount (the screen is keyed per level id), refreshed after the
  // player's own rating. Shown in the header cluster (desktop) and the ?-sheet
  // (phones — the header cluster usually gets dropped there).
  const [ulStats, setUlStats] = useState<Result['community']>(() => {
    if (!userLevel || userDbId <= 0) return null
    const own = loadUserLevels().find((e) => e.dbId === userDbId)
    return own
      ? {
          stars: averageStars(own.stats),
          ratings: own.stats.ratings,
          tags: topTags(own.stats),
          nologic: !own.logic,
        }
      : null
  })
  const puzzle = useMemo(() => loadLevel(meta.json), [meta])
  // The precomputed answer key is ONLY needed to steer the tutorial (win/submit check
  // the placement directly). Skipping it for normal play also keeps degenerate boards
  // (editor test-plays with no valid solution) from freezing in an endless search.
  const solution = useMemo(
    () => (tutorial ? new SearchSolver(puzzle).firstSolution() : null),
    [puzzle, tutorial],
  )
  const engine = useMemo(() => new DeductionEngine(puzzle), [puzzle])
  const suspectIndex = useMemo(
    () => new Map(puzzle.suspects.map((s, i) => [s.id, i] as const)),
    [puzzle],
  )
  const lang = i18n.resolvedLanguage ?? i18n.language
  const renderer = useMemo(
    () => new Renderer(i18n.getResourceBundle(lang, 'translation'), puzzle),
    [i18n, lang, puzzle],
  )
  // The title in the active language (per-language override from the level JSON).
  const title = titleOf(meta, lang)

  // Ctrl+B → log the solved board + full deduction path to the console.
  useDebugSolveKey(() => ({ puzzle, renderer }))

  const settings = useSettings()
  const session = useGameSession(puzzle, storageId, tutorial, !tutorial)
  // Destructured once: the session OBJECT is fresh each render, but its methods are
  // useCallback-stable — the memoized children hang their deps on these.
  const { commit, undo, resetAll, clearSaved } = session
  const [selected, setSelected] = useState<PersonId | null>(null)
  const [hoveredSuspect, setHoveredSuspect] = useState<PersonId | null>(null)
  const [xTool, setXTool] = useState(false)
  // The eraser: armed by a TAP on the erase button (a long press wipes the whole board).
  const [eraseTool, setEraseTool] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  // Header "solved" mark: already in the solved set on entry (re-checked per level),
  // OR just won this session (result.win) — the difficulty stamp then shows a check.
  const alreadySolved = useMemo(() => loadSolved().has(storageId), [storageId])
  // After a win the verdict can be tucked away to study the solved board; a tap on the
  // board brings it back (see the review layer below).
  const [dialogHidden, setDialogHidden] = useState(false)
  // Mobile-only legend: the desktop legend column is hidden on phones, so a small
  // button on the board corner opens it as a bottom sheet instead. Declared before the
  // tutorial hook — its sheet/PDF steps OBSERVE these two states.
  const [legendOpen, setLegendOpen] = useState(false)
  // PDF-Export: kleiner Vorschalt-Dialog „ohne / mit Auflösung" (Blatt 2).
  const [pdfOpen, setPdfOpen] = useState(false)
  // Handakte als Vollbild-Schicht ÜBER dem laufenden Level (Sprung aus der
  // Akten-Notiz eines Hinweises): das Spiel bleibt gemountet — Auswahl, Scroll
  // und Uhr sind beim Schließen exakt wie verlassen.
  const [faqEntry, setFaqEntry] = useState<string | null>(null)
  const tut = useTutorialFlow({
    enabled: !!tutorial,
    puzzle,
    solution,
    session,
    selected,
    setSelected,
    phase: tutorialPhase ?? 1,
    won: !!result?.win,
    legendOpen,
    pdfOpen,
    onAdvancePhase: onTutorialAdvance ?? NOOP,
  })
  const [hint, setHint] = useState<HintResult | null>(null)
  const [hintShown, setHintShown] = useState(false) // hint requested (even if none was found)
  const [hintRequestId, setHintRequestId] = useState(0) // bumped per request → scrolls the hint into view
  // Hints taken this attempt (every request; 0 → solo medal). Restored from storage so
  // leaving a half-solved level and resuming keeps the tally — else a resumed solve would
  // wrongly count as hint-free. Reset only on a win/restart/reset. Tutorial: always 0.
  const [hintsUsed, setHintsUsed] = useState(() => (tutorial ? 0 : loadHintsUsed(storageId)))
  // The play clock lives in its own component (GameClock above) so its per-second tick
  // never re-renders this whole screen; this token just tells it to restart at zero.
  const [clockReset, setClockReset] = useState(0)
  const [saved, setSaved] = useState(() => isCustomSaved(meta.id))
  // The settings dialog is controlled so the tutorial can open it (and explain it).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A short-lived note over the board. Two users: the phase-1 tutorial verdict, where
  // Restart / Back are LOCKED (they'd skip the second part) and a click just explains what
  // they'd do; and the eraser, which introduces its two reaches once.
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!note) return
    const id = window.setTimeout(() => setNote(null), 4200)
    return () => window.clearTimeout(id)
  }, [note])
  const verdictLock = tut.active && !!tut.coach?.overDialog
  useEffect(() => {
    if (!tut.active) return
    // Sync the dialog to the tutorial-driven phase (open / forced-closed); other
    // phases leave the player's own toggle alone. This is a genuine external sync.
    if (tut.settingsPhase === 'open' || tut.settingsPhase === null)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettingsOpen(tut.settingsPhase === 'open')
  }, [tut.active, tut.settingsPhase])
  // Same pattern for the ?-legend sheet and the PDF dialog (their tutorial steps hold
  // them open while the coach explains; leaving the step closes them again).
  useEffect(() => {
    if (!tut.active) return
    if (tut.legendPhase === 'open' || tut.legendPhase === null)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLegendOpen(tut.legendPhase === 'open')
  }, [tut.active, tut.legendPhase])
  useEffect(() => {
    if (!tut.active) return
    // Closing via state (not the dialog's onClose) — no advance loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPdfOpen(tut.pdfPhase === 'open')
  }, [tut.active, tut.pdfPhase])
  useBackInterceptor(legendOpen, () => setLegendOpen(false))
  useBackInterceptor(faqEntry !== null, () => setFaqEntry(null))
  // Stabile Identität: SuspectCard ist memoisiert — eine neue Funktion pro Render
  // würde jede Karte bei jedem Tap neu rendern.
  const openFaq = useCallback((entryId: string) => setFaqEntry(entryId), [])

  // Header title fit (mostly mobile): the title slot sits between the back/edit
  // buttons and the timer. If the title + the tag cluster (difficulty stamp + size)
  // overflow it, drop the cluster first; if the title alone still doesn't fit, CSS
  // clips it with an ellipsis.
  const headingRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const authorRef = useRef<HTMLSpanElement>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)
  const badgeWidthRef = useRef(0)
  const [hideBadge, setHideBadge] = useState(false)

  // Persist the hint tally so leaving and resuming a level keeps it honest.
  useEffect(() => {
    if (tutorial || result?.win) return
    if (hintsUsed > 0) saveHintsUsed(storageId, hintsUsed)
  }, [hintsUsed, storageId, tutorial, result?.win])

  useEffect(() => {
    const heading = headingRef.current
    const title = titleRef.current
    if (!heading || !title) return
    let alive = true
    const measure = () => {
      if (!alive) return
      const badge = badgeRef.current
      if (badge) badgeWidthRef.current = badge.offsetWidth // remember it while shown
      const gap = parseFloat(getComputedStyle(heading).columnGap) || 0
      // Natürliche Breiten bei Faktor 1 messen — der Mobil-Fit skaliert die
      // Schrift linear, also erst zurücksetzen, dann lesen (das Lesen von
      // scrollWidth erzwingt das Layout; Desktop ignoriert die Variablen).
      heading.style.setProperty('--fit-title', '1')
      heading.style.setProperty('--fit-author', '1')
      const badgeNeed = badgeWidthRef.current ? badgeWidthRef.current + gap : 0
      const naturalTitle = title.scrollWidth
      const hide = naturalTitle + badgeNeed > heading.clientWidth + 1
      setHideBadge(hide)
      // Mobil schrumpfen Titel und Autor danach stufenlos auf die verfügbare
      // Breite (statt „…"); den Lesbarkeits-Boden zieht das CSS per max() ein.
      const avail = heading.clientWidth - (hide ? 0 : badgeNeed)
      if (avail > 0 && naturalTitle > avail)
        heading.style.setProperty('--fit-title', String(avail / naturalTitle))
      const author = authorRef.current
      if (author && avail > 0 && author.scrollWidth > avail)
        heading.style.setProperty('--fit-author', String(avail / author.scrollWidth))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(heading)
    document.fonts?.ready.then(measure)
    return () => {
      alive = false
      ro.disconnect()
    }
  }, [title, meta.author, meta.width, meta.height, meta.difficulty, meta.custom, ulStats])

  // The hint stays on screen (with its highlight) until it's DONE or invalidated:
  //  - PLACING or removing a figure clears it (a different suspect set, or the hinted
  //    one set = done) — tracked by a content signature, since every board action
  //    hands back a fresh placements Map.
  //  - a CROSS hint clears once every highlighted cell is crossed (all done).
  // Crossing cells partway, or selecting a suspect, leaves it up. (Reset & undo clear
  // it too — wired on those buttons.)
  const placementSig = [...session.state.placements]
    .map(([id, c]) => `${id}@${c}`)
    .sort()
    .join('|')
  const placementSigRef = useRef<string | null>(null)
  useEffect(() => {
    if (placementSigRef.current !== null && placementSigRef.current !== placementSig) {
      setHint(null)
      setHintShown(false)
    }
    placementSigRef.current = placementSig
  }, [placementSig])
  // A CROSS hint is DONE once every highlighted cell is crossed — derived rather
  // than cleared via state, so no effect is needed; the stale state resets with
  // the next hint request or placement change anyway.
  const hintDone =
    (hint?.kind === 'exclude' && hint.focus.every((c) => session.state.crosses.has(c))) ||
    // A "remove your notes" hint is done once those marks are erased; a "remove your figure"
    // hint clears via the placement-change effect above when the figure is taken off.
    (hint?.kind === 'unmark' &&
      hint.focus.every((c) => !session.state.marks.get(c)?.has(hint.step.personId!))) ||
    // A "remove your wrong cross" hint is done once those crosses are gone.
    (hint?.kind === 'uncross' && hint.focus.every((c) => !session.state.crosses.has(c)))
  const activeHint = hintDone ? null : hint

  const highlight = useMemo<Set<Cell> | null>(() => {
    if (!selected || settings.helpMode !== 'full') return null
    const suspect = puzzle.suspects.find((s) => s.id === selected)
    if (!suspect) return null
    let acc: Set<Cell> | null = null
    for (const clue of suspect.clues) {
      const set = clue.candidateCells(puzzle.board)
      if (!set) continue
      if (acc === null) acc = new Set(set)
      else for (const c of [...acc]) if (!set.has(c)) acc.delete(c)
    }
    return acc
  }, [selected, puzzle, settings.helpMode])

  // Reduced help ("Kommissar"): each clue marks only its reference on the board.
  const refMarks = useMemo<HelpMarks | null>(() => {
    if (!selected || settings.helpMode !== 'reduced') return null
    const suspect = puzzle.suspects.find((s) => s.id === selected)
    if (!suspect) return null
    const marks = helpMarks(suspect.clues, puzzle.board)
    return hasMarks(marks) ? marks : null
  }, [selected, puzzle, settings.helpMode])

  // Selecting a suspect pulses the OTHER suspect cards their clues are "about" — everyone
  // sharing a mentioned trait (e.g. brown hair) plus any named person. Pure reading of the
  // visible suspects (no positions revealed), so it's shown regardless of help mode.
  const relatedCards = useMemo<Set<PersonId> | null>(() => {
    if (!selected) return null
    const suspect = puzzle.suspects.find((s) => s.id === selected)
    if (!suspect) return null
    const set = relatedSuspects(suspect.clues, selected, puzzle)
    return set.size > 0 ? set : null
  }, [selected, puzzle])

  const reveal = useMemo(
    () =>
      result?.win && result.victimCell !== null
        ? { victimCell: result.victimCell, murdererId: result.murderer?.id ?? null }
        : null,
    [result],
  )

  // Handlers are useCallback-stable: they feed the memoized panel/board/toolbar, and an
  // unstable identity would void exactly the memo that keeps a tap cheap on phones.
  const clearHint = useCallback(() => {
    setHint(null)
    setHintShown(false)
  }, [])
  // Selecting a suspect or arming the X-tool must NOT drop the hint (the player is
  // about to act ON it) — so these no longer clear it.
  // Picking a suspect means "I'm about to place THEM", so it disarms both cell tools — a
  // tap on the board must then place, never cross or erase. The eraser follows the X tool
  // here exactly; anything else and the next tap would silently do the wrong thing.
  const selectFromCard = useCallback((id: PersonId) => {
    setSelected((prev) => (prev === id ? null : id))
    setXTool(false)
    setEraseTool(false)
  }, [])
  const selectFromBoard = useCallback((id: PersonId | null) => {
    setSelected(id)
    setXTool(false)
    setEraseTool(false)
  }, [])
  // After placing a figure, drop the selection so their candidate highlight clears — the
  // player is done with that suspect.
  const commitAndClear = useCallback(
    (cell: Cell, id: PersonId) => {
      commit(cell, id)
      setSelected(null)
    },
    [commit],
  )
  // The X tool and the eraser are one toolbox: only ONE can be armed, so a tap on the board
  // always has a single, readable meaning.
  const toggleX = useCallback(() => {
    setXTool((v) => {
      if (!v) {
        setSelected(null)
        setEraseTool(false)
      }
      return !v
    })
  }, [])
  const toggleErase = useCallback(() => {
    setEraseTool((v) => {
      if (!v) {
        setSelected(null)
        setXTool(false)
        // Explain BOTH reaches once, exactly when the player first discovers the small one —
        // a button that does two things by press length has to say so at least that once.
        if (!eraseHintSeen()) {
          markEraseHintSeen()
          setNote(t('game.eraseIntro'))
        }
      }
      return !v
    })
  }, [t])
  // Undo and reset are structural — they discard the active hint.
  const onUndoClick = useCallback(() => {
    undo()
    clearHint()
  }, [undo, clearHint])
  const onResetClick = useCallback(() => {
    resetAll()
    clearHint()
    setHintsUsed(0) // fresh attempt — the hint tally starts over
    if (!tutorial) clearHintsUsed(storageId) // …and drop the persisted tally too
  }, [resetAll, clearHint, tutorial, storageId])

  // Replay the solved level from scratch: clear the board, drop the verdict, restart the
  // clock. (Offered on the win dialog.)
  const restart = () => {
    session.resetAll()
    clearHint()
    setHintsUsed(0) // replaying from scratch — hints reset
    setSelected(null)
    setXTool(false)
    setEraseTool(false)
    setResult(null)
    setDialogHidden(false)
    setClockReset((n) => n + 1)
    if (!tutorial) {
      clearElapsed(storageId)
      clearHintsUsed(storageId)
    }
    // Restarting from the final tutorial verdict means "I'm done learning" — drop the
    // guided overlay and let the level be played freely.
    if (tut.active) tut.end()
  }

  // Tap (not scroll/drag) on the revealed board re-opens the tucked-away verdict. A
  // pointer that moves past a small threshold is a swipe — it must NOT count as a tap,
  // which matters on touch where a scroll starts as a press.
  const reviewTap = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const onReviewDown = (e: ReactPointerEvent) => {
    reviewTap.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onReviewMove = (e: ReactPointerEvent) => {
    const t = reviewTap.current
    if (t && !t.moved && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) t.moved = true
  }
  const onReviewUp = () => {
    const t = reviewTap.current
    reviewTap.current = null
    if (t && !t.moved) setDialogHidden(false)
  }

  // The next un-done action from the full solution: cross a now-empty cell, or place
  // a person. It stays on screen until done (see the effects above); pressing again
  // before acting just recomputes the same next action.
  const showHint = useCallback(() => {
    setSelected(null) // the black hint highlight replaces the blue selection
    setXTool(false)
    setEraseTool(false) // the hint wants you to ACT on a cell — not to wipe it
    const h = engine.nextHint(session.state.placements, session.state.crosses, session.state.marks)
    setHint(h)
    setHintShown(true)
    if (h) setHintsUsed((n) => n + 1) // every request that actually shows a hint counts
    setHintRequestId((n) => n + 1) // re-scroll even when the same hint is requested again
  }, [engine, session.state])

  // Two highlight layers so a selected suspect's possible cells (blue) stay visible
  // UNDER an active hint (black) — both at once when both apply. A cross hint only
  // highlights the cells STILL to cross, so it shrinks as the player works through it
  // (and vanishes — via the effect above — once they're all done).
  // Memoized: an unstable Set identity here re-triggered the board redraw on EVERY
  // screen render while a hint was up (it feeds BoardCanvas's redraw effect).
  const hintHL = useMemo(() => {
    if (tut.active || !activeHint) return null
    return new Set(
      activeHint.kind === 'exclude'
        ? activeHint.focus.filter((c) => !session.state.crosses.has(c))
        : activeHint.kind === 'unmark'
          ? activeHint.focus.filter((c) => session.state.marks.get(c)?.has(activeHint.step.personId!) ?? false)
          : activeHint.kind === 'uncross'
            ? activeHint.focus.filter((c) => session.state.crosses.has(c))
            : activeHint.focus,
    )
  }, [tut.active, activeHint, session.state])
  const selectHL = tut.active ? tut.highlight : highlight
  const boardHighlight = hintHL ?? selectHL
  // In the tutorial the flow owns both layers (black "to cross" over blue candidates);
  // outside it, a hint (black) sits over the selection (blue).
  const boardHighlightColor = tut.active ? tut.highlightColor : hintHL ? HINT_BLACK : CANDIDATE_BLUE
  const boardHighlight2 = tut.active ? tut.highlight2 : hintHL && selectHL ? selectHL : null
  // A selected suspect who is ALREADY placed has moot candidates — dim their whole
  // highlight so the live (un-placed) suspects' candidates stand out more.
  const selDim = !tut.active && selected !== null && session.state.placements.has(selected) ? HIGHLIGHT_DIM : 1
  const boardHighlightAlpha = hintHL ? 1 : selDim // primary = black hint (full opacity) when a hint is up
  const boardHighlightAlpha2 = selDim // the secondary layer carries the selection under a hint
  const hintText = activeHint
    ? renderer.render(activeHint.step.explanation)
    : hintShown && !hintDone
      ? t('tool.hintNone')
      : null
  // Readable contradiction chain ("if X here → … → impossible"), when the hint has one.
  // Memoized so the array identity holds across renders (it feeds the memoized panel).
  const hintChain = useMemo(
    () => activeHint?.step.chain?.map((e) => renderer.render(e)) ?? null,
    [activeHint, renderer],
  )

  // The neighbouring level (next/prev) honouring the saved filter, the hidden-author
  // toggle and the current solved set — exactly what the picker would offer. Shared by
  // the post-win "next level" button and the n / p skip shortcuts.
  const neighborLevel = useCallback(
    (pick: (current: LevelMeta, filtered: LevelMeta[]) => LevelMeta | null): LevelMeta | null => {
      const custom = loadCustomLevels().map((j) => levelMetaFromJson(j, true))
      const filtered = pickerLevels(
        custom,
        loadFilter(DEFAULT_FILTER),
        loadSolved(),
        loadShowHiddenAuthor(),
      )
      return pick(meta, filtered)
    },
    [meta],
  )

  // Press "n" / "p" to jump to the next / previous level — same target as the verdict's
  // "next level" button. Only where that navigation exists (not tutorial / generated /
  // editor test-play, where onNext is omitted) and never while typing in a field.
  useEffect(() => {
    if (!onNext) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      const pick = key === 'n' ? nextLevel : key === 'p' ? prevLevel : null
      if (!pick) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const target = neighborLevel(pick)
      if (!target) return
      e.preventDefault()
      onNext(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext, neighborLevel])

  const submit = useCallback(() => {
    if (!session.allPlaced) return
    const placements = session.state.placements
    // A win is a GENUINELY valid solution, checked directly on the placement (not against
    // one precomputed `solution`): everyone on a distinct row AND column, every suspect clue
    // satisfied, the victim alone with exactly one suspect, and all board clues. Checking the
    // placement itself means the verdict is correct even for a non-unique or unsolvable
    // test-play board — pressing "Lösen" always explains WHY it doesn't work (e.g. "the
    // victim must be alone with exactly one suspect") instead of silently doing nothing.
    const board = puzzle.board
    const rows = new Set<number>()
    const cols = new Set<number>()
    let lineClash = false
    for (const cell of placements.values()) {
      const { row, col } = board.rc(cell)
      if (rows.has(row) || cols.has(col)) lineClash = true
      rows.add(row)
      cols.add(col)
    }
    const failures = unsatisfiedClues(puzzle, placements).map((f) =>
      f.personId ? renderer.namedClue(f.explanation, f.personId) : renderer.render(f.explanation),
    )
    // Two people sharing a row/column breaks the core one-per-line rule (the player can force
    // this onto an X'd cell), so name it too — else a clash that happens to satisfy every clue
    // would be wrongly accepted.
    if (lineClash) failures.unshift(renderer.render({ key: 'rule.oneEachLine' }))
    if (failures.length > 0) {
      setResult({ win: false, murderer: null, victimCell: null, failures })
      return
    }
    markSolved(storageId, hintsUsed)
    clearSaved()
    clearElapsed(storageId) // solved — the next visit starts the clock at zero
    clearHintsUsed(storageId) // …and the hint tally is banked into the result now
    setDialogHidden(false) // a fresh verdict always shows the dialog first
    const m = findMurderer(puzzle, new Solution(placements))
    const room = puzzle.board.rooms.get(m.roomId)
    // markSolved above already updated the solved set neighborLevel reads from.
    const next = onNext ? neighborLevel(nextLevel) : null
    // Daily case: "next" walks the still-open days up to today (this win is
    // already in the solved set). Today's case has no successor — button hides.
    const nextDaily =
      onNextDaily && isDailyId(storageId)
        ? nextOpenDailyKey(dailyKeyOf(storageId), todayKey(), (id) => loadSolved().has(id))
        : null
    // Community level: "next" prefers the best unsolved level (list order), falls back
    // to any other; the one-time rating block shows until this level has been rated.
    let nextUser: LevelMeta | null = null
    let community: Result['community'] = null
    if (userLevel) {
      const all = loadUserLevels()
      if (onNextUser) {
        const solvedNow = loadSolved()
        const others = all.filter((e) => e.json.id !== meta.id)
        const target = others.find((e) => !solvedNow.has(e.json.id)) ?? others[0]
        nextUser = target ? levelMetaFromJson(target.json) : null
      }
      const own = all.find((e) => e.dbId === userDbId)
      if (own) {
        community = {
          stars: averageStars(own.stats),
          ratings: own.stats.ratings,
          tags: topTags(own.stats),
          nologic: !own.logic,
        }
      }
    }
    setResult({
      win: true,
      murderer: {
        name: m.suspectId ? puzzle.nameOf(m.suspectId) : '',
        room: room ? t(room.nameKey) : m.roomId,
        id: m.suspectId,
      },
      victimCell: placements.get(VICTIM_ID)!,
      next,
      nextDaily,
      nextUser,
      // Rating needs the server (Dirks Regel: bewerten nur online) — when the device
      // is definitely offline, don't even offer the stars.
      rate:
        userLevel === true && userDbId > 0 && !isRated(userDbId) && navigator.onLine !== false,
      community,
      hintsUsed,
    })
  }, [session.allPlaced, session.state.placements, clearSaved, puzzle, renderer, storageId, hintsUsed, onNext, onNextDaily, neighborLevel, userLevel, userDbId, onNextUser, meta.id, t])

  // Stable identities for the memoized board + toolbar (a fresh arrow/element per render
  // would re-render them on every screen render for nothing).
  const roomName = useCallback((key: string) => t(key), [t])
  const legendNode = useMemo(() => <Legend puzzle={puzzle} />, [puzzle])
  // Phones hide the toolbar's legend column via CSS — but it still MOUNTED, drawing its
  // ~dozen little object-icon canvases for nothing. Skip it there entirely; the narrow
  // layout reaches the legend through the ?-button bottom sheet (legendNode) instead.
  const narrow = useNarrowLayout()

  return (
    <div className="mk-game">
      <header className="mk-game__head">
        <div className="mk-game__lead">
          <button type="button" className="mk-back" onClick={onBack} aria-label="back">
            ←
          </button>
          {onEdit && (
            <button
              type="button"
              className="mk-game__edit"
              // Während des geführten Tutorials ist der Sprung in den Editor gesperrt
              // (er würde den Fortschritt verwerfen) — der Knopf bleibt aber sichtbar,
              // der Kopf sieht überall gleich aus. Nach „Tutorial überspringen" ist er
              // voll funktional.
              onClick={tut.active ? () => setNote(t('tutorial.lockEdit')) : onEdit}
              aria-label={t('game.openInEditor')}
            >
              <span aria-hidden="true">✎</span>
              <span className="mk-game__edit-label">{t('game.openInEditor')}</span>
            </button>
          )}
          {/* Druckbogen-Export direkt im Kopf (Dirks Vorgabe: nicht erst nach dem
              Lösen). Desktop-exklusiv — mobil ist der Kopf zu voll, dort wohnt der
              Export als Zeile im ?-Sheet der Legende. Auch im Tutorial da (und voll
              funktional) — ein eigener Schritt in Teil 2 zeigt ihn. */}
          <button
            type="button"
            className="mk-game__edit mk-game__edit--pdf"
            // Während des Tutorials erst ab dem PDF-Schritt nutzbar — vorher würde der
            // Dialog mitten in einen fremden Schritt platzen; die Notiz vertröstet.
            onClick={() => {
              if (tut.active && !tut.pdfStep) {
                setNote(t('tutorial.lockPdf'))
                return
              }
              setPdfOpen(true)
            }}
            aria-label={t('game.pdfExport')}
            title={t('game.pdfExport')}
          >
            <svg className="mk-game__pdficon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 8V3h12v5M6 17H3v-7h18v7h-3M7 14h10v7H7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            <span className="mk-game__edit-label">PDF</span>
          </button>
        </div>
        <div className="mk-game__heading" ref={headingRef}>
          <div className="mk-game__titlewrap" data-author={meta.author ? '' : undefined}>
            <h2 className="mk-game__title" ref={titleRef}><BloodText text={title} /></h2>
            {meta.author && (
              <span className="mk-game__author" ref={authorRef}>
                {t('game.author', { name: meta.author })}
              </span>
            )}
          </div>
          {!hideBadge && (
            <span className="mk-game__tags" ref={badgeRef}>
              <span
                className="mk-game__case"
                data-d={meta.difficulty}
                data-solved={alreadySolved || result?.win ? 'true' : undefined}
              >
                <span className="mk-game__case-diff">{t(`difficulty.${meta.difficulty}`)}</span>
                {meta.custom && <span className="mk-game__case-own">{t('select.custom')}</span>}
              </span>
              <span className="mk-game__sz">{meta.width}×{meta.height}</span>
              {/* Community-Wertung neben der Größe (Desktop; mobil per CSS aus —
                  dort wohnt sie im ?-Sheet, und der Cluster bliebe sonst öfter weg). */}
              {ulStats && <UlStars className="mk-game__stars" stars={ulStats.stars} ratings={ulStats.ratings} />}
            </span>
          )}
        </div>
        <div className="mk-game__corner">
          <GameClock
            storageId={storageId}
            tutorial={!!tutorial}
            running={!result?.win}
            resetToken={clockReset}
          />
          <SettingsButton
            open={settingsOpen}
            onOpenChange={(o) => {
              setSettingsOpen(o)
              if (o && tut.active) tut.onSettingsOpen()
            }}
          />
        </div>
      </header>

      <CluePanel
        puzzle={puzzle}
        suspectIndex={suspectIndex}
        placements={session.state.placements}
        selectedSuspect={selected}
        related={relatedCards}
        onSelect={tut.active ? tut.onSelect : selectFromCard}
        onNoteOpen={tut.active ? tut.onNoteOpen : undefined}
        // Im geführten Tutorial gesperrt (ein Ausflug in die Handakte würde mitten
        // aus einem Skript-Schritt führen) — nach „Überspringen" voll da.
        onFaqLookup={tut.active ? undefined : openFaq}
        onHoverSuspect={setHoveredSuspect}
        hint={hintText}
        hintChain={hintChain}
        hintPlain={activeHint?.kind === 'unmark' || activeHint?.kind === 'unplace' || activeHint?.kind === 'uncross'}
        activeHint={activeHint}
        hintRequestId={hintRequestId}
      />

      <div className="mk-board">
        <button
          type="button"
          className="mk-legendbtn"
          aria-label={t('legend.title')}
          onClick={() => setLegendOpen(true)}
        >
          ?
        </button>
        <BoardCanvas
          puzzle={puzzle}
          state={session.state}
          suspectIndex={suspectIndex}
          selectedSuspect={selected}
          highlight={boardHighlight}
          highlightColor={boardHighlightColor}
          highlight2={boardHighlight2}
          highlightColor2={CANDIDATE_BLUE}
          highlightAlpha={boardHighlightAlpha}
          highlightAlpha2={boardHighlightAlpha2}
          helpMarks={tut.active ? null : refMarks}
          emphasize={hoveredSuspect}
          xTool={tut.active ? tut.xTool : xTool}
          // The tutorial drives its own board; the eraser stays out of its way.
          eraseTool={tut.active ? false : eraseTool}
          reveal={reveal}
          roomName={roomName}
          occupantAt={session.occupantAt}
          onPlaceMark={tut.active ? tut.onPlaceMark : session.placeMark}
          onCommit={tut.active ? tut.onCommit : commitAndClear}
          onRemove={tut.active ? NOOP : session.remove}
          onSetCross={tut.active ? tut.onSetCross : session.setCross}
          onEraseCell={tut.active ? NOOP : session.eraseCell}
          onSetMark={tut.active ? tut.onSetMark : session.setMark}
          onSelectSuspect={tut.active ? (id) => id && tut.onSelect(id) : selectFromBoard}
        />
        {result?.win && dialogHidden && (
          <div
            className="mk-review"
            onPointerDown={onReviewDown}
            onPointerMove={onReviewMove}
            onPointerUp={onReviewUp}
            onPointerCancel={() => (reviewTap.current = null)}
          >
            <span className="mk-review__pill">
              <span className="mk-review__icon" aria-hidden="true">⌕</span>
              {t('result.reopenHint')}
            </span>
          </div>
        )}
      </div>

      <Toolbar
        xTool={tut.active ? tut.xTool : xTool}
        onToggleX={tut.active ? tut.onToggleX : toggleX}
        eraseTool={tut.active ? false : eraseTool}
        onToggleErase={tut.active ? NOOP : toggleErase}
        onUndo={tut.active ? NOOP : onUndoClick}
        canUndo={tut.active ? false : session.canUndo}
        onReset={tut.active ? NOOP : onResetClick}
        onHint={
          tut.active
            ? () => {
                if (tut.hintPhase) {
                  showHint()
                  tut.onHint()
                }
              }
            : showHint
        }
        onSubmit={submit}
        allPlaced={session.allPlaced}
        // Level already solved this session and now being reviewed → lock the editing tools
        // (X / reset / undo / hint); replaying happens via the verdict's Restart button.
        locked={!tut.active && !!result?.win}
        legend={narrow ? undefined : legendNode}
      />

      {legendOpen && (
        <div
          className="mk-overlay mk-overlay--sheet"
          onClick={(e) => e.target === e.currentTarget && setLegendOpen(false)}
        >
          <div className="mk-sheet" role="dialog" aria-modal="true">
            <button
              type="button"
              className="mk-sheet__close"
              aria-label={t('legend.close')}
              onClick={() => setLegendOpen(false)}
            >
              ×
            </button>
            {/* Mobil wohnt die Community-Wertung hier (der Kopf wirft den Badge-
                Cluster meist ab) — als ERSTER der drei Sheet-Abschnitte
                (Wertung · Legende · PDF), mit derselben kleinen Abschnitts-
                Überschrift wie die Legende. */}
            {ulStats && (
              <div className="mk-sheet__community">
                <span className="mk-legend__title">{t('rate.community')}</span>
                <p className="mk-dialog__community">
                  <UlStars stars={ulStats.stars} ratings={ulStats.ratings} />
                  {ulStats.tags.map((tag) => (
                    <span key={tag} className="mk-ul-tag">
                      {t(`tag.${tag}`)}
                    </span>
                  ))}
                  {ulStats.nologic && (
                    <span className="mk-ul-tag" data-nologic="true">
                      {t('tag.nologic')}
                    </span>
                  )}
                </p>
              </div>
            )}
            {legendNode}
            {/* Mobil wohnt der Druckbogen-Export hier (der Kopf hat keinen Platz):
                eine vertraute Share-Sheet-Zeile unter der Legende — auch im Tutorial
                (Teil 2 zeigt sie in einem eigenen Schritt). */}
            <button
              type="button"
              className="mk-saverow mk-sheet__pdf"
              onClick={() => {
                // Tutorial: erst ab dem PDF-Schritt (Teil 2) — im Legenden-Schritt von
                // Teil 1 vertröstet die Notiz, das Sheet bleibt offen.
                if (tut.active && !tut.pdfStep) {
                  setNote(t('tutorial.lockPdf'))
                  return
                }
                setLegendOpen(false)
                setPdfOpen(true)
              }}
            >
              <span className="mk-saverow__ic" aria-hidden="true">
                <svg className="mk-game__pdficon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 8V3h12v5M6 17H3v-7h18v7h-3M7 14h10v7H7z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="mk-saverow__text">
                <span className="mk-saverow__title">{t('game.pdfExport')}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {pdfOpen && <PdfDialog json={meta.json} title={title} onClose={() => setPdfOpen(false)} />}

      {/* Die Handakte als Schicht über dem Spiel: ← / Android-Back / Escape schließen
          zurück ins unveränderte Level. Volle Handakte (Dirks Wahl) — man landet beim
          passenden Eintrag, darf aber weiterblättern. */}
      {faqEntry !== null && (
        <FaqScreen layer initialEntry={faqEntry} onBack={() => setFaqEntry(null)} />
      )}

      {result && !dialogHidden && (
        <ResultDialog
          win={result.win}
          hintsUsed={result.win ? result.hintsUsed : undefined}
          murderer={result.win ? result.murderer : null}
          avatar={
            result.win && result.murderer?.id
              ? {
                  attrs: puzzle.attributesOf(result.murderer.id),
                  color: suspectColor(suspectIndex.get(result.murderer.id) ?? 0),
                  letter: result.murderer.id,
                }
              : null
          }
          failures={result.win ? undefined : result.failures}
          onNext={
            result.win && result.next && onNext
              ? () => onNext(result.next!)
              : result.win && result.nextDaily && onNextDaily
                ? () => onNextDaily(result.nextDaily!)
                : result.win && result.nextUser && onNextUser
                  ? () => onNextUser(result.nextUser!)
                  : undefined
          }
          onRate={
            result.win && result.rate
              ? (stars, tags) =>
                  rateUserLevel(userDbId, stars, tags as UserLevelTag[]).then((ok) => {
                    // Die »Community-Wertung«-Zeile zeigt die eben gesendete Bewertung
                    // sofort: Ø + Anzahl frisch aus dem gerade aktualisierten Cache.
                    // tags/nologic bleiben eingefroren — es dürfen keine Chips
                    // erscheinen/verschwinden (die Dialoghöhe ändert sich nie).
                    const own = ok ? loadUserLevels().find((e) => e.dbId === userDbId) : undefined
                    if (own) {
                      // Kopf + ?-Sheet ziehen sofort mit (außerhalb des Dialogs —
                      // dessen Einfrier-Regel gilt hier nicht).
                      setUlStats({
                        stars: averageStars(own.stats),
                        ratings: own.stats.ratings,
                        tags: topTags(own.stats),
                        nologic: !own.logic,
                      })
                      setResult((r) =>
                        r?.community
                          ? {
                              ...r,
                              community: {
                                ...r.community,
                                stars: averageStars(own.stats),
                                ratings: own.stats.ratings,
                              },
                            }
                          : r,
                      )
                    }
                    return ok
                  })
              : undefined
          }
          community={result.win ? result.community : undefined}
          onRetry={() => setResult(null)}
          onRestart={
            result.win
              ? verdictLock
                ? () => setNote(t('tutorial.lockRestart'))
                : restart
              : undefined
          }
          onDismiss={result.win ? () => setDialogHidden(true) : undefined}
          onBack={verdictLock ? () => setNote(t('tutorial.lockBack')) : onBack}
          generated={generated}
          saved={saved}
          defaultName={meta.title}
          onSave={(name) => {
            saveCustomLevel({ ...meta.json, title: name })
            setSaved(true)
          }}
          onExport={(name) =>
            // Ohne eingetippten Namen (JSON-Icon außerhalb des Generator-Flows) bleibt
            // der Originaltitel erhalten — ein leerer Titel darf nie exportiert werden.
            void exportLevelJson({
              ...meta.json,
              ...(name.trim() !== '' ? { title: name.trim() } : {}),
            }).catch(() => {})
          }
          onNew={onNew}
        />
      )}

      {tut.coach && (!result || tut.coach.overDialog) && <Coach view={tut.coach} />}

      {note && (
        <div className="mk-coachnote" role="status" aria-live="polite">
          {note}
        </div>
      )}
    </div>
  )
}
