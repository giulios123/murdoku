import { useTranslation } from 'react-i18next'
import {
  ATTR_KINDS,
  BOOL_ATTRS,
  CARDINALS,
  COND_SECTIONS,
  DIRECTIONS_8,
  LINE_KINDS,
  QUANTIFIERS,
  ROOM_RELS,
  TEMPLATE_TARGET_FIELDS,
  VALUED_ATTRS,
  defaultCondition,
  type AttrKind,
  type AxisKind,
  type ClueGroup,
  type CondKind,
  type Condition,
  type InOutKind,
  type PortalKind,
  type Quantifier,
} from '../game/editorClues.ts'
import {
  OCCUPIABLE_OBJECT_TYPES,
  type Direction,
  type Direction8,
  type LineKind,
  type RoomRel,
} from '../engine/index.ts'

export interface ClueCtx {
  rooms: string[]
  objects: string[]
  others: { id: string; name: string }[]
  size: number
  /** Cell indices (row*size+col) holding an object of the type — for anchoring a
   *  direction clue to one specific tile when several exist. */
  objectCells: (type: string) => number[]
  /** Whether the board has any window / door — gates the "Fenster/Tür" condition. */
  hasWindows: boolean
  hasDoors: boolean
  roomLabel: (id: string) => string
}

interface Props {
  group: ClueGroup
  ctx: ClueCtx
  onChange: (group: ClueGroup) => void
  /** Generator-constraint mode ("Vorgaben"): each row is a TEMPLATE, not a real clue.
   *  Hides the AND/OR connector and shows a per-row "Generator wählt" toggle that frees
   *  the target fields (object/trait/room/…); the person is always generator-chosen. */
  templateMode?: boolean
}

/** Free targets a brand-new / re-kinded template starts with (chip ON). */
const ALL_WILD = ['of', ...TEMPLATE_TARGET_FIELDS]

