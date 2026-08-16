import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from './Avatar.tsx'
import AttrIcons from './AttrIcons.tsx'
import AppearanceInfo from './AppearanceInfo.tsx'
import InfoTip from './InfoTip.tsx'
import ClueBuilder, { type ClueCtx } from './ClueBuilder.tsx'
import ClueText from './ClueText.tsx'
import { Renderer } from '../i18n/Renderer.ts'
import { suspectColor } from '../game/palette.ts'
import { useSettings } from '../game/settings.ts'
import { useBackInterceptor } from '../game/backHandler.ts'
import {
  HAIR_COLORS,
  TEMPLATE_TARGET_FIELDS,
  defaultCondition,
  emptyClueGroup,
  type ClueGroup,
  type Condition,
} from '../game/editorClues.ts'
import { BEARD_STYLES, GLASSES_COLORS, GLASSES_SHAPES, hairstylesFor } from '../game/avatar.ts'
import {
  ROOM_IDS,
  buildPlayableLevel,
  objectCellsOf,
  presentObjectTypes,
  suspectAttributes,
  usedRooms,
  type EditorState,
  type EditorSuspect,
} from '../game/editorModel.ts'
import { isWaterRoom, loadLevel, usesInsideOutside, type Puzzle } from '../engine/index.ts'

interface Props {
  state: EditorState
  onChangeSuspect: (index: number, suspect: EditorSuspect) => void
  onChangeVictim: (name: string, gender: 'm' | 'f') => void
  /** Generate people + clues onto the current board (kept as-is). With a `palette`
   *  (the "Vorgaben" templates) only matching clue shapes are used. With `keepPeople`
   *  the styled cast (names + traits) is kept and only clues + placement are new. */
  onRandom: (palette?: Condition[], keepPeople?: boolean) => void
  randomizing: boolean
}

/** Line-art icons for the random dialog (noir style — never emoji in dialogs). */
function DiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
      <circle cx="15" cy="9" r="1.4" fill="currentColor" />
      <circle cx="9" cy="15" r="1.4" fill="currentColor" />
      <circle cx="15" cy="15" r="1.4" fill="currentColor" />
    </svg>
  )
}
function KeepPeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Build the editor state into a playable puzzle + a renderer for the active
 *  language — the basis for previews (board rules, suspect clue text). Returns null
 *  while the board can't be built yet. Memoised so it rebuilds live as the state edits. */
function useEditorBuild(state: EditorState): { puzzle: Puzzle; renderer: Renderer } | null {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  return useMemo(() => {
    try {
      const puzzle = loadLevel(buildPlayableLevel(state, 'preview'))
      const renderer = new Renderer(i18n.getResourceBundle(lang, 'translation'), puzzle)
      return { puzzle, renderer }
    } catch {
      return null
    }
  }, [state, lang, i18n])
}

