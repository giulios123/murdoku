import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { LevelJson } from '../engine/index.ts'
import { exportLevelPdf, hasSolutionSheet } from '../game/pdfExport.ts'
import { useBackInterceptor } from '../game/backHandler.ts'

interface Props {
  json: LevelJson
  /** Titel auf dem Bogen — derselbe, den der Aufrufer bisher an exportLevelPdf gab. */
  title: string
  onClose: () => void
}

/** Der Druckerei-Rahmen — dieselbe Glyphe wie die PDF-Knöpfe im Kopf/Sheet. */
function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <path
        d="M6 8V3h12v5M6 17H3v-7h18v7h-3M7 14h10v7H7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Kleiner Vorschalt-Dialog des PDF-Exports: Bogen ohne oder mit Auflösung
 * (Blatt 2). Share-Sheet-Muster wie jeder Speichern-Dialog — Icon + Name +
 * Unterzeile, gesperrte Zeile zeigt den GRUND; darunter abgesetzt „Abbrechen".
 */
export default function PdfDialog({ json, title, onClose }: Props) {
  const { t, i18n } = useTranslation()
  // Reiner Vorwärts-Löser (kein Suchbudget nötig) — bei „Ausprobieren"-Leveln
  // gibt es keinen erklärbaren Weg, die Auflösungs-Zeile sperrt mit Grund.
  const canSolution = useMemo(() => hasSolutionSheet(json), [json])
  useBackInterceptor(true, onClose)

  const pick = (solution: boolean): void => {
    onClose()
    void exportLevelPdf(json, i18n, title, { solution }).catch(() => {})
  }

  return (
    <div className="mk-overlay" onClick={onClose}>
      <div className="mk-dialog mk-savedlg mk-pdfdlg" onClick={(e) => e.stopPropagation()}>
        <h3>{t('game.pdfExport')}</h3>
        <div className="mk-savelist">
          <button type="button" className="mk-saverow" onClick={() => pick(false)}>
            <span className="mk-saverow__ic" aria-hidden="true">
              <PrinterIcon />
            </span>
            <span className="mk-saverow__text">
              <span className="mk-saverow__title">{t('game.pdfPlain')}</span>
              <span className="mk-saverow__sub">{t('game.pdfPlainSub')}</span>
            </span>
          </button>
          <button
            type="button"
            className="mk-saverow"
            disabled={!canSolution}
            onClick={() => pick(true)}
          >
            <span className="mk-saverow__ic" aria-hidden="true">
              {/* Lupe — die Auflösung liegt bei */}
              <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
                <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M14.5 14.5 L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="mk-saverow__text">
              <span className="mk-saverow__title">{t('game.pdfSolution')}</span>
              <span className="mk-saverow__sub">
                {canSolution ? t('game.pdfSolutionSub') : t('game.pdfNoPath')}
              </span>
            </span>
          </button>
        </div>
        <div className="mk-dialog__actions">
          <button type="button" className="mk-btn mk-btn--ghost" onClick={onClose}>
            {t('generate.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
