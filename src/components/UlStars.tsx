import { useTranslation } from 'react-i18next'

/**
 * Community-Wertung als schmaler Textlauf „★ Ø (Stimmen)" — die EINE Form für
 * Levelliste, Sieg-Dialog, Spiel-Kopf und ?-Sheet. Unbewertet: graues „★ –".
 */
export default function UlStars({
  stars,
  ratings,
  className,
}: {
  stars: number | null
  ratings: number
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  return (
    <span
      className={className ? `mk-ul-stars ${className}` : 'mk-ul-stars'}
      data-unrated={stars === null || undefined}
      title={stars === null ? t('userlevel.unrated') : undefined}
    >
      {stars === null
        ? '★ –'
        : `★ ${stars.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${ratings})`}
    </span>
  )
}