export default function SuspectsPanel({
  state,
  onChangeSuspect,
  onChangeVictim,
  onRandom,
  randomizing,
}: Props) {
  const { t } = useTranslation()
  const { genderColors } = useSettings()
  const [editing, setEditing] = useState<number | 'victim' | null>(null)
  const [showConstraints, setShowConstraints] = useState(false)
  // The 🎲 pre-dialog: "alles neu" vs "Personen behalten" (share-sheet pattern).
  const [showRandom, setShowRandom] = useState(false)
  // The same choice inside the "Vorgaben" dialog — kept like `constraints` so it
  // survives closing/reopening the dialog within an editing session.
  const [keepPeople, setKeepPeople] = useState(false)
  // The "Vorgaben" palette: clue-shape templates the generator may use. Kept here so it
  // survives closing/reopening the dialog within an editing session.
  const [constraints, setConstraints] = useState<ClueGroup>(() => emptyClueGroup())
  const built = useEditorBuild(state)

  // Android back / desktop ESC: close the suspect (or victim) editor and the
  // constraints dialog first — so you return to the editor, not out of it.
  useBackInterceptor(editing !== null, () => setEditing(null))
  useBackInterceptor(showConstraints, () => setShowConstraints(false))
  useBackInterceptor(showRandom, () => setShowRandom(false))

  // Builder context for the constraint templates: the board's rooms/objects, but with a
  // single synthetic "(Generator wählt)" person — the suspects don't exist yet, so a
  // concrete person can't be fixed (the generator always picks it).
  const templateCtx: ClueCtx = useMemo(
    () => ({
      rooms: usedRooms(state).length ? usedRooms(state) : ['1'],
      objects: presentObjectTypes(state),
      others: [{ id: '*', name: t('cond.genPicks') }],
      size: state.size,
      objectCells: (type) => objectCellsOf(state, type),
      hasWindows: state.windows.length > 0,
      hasDoors: state.doors.length > 0,
      roomLabel: (id) => {
        const idx = ROOM_IDS.indexOf(id)
        return t(state.roomNames[idx] ?? `room.editor${id}`)
      },
    }),
    [state, t],
  )

  const openConstraints = () => {
    // Seed with one ready-to-tweak template (the "same room as a trait" case, which best
    // shows the depth: count + exact/at-least) so the dialog isn't empty.
    if (constraints.conditions.length === 0) {
      setConstraints({
        connector: 'and',
        conditions: [
          {
            ...defaultCondition('room', templateCtx),
            roomMode: 'with',
            roomTarget: 'attr',
            wild: ['of', ...TEMPLATE_TARGET_FIELDS],
          },
        ],
      })
    }
    setShowConstraints(true)
  }
  const runConstraints = () => {
    setShowConstraints(false)
    onRandom(constraints.conditions, keepPeople)
  }

  // Global (board) rules, rendered exactly like the game's clue panel, so the editor
  // shows at a glance which ones are set. Best effort — skipped if the board won't build.
  const boardNotes = useMemo(() => {
    if (!built) return []
    const { puzzle, renderer } = built
    const notes = puzzle.boardClues.map((c) => renderer.render(c.describe()))
    // Same global rule as the game: a water room is drawn as a lake but is walkable.
    if ([...puzzle.board.rooms.values()].some((r) => isWaterRoom(r.nameKey))) {
      notes.unshift(t('game.waterWalkable'))
    }
    // …and the same indoor/outdoor legend, so the editor shows exactly what the player will
    // read. `outside` is a room flag the board art never reveals, so a clue leaning on it is
    // unusable without this list.
    const outside = [...puzzle.board.rooms.values()].filter((r) => r.outside).map((r) => t(r.nameKey))
    if (usesInsideOutside(puzzle) && outside.length > 0) {
      notes.unshift(`${t('game.outsideLabel')}: ${outside.join(', ')}`)
    }
    return notes
  }, [built, t])

  return (
    <div className="mk-clues mk-editor__left">
      <p className="mk-clues__title">{t('game.suspects')}</p>

      {boardNotes.length > 0 && (
        <div className="mk-boardclues">
          {boardNotes.map((note, i) => (
            <p key={i} className="mk-boardclue">
              <span className="mk-boardclue__icon">🔍</span>
              {note}
            </p>
          ))}
        </div>
      )}

      {state.suspects.map((s, i) => {
        // Reuse the game's clue renderer (bold objects/rooms + concept tooltips). Only
        // the click differs: here it opens the editor instead of selecting the suspect.
        const built_s = built?.puzzle.suspects[i]
        const hasClues = !!built_s && built_s.clues.length > 0
        return (
          <button
            key={s.id}
            type="button"
            className="mk-clue"
            data-suspect={s.id}
            data-gender={genderColors ? s.gender : undefined}
            onClick={() => setEditing(i)}
          >
            <InfoTip
              className="mk-avatarwrap"
              anchor=".mk-clue"
              content={<AppearanceInfo attrs={suspectAttributes(s)} letter={s.id} />}
            >
              <Avatar
                className="mk-avatar"
                attrs={suspectAttributes(s)}
                color={suspectColor(i)}
                letter={s.id}
              />
            </InfoTip>
            <span className="mk-clue__main">
              <span className="mk-clue__name">
                {s.name || s.id}
                <AttrIcons attrs={suspectAttributes(s)} />
              </span>
              <span className="mk-clue__text">
                {hasClues && built ? (
                  <ClueText renderer={built.renderer} clues={built_s!.clues} subjectId={s.id} />
                ) : (
                  t('editor.noClue')
                )}
              </span>
            </span>
          </button>
        )
      })}

      <button
        type="button"
        className="mk-clue mk-clue--victim"
        onClick={() => setEditing('victim')}
      >
        <InfoTip
          className="mk-avatarwrap"
          anchor=".mk-clue"
          content={
            <span className="mk-tipinfo">
              <span>
                {state.victim.gender === 'm' ? '♂' : '♀'}{' '}
                {t(state.victim.gender === 'm' ? 'info.male' : 'info.female')}
              </span>
            </span>
          }
        >
          <span className="mk-token mk-token--victim">☠</span>
        </InfoTip>
        <span className="mk-clue__main">
          <span className="mk-clue__name">
            <span
              className="mk-victimname"
              data-gender={genderColors ? state.victim.gender : undefined}
            >
              {state.victim.name || t('game.victim')}
            </span>
            <span className="mk-attr">{state.victim.gender === 'm' ? '♂' : '♀'}</span>
          </span>
          <span className="mk-clue__text">{t('game.victim')}</span>
        </span>
      </button>

      {/* Spaced apart from the victim so it isn't pressed by accident. */}
      <button
        type="button"
        className="mk-clue mk-clue--random"
        onClick={() => setShowRandom(true)}
        disabled={randomizing}
      >
        <span className="mk-token mk-token--random">🎲</span>
        <span className="mk-clue__main">
          <span className="mk-clue__name">{t('editor.random')}</span>
          <span className="mk-clue__text">{t('editor.randomHint')}</span>
        </span>
      </button>

      <button
        type="button"
        className="mk-clue mk-clue--random"
        onClick={openConstraints}
        disabled={randomizing}
      >
        <span className="mk-token mk-token--random">🎯</span>
        <span className="mk-clue__main">
          <span className="mk-clue__name">{t('editor.randomConstrained')}</span>
          <span className="mk-clue__text">{t('editor.randomConstrainedHint')}</span>
        </span>
      </button>

      {typeof editing === 'number' && (
        <SuspectEditor
          state={state}
          index={editing}
          onChange={(s) => onChangeSuspect(editing, s)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing === 'victim' && (
        <VictimEditor
          name={state.victim.name}
          gender={state.victim.gender}
          onChange={onChangeVictim}
          onClose={() => setEditing(null)}
        />
      )}
      {showRandom && (
        <div className="mk-overlay" onClick={() => setShowRandom(false)}>
          <div className="mk-dialog mk-savedlg" onClick={(e) => e.stopPropagation()}>
            <h3>{t('editor.random')}</h3>
            <div className="mk-savelist">
              <button
                type="button"
                className="mk-saverow"
                onClick={() => {
                  setShowRandom(false)
                  onRandom()
                }}
              >
                <span className="mk-saverow__ic" aria-hidden="true">
                  <DiceIcon />
                </span>
                <span className="mk-saverow__text">
                  <span className="mk-saverow__title">{t('editor.randomAllNew')}</span>
                  <span className="mk-saverow__sub">{t('editor.randomAllNewSub')}</span>
                </span>
              </button>
              <button
                type="button"
                className="mk-saverow"
                onClick={() => {
                  setShowRandom(false)
                  onRandom(undefined, true)
                }}
              >
                <span className="mk-saverow__ic" aria-hidden="true">
                  <KeepPeopleIcon />
                </span>
                <span className="mk-saverow__text">
                  <span className="mk-saverow__title">{t('editor.randomKeepPeople')}</span>
                  <span className="mk-saverow__sub">{t('editor.randomKeepPeopleSub')}</span>
                </span>
              </button>
            </div>
            <div className="mk-dialog__actions">
              <button type="button" className="mk-btn mk-btn--ghost" onClick={() => setShowRandom(false)}>
                {t('generate.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showConstraints && (
        <div className="mk-overlay" onClick={() => setShowConstraints(false)}>
          <div className="mk-dialog mk-suspedit mk-constraints" onClick={(e) => e.stopPropagation()}>
            <p className="mk-suspedit__label">{t('editor.constraintsTitle')}</p>
            <p className="mk-constraints__intro">{t('editor.constraintsIntro')}</p>
            <ClueBuilder group={constraints} ctx={templateCtx} onChange={setConstraints} templateMode />
            {/* Same choice as the 🎲 pre-dialog, as a compact chip pair (suspect-editor style). */}
            <div className="mk-suspedit__traits">
              <button
                type="button"
                className="mk-chip"
                data-active={!keepPeople}
                onClick={() => setKeepPeople(false)}
              >
                {t('editor.peopleNew')}
              </button>
              <button
                type="button"
                className="mk-chip"
                data-active={keepPeople}
                onClick={() => setKeepPeople(true)}
              >
                {t('editor.randomKeepPeople')}
              </button>
            </div>
            <button
              type="button"
              className="mk-btn mk-btn--primary mk-btn--block"
              onClick={runConstraints}
              disabled={randomizing || constraints.conditions.length === 0}
            >
              {t('editor.constraintsRun')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface EditorProps {
  state: EditorState
  index: number
  onChange: (suspect: EditorSuspect) => void
  onClose: () => void
}

function SuspectEditor({ state, index, onChange, onClose }: EditorProps) {
  const { t } = useTranslation()
  const s = state.suspects[index]
  // Live preview rebuilds as the clue is edited; same renderer as the game.
  const built = useEditorBuild(state)
  const previewSuspect = built?.puzzle.suspects[index]

  const ctx: ClueCtx = useMemo(() => {
    const rooms = usedRooms(state)
    return {
      rooms: rooms.length ? rooms : ['1'],
      objects: presentObjectTypes(state),
      others: state.suspects.filter((o) => o.id !== s.id).map((o) => ({ id: o.id, name: o.name || o.id })),
      size: state.size,
      objectCells: (type) => objectCellsOf(state, type),
      hasWindows: state.windows.length > 0,
      hasDoors: state.doors.length > 0,
      roomLabel: (id) => {
        const i = ROOM_IDS.indexOf(id)
        return t(state.roomNames[i] ?? `room.editor${id}`)
      },
    }
  }, [state, s.id, t])

  const trait = (key: 'beard' | 'glasses' | 'bald', label: string) => (
    <button
      type="button"
      className="mk-chip"
      data-active={s[key]}
      onClick={() => onChange({ ...s, [key]: !s[key] })}
    >
      {label}
    </button>
  )

  /** A labelled style dropdown (hairstyle / beard / glasses) writing one field. */
  const styleSelect = (
    key: 'hairstyle' | 'beardStyle' | 'glassesShape' | 'glassesColor',
    value: string,
    options: readonly string[],
    labelPrefix: string,
    autoLabel?: string,
  ) => (
    <label className="mk-fieldlet">
      <span className="mk-fieldlet__label">{t(`editor.${key}`)}</span>
      <select
        className="mk-select-input"
        value={value}
        onChange={(e) => onChange({ ...s, [key]: e.target.value })}
      >
        {autoLabel !== undefined && <option value="">{autoLabel}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`${labelPrefix}.${o}`)}
          </option>
        ))}
      </select>
    </label>
  )

  // Only offer hairstyles valid for the current gender; cross-gender → "auto".
  const hairOptions = hairstylesFor(s.gender)
  const hairstyleValue = s.hairstyle && hairOptions.includes(s.hairstyle) ? s.hairstyle : ''

  return (
    <div className="mk-overlay" onClick={onClose}>
      <div className="mk-dialog mk-suspedit" onClick={(e) => e.stopPropagation()}>
        <div className="mk-suspedit__head">
          <Avatar
            className="mk-avatar mk-suspedit__avatar"
            attrs={suspectAttributes(s)}
            color={suspectColor(index)}
            letter={s.id}
          />
          <input
            className="mk-input"
            value={s.name}
            placeholder={s.id}
            onChange={(e) => onChange({ ...s, name: e.target.value })}
          />
        </div>

        <div className="mk-suspedit__traits">
          {(['m', 'f'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="mk-chip"
              data-active={s.gender === g}
              onClick={() => onChange({ ...s, gender: g, hairstyle: '' })}
            >
              {g === 'm' ? `♂ ${t('info.male')}` : `♀ ${t('info.female')}`}
            </button>
          ))}
          {trait('beard', `🧔 ${t('info.beard')}`)}
          {trait('glasses', `👓 ${t('info.glasses')}`)}
          {trait('bald', `🧑‍🦲 ${t('info.bald')}`)}
        </div>

        <div className="mk-suspedit__traits">
          {!s.bald && (
            <>
              <label className="mk-fieldlet">
                <span className="mk-fieldlet__label">{t('editor.hair')}</span>
                <select
                  className="mk-select-input"
                  value={s.hair}
                  onChange={(e) => onChange({ ...s, hair: e.target.value })}
                >
                  <option value="">{t('editor.hairDefault')}</option>
                  {HAIR_COLORS.map((h) => (
                    <option key={h} value={h}>
                      {t(`hairColor.${h}`)}
                    </option>
                  ))}
                </select>
              </label>
              {styleSelect('hairstyle', hairstyleValue, hairOptions, 'hairstyle', t('editor.styleAuto'))}
            </>
          )}
          {s.beard && styleSelect('beardStyle', s.beardStyle || 'full', BEARD_STYLES, 'beardStyle')}
          {s.glasses && (
            <>
              {styleSelect('glassesShape', s.glassesShape || 'round', GLASSES_SHAPES, 'glassesShape')}
              {styleSelect('glassesColor', s.glassesColor || 'black', GLASSES_COLORS, 'glassesColor')}
            </>
          )}
        </div>

        <p className="mk-suspedit__label">{t('editor.clueTitle')}</p>
        <ClueBuilder
          group={s.clue}
          ctx={ctx}
          onChange={(clue: ClueGroup) => onChange({ ...s, clue })}
        />

        <p className="mk-suspedit__preview">
          <span>{t('editor.cluePreview')}</span>{' '}
          <span className="mk-clue__text">
            {built && previewSuspect && previewSuspect.clues.length > 0 ? (
              <ClueText renderer={built.renderer} clues={previewSuspect.clues} subjectId={s.id} />
            ) : (
              t('editor.noClue')
            )}
          </span>
        </p>

        <button type="button" className="mk-btn mk-btn--primary mk-btn--block" onClick={onClose}>
          {t('editor.done')}
        </button>
      </div>
    </div>
  )
}

interface VictimProps {
  name: string
  gender: 'm' | 'f'
  onChange: (name: string, gender: 'm' | 'f') => void
  onClose: () => void
}

function VictimEditor({ name, gender, onChange, onClose }: VictimProps) {
  const { t } = useTranslation()
  return (
    <div className="mk-overlay" onClick={onClose}>
      <div className="mk-dialog mk-suspedit" onClick={(e) => e.stopPropagation()}>
        <div className="mk-suspedit__head">
          <span className="mk-token mk-token--victim">☠</span>
          <input
            className="mk-input"
            value={name}
            placeholder={t('game.victim')}
            onChange={(e) => onChange(e.target.value, gender)}
          />
        </div>
        <div className="mk-suspedit__traits">
          {(['m', 'f'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="mk-chip"
              data-active={gender === g}
              onClick={() => onChange(name, g)}
            >
              {g === 'm' ? `♂ ${t('info.male')}` : `♀ ${t('info.female')}`}
            </button>
          ))}
        </div>
        <button type="button" className="mk-btn mk-btn--primary mk-btn--block" onClick={onClose}>
          {t('editor.done')}
        </button>
      </div>
    </div>
  )
}