/** Flat clue builder: a list of conditions joined by one connector, each with NICHT. */
export default function ClueBuilder({ group, ctx, onChange, templateMode = false }: Props) {
  const { t } = useTranslation()

  const update = (i: number, patch: Partial<Condition>) =>
    onChange({
      ...group,
      conditions: group.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    })

  const remove = (i: number) =>
    onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })

  const add = () => {
    const c = defaultCondition('room', ctx)
    onChange({
      ...group,
      conditions: [...group.conditions, templateMode ? { ...c, wild: [...ALL_WILD] } : c],
    })
  }

  // Template rows: is the generator free to choose the targets (object/trait/room/…)?
  const targetsFree = (c: Condition) => TEMPLATE_TARGET_FIELDS.some((f) => (c.wild ?? []).includes(f))
  const toggleTargetsFree = (c: Condition, i: number) =>
    update(i, { wild: targetsFree(c) ? ['of'] : [...ALL_WILD] })

  const objName = (type: string) => t(`objName.${type}`)

  /** A small on/off chip (NICHT-style) for a boolean flag on a condition. */
  const flagChip = (active: boolean, onClick: () => void, label: string, title: string) => (
    <button
      type="button"
      className="mk-chip mk-cond__flag"
      data-active={active}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  )
  /** "einzige" toggle — the ONLY person there (on/beside object, at window/door, in/out). */
  const uniqueToggle = (c: Condition, i: number) =>
    flagChip(!!c.unique, () => update(i, { unique: !c.unique }), t('cond.uniqueToggle'), t('cond.uniqueHint'))
  /** "allein" toggle — also alone (no one else in the room). */
  const aloneToggle = (c: Condition, i: number) =>
    flagChip(!!c.alone, () => update(i, { alone: !c.alone }), t('cond.aloneToggle'), t('cond.aloneHint'))

  /** Object-type picker. `occupiableOnly` restricts it to objects a person can stand
   *  ON (for "on object") — nobody can sit on a table. */
  const objectSelect = (c: Condition, i: number, occupiableOnly = false) => {
    const options = occupiableOnly
      ? ctx.objects.filter((o) => OCCUPIABLE_OBJECT_TYPES.includes(o))
      : ctx.objects
    return (
      <select
        className="mk-select-input mk-cond__val"
        value={c.object ?? ''}
        // A tile anchor belongs to the previous object type — drop it on change.
        onChange={(e) => update(i, { object: e.target.value, at: undefined })}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {objName(o)}
          </option>
        ))}
      </select>
    )
  }

  /** WHICH tile(s) a "direction from object" means — only when several exist (one is
   *  unambiguous). Quantor first: "mindestens eines" (∃) / "alle" (∀); then the single
   *  tiles as anchors. Encodes `some`/`all` → quantifier (+ at cleared), a number → `at`. */
  const objectAtSelect = (c: Condition, i: number) => {
    const cells = c.object ? ctx.objectCells(c.object) : []
    // Keep a stale anchor (object repainted since) visible instead of lying about it.
    if (c.at !== undefined && !cells.includes(c.at)) cells.push(c.at)
    if (cells.length < 2) return null
    const label = (cell: number) =>
      `${t('coord.row')}${Math.floor(cell / ctx.size) + 1}/${t('coord.col')}${(cell % ctx.size) + 1}`
    const value = c.at !== undefined ? String(c.at) : c.quantifier === 'all' ? 'all' : 'some'
    return (
      <select
        className="mk-select-input mk-cond__val"
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'some') update(i, { at: undefined, quantifier: 'some' })
          else if (v === 'all') update(i, { at: undefined, quantifier: 'all' })
          else update(i, { at: Number(v), quantifier: 'some' })
        }}
      >
        <option value="some">{t('cond.dirQtySome')}</option>
        <option value="all">{t('cond.dirQtyAll')}</option>
        {cells.map((cell) => (
          <option key={cell} value={cell}>
            {label(cell)}
          </option>
        ))}
      </select>
    )
  }

  /** Room qualifier (egal / same room / other room) for object clues. */
  const roomRelSelect = (c: Condition, i: number) => (
    <select
      className="mk-select-input mk-cond__val"
      value={c.roomRel ?? 'any'}
      onChange={(e) => update(i, { roomRel: e.target.value as RoomRel })}
    >
      {ROOM_RELS.map((r) => (
        <option key={r} value={r}>
          {t(`roomRelLabel.${r}`)}
        </option>
      ))}
    </select>
  )

  /** Other-suspect picker writing `of`. */
  const personSelect = (c: Condition, i: number) => (
    <select
      className="mk-select-input mk-cond__val"
      value={c.of ?? ''}
      onChange={(e) => update(i, { of: e.target.value })}
    >
      {ctx.others.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  )

  /** Attribute picker (gender / boolean / valued) + a value sub-picker for valued
   *  ones. `allowAny` prepends "irgendjemand" (no trait filter — roomExists). */
  const attrSelect = (c: Condition, i: number, allowAny = false) => {
    const attr = c.attribute ?? (allowAny ? 'any' : 'beard')
    const spec = attr === 'any' ? undefined : VALUED_ATTRS[attr]
    return (
      <>
        <select
          className="mk-select-input mk-cond__val"
          value={attr}
          onChange={(e) => {
            // Reset the value to the new attribute's first valid one (else a stale
            // value like 'blond' leaks into e.g. gender → "blond_nom").
            const a = e.target.value as AttrKind | 'any'
            const aSpec = a === 'any' ? undefined : VALUED_ATTRS[a]
            update(i, { attribute: a, value: aSpec ? aSpec.values[0] : undefined })
          }}
        >
          {allowAny && <option value="any">{t('cond.anyone')}</option>}
          {ATTR_KINDS.map((a) => (
            <option key={a} value={a}>
              {t(`attrKind.${a}`)}
            </option>
          ))}
        </select>
        {spec && (
          <select
            className="mk-select-input mk-cond__val"
            value={c.value ?? c.hair ?? spec.values[0]}
            onChange={(e) => update(i, { value: e.target.value })}
          >
            {spec.values.map((v) => (
              <option key={v} value={v}>
                {t(`${spec.labelKey}.${v}`)}
              </option>
            ))}
          </select>
        )}
      </>
    )
  }

  /** Cardinal-only direction picker (offset). */
  const cardinalSelect = (value: Direction, onPick: (d: Direction) => void) => (
    <select
      className="mk-select-input mk-cond__val"
      value={value}
      onChange={(e) => onPick(e.target.value as Direction)}
    >
      {CARDINALS.map((d) => (
        <option key={d} value={d}>
          {t(`dir.${d}`)}
        </option>
      ))}
    </select>
  )

  /** The value control(s) for one condition's kind. */
  const valueControls = (c: Condition, i: number) => {
    switch (c.kind) {
      case 'room': {
        // The "Im Raum …" hub. The first dropdown (Aspekt) picks the kind of room
        // statement; the remaining controls depend on it.
        const mode = c.roomMode ?? 'in'
        const occupiableObj = () =>
          ctx.objects.find((o) => OCCUPIABLE_OBJECT_TYPES.includes(o)) ?? ctx.objects[0]
        const modeSelect = (
          <select
            className="mk-select-input mk-cond__val"
            value={mode}
            onChange={(e) => {
              const m = e.target.value as NonNullable<Condition['roomMode']>
              const patch: Partial<Condition> = { roomMode: m }
              if (m === 'in') patch.room = c.room ?? ctx.rooms[0]
              if (m === 'adjacent') {
                // Same rule as 'with': only offer "a person's room" when a real other
                // suspect exists, else fall back to naming a room (which always works).
                const personOk = c.adjTarget === 'person' && !!c.of && ctx.others.some((o) => o.id === c.of)
                patch.adjTarget = personOk ? 'person' : 'room'
                if (!personOk) patch.room = c.room ?? ctx.rooms[0]
              }
              if (m === 'neighborCount') patch.count = Math.max(1, c.count ?? 1)
              if (m === 'with') {
                // Pick a target that actually maps to a clue. "person" needs a valid
                // other suspect; with none, fall back to "anyone" (= not alone) so the
                // shown option matches the state and a clue appears (no phantom select).
                const personOk = c.roomTarget === 'person' && !!c.of && ctx.others.some((o) => o.id === c.of)
                const objectOk = c.roomTarget === 'object' && !!c.object
                if (!(personOk || objectOk || c.roomTarget === 'attr' || c.roomTarget === 'anyone')) {
                  patch.roomTarget = 'anyone'
                }
                // 'any'/'object' aren't real traits — reset so the trait picker isn't blank.
                if (c.attribute === 'any' || c.attribute === 'object') patch.attribute = 'beard'
              }
              if (m === 'onObject') {
                patch.attribute = 'any'
                patch.objRel = c.objRel ?? 'on'
                if (c.roomTarget !== 'person' && c.roomTarget !== 'attr') patch.roomTarget = 'anyone'
                if (!c.object || !OCCUPIABLE_OBJECT_TYPES.includes(c.object)) patch.object = occupiableObj()
              }
              update(i, patch)
            }}
          >
            <option value="alone">{t('cond.roomMode.alone')}</option>
            <option value="in">{t('cond.roomMode.in')}</option>
            <option value="with">{t('cond.roomMode.with')}</option>
            <option value="onObject">{t('cond.roomMode.onObject')}</option>
            <option value="adjacent">{t('cond.roomMode.adjacent')}</option>
            <option value="neighborEmpty">{t('cond.roomMode.neighborEmpty')}</option>
            <option value="neighborCount">{t('cond.roomMode.neighborCount')}</option>
          </select>
        )
        if (mode === 'alone') return <>{modeSelect}</>
        // "an empty room adjoined his" — nothing to configure; NICHT flips it to the
        // stronger "no adjoining room was empty".
        if (mode === 'neighborEmpty') return <>{modeSelect}</>
        // "his room borders <a named room | that person's room>".
        if (mode === 'adjacent') {
          const target = c.adjTarget ?? 'room'
          return (
            <>
              {modeSelect}
              <select
                className="mk-select-input mk-cond__val"
                value={target}
                onChange={(e) => {
                  const v = e.target.value as 'room' | 'person'
                  update(i, v === 'person' ? { adjTarget: v, of: c.of ?? ctx.others[0]?.id } : { adjTarget: v, room: c.room ?? ctx.rooms[0] })
                }}
              >
                <option value="room">{t('cond.adjTargetRoom')}</option>
                {ctx.others.length > 0 && <option value="person">{t('cond.adjTargetPerson')}</option>}
              </select>
              {target === 'person' ? (
                <select
                  className="mk-select-input mk-cond__val"
                  value={c.of ?? ''}
                  onChange={(e) => update(i, { of: e.target.value })}
                >
                  {ctx.others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="mk-select-input mk-cond__val"
                  value={c.room ?? ''}
                  onChange={(e) => update(i, { room: e.target.value })}
                >
                  {ctx.rooms.map((r) => (
                    <option key={r} value={r}>
                      {ctx.roomLabel(r)}
                    </option>
                  ))}
                </select>
              )}
            </>
          )
        }
        // "a room bordering his — optionally lying ENTIRELY one way from him — held exactly
        // N suspects". Count starts at 1: 0 is the `neighborEmpty` aspect, which reads better.
        if (mode === 'neighborCount') {
          return (
            <>
              {modeSelect}
              <input
                className="mk-input mk-cond__val mk-cond__num"
                type="number"
                min={1}
                max={Math.max(1, ctx.others.length + 1)}
                value={c.count ?? 1}
                onChange={(e) => update(i, { count: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span className="mk-cond__unit">{t('cond.suspectsUnit')}</span>
              <select
                className="mk-select-input mk-cond__val"
                value={c.neighborDir ?? 'none'}
                onChange={(e) => update(i, { neighborDir: e.target.value as Condition['neighborDir'] })}
              >
                <option value="none">{t('cond.neighborDirAny')}</option>
                {DIRECTIONS_8.map((d) => (
                  <option key={d} value={d}>
                    {t(`dir.${d}`)}
                  </option>
                ))}
              </select>
            </>
          )
        }
        if (mode === 'in')
          return (
            <>
              {modeSelect}
              <select
                className="mk-select-input mk-cond__val"
                value={c.room ?? ''}
                onChange={(e) => update(i, { room: e.target.value })}
              >
                {ctx.rooms.map((r) => (
                  <option key={r} value={r}>
                    {ctx.roomLabel(r)}
                  </option>
                ))}
              </select>
              {aloneToggle(c, i)}
            </>
          )
        if (mode === 'onObject') {
          // "In seinem Raum war <wer> <wo>": who = anyone / a named person / a trait;
          // where = on/beside an object, or a board position (corner/wall/window/door).
          const rel = c.objRel ?? 'on'
          const needsObject = rel === 'on' || rel === 'near'
          const target =
            c.roomTarget === 'person' || c.roomTarget === 'attr' ? c.roomTarget : 'anyone'
          const whoValue =
            target === 'person'
              ? c.of
                ? `person:${c.of}`
                : 'anyone'
              : target === 'attr'
                ? c.attribute === 'gender'
                  ? `attr:gender:${c.value ?? 'f'}`
                  : `attr:${c.attribute}`
                : 'anyone'
          const valuedAttr =
            target === 'attr' && c.attribute && c.attribute !== 'gender'
              ? VALUED_ATTRS[c.attribute]
              : undefined
          const positions = [
            { v: 'on', label: t('cond.relOn') },
            { v: 'near', label: t('cond.relNear') },
            { v: 'corner', label: t('cond.posCorner') },
            { v: 'wall', label: t('cond.posWall') },
            ...(ctx.hasWindows ? [{ v: 'window', label: t('cond.posWindow') }] : []),
            ...(ctx.hasDoors ? [{ v: 'door', label: t('cond.posDoor') }] : []),
          ] as const
          return (
            <>
              {modeSelect}
              <select
                className="mk-select-input mk-cond__val"
                value={whoValue}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'anyone') update(i, { roomTarget: 'anyone', of: undefined })
                  else if (v.startsWith('person:'))
                    update(i, { roomTarget: 'person', of: v.slice(7) })
                  else {
                    const [attribute, value] = v.slice(5).split(':')
                    const valued = VALUED_ATTRS[attribute]
                    update(i, {
                      roomTarget: 'attr',
                      attribute: attribute as AttrKind,
                      value: value ?? (valued && attribute !== 'gender' ? valued.values[0] : undefined),
                      of: undefined,
                    })
                  }
                }}
              >
                <option value="anyone">{t('cond.anyone')}</option>
                <optgroup label={t('cond.grpPeople')}>
                  {ctx.others.map((o) => (
                    <option key={o.id} value={`person:${o.id}`}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('cond.grpAttrs')}>
                  <option value="attr:gender:m">{t('genderVal.m')}</option>
                  <option value="attr:gender:f">{t('genderVal.f')}</option>
                  {BOOL_ATTRS.map((a) => (
                    <option key={a} value={`attr:${a}`}>
                      {`${t('cond.companionWith')} ${t(`attrKind.${a}`)}`}
                    </option>
                  ))}
                  {ATTR_KINDS.filter((a) => a !== 'gender' && VALUED_ATTRS[a]).map((a) => (
                    <option key={a} value={`attr:${a}`}>
                      {`${t('cond.companionWith')} ${t(`attrKind.${a}`)} …`}
                    </option>
                  ))}
                </optgroup>
              </select>
              {valuedAttr && (
                <select
                  className="mk-select-input mk-cond__val"
                  value={c.value ?? valuedAttr.values[0]}
                  onChange={(e) => update(i, { value: e.target.value })}
                >
                  {valuedAttr.values.map((val) => (
                    <option key={val} value={val}>
                      {t(`${valuedAttr.labelKey}.${val}`)}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="mk-select-input mk-cond__val"
                value={rel}
                onChange={(e) => {
                  const objRel = e.target.value as 'on' | 'near' | 'corner' | 'wall' | 'window' | 'door'
                  const patch: Partial<Condition> = { objRel }
                  if (objRel === 'on' && c.object && !OCCUPIABLE_OBJECT_TYPES.includes(c.object)) {
                    patch.object = occupiableObj()
                  } else if ((objRel === 'on' || objRel === 'near') && !c.object) {
                    patch.object = objRel === 'on' ? occupiableObj() : ctx.objects[0]
                  }
                  update(i, patch)
                }}
              >
                {positions.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.label}
                  </option>
                ))}
              </select>
              {needsObject && objectSelect(c, i, rel === 'on')}
            </>
          )
        }
        // mode === 'with' — same room as a person / object / trait / anyone.
        const withValue =
          c.roomTarget === 'anyone'
            ? 'anyone'
            : c.roomTarget === 'attr'
              ? c.attribute === 'gender'
                ? `attr:gender:${c.value ?? 'f'}`
                : `attr:${c.attribute}`
              : c.roomTarget === 'object'
                ? c.object
                  ? `object:${c.object}`
                  : ''
                : c.of
                  ? `person:${c.of}`
                  : ''
        const valuedAttr =
          c.roomTarget === 'attr' && c.attribute && c.attribute !== 'gender'
            ? VALUED_ATTRS[c.attribute]
            : undefined
        const quantifier = c.quantifier ?? 'some'
        const showAlone =
          c.roomTarget === 'person' ||
          c.roomTarget === 'object' ||
          (c.roomTarget === 'attr' && quantifier === 'some')
        return (
          <>
            {modeSelect}
            <select
              className="mk-select-input mk-cond__val"
              value={withValue}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'anyone') update(i, { roomTarget: 'anyone', of: undefined, object: undefined })
                else if (v.startsWith('person:'))
                  update(i, { roomTarget: 'person', of: v.slice(7), object: undefined })
                else if (v.startsWith('object:'))
                  update(i, { roomTarget: 'object', object: v.slice(7), of: undefined })
                else {
                  const [attribute, value] = v.slice(5).split(':')
                  const valued = VALUED_ATTRS[attribute]
                  update(i, {
                    roomTarget: 'attr',
                    attribute: attribute as AttrKind,
                    value: value ?? (valued && attribute !== 'gender' ? valued.values[0] : undefined),
                    of: undefined,
                    object: undefined,
                  })
                }
              }}
            >
              <option value="anyone">{t('cond.sameRoomAnyone')}</option>
              <optgroup label={t('cond.grpPeople')}>
                {ctx.others.map((o) => (
                  <option key={o.id} value={`person:${o.id}`}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('cond.grpObjects')}>
                {ctx.objects.map((o) => (
                  <option key={o} value={`object:${o}`}>
                    {objName(o)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('cond.grpAttrs')}>
                <option value="attr:gender:m">{t('genderVal.m')}</option>
                <option value="attr:gender:f">{t('genderVal.f')}</option>
                {BOOL_ATTRS.map((a) => (
                  <option key={a} value={`attr:${a}`}>
                    {`${t('cond.companionWith')} ${t(`attrKind.${a}`)}`}
                  </option>
                ))}
                {ATTR_KINDS.filter((a) => a !== 'gender' && VALUED_ATTRS[a]).map((a) => (
                  <option key={a} value={`attr:${a}`}>
                    {`${t('cond.companionWith')} ${t(`attrKind.${a}`)} …`}
                  </option>
                ))}
              </optgroup>
            </select>
            {c.roomTarget === 'attr' && (
              <select
                className="mk-select-input mk-cond__val"
                value={quantifier}
                onChange={(e) => update(i, { quantifier: e.target.value as Quantifier })}
              >
                {QUANTIFIERS.map((q) => (
                  <option key={q} value={q}>
                    {t(`cond.qty.${q}`)}
                  </option>
                ))}
              </select>
            )}
            {/* "some": how many matching companions, and (unless "allein") at-least vs exact. */}
            {c.roomTarget === 'attr' && quantifier === 'some' && (
              <>
                <input
                  className="mk-input mk-cond__val mk-cond__num"
                  type="number"
                  min={1}
                  value={c.count ?? 1}
                  onChange={(e) => update(i, { count: Math.max(1, Number(e.target.value)) })}
                />
                <span className="mk-cond__unit">{t('cond.people')}</span>
                {!c.alone && (
                  <select
                    className="mk-select-input mk-cond__val"
                    value={c.exact ? 'exact' : 'min'}
                    onChange={(e) => update(i, { exact: e.target.value === 'exact' })}
                  >
                    <option value="min">{t('cond.countMin')}</option>
                    <option value="exact">{t('cond.countExact')}</option>
                  </select>
                )}
              </>
            )}
            {valuedAttr && (
              <select
                className="mk-select-input mk-cond__val"
                value={c.value ?? valuedAttr.values[0]}
                onChange={(e) => update(i, { value: e.target.value })}
              >
                {valuedAttr.values.map((val) => (
                  <option key={val} value={val}>
                    {t(`${valuedAttr.labelKey}.${val}`)}
                  </option>
                ))}
              </select>
            )}
            {showAlone && aloneToggle(c, i)}
          </>
        )
      }
      case 'boardPos':
        return (
          <select
            className="mk-select-input mk-cond__val"
            value={c.pos ?? 'corner'}
            onChange={(e) => update(i, { pos: e.target.value as 'corner' | 'wall' })}
          >
            <option value="corner">{t('cond.posCorner')}</option>
            <option value="wall">{t('cond.posWall')}</option>
          </select>
        )
      case 'onObject':
        return (
          <>
            {objectSelect(c, i, true)}
            {uniqueToggle(c, i)}
          </>
        )
      case 'nearObject': {
        // Multi-select: pick one object (with optional "einzige"), or several →
        // "beside one of them". One control, no separate clue type.
        const sel = new Set(c.objects ?? [])
        return (
          <>
            <div className="mk-cond__multi">
              {ctx.objects.map((o) => (
                <button
                  key={o}
                  type="button"
                  className="mk-chip mk-cond__flag"
                  data-active={sel.has(o)}
                  onClick={() => {
                    const next = new Set(sel)
                    if (next.has(o)) next.delete(o)
                    else next.add(o)
                    update(i, { objects: [...next] })
                  }}
                >
                  {objName(o)}
                </button>
              ))}
            </div>
            {/* "einzige" only applies to a single object (no unique-of-several clue). */}
            {sel.size === 1 && uniqueToggle(c, i)}
          </>
        )
      }
      case 'portal': {
        // Only offer the kinds the board actually has (window preferred when both).
        const types: PortalKind[] = [
          ...(ctx.hasWindows ? (['window'] as const) : []),
          ...(ctx.hasDoors ? (['door'] as const) : []),
        ]
        return (
          <>
            <select
              className="mk-select-input mk-cond__val"
              value={c.portal ?? types[0] ?? 'window'}
              onChange={(e) => update(i, { portal: e.target.value as PortalKind })}
            >
              {types.map((p) => (
                <option key={p} value={p}>
                  {objName(p)}
                </option>
              ))}
            </select>
            {uniqueToggle(c, i)}
          </>
        )
      }
      case 'inout':
        return (
          <>
            <select
              className="mk-select-input mk-cond__val"
              value={c.side ?? 'inside'}
              onChange={(e) => update(i, { side: e.target.value as InOutKind })}
            >
              {(['inside', 'outside'] as InOutKind[]).map((s) => (
                <option key={s} value={s}>
                  {t(`side.${s}`)}
                </option>
              ))}
            </select>
            {uniqueToggle(c, i)}
          </>
        )
      case 'line':
        return (
          <>
            <select
              className="mk-select-input mk-cond__val"
              value={c.axis ?? 'row'}
              onChange={(e) => update(i, { axis: e.target.value as AxisKind })}
            >
              {(['row', 'col'] as AxisKind[]).map((a) => (
                <option key={a} value={a}>
                  {t(`line.${a}`)}
                </option>
              ))}
            </select>
            <select
              className="mk-select-input mk-cond__val"
              value={c.index ?? 0}
              onChange={(e) => update(i, { index: Number(e.target.value) })}
            >
              {Array.from({ length: ctx.size }, (_, n) => (
                <option key={n} value={n}>
                  {n + 1}
                </option>
              ))}
            </select>
          </>
        )
      case 'sameLineAsObject':
        return (
          <>
            {objectSelect(c, i)}
            <select
              className="mk-select-input mk-cond__val"
              value={c.line ?? 'col'}
              onChange={(e) => update(i, { line: e.target.value as LineKind })}
            >
              {LINE_KINDS.map((l) => (
                <option key={l} value={l}>
                  {t(`lineLabel.${l}`)}
                </option>
              ))}
            </select>
            {roomRelSelect(c, i)}
          </>
        )
      case 'sameObject': {
        // Object type + who else is beside the SAME instance (anyone / person / trait)
        // + optional 8-way direction of that mate relative to the subject.
        const mateValue =
          c.objTarget === 'person'
            ? `person:${c.of}`
            : c.objTarget === 'attr'
              ? c.attribute === 'gender'
                ? `attr:gender:${c.value ?? 'f'}`
                : `attr:${c.attribute}`
              : 'any'
        const valuedAttr =
          c.objTarget === 'attr' && c.attribute && c.attribute !== 'gender'
            ? VALUED_ATTRS[c.attribute]
            : undefined
        return (
          <>
            {objectSelect(c, i)}
            <select
              className="mk-select-input mk-cond__val"
              value={mateValue}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'any') update(i, { objTarget: 'any', of: undefined })
                else if (v.startsWith('person:')) update(i, { objTarget: 'person', of: v.slice(7) })
                else {
                  const [attribute, value] = v.slice(5).split(':')
                  const valued = VALUED_ATTRS[attribute]
                  update(i, {
                    objTarget: 'attr',
                    attribute: attribute as AttrKind,
                    value: value ?? (valued && attribute !== 'gender' ? valued.values[0] : undefined),
                  })
                }
              }}
            >
              <option value="any">{t('cond.anyone')}</option>
              <optgroup label={t('cond.grpPeople')}>
                {ctx.others.map((o) => (
                  <option key={o.id} value={`person:${o.id}`}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('cond.grpAttrs')}>
                <option value="attr:gender:m">{t('genderVal.m')}</option>
                <option value="attr:gender:f">{t('genderVal.f')}</option>
                {BOOL_ATTRS.map((a) => (
                  <option key={a} value={`attr:${a}`}>
                    {`${t('cond.companionWith')} ${t(`attrKind.${a}`)}`}
                  </option>
                ))}
                {ATTR_KINDS.filter((a) => a !== 'gender' && VALUED_ATTRS[a]).map((a) => (
                  <option key={a} value={`attr:${a}`}>
                    {`${t('cond.companionWith')} ${t(`attrKind.${a}`)} …`}
                  </option>
                ))}
              </optgroup>
            </select>
            {valuedAttr && (
              <select
                className="mk-select-input mk-cond__val"
                value={c.value ?? valuedAttr.values[0]}
                onChange={(e) => update(i, { value: e.target.value })}
              >
                {valuedAttr.values.map((val) => (
                  <option key={val} value={val}>
                    {t(`${valuedAttr.labelKey}.${val}`)}
                  </option>
                ))}
              </select>
            )}
            <select
              className="mk-select-input mk-cond__val"
              value={c.objDir ?? 'none'}
              onChange={(e) => update(i, { objDir: e.target.value as 'none' | Direction8 })}
            >
              <option value="none">{t('cond.dirNone')}</option>
              {DIRECTIONS_8.map((d) => (
                <option key={d} value={d}>
                  {t(`dir.${d}`)}
                </option>
              ))}
            </select>
          </>
        )
      }
      case 'insideXor':
        return (
          <select
            className="mk-select-input mk-cond__val"
            value={c.of ?? ''}
            onChange={(e) => update(i, { of: e.target.value })}
          >
            {ctx.others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )
      case 'direction': {
        // Merged "Richtung von …": relative to a person OR an object.
        const target = c.dirTarget ?? 'person'
        const dirSelect = (
          <select
            className="mk-select-input mk-cond__val"
            value={c.dir ?? 'north'}
            onChange={(e) => update(i, { dir: e.target.value as Direction8 })}
          >
            {DIRECTIONS_8.map((d) => (
              <option key={d} value={d}>
                {t(`dir.${d}`)}
              </option>
            ))}
          </select>
        )
        const targetSelect = (
          <select
            className="mk-select-input mk-cond__val"
            value={target}
            onChange={(e) => {
              const dt = e.target.value as 'person' | 'object' | 'attr'
              const patch: Partial<Condition> = { dirTarget: dt }
              if (dt === 'object' && !c.object) patch.object = ctx.objects[0]
              if (dt === 'person' && !c.of) patch.of = ctx.others[0]?.id
              // 'any'/'object' aren't real traits — give the trait picker a valid start.
              if (dt === 'attr' && (c.attribute === 'any' || c.attribute === 'object' || !c.attribute)) {
                patch.attribute = 'beard'
              }
              update(i, patch)
            }}
          >
            <option value="person">{t('cond.dirTargetPerson')}</option>
            <option value="object">{t('cond.dirTargetObject')}</option>
            <option value="attr">{t('cond.dirTargetAttr')}</option>
          </select>
        )
        if (target === 'object')
          return (
            <>
              {targetSelect}
              {objectSelect(c, i)}
              {objectAtSelect(c, i)}
              {dirSelect}
              {roomRelSelect(c, i)}
            </>
          )
        if (target === 'attr')
          return (
            <>
              {targetSelect}
              {dirSelect}
              <select
                className="mk-select-input mk-cond__val"
                value={c.quantifier === 'all' ? 'all' : 'some'}
                onChange={(e) => update(i, { quantifier: e.target.value as Quantifier })}
              >
                <option value="some">{t('cond.dirQtySome')}</option>
                <option value="all">{t('cond.dirQtyAll')}</option>
              </select>
              {attrSelect(c, i)}
            </>
          )
        return (
          <>
            {targetSelect}
            {dirSelect}
            {personSelect(c, i)}
          </>
        )
      }
      case 'offset': {
        // "exactly N cells {cardinal} of …": distance + cardinal + target — a person,
        // a trait-bearer, an anonymous someone on/beside an object (with the
        // "jemand"/"Verdächtiger" scope), or an object tile itself (∃, + room rel).
        const target =
          c.dirTarget === 'attr' || c.dirTarget === 'objectPerson' || c.dirTarget === 'object'
            ? c.dirTarget
            : 'person'
        const occupiable = () =>
          ctx.objects.find((o) => OCCUPIABLE_OBJECT_TYPES.includes(o)) ?? ctx.objects[0]
        const targetSelect = (
          <select
            className="mk-select-input mk-cond__val"
            value={target}
            onChange={(e) => {
              const dt = e.target.value as 'person' | 'attr' | 'objectPerson' | 'object'
              const patch: Partial<Condition> = { dirTarget: dt }
              if (dt === 'person' && !c.of) patch.of = ctx.others[0]?.id
              if (dt === 'object' && !c.object) patch.object = ctx.objects[0]
              if (dt === 'objectPerson') {
                const rel = c.objRel === 'near' ? 'near' : 'on'
                patch.objRel = rel
                if (rel === 'on' && (!c.object || !OCCUPIABLE_OBJECT_TYPES.includes(c.object))) {
                  patch.object = occupiable()
                } else if (!c.object) {
                  patch.object = ctx.objects[0]
                }
              }
              // 'any'/'object' aren't real traits — give the trait picker a valid start.
              if (dt === 'attr' && (c.attribute === 'any' || c.attribute === 'object' || !c.attribute)) {
                patch.attribute = 'beard'
              }
              update(i, patch)
            }}
          >
            <option value="person">{t('cond.dirTargetPerson')}</option>
            <option value="attr">{t('cond.dirTargetAttr')}</option>
            <option value="objectPerson">{t('cond.offTargetObjPerson')}</option>
            <option value="object">{t('cond.dirTargetObject')}</option>
          </select>
        )
        const base = (
          <>
            <input
              className="mk-input mk-cond__val mk-cond__num"
              type="number"
              min={1}
              value={c.dist ?? 1}
              onChange={(e) => update(i, { dist: Math.max(1, Number(e.target.value)) })}
            />
            <span className="mk-cond__unit">{t('cond.cells')}</span>
            {cardinalSelect((c.dir as Direction) ?? 'east', (d) => update(i, { dir: d }))}
            {targetSelect}
          </>
        )
        if (target === 'attr') {
          return (
            <>
              {base}
              {attrSelect(c, i)}
            </>
          )
        }
        if (target === 'objectPerson') {
          const rel = c.objRel === 'near' ? 'near' : 'on'
          return (
            <>
              {base}
              <select
                className="mk-select-input mk-cond__val"
                value={c.scope ?? 'people'}
                onChange={(e) => update(i, { scope: e.target.value as 'people' | 'suspects' })}
              >
                <option value="people">{t('cond.scopePeople')}</option>
                <option value="suspects">{t('cond.scopeSuspects')}</option>
              </select>
              <select
                className="mk-select-input mk-cond__val"
                value={rel}
                onChange={(e) => {
                  const objRel = e.target.value as 'on' | 'near'
                  const patch: Partial<Condition> = { objRel }
                  if (objRel === 'on' && c.object && !OCCUPIABLE_OBJECT_TYPES.includes(c.object)) {
                    patch.object = occupiable()
                  }
                  update(i, patch)
                }}
              >
                <option value="on">{t('cond.relOn')}</option>
                <option value="near">{t('cond.relNear')}</option>
              </select>
              {objectSelect(c, i, rel === 'on')}
            </>
          )
        }
        if (target === 'object') {
          return (
            <>
              {base}
              {objectSelect(c, i)}
              {roomRelSelect(c, i)}
            </>
          )
        }
        return (
          <>
            {base}
            {personSelect(c, i)}
          </>
        )
      }
      case 'aloneWith':
        // "alone with {person} + N others matching {trait}, one of them {direction}".
        return (
          <>
            {personSelect(c, i)}
            <input
              className="mk-input mk-cond__val mk-cond__num"
              type="number"
              min={0}
              value={c.extraCount ?? 1}
              onChange={(e) => update(i, { extraCount: Math.max(0, Number(e.target.value)) })}
            />
            {attrSelect(c, i)}
            <select
              className="mk-select-input mk-cond__val"
              value={c.aloneDir ?? 'none'}
              onChange={(e) => update(i, { aloneDir: e.target.value as 'none' | Direction })}
            >
              <option value="none">{t('cond.dirNone')}</option>
              {CARDINALS.map((d) => (
                <option key={d} value={d}>
                  {t(`dir.${d}`)}
                </option>
              ))}
            </select>
          </>
        )
      default:
        // Every kind above renders its own controls; nothing falls through here.
        return null
    }
  }

  return (
    <div className="mk-cb">
      {!templateMode && group.conditions.length >= 2 && (
        <div className="mk-cb__conn">
          {(['and', 'or'] as const).map((conn) => (
            <button
              key={conn}
              type="button"
              className="mk-chip"
              data-active={group.connector === conn}
              onClick={() => onChange({ ...group, connector: conn })}
            >
              {t(`conn.${conn}`)}
            </button>
          ))}
        </div>
      )}

      {group.conditions.map((c, i) => {
        return (
          <div key={i} className="mk-cond">
            <button
              type="button"
              className="mk-chip mk-cond__not"
              data-active={c.not}
              onClick={() => update(i, { not: !c.not })}
              title={t('cond.not')}
            >
              {t('cond.not')}
            </button>
            <select
              className="mk-select-input mk-cond__kind"
              value={c.kind}
              onChange={(e) =>
                onChange({
                  ...group,
                  conditions: group.conditions.map((cc, j) =>
                    j === i
                      ? {
                          ...defaultCondition(e.target.value as CondKind, ctx),
                          not: cc.not,
                          // Keep the row's "Generator wählt" state across a kind change.
                          ...(templateMode ? { wild: cc.wild ?? [...ALL_WILD] } : {}),
                        }
                      : cc,
                  ),
                })
              }
            >
              {COND_SECTIONS.map((sec) => {
                // Drop "Fenster/Tür" when the board has neither; hide empty sections.
                const kinds = sec.kinds.filter((k) => k !== 'portal' || ctx.hasWindows || ctx.hasDoors)
                if (kinds.length === 0) return null
                return (
                  <optgroup key={sec.labelKey} label={t(sec.labelKey)}>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {t(`cond.${k}`)}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
            {valueControls(c, i)}
            {templateMode &&
              flagChip(
                targetsFree(c),
                () => toggleTargetsFree(c, i),
                t('cond.genFree'),
                t('cond.genFreeHint'),
              )}
            <button
              type="button"
              className="mk-cond__del"
              onClick={() => remove(i)}
              aria-label={t('cond.remove')}
            >
              ✕
            </button>
          </div>
        )
      })}

      <button type="button" className="mk-btn mk-btn--ghost mk-cb__add" onClick={add}>
        {t('cond.add')}
      </button>
    </div>
  )
}
