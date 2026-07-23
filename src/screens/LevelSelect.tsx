import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsButton from '../components/SettingsButton.tsx'
import BloodText from '../components/BloodText.tsx'
import BloodSplatter from '../components/BloodSplatter.tsx'
import BoardPreview from '../components/BoardPreview.tsx'
import FilterDropdown from '../components/FilterDropdown.tsx'
import {
  DEFAULT_FILTER,
  DIFFICULTIES,
  allLevels,
  authorVisibleLevels,
  availableFilterOptions,
  availableSizes,
  availableThemes,
  effectiveFilter,
  filterLevels,
  levelMetaFromJson,
  titleOf,
  type LevelFilter,
  type LevelMeta,
} from '../game/levels.ts'
import {
  loadCustomLevels,
  loadFilter,
  loadResults,
  loadShowHiddenAuthor,
  loadSolved,
  saveFilter,
  saveShowHiddenAuthor,
} from '../game/storage.ts'

interface Props {
  onPick: (level: LevelMeta) => void
  onBack: () => void
}

// Secret unlock: five taps on the title within a two-second window toggles whether
// the hidden author's levels are shown. Tracked by their timestamps so a slow,
// deliberate tap never trips it — only a quick burst does.
const TAP_COUNT = 5
const TAP_WINDOW_MS = 2000
const TOAST_MS = 1800

/** Group order for the difficulty dividers (unknown difficulties sort last). */
const DIFF_ORDER = new Map<string, number>(DIFFICULTIES.map((d, i) => [d, i]))

