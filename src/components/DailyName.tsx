import { useTranslation } from 'react-i18next'
import type { GenDifficulty } from '../engine/generator/index.ts'

/**
 * The daily case's full name ("Schweres Rätsel des Tages") with the difficulty
 * word tinted in its tier colour. The locale marks that word with asterisks
 * ("*Leichtes* Rätsel des Tages") so each language keeps its own word order.
 */
export default function DailyName({ difficulty }: { difficulty: GenDifficulty }) {
  const { t } = useTranslation()
  const text = t(`daily.name.${difficulty}`)
  const parts = text.split('*')
  if (parts.length < 3) return <>{text}</>
  return (
    <>
      {parts[0]}
      <em className="mk-dailyword" data-d={difficulty}>
        {parts[1]}
      </em>
      {parts[2]}
    </>
  )
}
