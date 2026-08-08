import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import pt from './locales/pt.json'
import fr from './locales/fr.json'
import ru from './locales/ru.json'

// All UI/clue strings live in the locale JSON files — never hard-coded in TS.

const LANG_KEY = 'murdoku.lang.v1'

/**
 * Every language the app ships, in display order. The switcher, persistence and
 * browser detection all derive from this list — adding a locale is just an entry
 * here plus its JSON in `resources` and a `language.<code>` label in each file.
 */
export const SUPPORTED_LANGS = ['de', 'en', 'es', 'pt', 'fr', 'ru'] as const
export type Lang = (typeof SUPPORTED_LANGS)[number]

/**
 * Each language's own name (autonym). The picker always shows these, never the
 * translated `language.*` labels — a Spanish speaker whose app is set to German
 * must still recognise "Español", not read "Spanisch". Order stays fixed too, so
 * the list looks identical in every UI language.
 */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  ru: 'Русский',
}

const resources = {
  de: { translation: de },
  en: { translation: en },
  es: { translation: es },
  pt: { translation: pt },
  fr: { translation: fr },
  ru: { translation: ru },
}

function isLang(value: string): value is Lang {
  return (SUPPORTED_LANGS as readonly string[]).includes(value)
}

/** The supported language a locale tag maps to ('de' from 'de-AT'), or undefined. */
function toSupported(tag: string): Lang | undefined {
  const base = tag.toLowerCase().split('-')[0]
  return isLang(base) ? base : undefined
}

/** Save the active language so the next visit restores it. */
function persist(lng: string): void {
  try {
    const lang = toSupported(lng)
    if (lang) localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* ignore write failures (e.g. private mode) */
  }
}

/**
 * Which language to start in: the user's previously saved choice if there is one,
 * otherwise the browser's PRIMARY language decides — Spanish → es, German → de,
 * anything else → English (the default). Only the first/primary language counts,
 * so a user whose main language is unsupported always lands on English.
 * Must stay loadable in node (tests import this transitively): no bare
 * navigator/localStorage access outside a guard.
 */
function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved && isLang(saved)) return saved
  } catch {
    /* localStorage can be unavailable — fall back to browser detection */
  }
  const primary =
    typeof navigator === 'undefined' ? '' : (navigator.languages?.[0] ?? navigator.language ?? '')
  return toSupported(primary) ?? 'en'
}

const startLang = initialLanguage()
persist(startLang) // remember the first-visit detection too, not just later changes
i18n.on('languageChanged', persist) // and whenever the user switches via the picker

void i18n.use(initReactI18next).init({
  resources,
  lng: startLang,
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LANGS],
  interpolation: { escapeValue: false },
})

export default i18n