export default function LevelSelect({ onPick, onBack }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  // Filter is persisted so it survives leaving for a level and coming back.
  const [filter, setFilter] = useState<LevelFilter>(() => loadFilter(DEFAULT_FILTER))
  const [solved] = useState(() => loadSolved())
  const [results] = useState(() => loadResults())
  const [custom] = useState(() => loadCustomLevels().map((j) => levelMetaFromJson(j, true)))
  // Whether the hidden author's levels are revealed (persisted, off by default).
  const [showHidden, setShowHidden] = useState(() => loadShowHiddenAuthor())
  const [toast, setToast] = useState<{ text: string; on: boolean; n: number } | null>(null)
  const tapTimes = useRef<number[]>([])
  const toastN = useRef(0)

  useEffect(() => saveFilter(filter), [filter])
  useEffect(() => saveShowHiddenAuthor(showHidden), [showHidden])

  // Self-dismiss the toast; re-arming on a new toggle restarts the timer.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(id)
  }, [toast])

  // The picker's universe once the hidden author is filtered in/out. Both the grid
  // and the filter options derive from this, so hiding the author also drops any
  // filter option (e.g. "Original") that would now match nothing.
  const universe = useMemo(
    () => authorVisibleLevels(allLevels(custom), showHidden),
    [custom, showHidden],
  )

  // Which option values still have at least one level — used to prune empty chips.
  const available = useMemo(() => availableFilterOptions(universe, solved), [universe, solved])

  // The filter actually applied: stale stored selections fall back to "all".
  const effective = useMemo(() => effectiveFilter(filter, available), [filter, available])

  const levels = useMemo(
    () => filterLevels(universe, effective, solved),
    [universe, effective, solved],
  )

  // With the difficulty filter on "all", the grid splits into case-drawer groups
  // (easy/medium/…), each behind a divider tab. A specific filter needs none.
  const groups = useMemo(() => {
    if (effective.difficulty !== 'all') return [{ difficulty: null, levels }]
    const byDiff = new Map<string, LevelMeta[]>()
    for (const l of levels) {
      const list = byDiff.get(l.difficulty)
      if (list) list.push(l)
      else byDiff.set(l.difficulty, [l])
    }
    return [...byDiff.entries()]
      .sort(([a], [b]) => (DIFF_ORDER.get(a) ?? 99) - (DIFF_ORDER.get(b) ?? 99))
      .map(([difficulty, list]) => ({ difficulty, levels: list }))
  }, [levels, effective.difficulty])

  const update = (key: keyof LevelFilter, value: string) =>
    setFilter((f) => ({ ...f, [key]: value }) as LevelFilter)

  // A burst of TAP_COUNT taps inside TAP_WINDOW_MS flips the hidden author on/off.
  const onSecretTap = () => {
    const now = Date.now()
    const recent = [...tapTimes.current.filter((tm) => now - tm < TAP_WINDOW_MS), now]
    if (recent.length < TAP_COUNT) {
      tapTimes.current = recent
      return
    }
    tapTimes.current = []
    const on = !showHidden
    setShowHidden(on)
    toastN.current += 1
    setToast({ text: on ? t('select.garandOn') : t('select.garandOff'), on, n: toastN.current })
  }

  // One source of truth for the four filters; rendered as custom noir dropdowns on
  // desktop and as native selects on mobile (CSS toggles which is visible; the theme
  // filter is desktop-only). Empty non-"all" options are pruned, and a group with
  // no real choice is dropped.
  const filterDefs: {
    key: keyof LevelFilter
    label: string
    value: string
    options: { value: string; label: string }[]
    desktopOnly?: boolean
  }[] = [
    {
      key: 'difficulty',
      label: t('select.filterDifficulty'),
      value: effective.difficulty,
      options: [
        { value: 'all', label: t('select.all') },
        ...DIFFICULTIES.filter((d) => available.difficulty.has(d)).map((d) => ({
          value: d,
          label: t(`difficulty.${d}`),
        })),
        // The player's own levels (editor-built or kept generated ones).
        ...(available.difficulty.has('custom')
          ? [{ value: 'custom', label: t('select.custom') }]
          : []),
      ],
    },
    {
      key: 'size',
      label: t('select.filterSize'),
      value: effective.size,
      options: [
        { value: 'all', label: t('select.all') },
        ...availableSizes(universe).map((s) => ({ value: s, label: s })),
      ],
    },
    {
      key: 'status',
      label: t('select.filterStatus'),
      value: effective.status,
      options: [
        { value: 'all', label: t('select.all') },
        ...(available.status.has('solved') ? [{ value: 'solved', label: t('select.solved') }] : []),
        ...(available.status.has('unsolved')
          ? [{ value: 'unsolved', label: t('select.unsolved') }]
          : []),
      ],
    },
    {
      key: 'theme',
      label: t('select.filterTheme'),
      value: effective.theme,
      desktopOnly: true,
      options: [
        { value: 'all', label: t('select.all') },
        ...availableThemes(universe)
          .map((id) => ({ value: id, label: t(`theme.${id}`) }))
          .sort((a, b) => a.label.localeCompare(b.label, lang)),
      ],
    },
  ]
  // Drop a whole group that collapsed to just "All" (no real choice left).
  const filters = filterDefs.filter((f) => f.options.length > 1)

  return (
    <div className="mk-screen">
      <div className="mk-select">
        <div className="mk-select__head">
        <header className="mk-topbar">
          <button type="button" className="mk-back" onClick={onBack} aria-label="back">
            ←
          </button>
          <h1>
            <span className="mk-secret mk-titleblood" onClick={onSecretTap}>
              <BloodSplatter className="mk-titleblood__splatter" />
              <BloodText text={t('select.title')} />
            </span>
            <small>{t('select.subtitle')}</small>
          </h1>
          <SettingsButton />
        </header>

        <div className="mk-filters">
          {filters.map((f) => (
            <div className="mk-filtergroup" key={f.key} data-desktop-only={f.desktopOnly}>
              <span className="mk-filtergroup__label">{f.label}</span>
              <FilterDropdown
                label={f.label}
                value={f.value}
                options={f.options}
                onChange={(v) => update(f.key, v)}
              />
              <select
                className="mk-select-input mk-filterselect"
                aria-label={f.label}
                value={f.value}
                onChange={(e) => update(f.key, e.target.value)}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        </div>

        <div className="mk-level-grid">
          {levels.length === 0 && <p className="mk-empty">{t('select.empty')}</p>}
          {groups.map((g) => (
              <Fragment key={g.difficulty ?? 'all'}>
                {g.difficulty && (
                  <div className="mk-divider">
                    <span className="mk-divider__label">{t(`difficulty.${g.difficulty}`)}</span>
                    <span className="mk-divider__count">
                      {t('select.cases', { count: g.levels.length })}
                    </span>
                  </div>
                )}
                {g.levels.map((l) => {
                  const hints = results[l.id]?.hints
                  const solo = hints === 0
                  const isSolved = solved.has(l.id)
                  // Card state travels as data attributes so the CSS never needs :has()
                  // (which is costly to recalc across ~150 cards).
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className="mk-card"
                      data-solved={isSolved}
                      data-custom={l.custom ? 'true' : undefined}
                      data-author={l.author ? 'true' : undefined}
                      data-solo={isSolved && solo ? 'true' : undefined}
                      onClick={() => onPick(l)}
                    >
                      <span className="mk-card__photo">
                        <span className="mk-card__tape" />
                        <BoardPreview json={l.json} />
                      </span>
                      {isSolved && (
                        <span className="mk-stamp">{t('select.solved')}</span>
                      )}
                      <span className="mk-card__body">
                        <span className="mk-card__titlewrap">
                          <BloodSplatter className="mk-card__splatter" />
                          <span className="mk-card__title">
                            <BloodText text={titleOf(l, lang)} />
                          </span>
                        </span>
                        {l.author && <span className="mk-card__author">— {l.author}</span>}
                        <span className="mk-card__meta">
                          <span className="mk-pill" data-d={l.difficulty}>
                            {t(`difficulty.${l.difficulty}`)}
                          </span>
                          <span className="mk-card__sizewrap">
                            {isSolved &&
                              (solo ? (
                                <span
                                  className="mk-solo"
                                  data-solo="true"
                                  title={t('select.solo')}
                                  aria-label={t('select.solo')}
                                >
                                  <svg
                                    viewBox="0 0 40 46"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M14 3 L17 20 M26 3 L23 20"
                                      strokeWidth="2.4"
                                      strokeLinecap="round"
                                    />
                                    <circle cx="20" cy="30" r="13" strokeWidth="2.2" />
                                    <path
                                      d="M20 23.5 l1.9 3.9 4.3.6 -3.1 3 .8 4.3 -3.8 -2 -3.8 2 .8 -4.3 -3.1 -3 4.3 -.6z"
                                      fill="currentColor"
                                      stroke="none"
                                    />
                                  </svg>
                                </span>
                              ) : hints !== undefined && hints > 0 ? (
                                <span className="mk-solo">
                                  {t('select.hintCount', { count: hints })}
                                </span>
                              ) : null)}
                            <span className="mk-card__size">
                              {l.width}×{l.height}
                            </span>
                          </span>
                          {/* Desktop: absolute top-right badge (anchors to the card, so the
                              DOM slot doesn't matter). Mobile: a static pill in this meta
                              row, between the size and the GELÖST gutter — in the gutter it
                              collided with the solo medal / hint tally. */}
                          {l.custom && <span className="mk-custom">{t('select.custom')}</span>}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </Fragment>
          ))}
        </div>
      </div>

      {toast && (
        <div className="mk-toast" role="status" aria-live="polite" data-on={toast.on} key={toast.n}>
          <span className="mk-toast__tag">{t('select.garandTag')}</span>
          <span className="mk-toast__msg">{toast.text}</span>
        </div>
      )}
    </div>
  )
}
