import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { updateSettings, useSettings, type HelpMode } from '../game/settings.ts'
import type { BlockedStyle } from '../game/boardRender.ts'
import LanguageSelect from './LanguageSelect.tsx'

const HELP_MODES: readonly HelpMode[] = ['full', 'reduced', 'none']
const MODE_KEY: Record<HelpMode, string> = {
  full: 'settings.helpFull',
  reduced: 'settings.helpReduced',
  none: 'settings.helpNone',
}

const BLOCKED_STYLES: readonly BlockedStyle[] = ['plain', 'dim', 'hatch', 'both']

/** A compact label + switch row — no helper text, so the list stays short. */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      className="mk-settings__row mk-settings__toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="mk-settings__label">{label}</span>
      <span className="mk-switch" data-on={checked} aria-hidden="true">
        <span className="mk-switch__knob" />
      </span>
    </button>
  )
}

/** The settings "case file": language, help mode, stopwatch, gender tints,
 *  object badges, floor patterns. */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const settings = useSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="mk-overlay" onClick={onClose}>
      <div
        className="mk-dialog mk-settings"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mk-dialog__stamp mk-settings__stamp">{t('settings.stamp')}</span>
        <h3>{t('settings.title')}</h3>

        <div className="mk-settings__row">
          <span className="mk-settings__label">{t('settings.language')}</span>
          <LanguageSelect />
        </div>

        <div className="mk-settings__row mk-settings__row--stack">
          <span className="mk-settings__label">{t('settings.help')}</span>
          <div className="mk-settings__modes" role="radiogroup" aria-label={t('settings.help')}>
            {HELP_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.helpMode === mode}
                className="mk-settings__mode"
                data-active={settings.helpMode === mode}
                onClick={() => updateSettings({ helpMode: mode })}
              >
                <span className="mk-settings__modename">{t(MODE_KEY[mode])}</span>
                <span className="mk-settings__modesub">{t(`${MODE_KEY[mode]}Sub`)}</span>
              </button>
            ))}
          </div>
        </div>

        <ToggleRow
          label={t('settings.timer')}
          checked={settings.timer}
          onChange={(timer) => updateSettings({ timer })}
        />
        <ToggleRow
          label={t('settings.genderColors')}
          checked={settings.genderColors}
          onChange={(genderColors) => updateSettings({ genderColors })}
        />
        <ToggleRow
          label={t('settings.objectBadges')}
          checked={settings.objectBadges}
          onChange={(objectBadges) => updateSettings({ objectBadges })}
        />
        <ToggleRow
          label={t('settings.floorTextures')}
          checked={settings.floorTextures}
          onChange={(floorTextures) => updateSettings({ floorTextures })}
        />

        {/* One slim row with a native dropdown — the settings dialog must never
            grow to the point of scrolling (Dirks Regel). */}
        <div className="mk-settings__row">
          <span className="mk-settings__label">{t('settings.blockedStyle')}</span>
          <select
            className="mk-select-input mk-settings__select"
            aria-label={t('settings.blockedStyle')}
            value={settings.blockedStyle}
            onChange={(e) => updateSettings({ blockedStyle: e.target.value as BlockedStyle })}
          >
            {BLOCKED_STYLES.map((style) => (
              <option key={style} value={style}>
                {t(`settings.blocked_${style}`)}
              </option>
            ))}
          </select>
        </div>

        <button type="button" className="mk-btn mk-settings__close" onClick={onClose}>
          {t('settings.close')}
        </button>
      </div>
    </div>
  )
}
