import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsButton from '../components/SettingsButton.tsx'
import EditorBoard from '../components/EditorBoard.tsx'
import SuspectsPanel from '../components/SuspectsPanel.tsx'
import ObjectIcon from '../components/ObjectIcon.tsx'
import { THEME_IDS, themeRooms, themeOutdoor, themeFromRoomKeys, themeDefaultObjects, redundantBoardClues } from '../engine/generator/index.ts'
import { fillBoardCluesAsync, generateLevelAsync, longHintSeconds, type GenHandle } from '../game/generatorClient.ts'
import { VALUED_ATTRS, type Condition } from '../game/editorClues.ts'
import { LEVELS, levelMetaFromJson, type Difficulty, type LevelMeta } from '../game/levels.ts'
import {
  saveCustomLevel,
  exportLevelJson,
  loadCustomLevels,
  loadEditorDraft,
  loadAuthorTools,
  saveEditorDraft,
} from '../game/storage.ts'
import PdfDialog from '../components/PdfDialog.tsx'
import {
  GROUND_OBJECTS,
  ROOM_COLORS,
  ROOM_IDS,
  TOP_OBJECTS,
  buildEditorLevel,
  buildPlayableLevel,
  editorPeopleFromLevel,
  editorStateFromLevel,
  emptyEditorState,
  normalizeBoardClues,
  presentObjectTypes,
  pruneWallEdges,
  setCell,
  suspectAttributes,
  toggleWallEdgeAt,
  usedRooms,
  type EditorObject,
  type EditorState,
  type EditorSuspect,
} from '../game/editorModel.ts'
import { checkLevel, findMurderer, loadLevel, startCoverage, VOID_ROOM, type BoardClueJson, type Cell, type LevelJson } from '../engine/index.ts'
import { loadAuthorName, saveAuthorName, uploadUserLevel } from '../game/userlevels.ts'
import { keepFieldVisible } from '../game/keyboard.ts'
import { Renderer } from '../i18n/Renderer.ts'
import { useDebugSolveKey } from '../game/debugSolve.ts'
import { useNarrowLayout } from '../game/useNarrowLayout.ts'
import { useBackInterceptor } from '../game/backHandler.ts'

type Mode = 'rooms' | 'ground' | 'top' | 'window' | 'door' | 'global'
/** The four board layers shown as tabs; windows & doors live inside 'top' (Objekte). */
const LAYERS: Mode[] = ['rooms', 'ground', 'top', 'global']
type CheckResult = {
  kind: 'ok' | 'multi' | 'none' | 'contradiction' | 'aborted' | 'error' | 'saved' | 'exported' | 'loaded' | 'genfail' | 'genfailVorgaben' | 'genfailKeep' | 'uploaded' | 'uploadDuplicate' | 'uploadDaily' | 'uploadContent' | 'uploadTooFast' | 'uploadNetwork' | 'uploadFailed'
  murderer?: string
  /** For a solvable level: did pure forward deduction crack it ('pure'), or were
   *  proof-by-contradiction steps (forcing/SAT search) required ('contradiction')? */
  logic?: 'pure' | 'contradiction'
  /** Start coverage in percent (union over restricted suspects). */
  coverage?: number
  /** Mean per-suspect domain breadth in percent. */
  breadth?: number
  /** How many GLOBAL clues the case cracks without — pure noise the player reasons with in
   *  vain. Reported rather than prevented: a global clue is the author's, so neither the fill
   *  nor `pruneClues` may drop it, and refusing such a fill cost 3 of 12 fills (measured). */
  redundantBoard?: number
}
type EditDifficulty = Exclude<Difficulty, 'tutorial' | 'original'>
const DIFFS: EditDifficulty[] = ['easy', 'medium', 'hard']
const MIN = 4
/** Hard cap — matches the generator and the biggest hand-made cases (12×12). */
const MAX = 12
/** All pickable sizes — the phone layout offers them as a dropdown (a slider is
 *  imprecise there and needs a full row of width). */
const SIZES = Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i)
/** The result banner behaves like a toast — it self-dismisses after this long. */
const RESULT_TOAST_MS = 4000
/** Node budget for the editor's uniqueness search. Real levels stay far below this
 *  (worst bundled level ≈ 18k nodes); a degenerate board (murder rule unsatisfiable)
 *  would otherwise freeze the app proving "0 solutions" — abort in ~0.4 s instead. */
const CHECK_BUDGET = 500_000

/** Pick a random theme to seed the room names (changeable in the dropdown). */
const pickTheme = (): string => THEME_IDS[Math.floor(Math.random() * THEME_IDS.length)]

/** A decorative dossier case number, stable per case name (pure flavour). */
function caseNumber(name: string): string {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return String(((h >>> 0) % 9000) + 1000)
}

interface Props {
  onBack: () => void
  onPlay: (level: LevelMeta) => void
  /** When set, the editor opens this existing level for editing instead of a draft. */
  initialLevel?: LevelJson
}

/** Everything the editor persists so test-playing (or a reload) never loses work. */
interface EditorDraft {
  state: EditorState
  name: string
  difficulty: EditDifficulty
  theme: string
}

/** Seed an editor draft from an existing level ("open in the editor"). */
function draftFromLevel(level: LevelJson): EditorDraft {
  const diff = level.difficulty
  const state = editorStateFromLevel(level)
  // Preselect the theme that matches the level's rooms; fall back to a random one for
  // levels with only generic room slots (no theme to detect).
  const theme = themeFromRoomKeys(state.roomNames) ?? pickTheme()
  // Fill the room slots the level DIDN'T use (still generic "room.editorX") with the
  // theme's rooms that AREN'T already used — so every slot is labelled, with no
  // duplicates ("Room 6, 7 …" becomes the remaining theme rooms in order).
  const generic = (i: number) => `room.editor${ROOM_IDS[i]}`
  const used = new Set(state.roomNames.filter((n, i) => n !== generic(i)))
  const remaining = themeRooms(theme).filter((name) => !used.has(name))
  let next = 0
  const roomNames = state.roomNames.map((n, i) => (n === generic(i) ? (remaining[next++] ?? n) : n))
  return {
    state: { ...state, roomNames },
    name: level.title ?? '',
    difficulty: diff === 'easy' || diff === 'medium' || diff === 'hard' ? diff : 'medium',
    theme,
  }
}

/**
 * A restored draft comes straight from localStorage and may predate the current build — its
 * board clues have to be migrated, exactly like a level opened from a file. Without this the
 * editor crashed on open as soon as a clue type was renamed: the stale type reached
 * createBoardClue, which no longer knows it.
 */
function migrateDraft(draft: EditorDraft | null): EditorDraft | null {
  if (!draft?.state) return draft
  return { ...draft, state: { ...draft.state, boardClues: normalizeBoardClues(draft.state.boardClues) } }
}

