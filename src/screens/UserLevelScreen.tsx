import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsButton from '../components/SettingsButton.tsx'
import BloodText from '../components/BloodText.tsx'
import BloodSplatter from '../components/BloodSplatter.tsx'
import BoardPreview from '../components/BoardPreview.tsx'
import FilterDropdown from '../components/FilterDropdown.tsx'
import UlStars from '../components/UlStars.tsx'
import { levelMetaFromJson, titleOf, type LevelMeta } from '../game/levels.ts'
import { loadResults, loadSolved, readStorage, writeStorage } from '../game/storage.ts'
import {
  DEFAULT_USERLEVEL_FILTER,
  NO_LOGIC_TAG,
  USERLEVEL_TAGS,
  averageStars,
  loadRatedIds,
  loadUserLevels,
  matchesStarsFilter,
  matchesTagFilter,
  syncUserLevels,
  topTags,
  type UserLevelEntry,
  type UserLevelFilter,
} from '../game/userlevels.ts'

interface Props {
  onPick: (level: LevelMeta) => void
  onBack: () => void
}

const FILTER_KEY = 'murdoku.userlevels.filter.v1'

/** Alle möglichen Brettgrößen (4×4–12×12) — der Größen-Filter bietet immer die volle
 *  Spanne an, unabhängig davon, welche Größen gerade im Archiv liegen. */
const ALL_SIZES = Array.from({ length: 9 }, (_, i) => `${i + 4}×${i + 4}`)

/** A user-level entry plus its derived picker meta (title/theme/size once, not per render). */
interface Row {
  entry: UserLevelEntry
  meta: LevelMeta
}

/**
 * The community picker: levels arrive via `syncUserLevels` (incremental, cached in
 * localStorage — offline simply shows the cache) and are listed newest first.
 * Filters: size, theme (desktop only, like the level picker), stars, property tag.
 */