export default function EditorScreen({ onBack, onPlay, initialLevel }: Props) {
  const { t, i18n } = useTranslation()
  // Autoren-Werkzeuge (geheime Wortzeichen-Geste): zeigen das JSON-Ecken-Icon im
  // Speichern-Dialog — als sichtbare Zeile braucht den Export niemand mehr.
  const [authorTools] = useState(() => loadAuthorTools())
  // Open the passed level for editing; otherwise restore the saved draft, else fresh.
  const [draft] = useState<EditorDraft | null>(() =>
    initialLevel ? draftFromLevel(initialLevel) : migrateDraft(loadEditorDraft<EditorDraft>()),
  )
  const [theme, setTheme] = useState<string>(() => draft?.theme ?? pickTheme())
  const [state, setState] = useState<EditorState>(
    () => draft?.state ?? emptyEditorState(8, themeRooms(theme)),
  )
  const [name, setName] = useState(() => draft?.name ?? '')
  // Upload byline — entered once, remembered across sessions.
  const [author, setAuthor] = useState(() => loadAuthorName())
  const [uploading, setUploading] = useState(false)
  const [difficulty, setDifficulty] = useState<EditDifficulty>(() => draft?.difficulty ?? 'medium')
  const [mode, setMode] = useState<Mode>('rooms')
  const [paintRoom, setPaintRoom] = useState('1')
  const [paintObj, setPaintObj] = useState<string>('s') // top object char, or '' to erase
  const [result, setResult] = useState<CheckResult | null>(null)
  const [showSave, setShowSave] = useState(false)
  // Validity shown as a WARNING in the save dialog (saving stays allowed — the user must be
  // able to keep/export a level for testing/sharing even when it's not yet fair).
  const [saveWarn, setSaveWarn] = useState<'ok' | 'multi' | 'none' | 'contradiction' | 'aborted'>('ok')
  // Stable per-session fallback id; a named level uses a slug so re-saving overwrites.
  const [sessionId] = useState(() => `editor-${Date.now()}`)
  const [randomizing, setRandomizing] = useState(false)
  const randomHandle = useRef<GenHandle | null>(null)
  const [regenBusy, setRegenBusy] = useState(false)
  const regenHandle = useRef<GenHandle | null>(null)
  const loadInputRef = useRef<HTMLInputElement>(null)
  // Mobile bottom-sheet picker (rooms / floor / objects / walls) + the paint mode to
  // return to when leaving the "Globale Hinweise" tab of the mobile tool card.
  const [sheetOpen, setSheetOpen] = useState(false)
  const prevPlaceMode = useRef<Mode>('rooms')

  // Every level already in the game (bundled + saved): a content signature to spot an
  // exact duplicate, and the titles to warn about a name clash. Computed once.
  const existing = useMemo(() => {
    const sigs = new Set<string>()
    const titles = new Set<string>()
    const add = (json: LevelJson) => {
      sigs.add(JSON.stringify(editorStateFromLevel(json)))
      const title = (json.title ?? '').trim().toLowerCase()
      if (title) titles.add(title)
    }
    for (const l of LEVELS) add(l.json)
    for (const j of loadCustomLevels()) add(j)
    return { sigs, titles }
  }, [])
  // This exact board+people already exists ⇒ nothing to save. A different board whose
  // name is taken ⇒ saving would overwrite, so warn (but still allow it).
  const contentExists = existing.sigs.has(JSON.stringify(state))
  const nameTaken = name.trim() !== '' && existing.titles.has(name.trim().toLowerCase())

  // Persist the draft on every change so navigating away and back restores it.
  useEffect(() => {
    saveEditorDraft({ state, name, difficulty, theme })
  }, [state, name, difficulty, theme])

  // Auto-dismiss the result banner: a fresh result re-arms the 4 s timer.
  useEffect(() => {
    if (!result) return
    const id = window.setTimeout(() => setResult(null), RESULT_TOAST_MS)
    return () => window.clearTimeout(id)
  }, [result])

  const cols = state.size

  /** Storage id: a slug of the name (re-save overwrites), else the session id. */
  const levelId = () => {
    const slug = name.trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/(^-+|-+$)/g, '')
    return slug ? `editor-${slug}` : sessionId
  }

  const resize = (size: number) => {
    setResult(null)
    setState(emptyEditorState(size, themeRooms(theme)))
  }

  /** Switch theme → re-label the room slots with that theme's room names. */
  const changeTheme = (id: string) => {
    setTheme(id)
    const names = themeRooms(id)
    setState((s) => ({ ...s, roomNames: s.roomNames.map((n, i) => names[i] ?? n) }))
  }

  const changeSuspect = (i: number, sus: EditorSuspect) =>
    setState((s) => ({ ...s, suspects: s.suspects.map((x, j) => (j === i ? sus : x)) }))

  const changeVictim = (name: string, gender: 'm' | 'f') =>
    setState((s) => ({ ...s, victim: { name, gender } }))

  const build = (id: string) =>
    buildPlayableLevel(state, id, name.trim() || undefined, difficulty, themeOutdoor(theme))

  // Check / Play / Save stay DISABLED until the board can host a murder scenario at all:
  // it must build & load, and needs ≥2 rooms (with one room the victim can never be alone
  // with exactly one suspect — the uniqueness search would freeze proving "0 solutions").
  const boardReady = useMemo(() => {
    if (usedRooms(state).length < 2) return false
    try {
      loadLevel(buildPlayableLevel(state, 'editor-validate', undefined, difficulty, themeOutdoor(theme)))
      return true
    } catch {
      return false
    }
  }, [state, difficulty, theme])

  // Ctrl+B → log the solved board + full deduction path for the level as drawn.
  useDebugSolveKey(() => {
    try {
      const puzzle = loadLevel(build('editor-debug'))
      const lang = i18n.resolvedLanguage ?? i18n.language
      const renderer = new Renderer(i18n.getResourceBundle(lang, 'translation'), puzzle)
      return { puzzle, renderer }
    } catch {
      console.warn('[Murdoku] Board lässt sich (noch) nicht bauen.')
      return null
    }
  })

  /**
   * Keep the board (rooms, floor, objects, windows, doors, global clues) exactly as
   * drawn and let the generator fill the PEOPLE: fresh names, traits and clues so the
   * case is uniquely solvable at the chosen difficulty. With `keepPeople` the styled
   * cast (names + every trait) is kept verbatim and only clues + placement are new.
   * Runs in the worker.
   */
  const randomize = (palette?: Condition[], keepPeople?: boolean) => {
    setResult(null)
    setRandomizing(true)
    const boardLevel = buildEditorLevel(
      state,
      // Full attributes always: the plain fill replaces them anyway, the keep-fill needs them.
      state.suspects.map((s) => ({ id: s.id, name: s.name, attributes: suspectAttributes(s), clues: [] })),
      { name: state.victim.name || '?', attributes: { gender: state.victim.gender } },
      name.trim() || undefined,
      themeOutdoor(theme),
    )
    const constrained = !!palette && palette.length > 0
    const handle = fillBoardCluesAsync(boardLevel, { difficulty, keepPeople }, constrained ? palette : undefined)
    randomHandle.current = handle
    handle.promise
      .then((level) => {
        randomHandle.current = null
        setRandomizing(false)
        const people = editorPeopleFromLevel(level)
        setState((s) => ({ ...s, suspects: people.suspects, victim: people.victim }))
      })
      .catch((err: Error) => {
        randomHandle.current = null
        setRandomizing(false)
        // Strict constraints / a fixed cast can be unsatisfiable on this board → tailored hints.
        if (err.message !== 'cancelled')
          setResult({ kind: constrained ? 'genfailVorgaben' : keepPeople ? 'genfailKeep' : 'genfail' })
      })
  }

  const cancelRandom = () => {
    randomHandle.current?.cancel()
    randomHandle.current = null
    setRandomizing(false)
  }

  /**
   * Generate fresh ROOMS + OBJECTS (layout, floor, furniture, windows, doors) for the
   * current theme/size/difficulty, KEEPING the suspects & victim and the global clues —
   * the people are still (re)made on the left. Runs in the worker.
   */
  const regenerateBoard = () => {
    setResult(null)
    setRegenBusy(true)
    const handle = generateLevelAsync({
      width: state.size,
      height: state.size,
      suspects: state.suspects.length,
      difficulty,
      themeId: theme,
      objects: themeDefaultObjects(theme),
    })
    regenHandle.current = handle
    handle.promise
      .then((level) => {
        regenHandle.current = null
        setRegenBusy(false)
        const gen = editorStateFromLevel(level)
        // Keep the THEME's ordered room list (exactly what the theme dropdown gives), NOT
        // the generator's shuffled subset — so the room list stays stable after a regen.
        const names = themeRooms(theme)
        // Take only the BOARD (rooms/floor/objects/openings); keep people + global clues.
        setState((s) => ({
          ...s,
          roomMap: gen.roomMap,
          roomNames: gen.roomNames.map((n, i) => names[i] ?? n),
          groundMap: gen.groundMap,
          topMap: gen.topMap,
          windows: gen.windows,
          doors: gen.doors,
        }))
      })
      .catch((err: Error) => {
        regenHandle.current = null
        setRegenBusy(false)
        if (err.message !== 'cancelled') setResult({ kind: 'genfail' })
      })
  }

  const cancelRegen = () => {
    regenHandle.current?.cancel()
    regenHandle.current = null
    setRegenBusy(false)
  }

  // PDF-Export aus dem Speichern-Dialog: das gebaute Level für den Vorschalt-Dialog
  // „ohne / mit Auflösung" (null = Dialog zu).
  const [pdfLevel, setPdfLevel] = useState<LevelJson | null>(null)

  // Back/ESC inside the editor closes the open dialog/spinner first, so you land
  // back IN the editor instead of leaving it.
  useBackInterceptor(showSave, () => setShowSave(false))
  useBackInterceptor(randomizing, cancelRandom)
  useBackInterceptor(regenBusy, cancelRegen)
  useBackInterceptor(sheetOpen, () => setSheetOpen(false))

  const check = () => {
    try {
      const level = build('editor-check')
      const puzzle = loadLevel(level)
      const c = checkLevel(puzzle, { budget: CHECK_BUDGET })
      if (c.aborted) return setResult({ kind: 'aborted' })
      if (c.solutions === 0) return setResult({ kind: 'none' })
      if (c.solutions >= 2) return setResult({ kind: 'multi' })
      const m = findMurderer(puzzle, c.solution!)
      // `c.solvable` is the SAME human-logic verdict the save gate uses: forward +
      // convergent ("egal wo X → raus"), never proof-by-contradiction. Solved ⇒ crackable
      // by clean logic; stuck ⇒ would need trial-and-error → flagged "Nur mit Widersprüchen".
      const cov = startCoverage(puzzle)
      setResult({
        kind: 'ok',
        murderer: m.suspectId ? puzzle.nameOf(m.suspectId) : undefined,
        logic: c.solvable ? 'pure' : 'contradiction',
        coverage: Math.round(cov.constrainedRatio * 100),
        breadth: Math.round(cov.avgBreadth * 100),
        redundantBoard: redundantBoardClues(level).length,
      })
    } catch {
      setResult({ kind: 'error' })
    }
  }

  const play = () => {
    try {
      const level = build(levelId())
      // Test-play is ALWAYS allowed — even an unsolvable, ambiguous, or contradiction-only
      // board may be played to try it out (the game tolerates a solution-less board: you
      // simply can't "win" it). Only SAVING/exporting requires a genuinely valid level.
      // loadLevel still runs so a structurally broken board shows an error instead of
      // navigating into a crash.
      loadLevel(level)
      onPlay(levelMetaFromJson(level, true))
    } catch {
      setResult({ kind: 'error' })
    }
  }

  // The save-dialog warning uses the EXACT same `checkLevel` as the Check button above —
  // one source of truth (DRY), so "Prüfen" and "Speichern" can never disagree.
  const validity = (level: LevelJson): 'ok' | 'multi' | 'none' | 'contradiction' | 'aborted' => {
    const c = checkLevel(loadLevel(level), { budget: CHECK_BUDGET })
    if (c.aborted) return 'aborted'
    if (c.solutions === 0) return 'none'
    if (c.solutions >= 2) return 'multi'
    return c.solvable ? 'ok' : 'contradiction'
  }

  // Open the save dialog ALWAYS; if the level isn't fully valid, surface it as a warning
  // inside the dialog but still let the user keep/export it (e.g. to test or to share a
  // case for debugging). The real guard against shipping a bad level is the GENERATOR.
  const openSave = () => {
    try {
      setSaveWarn(validity(build('editor-check')))
      setShowSave(true)
    } catch {
      setResult({ kind: 'error' })
    }
  }

  const keep = () => {
    try {
      saveCustomLevel(build(levelId()))
      setShowSave(false)
      setResult({ kind: 'saved' })
    } catch {
      setShowSave(false)
      setResult({ kind: 'error' })
    }
  }

  const exportJson = () => {
    let level: LevelJson
    try {
      level = build(levelId())
    } catch {
      setShowSave(false)
      setResult({ kind: 'error' })
      return
    }
    setShowSave(false)
    // Web downloads immediately; native opens the share sheet. Toast only once it
    // resolves — and stay silent if the user dismisses the share.
    exportLevelJson(level)
      .then(() => setResult({ kind: 'exported' }))
      .catch(() => {})
  }

  // Upload gate: only genuinely unique levels may go to the community ('ok', or
  // 'contradiction' = unique but beyond the deduction engine — those arrive with the
  // automatic "Ausprobieren" property, computed by every client at sync time). The
  // name is required; the author byline is OPTIONAL (not everyone wants to give
  // their name) and remembered for the next upload.
  const canUpload = saveWarn === 'ok' || saveWarn === 'contradiction'
  const upload = async () => {
    const title = name.trim()
    const byline = author.trim()
    if (!canUpload || title === '' || uploading) return
    saveAuthorName(byline)
    let level: LevelJson
    try {
      level = { ...build(levelId()), title, ...(byline !== '' ? { author: byline } : {}) }
    } catch {
      setShowSave(false)
      setResult({ kind: 'error' })
      return
    }
    setUploading(true)
    const res = await uploadUserLevel(level)
    setUploading(false)
    setShowSave(false)
    setResult({
      kind: res.ok
        ? 'uploaded'
        : res.error === 'duplicate'
          ? 'uploadDuplicate'
          : res.error === 'daily'
            ? 'uploadDaily'
            : res.error === 'content'
              ? 'uploadContent'
              : res.error === 'tooFast'
                ? 'uploadTooFast'
                : res.error === 'network'
                  ? 'uploadNetwork'
                  : 'uploadFailed',
    })
  }

  /** Load a level from a picked .json file (works on desktop, mobile web AND Android). */
  const loadFromFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as LevelJson
      if (!json || typeof json !== 'object' || !json.rooms || !Array.isArray(json.suspects) || !json.victim) {
        setResult({ kind: 'error' })
        return
      }
      const d = draftFromLevel(json)
      setState(d.state)
      setName(d.name)
      setDifficulty(d.difficulty)
      setTheme(d.theme)
      setResult({ kind: 'loaded' })
    } catch {
      setResult({ kind: 'error' })
    }
  }

  const paint = (cell: Cell) => {
    const row = Math.floor(cell / cols)
    const col = cell % cols
    setState((s) => {
      if (mode === 'rooms') {
        const roomMap = setCell(s.roomMap, row, col, paintRoom)
        // Moving a wall can orphan windows/doors — drop the ones no longer on a wall.
        const { windows, doors } = pruneWallEdges(roomMap, s.size, s.windows, s.doors)
        return { ...s, roomMap, windows, doors }
      }
      if (mode === 'ground') {
        // Clicking the same object that's already there removes it (toggle).
        const ch = paintObj && s.groundMap[row][col] === paintObj ? '.' : paintObj || '.'
        return { ...s, groundMap: setCell(s.groundMap, row, col, ch) }
      }
      if (mode === 'top') {
        const ch = paintObj && s.topMap[row][col] === paintObj ? '.' : paintObj || '.'
        return { ...s, topMap: setCell(s.topMap, row, col, ch) }
      }
      return s
    })
  }

  const paintWindow = (cell: Cell, fx: number, fy: number) => {
    const row = Math.floor(cell / cols)
    const col = cell % cols
    setState((s) => ({ ...s, windows: toggleWallEdgeAt(s.windows, row, col, fx, fy) }))
  }

  const paintDoor = (cell: Cell, fx: number, fy: number) => {
    const row = Math.floor(cell / cols)
    const col = cell % cols
    setState((s) => ({ ...s, doors: toggleWallEdgeAt(s.doors, row, col, fx, fy) }))
  }

  const updateBoardClue = (i: number, next: BoardClueJson) =>
    setState((s) => ({ ...s, boardClues: s.boardClues.map((b, j) => (j === i ? next : b)) }))

  /**
   * The traits a "trait inside/outside" clue may ask about — the ones the player can SEE on
   * the suspect cards, matching the set the generator offers (editor/generator parity).
   */
  const BOARD_CLUE_TRAITS = ['gender', 'beard', 'glasses', 'bald', 'hair'] as const

  /**
   * The murder rule (the victim's room always holds the victim + EXACTLY one suspect, i.e.
   * 2 people / 1 suspect) makes some counts unsatisfiable on every board. Rather than let
   * the user build a level that can never have a solution, the number input is bounded:
   *
   *   at most     >= 2 people / >= 1 suspect  (the victim's room already has that many)
   *   exactly     == 2 people / == 1 suspect  (every room must match the victim's room)
   *   not exactly must SKIP 2 people / 1 suspect — handled by boardClueSkip below
   *   at least    >= 1 (0 says nothing)
   */
  const occupancyFloor = (scope: 'people' | 'suspects' | undefined): number =>
    scope === 'suspects' ? 1 : 2

  const boardClueMin = (bc: BoardClueJson): number => {
    if (bc.type === 'roomOccupancy') {
      if (bc.op === 'atMost' || bc.op === 'exactly') return occupancyFloor(bc.scope)
      return bc.op === 'atLeast' ? 1 : 0
    }
    if (bc.type === 'countWithAttr') return 1
    return 0
  }

  /** Upper bound, where the operator forces one ('exactly' can only be the victim's count). */
  const boardClueMax = (bc: BoardClueJson): number | undefined =>
    bc.type === 'roomOccupancy' && bc.op === 'exactly' ? occupancyFloor(bc.scope) : undefined

  /** The one count "not exactly" may never name: the victim's room always has it. */
  const boardClueSkip = (bc: BoardClueJson): number | undefined =>
    bc.type === 'roomOccupancy' && bc.op === 'notExactly' ? occupancyFloor(bc.scope) : undefined

  /** Push `count` into the legal range for the current operator/scope. */
  const clampBoardClue = (bc: BoardClueJson): BoardClueJson => {
    let count = Math.max(bc.count, boardClueMin(bc))
    const max = boardClueMax(bc)
    if (max !== undefined) count = Math.min(count, max)
    if (count === boardClueSkip(bc)) count = count + 1
    return { ...bc, count }
  }

  /** A fresh clue of the picked type, carrying `count` over where that stays legal. */
  const boardClueOfType = (type: BoardClueJson['type'], count: number): BoardClueJson => {
    switch (type) {
      case 'countOnObject':
        return { type, object: presentObjectTypes(state)[0] ?? 'mud', count }
      case 'roomOccupancy':
        // "no room held exactly 1 person" — the most useful default of the four.
        return clampBoardClue({ type, op: 'notExactly', count: 1, scope: 'people' })
      case 'countWithAttr':
        // Defaults to gender, the only trait the victim visibly carries — so scope 'people'
        // is legal right away and the user can switch either field freely.
        return { type, attribute: 'gender', value: 'f', area: 'outside', count: Math.max(1, count), scope: 'people' }
      default:
        return { type, count }
    }
  }
  const removeBoardClue = (i: number) =>
    setState((s) => ({ ...s, boardClues: s.boardClues.filter((_, j) => j !== i) }))
  const addBoardClue = () =>
    setState((s) => ({
      ...s,
      boardClues: [
        ...s.boardClues,
        { type: 'countOnObject', object: presentObjectTypes(s)[0] ?? 'mud', count: 1 },
      ],
    }))

  // Windows & doors are placed from INSIDE the Objekte (top) layer — its 'Wände'
  // group — so they share the 'top' tab instead of being their own layers.
  const activeLayer: Mode = mode === 'window' || mode === 'door' ? 'top' : mode
  const selectLayer = (layer: Mode) => {
    setMode(layer)
    if (layer === 'ground') setPaintObj('r')
    else if (layer === 'top') setPaintObj('s')
  }

  // Keep the paint selection valid for the active layer.
  const palette = useMemo(() => {
    const base = activeLayer === 'ground' ? GROUND_OBJECTS : activeLayer === 'top' ? TOP_OBJECTS : []
    // Walkable objects on top, blocking ones below (stable within each group).
    return [...base].sort((a, b) => Number(b.occupiable) - Number(a.occupiable))
  }, [activeLayer])

  // On mobile the whole palette collapses to compact dropdowns (the button grid
  // wrapped too tall and covered the action buttons). Desktop keeps the grid.
  const narrow = useNarrowLayout()
  const selectedObj = palette.find((o) => o.char === paintObj)

  // Mobile "Platzieren" dropdown merges rooms + floor + objects into ONE control;
  // its value encodes "<mode>:<token>" so picking an entry also sets the mode.
  const placeValue =
    mode === 'rooms'
      ? `room:${paintRoom}`
      : mode === 'ground'
        ? `ground:${paintObj}`
        : mode === 'top'
          ? `top:${paintObj}`
          : mode === 'window'
            ? 'wall:window'
            : mode === 'door'
              ? 'wall:door'
              : '' // global → nothing to paint
  const changePlace = (value: string) => {
    const i = value.indexOf(':')
    const kind = value.slice(0, i)
    const token = value.slice(i + 1)
    if (kind === 'room') {
      setMode('rooms')
      setPaintRoom(token)
    } else if (kind === 'ground') {
      setMode('ground')
      setPaintObj(token)
    } else if (kind === 'top') {
      setMode('top')
      setPaintObj(token)
    } else if (kind === 'wall') {
      setMode(token === 'door' ? 'door' : 'window')
    }
  }
  const roomSwatchStyle =
    paintRoom === VOID_ROOM
      ? { background: '#191722', border: '1px dashed #6f6a78' }
      : { background: ROOM_COLORS[ROOM_IDS.indexOf(paintRoom)] }

  /** One object paint button — shared by the Boden and Objekte palettes. */
  const objButton = (o: EditorObject, active: boolean, onPick: () => void) => (
    <button key={o.char} type="button" className="mk-pal" data-active={active} onClick={onPick}>
      <ObjectIcon type={o.type} occupiable={o.occupiable} size={26} className="mk-pal__canvas" />
      {t(`objName.${o.type}`)}
    </button>
  )

  /** One chip in the mobile bottom sheet. `value` is the same "<mode>:<token>" code
   *  the old dropdown used, so picking simply reuses changePlace (DRY). */
  const sheetChip = (value: string, label: string, icon: ReactNode) => (
    <button
      key={value}
      type="button"
      className="mk-chip mk-sheetchip"
      data-active={placeValue === value}
      onClick={() => {
        changePlace(value)
        setSheetOpen(false)
      }}
    >
      <span className="mk-sheetchip__dot" aria-hidden="true">{icon}</span>
      {label}
    </button>
  )

  // The board-clue (global) editor — one definition, two homes: inside the mobile
  // tool card's "Globale Hinweise" tab, or the desktop palette's Global layer.
  const boardClueEditor = (
    <div className="mk-boardclue-edit">
      {state.boardClues.map((bc, i) => (
        <div key={i} className="mk-bce">
          <button
            type="button"
            className="mk-bce__del"
            onClick={() => removeBoardClue(i)}
            aria-label={t('cond.remove')}
          >
            ✕
          </button>
          <select
            className="mk-select-input"
            value={bc.type}
            onChange={(e) =>
              updateBoardClue(i, boardClueOfType(e.target.value as BoardClueJson['type'], bc.count))
            }
          >
            {/* `everyRoomCount` is legacy — it IS roomOccupancy/exactly, and old levels are
                normalised to that on open, so it never needs its own entry here. */}
            {(['countOnObject', 'emptyRooms', 'roomOccupancy', 'countWithAttr'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`editor.boardClueKind.${k}`)}
              </option>
            ))}
          </select>
          {bc.type === 'roomOccupancy' && (
            <select
              className="mk-select-input"
              value={bc.op}
              onChange={(e) =>
                updateBoardClue(i, clampBoardClue({ ...bc, op: e.target.value as typeof bc.op }))
              }
            >
              {(['atLeast', 'atMost', 'exactly', 'notExactly'] as const).map((op) => (
                <option key={op} value={op}>
                  {t(`editor.occupancyOp.${op}`)}
                </option>
              ))}
            </select>
          )}
          {bc.type === 'countOnObject' && (
            <select
              className="mk-select-input"
              value={bc.object}
              onChange={(e) => updateBoardClue(i, { ...bc, object: e.target.value })}
            >
              {presentObjectTypes(state).map((o) => (
                <option key={o} value={o}>
                  {t(`objName.${o}`)}
                </option>
              ))}
            </select>
          )}
          {bc.type === 'countWithAttr' && (
            <>
              <select
                className="mk-select-input"
                value={bc.attribute}
                onChange={(e) => {
                  const attribute = e.target.value
                  const spec = VALUED_ATTRS[attribute]
                  updateBoardClue(i, {
                    ...bc,
                    attribute,
                    value: spec ? spec.values[0] : true,
                    // Only gender is visible on the victim, so every other trait must count
                    // suspects only — otherwise the clue would hinge on hidden data.
                    scope: attribute === 'gender' ? bc.scope : 'suspects',
                  })
                }}
              >
                {BOARD_CLUE_TRAITS.map((a) => (
                  <option key={a} value={a}>
                    {t(`attrKind.${a}`)}
                  </option>
                ))}
              </select>
              {VALUED_ATTRS[bc.attribute] && (
                <select
                  className="mk-select-input"
                  value={String(bc.value)}
                  onChange={(e) => updateBoardClue(i, { ...bc, value: e.target.value })}
                >
                  {VALUED_ATTRS[bc.attribute].values.map((v) => (
                    <option key={v} value={v}>
                      {t(`${VALUED_ATTRS[bc.attribute].labelKey}.${v}`)}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="mk-select-input"
                value={bc.area}
                onChange={(e) => updateBoardClue(i, { ...bc, area: e.target.value as 'inside' | 'outside' })}
              >
                <option value="inside">{t('area.inside')}</option>
                <option value="outside">{t('area.outside')}</option>
              </select>
            </>
          )}
          {(bc.type === 'roomOccupancy' || bc.type === 'countWithAttr') && (
            <select
              className="mk-select-input"
              value={bc.scope ?? (bc.type === 'countWithAttr' ? 'suspects' : 'people')}
              // A non-gender trait can only ever count suspects (hidden victim traits).
              disabled={bc.type === 'countWithAttr' && bc.attribute !== 'gender'}
              onChange={(e) => {
                const scope = e.target.value as 'people' | 'suspects'
                // Switching scope moves the murder rule's bounds — re-clamp the count.
                updateBoardClue(i, clampBoardClue({ ...bc, scope }))
              }}
            >
              <option value="people">{t('editor.boardClueScopePeople')}</option>
              <option value="suspects">{t('editor.boardClueScopeSuspects')}</option>
            </select>
          )}
          <label className="mk-bce__count">
            <span>{t('editor.count')}</span>
            <input
              className="mk-input"
              type="number"
              min={boardClueMin(bc)}
              max={boardClueMax(bc)}
              value={bc.count}
              onChange={(e) => updateBoardClue(i, clampBoardClue({ ...bc, count: Number(e.target.value) }))}
            />
          </label>
        </div>
      ))}
      <button type="button" className="mk-btn mk-btn--ghost mk-cb__add" onClick={addBoardClue}>
        {t('editor.addClue')}
      </button>
    </div>
  )

  // What the mobile pick row shows for the current selection: "<name> · <group>".
  const pickLabel = (() => {
    if (mode === 'rooms') {
      const label =
        paintRoom === VOID_ROOM
          ? t('editor.roomEmpty')
          : t(state.roomNames[ROOM_IDS.indexOf(paintRoom)] ?? `room.editor${paintRoom}`)
      return `${label} · ${t('editor.room')}`
    }
    if (mode === 'window' || mode === 'door') {
      return `${t(`objName.${mode}`)} · ${t('editor.wallsLabel')}`
    }
    if (mode === 'ground' || mode === 'top') {
      const group = t(`editor.mode_${mode}`)
      return `${selectedObj ? t(`objName.${selectedObj.type}`) : t('editor.erase')} · ${group}`
    }
    return ''
  })()

  // Check / Play / Save — pinned in the right column on desktop, in a sticky
  // bottom bar on mobile, so the same three buttons live in exactly one place.
  // Disabled (with the reason as tooltip) until the board is structurally playable.
  const actionTitle = boardReady ? undefined : t('editor.needBoard')
  const actionButtons = (
    <>
      <button type="button" className="mk-btn mk-btn--ghost" onClick={check} disabled={!boardReady} title={actionTitle}>
        {t('editor.check')}
      </button>
      <button type="button" className="mk-btn mk-btn--ghost" onClick={play} disabled={!boardReady} title={actionTitle}>
        {t('editor.play')}
      </button>
      <button type="button" className="mk-btn mk-btn--primary" onClick={openSave} disabled={!boardReady} title={actionTitle}>
        {t('editor.save')}
      </button>
    </>
  )

  return (
    <div className="mk-game mk-editor">
      <header className="mk-game__head mk-editor__head">
        {/* Identity: back, the wordmark, and a stamped case-file tag. */}
        <div className="mk-editor__brand">
          <button type="button" className="mk-back" onClick={onBack} aria-label="back">
            ←
          </button>
          <div className="mk-editor__ident">
            <strong className="mk-editor__title">
              <span className="mk-editor__mark" aria-hidden="true">☠</span>
              {t('editor.title')}
            </strong>
            <span className="mk-editor__casetag" aria-hidden="true">
              {t('editor.caseTag')} №{caseNumber(name)}
            </span>
          </div>
        </div>

        {/* Grouped, labelled case fields: title · theme · difficulty · size. */}
        <div className="mk-editor__fields">
          <label className="mk-field mk-field--title">
            <span className="mk-field__label">{t('editor.fieldTitle')}</span>
            <input
              className="mk-input mk-editor__name"
              value={name}
              placeholder={t('editor.name')}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {/* Theme · difficulty · size: transparent on desktop (display: contents keeps
              the field row exactly as before), a strict one-row 3-column grid on phones. */}
          <div className="mk-editor__meta3">
            <label className="mk-field">
              <span className="mk-field__label">{t('editor.theme')}</span>
              <select
                className="mk-select-input"
                value={theme}
                onChange={(e) => changeTheme(e.target.value)}
              >
                {THEME_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`theme.${id}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mk-field">
              <span className="mk-field__label">{t('generate.difficulty')}</span>
              <select
                className="mk-select-input"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as EditDifficulty)}
              >
                {DIFFS.map((d) => (
                  <option key={d} value={d}>
                    {t(`difficulty.${d}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mk-field mk-field--size">
              <span className="mk-field__label">
                {t('editor.size')}
                {!narrow && (
                  <>
                    {' '}
                    <strong>{state.size}×{state.size}</strong>
                  </>
                )}
              </span>
              {narrow ? (
                // A dropdown on phones: precise to hit, a third of the row wide (the
                // slider needed a full row and was easy to nudge accidentally).
                <select
                  className="mk-select-input"
                  value={state.size}
                  onChange={(e) => resize(Number(e.target.value))}
                >
                  {/* An old draft/level may exceed the cap — keep its size listed. */}
                  {state.size > MAX && (
                    <option value={state.size}>{state.size}×{state.size}</option>
                  )}
                  {SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}×{n}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="range"
                  min={MIN}
                  max={MAX}
                  value={state.size}
                  onChange={(e) => resize(Number(e.target.value))}
                />
              )}
            </label>
          </div>

          {/* EBENE is a normal field in the SAME container as Titel/Thema/… so it
              lines up identically. Windows & doors live inside the Objekte layer.
              Hidden on phones (which use the consolidated dropdown instead). */}
          <div className="mk-field mk-editor__layerfield">
            <span className="mk-field__label">{t('editor.layer')}</span>
            <div className="mk-editor__layers" role="tablist" aria-label={t('editor.layer')}>
              {LAYERS.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  role="tab"
                  className="mk-layertab"
                  data-active={activeLayer === layer}
                  aria-selected={activeLayer === layer}
                  onClick={() => selectLayer(layer)}
                >
                  {t(`editor.mode_${layer}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* "Regenerate rooms & objects" — its own slot LEFT of the divider (the divider
            is the left border of .mk-editor__lang), so it isn't grouped with the gear. */}
        <div className="mk-editor__tool">
          <button
            type="button"
            className="mk-gear mk-gear--board"
            onClick={regenerateBoard}
            disabled={regenBusy}
            title={t('editor.randomBoardHint')}
            aria-label={t('editor.randomBoard')}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="3.5" y="3.5" width="17" height="17" rx="1.6" />
              <path d="M13 3.5 V12 M3.5 12 H9 M13 12 H20.5" />
            </svg>
          </button>
        </div>

        <div className="mk-editor__lang">
          {/* Load a level from a .json file — a hidden native file picker (works on
              desktop, mobile web AND Android). Sits beside the gear so it stays visible
              on phones too (unlike the desktop-only regenerate tool). */}
          <input
            ref={loadInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void loadFromFile(f)
            }}
          />
          <button
            type="button"
            className="mk-gear mk-gear--board"
            onClick={() => loadInputRef.current?.click()}
            title={t('editor.load')}
            aria-label={t('editor.load')}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 14.5 V18 a1.5 1.5 0 0 0 1.5 1.5 h13 a1.5 1.5 0 0 0 1.5-1.5 V14.5" />
              <path d="M12 15 V4 M8 8 L12 4 L16 8" />
            </svg>
          </button>
          <SettingsButton />
        </div>
      </header>

      {result && (
        <div className="mk-editor__result" data-kind={result.kind}>
          {result.kind === 'ok' ? (
            <>
              {result.murderer
                ? t('editor.resultOk', { name: result.murderer })
                : t('editor.resultOkNoMurderer')}
              {result.logic && (
                <span className="mk-editor__logic" data-logic={result.logic}>
                  {t(`editor.logic_${result.logic}`)}
                </span>
              )}
              {result.coverage !== undefined && (
                <span className="mk-editor__logic">
                  {t('editor.coverage', { percent: result.coverage, avg: result.breadth ?? 0 })}
                </span>
              )}
              {result.redundantBoard !== undefined && result.redundantBoard > 0 && (
                <span className="mk-editor__logic" data-logic="contradiction">
                  {t('editor.redundantBoardClue', { count: result.redundantBoard })}
                </span>
              )}
            </>
          ) : (
            t(`editor.result_${result.kind}`)
          )}
        </div>
      )}

      <SuspectsPanel
        state={state}
        onChangeSuspect={changeSuspect}
        onChangeVictim={changeVictim}
        onRandom={randomize}
        randomizing={randomizing}
      />

      <div className="mk-board">
        <EditorBoard
          state={state}
          onPaint={paint}
          windowMode={mode === 'window'}
          onPaintWindow={paintWindow}
          doorMode={mode === 'door'}
          onPaintDoor={paintDoor}
        />
      </div>

      <aside className="mk-tools mk-editor__palette">
        <div className="mk-editor__palettescroll">
          {/* MOBILE: one tool card under the board. A two-tab mode switch (Platzieren /
              Globale Hinweise) on top; below it either the pick row (opens the bottom
              sheet) or the global-clue editor. */}
          {narrow && (
            <div className="mk-mobtools">
              <div className="mk-mobtools__seg" role="tablist" aria-label={t('editor.layer')}>
                <button
                  type="button"
                  role="tab"
                  className="mk-mobtab"
                  aria-selected={mode !== 'global'}
                  onClick={() => {
                    if (mode === 'global') setMode(prevPlaceMode.current)
                  }}
                >
                  {t('editor.placeLabel')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className="mk-mobtab"
                  aria-selected={mode === 'global'}
                  onClick={() => {
                    if (mode !== 'global') {
                      prevPlaceMode.current = mode
                      setMode('global')
                    }
                  }}
                >
                  {t('editor.globalClues')}
                  {state.boardClues.length > 0 && (
                    <span className="mk-mobtab__badge">{state.boardClues.length}</span>
                  )}
                </button>
              </div>
              <div className="mk-mobtools__body">
                {mode !== 'global' ? (
                  <button type="button" className="mk-pickrow" onClick={() => setSheetOpen(true)}>
                    <span className="mk-pickrow__swatch" aria-hidden="true">
                      {mode === 'rooms' ? (
                        <span className="mk-pickrow__fill" style={roomSwatchStyle} />
                      ) : mode === 'window' || mode === 'door' ? (
                        <ObjectIcon type={mode} occupiable={false} size={30} className="mk-pal__canvas" />
                      ) : selectedObj ? (
                        <ObjectIcon
                          type={selectedObj.type}
                          occupiable={selectedObj.occupiable}
                          size={30}
                          className="mk-pal__canvas"
                        />
                      ) : (
                        <span className="mk-pal__icon">✕</span>
                      )}
                    </span>
                    <span className="mk-pickrow__what">
                      <small>{t('editor.pick')}</small>
                      <span className="mk-pickrow__name">{pickLabel}</span>
                    </span>
                    <span className="mk-pickrow__chev" aria-hidden="true">▴ {t('editor.change')}</span>
                  </button>
                ) : (
                  boardClueEditor
                )}
              </div>
            </div>
          )}

          {mode === 'window' && <p className="mk-pal__hint">{t('editor.windowHint')}</p>}
          {mode === 'door' && <p className="mk-pal__hint">{t('editor.doorHint')}</p>}

          {/* DESKTOP: the Global layer tab shows the same editor in the palette column
              (mobile renders it inside the tool card above). */}
          {!narrow && activeLayer === 'global' && boardClueEditor}

          {/* DESKTOP: per-layer item buttons (mobile uses the dropdowns above). */}
          {!narrow && activeLayer === 'rooms' && (
            <>
              <button
                type="button"
                className="mk-pal mk-pal--room"
                data-active={paintRoom === VOID_ROOM}
                onClick={() => setPaintRoom(VOID_ROOM)}
              >
                <span
                  className="mk-pal__swatch"
                  style={{ background: '#191722', border: '1px dashed #6f6a78' }}
                />
                {t('editor.roomEmpty')}
              </button>
              {ROOM_IDS.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  className="mk-pal mk-pal--room"
                  data-active={paintRoom === id}
                  onClick={() => setPaintRoom(id)}
                >
                  <span className="mk-pal__swatch" style={{ background: ROOM_COLORS[i] }} />
                  {t(state.roomNames[i] ?? `room.editor${id}`)}
                </button>
              ))}
            </>
          )}

          {/* Boden: a single flat list of floor objects. */}
          {!narrow && activeLayer === 'ground' && (
            <>
              {palette.map((o) => objButton(o, paintObj === o.char, () => setPaintObj(o.char)))}
              <button
                type="button"
                className="mk-pal"
                data-active={paintObj === ''}
                onClick={() => setPaintObj('')}
              >
                <span className="mk-pal__icon">✕</span>
                {t('editor.erase')}
              </button>
            </>
          )}

          {/* Objekte: grouped walkable / blocking, plus the 'Wände' subgroup that
              merges the former Fenster & Türen tools (selecting one arms edge mode). */}
          {!narrow && activeLayer === 'top' && (
            <>
              <div className="mk-pal__group">
                <span className="mk-pal__grouplabel">{t('editor.groupWalkable')}</span>
                {TOP_OBJECTS.filter((o) => o.occupiable).map((o) =>
                  objButton(o, mode === 'top' && paintObj === o.char, () => {
                    setMode('top')
                    setPaintObj(o.char)
                  }),
                )}
              </div>
              <div className="mk-pal__group">
                <span className="mk-pal__grouplabel">{t('editor.groupBlocking')}</span>
                {TOP_OBJECTS.filter((o) => !o.occupiable).map((o) =>
                  objButton(o, mode === 'top' && paintObj === o.char, () => {
                    setMode('top')
                    setPaintObj(o.char)
                  }),
                )}
              </div>
              <button
                type="button"
                className="mk-pal"
                data-active={mode === 'top' && paintObj === ''}
                onClick={() => {
                  setMode('top')
                  setPaintObj('')
                }}
              >
                <span className="mk-pal__icon">✕</span>
                {t('editor.erase')}
              </button>
              <div className="mk-pal__group">
                <span className="mk-pal__grouplabel">{t('editor.wallsLabel')}</span>
                <button
                  type="button"
                  className="mk-pal mk-pal--wall"
                  data-active={mode === 'window'}
                  onClick={() => setMode('window')}
                >
                  <ObjectIcon type="window" occupiable={false} size={26} className="mk-pal__canvas" />
                  {t('objName.window')}
                  <span className="mk-pal__tag">{t('legend.wall')}</span>
                </button>
                <button
                  type="button"
                  className="mk-pal mk-pal--wall"
                  data-active={mode === 'door'}
                  onClick={() => setMode('door')}
                >
                  <ObjectIcon type="door" occupiable={false} size={26} className="mk-pal__canvas" />
                  {t('objName.door')}
                  <span className="mk-pal__tag">{t('legend.wall')}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Desktop keeps the actions pinned at the bottom of this column. */}
        {!narrow && <div className="mk-editor__actions">{actionButtons}</div>}
      </aside>

      {/* Mobile: actions are a sticky bar at the very bottom of the page. */}
      {narrow && <div className="mk-editor__actions mk-editor__actionsbar">{actionButtons}</div>}

      {/* Mobile bottom-sheet picker: everything paintable, grouped, one tap to pick.
          It scrolls (max-height) — themes can bring MANY rooms and objects. */}
      {narrow && sheetOpen && (
        <>
          <div className="mk-sheetveil" onClick={() => setSheetOpen(false)} />
          <div className="mk-sheet" role="dialog" aria-label={t('editor.placeLabel')}>
            <div className="mk-sheet__grab" aria-hidden="true" />
            <p className="mk-sheet__group">{t('editor.rooms')}</p>
            <div className="mk-sheet__chips">
              {sheetChip(
                `room:${VOID_ROOM}`,
                t('editor.roomEmpty'),
                <span
                  className="mk-pickrow__fill"
                  style={{ background: '#191722', border: '1px dashed #6f6a78' }}
                />,
              )}
              {ROOM_IDS.map((id, i) =>
                sheetChip(
                  `room:${id}`,
                  t(state.roomNames[i] ?? `room.editor${id}`),
                  <span className="mk-pickrow__fill" style={{ background: ROOM_COLORS[i] }} />,
                ),
              )}
            </div>
            <p className="mk-sheet__group">{t('editor.mode_ground')}</p>
            <div className="mk-sheet__chips">
              {GROUND_OBJECTS.map((o) =>
                sheetChip(
                  `ground:${o.char}`,
                  t(`objName.${o.type}`),
                  <ObjectIcon type={o.type} occupiable={o.occupiable} size={20} className="mk-pal__canvas" />,
                ),
              )}
              {sheetChip('ground:', t('editor.erase'), <span className="mk-pal__icon">✕</span>)}
            </div>
            <p className="mk-sheet__group">{`${t('editor.mode_top')} – ${t('generate.objectsOccupiable')}`}</p>
            <div className="mk-sheet__chips">
              {TOP_OBJECTS.filter((o) => o.occupiable).map((o) =>
                sheetChip(
                  `top:${o.char}`,
                  t(`objName.${o.type}`),
                  <ObjectIcon type={o.type} occupiable={o.occupiable} size={20} className="mk-pal__canvas" />,
                ),
              )}
            </div>
            <p className="mk-sheet__group">{`${t('editor.mode_top')} – ${t('generate.objectsBlocking')}`}</p>
            <div className="mk-sheet__chips">
              {TOP_OBJECTS.filter((o) => !o.occupiable).map((o) =>
                sheetChip(
                  `top:${o.char}`,
                  t(`objName.${o.type}`),
                  <ObjectIcon type={o.type} occupiable={o.occupiable} size={20} className="mk-pal__canvas" />,
                ),
              )}
              {sheetChip('top:', t('editor.erase'), <span className="mk-pal__icon">✕</span>)}
            </div>
            <p className="mk-sheet__group">{t('editor.wallsLabel')}</p>
            <div className="mk-sheet__chips">
              {sheetChip(
                'wall:window',
                t('objName.window'),
                <ObjectIcon type="window" occupiable={false} size={20} className="mk-pal__canvas" />,
              )}
              {sheetChip(
                'wall:door',
                t('objName.door'),
                <ObjectIcon type="door" occupiable={false} size={20} className="mk-pal__canvas" />,
              )}
            </div>
          </div>
        </>
      )}

      {showSave && (
        <div className="mk-overlay" onClick={() => setShowSave(false)}>
          <div className="mk-dialog mk-savedlg" onClick={(e) => e.stopPropagation()}>
            {/* Winziges Ecken-Icon (wie im Sieg-Dialog): den Fall als Druckbogen sichern —
                hier oben RECHTS, die Ecke ist im Editor-Dialog frei. */}
            <button
              type="button"
              className="mk-cornerbtn"
              aria-label={t('game.pdfExport')}
              title={t('game.pdfExport')}
              onClick={() => {
                let level: LevelJson
                try {
                  level = build(levelId())
                } catch {
                  setShowSave(false)
                  setResult({ kind: 'error' })
                  return
                }
                setPdfLevel(level)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6 8V3h12v5M6 17H3v-7h18v7h-3M7 14h10v7H7z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {/* Autoren-JSON oben LINKS — die rechte Ecke gehört dem PDF (Dirks Wunsch). */}
            {authorTools && (
              <button
                type="button"
                className="mk-cornerbtn mk-cornerbtn--left"
                aria-label={t('editor.saveExport')}
                title={t('editor.saveExport')}
                onClick={exportJson}
              >
                <span className="mk-cornerbtn__type" aria-hidden="true">{'{ }'}</span>
              </button>
            )}
            <h3>{t('editor.saveTitle')}</h3>
            <div className="mk-nameform">
              <label htmlFor="mk-savename">{t('result.nameLabel')}</label>
              <input
                id="mk-savename"
                type="text"
                autoFocus
                value={name}
                maxLength={40}
                placeholder={t('editor.name')}
                onChange={(e) => setName(e.target.value)}
                onFocus={keepFieldVisible}
              />
            </div>
            <div className="mk-nameform">
              <label htmlFor="mk-authorname">{t('editor.authorLabel')}</label>
              <input
                id="mk-authorname"
                type="text"
                value={author}
                maxLength={40}
                placeholder={t('editor.authorPlaceholder')}
                onChange={(e) => setAuthor(e.target.value)}
                onFocus={keepFieldVisible}
              />
            </div>
            <div className="mk-savedlg__diff">
              {DIFFS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="mk-chip"
                  data-active={difficulty === d}
                  onClick={() => setDifficulty(d)}
                >
                  {t(`difficulty.${d}`)}
                </button>
              ))}
            </div>
            {saveWarn !== 'ok' && (
              <p className="mk-savedlg__warn">⚠ {t(`editor.result_${saveWarn}`)}</p>
            )}
            {contentExists ? (
              <>
                <p className="mk-savedlg__exists">{t('editor.levelExists')}</p>
                <div className="mk-dialog__actions">
                  <button type="button" className="mk-btn mk-btn--ghost" onClick={() => setShowSave(false)}>
                    {t('generate.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <>
                {nameTaken && <p className="mk-savedlg__warn">{t('editor.nameTaken')}</p>}
                {/* The three destinations as self-explaining share-sheet rows: icon +
                    name + a 3–5 word subline right where you tap — no separate hint
                    text needed. A locked upload row shows its REASON as the subline. */}
                <div className="mk-savelist">
                  <button
                    type="button"
                    className="mk-saverow"
                    disabled={!canUpload || name.trim() === '' || uploading}
                    onClick={() => void upload()}
                  >
                    <span className="mk-saverow__ic" aria-hidden="true">↥</span>
                    <span className="mk-saverow__text">
                      <span className="mk-saverow__title">{t('editor.saveUpload')}</span>
                      <span className="mk-saverow__sub">
                        {uploading
                          ? t('editor.uploading')
                          : !canUpload
                            ? t('editor.uploadGateShort')
                            : name.trim() === ''
                              ? t('editor.uploadNeedTitle')
                              : saveWarn === 'contradiction'
                                ? t('editor.uploadNoLogicShort')
                                : t('editor.uploadSub')}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="mk-saverow" onClick={keep}>
                    <span className="mk-saverow__ic" aria-hidden="true">✓</span>
                    <span className="mk-saverow__text">
                      <span className="mk-saverow__title">{t('editor.saveKeep')}</span>
                      <span className="mk-saverow__sub">{t('editor.keepSub')}</span>
                    </span>
                  </button>
                  {/* JSON ist keine sichtbare Zeile mehr — Autoren erreichen den Export
                      über das versteckte Ecken-Icon oben rechts. */}
                </div>
                {/* Plain back — closes the dialog, deliberately set apart from the
                    destination list (it is navigation, not a destination). */}
                <div className="mk-dialog__actions">
                  <button type="button" className="mk-btn mk-btn--ghost" onClick={() => setShowSave(false)}>
                    {t('generate.cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pdfLevel && (
        <PdfDialog
          json={pdfLevel}
          title={name.trim() || t('editor.name')}
          onClose={() => setPdfLevel(null)}
        />
      )}

      {randomizing && (
        <div className="mk-overlay">
          <div className="mk-dialog">
            <span className="mk-spinner" />
            <p>{t('editor.randomizing')}</p>
            {/* Same budgets as the generator screen (the fill runs through the same pool):
                the figure IS workerBudget's hard wall (longHintSeconds — single source). */}
            {state.size >= 10 && (
              <p className="mk-genhint">
                {t('generate.generatingLong', { seconds: longHintSeconds(state.size, difficulty) })}
              </p>
            )}
            <button type="button" className="mk-btn mk-btn--ghost" onClick={cancelRandom}>
              {t('generate.cancel')}
            </button>
          </div>
        </div>
      )}

      {regenBusy && (
        <div className="mk-overlay">
          <div className="mk-dialog">
            <span className="mk-spinner" />
            <p>{t('editor.randomizingBoard')}</p>
            {state.size >= 10 && (
              <p className="mk-genhint">
                {t('generate.generatingLong', { seconds: longHintSeconds(state.size, difficulty) })}
              </p>
            )}
            <button type="button" className="mk-btn mk-btn--ghost" onClick={cancelRegen}>
              {t('generate.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