export default function UserLevelScreen({ onPick, onBack }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  const [entries, setEntries] = useState<UserLevelEntry[]>(() => loadUserLevels())
  const [sync, setSync] = useState<'syncing' | 'online' | 'offline'>('syncing')
  const [filter, setFilter] = useState<UserLevelFilter>(() => ({
    ...DEFAULT_USERLEVEL_FILTER,
    ...readStorage<Partial<UserLevelFilter>>(FILTER_KEY, {}),
  }))
  const [solved] = useState(() => loadSolved())
  const [results] = useState(() => loadResults())
  // Which levels THIS player already rated — shown on the cards and filterable,
  // so a solved-but-unrated case is easy to find, replay and rate.
  const [ratedIds] = useState(() => loadRatedIds())

  useEffect(() => writeStorage(FILTER_KEY, filter), [filter])

  // One sync per screen visit: push queued ratings, pull new levels + fresh counters.
  useEffect(() => {
    let alive = true
    void syncUserLevels().then((r) => {
      if (!alive) return
      setEntries(r.levels)
      setSync(r.online ? 'online' : 'offline')
    })
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo<Row[]>(
    () => entries.map((entry) => ({ entry, meta: levelMetaFromJson(entry.json) })),
    [entries],
  )

  const themes = useMemo(
    () => [...new Set(rows.map((r) => r.meta.theme).filter((x): x is string => x !== undefined))],
    [rows],
  )

  // A stored selection whose option vanished (e.g. the only 5×5 level was deleted)
  // falls back to "all" — derived, so the pick returns if the option reappears.
  const effective = useMemo<UserLevelFilter>(
    () => ({
      size: filter.size !== 'all' && !ALL_SIZES.includes(filter.size) ? 'all' : filter.size,
      theme: filter.theme !== 'all' && !themes.includes(filter.theme) ? 'all' : filter.theme,
      stars: filter.stars,
      status: filter.status,
      tag: filter.tag,
    }),
    [filter, themes],
  )

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (effective.size === 'all' || `${r.meta.width}×${r.meta.height}` === effective.size) &&
          (effective.theme === 'all' || r.meta.theme === effective.theme) &&
          (effective.status === 'all' ||
            (effective.status === 'toRate'
              ? solved.has(r.meta.id) && !ratedIds.has(r.entry.dbId)
              : solved.has(r.meta.id) === (effective.status === 'solved'))) &&
          matchesStarsFilter(r.entry, effective.stars) &&
          matchesTagFilter(r.entry, effective.tag),
      ),
    [rows, effective, solved, ratedIds],
  )

  const update = (key: keyof UserLevelFilter, value: string) =>
    setFilter((f) => ({ ...f, [key]: value }) as UserLevelFilter)

  const filterDefs: {
    key: keyof UserLevelFilter
    label: string
    value: string
    options: { value: string; label: string }[]
    desktopOnly?: boolean
  }[] = [
    {
      key: 'stars',
      label: t('userlevel.filterStars'),
      value: effective.stars,
      options: [
        { value: 'all', label: t('select.all') },
        { value: '4', label: `★ 4+` },
        { value: '3', label: `★ 3+` },
        { value: '2', label: `★ 2+` },
        { value: '1', label: `★ 1+` },
        { value: 'unrated', label: t('userlevel.unrated') },
      ],
    },
    {
      key: 'size',
      label: t('select.filterSize'),
      value: effective.size,
      options: [
        { value: 'all', label: t('select.all') },
        ...ALL_SIZES.map((s) => ({ value: s, label: s })),
      ],
    },
    {
      key: 'status',
      label: t('select.filterStatus'),
      value: effective.status,
      options: [
        { value: 'all', label: t('select.all') },
        { value: 'solved', label: t('select.solved') },
        // Direkt unter "Gelöst" — es ist dessen Spezialfall (gelöst, aber ohne Wertung).
        { value: 'toRate', label: t('userlevel.toRate') },
        { value: 'unsolved', label: t('select.unsolved') },
      ],
    },
    {
      key: 'theme',
      label: t('select.filterTheme'),
      value: effective.theme,
      desktopOnly: true,
      options: [
        { value: 'all', label: t('select.all') },
        ...themes
          .map((id) => ({ value: id, label: t(`theme.${id}`) }))
          .sort((a, b) => a.label.localeCompare(b.label, lang)),
      ],
    },
    {
      key: 'tag',
      label: t('userlevel.filterTag'),
      value: effective.tag,
      desktopOnly: true,
      options: [
        { value: 'all', label: t('select.all') },
        ...USERLEVEL_TAGS.map((tag) => ({ value: tag, label: t(`tag.${tag}`) })),
        { value: NO_LOGIC_TAG, label: t(`tag.${NO_LOGIC_TAG}`) },
      ],
    },
  ]
  const filters = filterDefs.filter((f) => f.options.length > 1)

  return (
    <div className="mk-screen">
      <div className="mk-select mk-select--ul">
        <div className="mk-select__head">
          <header className="mk-topbar">
            <button type="button" className="mk-back" onClick={onBack} aria-label="back">
              ←
            </button>
            <h1>
              <span className="mk-titleblood">
                <BloodSplatter className="mk-titleblood__splatter" />
                <BloodText text={t('userlevel.title')} />
              </span>
              <small>{t('userlevel.subtitle')}</small>
            </h1>
            <SettingsButton />
          </header>

          {sync !== 'online' && (
            <p className="mk-ul-status" data-offline={sync === 'offline' || undefined}>
              {sync === 'syncing' ? t('userlevel.syncing') : t('userlevel.offline')}
            </p>
          )}

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
          {rows.length === 0 && (
            <p className="mk-empty">
              {sync === 'syncing'
                ? t('userlevel.syncing')
                : sync === 'offline'
                  ? t('userlevel.emptyOffline')
                  : t('userlevel.empty')}
            </p>
          )}
          {rows.length > 0 && shown.length === 0 && <p className="mk-empty">{t('select.empty')}</p>}
          {/* Kleine Anzahl über den Karten — dasselbe Zähl-Element wie die
              Schwierigkeits-Gruppen der Levelauswahl (»N Fälle«). */}
          {shown.length > 0 && (
            <div className="mk-divider">
              <span className="mk-divider__count">{t('select.cases', { count: shown.length })}</span>
            </div>
          )}
          {shown.map(({ entry, meta }) => {
            const hints = results[meta.id]?.hints
            const solo = hints === 0
            const isSolved = solved.has(meta.id)
            const avg = averageStars(entry.stats)
            const tags = topTags(entry.stats)
            return (
              <button
                key={meta.id}
                type="button"
                className="mk-card"
                data-solved={isSolved}
                data-author={meta.author ? 'true' : undefined}
                data-solo={isSolved && solo ? 'true' : undefined}
                onClick={() => onPick(meta)}
              >
                <span className="mk-card__photo">
                  <span className="mk-card__tape" />
                  <BoardPreview json={meta.json} />
                </span>
                {isSolved && <span className="mk-stamp">{t('select.solved')}</span>}
                <span className="mk-card__body">
                  <span className="mk-card__titlewrap">
                    <BloodSplatter className="mk-card__splatter" />
                    <span className="mk-card__title">
                      <BloodText text={titleOf(meta, lang)} />
                    </span>
                  </span>
                  {meta.author && <span className="mk-card__author">— {meta.author}</span>}
                  <span className="mk-card__meta">
                    <span className="mk-pill" data-d={meta.difficulty}>
                      {t(`difficulty.${meta.difficulty}`)}
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
                          <span className="mk-solo">{t('select.hintCount', { count: hints })}</span>
                        ) : null)}
                      <span className="mk-card__size">
                        {meta.width}×{meta.height}
                      </span>
                    </span>
                  </span>
                  {/* One slim text run — stars always, then the top-2 properties. No
                      chips/borders, single line: the photo keeps dictating the card
                      height, especially in the phone register rows. */}
                  <span className="mk-card__ulmeta">
                    <UlStars stars={avg} ratings={entry.stats.ratings} />
                    {ratedIds.has(entry.dbId) && (
                      <span
                        className="mk-ul-tag"
                        data-mine="true"
                        title={t('userlevel.ratedByMe')}
                        aria-label={t('userlevel.ratedByMe')}
                      >
                        ✓
                      </span>
                    )}
                    {tags.map((tag) => (
                      <span key={tag} className="mk-ul-tag">
                        {t(`tag.${tag}`)}
                      </span>
                    ))}
                    {!entry.logic && (
                      <span className="mk-ul-tag" data-nologic="true">
                        {t(`tag.${NO_LOGIC_TAG}`)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
