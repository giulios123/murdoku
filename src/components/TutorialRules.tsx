import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { suspectColor } from '../game/palette.ts'

/** Paper-slip colours — the diagrams live on light "evidence slips" pinned to the dark
 *  coach card, so they use the board's paper/ink values, not the app's dark tokens. */
const INK = '#16141d'
const PAPER_LINE = 'rgba(20, 18, 26, 0.28)'
const CRIMSON = '#cf463c'
/** Same dark X as the board's eliminated cells (BOARD.cross) — never red. */
const CROSS = 'rgba(20, 16, 26, 0.92)'
const BONE = '#f6ecd9'
/** The demo level's real room pastels — the sketch previews the world the player enters. */
const ROOM_A = '#cdb4db'
const ROOM_B = '#a2d2ff'

/** Inner grid lines of a cols×rows box at (x,y) with cell size s, as one path. */
function gridLines(x: number, y: number, cols: number, rows: number, s: number): string {
  const parts: string[] = []
  for (let i = 1; i < cols; i++) parts.push(`M${x + i * s} ${y}V${y + rows * s}`)
  for (let i = 1; i < rows; i++) parts.push(`M${x} ${y + i * s}H${x + cols * s}`)
  return parts.join(' ')
}

/** One dark elimination X in cell (row,col); `i` staggers the stamp animation. */
function Cross({ gx, gy, s, row, col, i }: { gx: number; gy: number; s: number; row: number; col: number; i: number }) {
  const p = s * 0.27
  const x = gx + col * s
  const y = gy + row * s
  return (
    <g className="mk-tutrules__x" style={{ ['--i' as string]: String(i) }}>
      <path
        d={`M${x + p} ${y + p}L${x + s - p} ${y + s - p}M${x + s - p} ${y + p}L${x + p} ${y + s - p}`}
        stroke={CROSS}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </g>
  )
}

const G = 22 // cell size of the wenn/dann pair
const R = 26 // cell size of the room sketch

/**
 * The illustrated core rules for the tutorial's "rules" step — two evidence slips in
 * the investigation-wall style of the book: the »wenn … dann« mini-grid pair (a placed
 * person locks their whole row and column) and a two-room floor sketch (the victim was
 * alone with exactly ONE suspect — the murderer). The SVGs carry no words, so they work
 * in every language; the captions do the talking.
 */
function TutorialRules() {
  const { t } = useTranslation()
  // Cells of the second grid that get stamped: the coin's row, then its column.
  const crosses: [number, number][] = [[1, 0], [1, 2], [1, 3], [0, 1], [2, 1], [3, 1]]
  return (
    <div className="mk-tutrules">
      <figure className="mk-tutrules__chip" data-tilt="l">
        <svg viewBox="0 0 220 96" role="img" aria-label={t('tutorial.rules.line')}>
          {/* wenn: a person stands here … */}
          <rect x="6" y="4" width={4 * G} height={4 * G} fill="#ffffff" stroke={INK} strokeWidth="1.5" />
          <path d={gridLines(6, 4, 4, 4, G)} stroke={PAPER_LINE} strokeWidth="1" />
          <circle cx={6 + G + G / 2} cy={4 + G + G / 2} r="8" fill={suspectColor(0)} />
          {/* dann: … and their row + column are done */}
          <path d="M98 48H115" stroke={INK} strokeWidth="2" />
          <path d="M120 48l-7-4.5v9z" fill={INK} />
          <rect x="126" y="4" width={4 * G} height={4 * G} fill="#ffffff" stroke={INK} strokeWidth="1.5" />
          <path d={gridLines(126, 4, 4, 4, G)} stroke={PAPER_LINE} strokeWidth="1" />
          <circle cx={126 + G + G / 2} cy={4 + G + G / 2} r="8" fill={suspectColor(0)} />
          {crosses.map(([row, col], i) => (
            <Cross key={`${row}-${col}`} gx={126} gy={4} s={G} row={row} col={col} i={i} />
          ))}
        </svg>
        <figcaption className="mk-tutrules__cap">{t('tutorial.rules.line')}</figcaption>
      </figure>

      <figure className="mk-tutrules__chip" data-tilt="r">
        <svg viewBox="0 0 220 96" role="img" aria-label={t('tutorial.rules.victim')}>
          {/* Two rooms; every token keeps its own row AND column (rule 1 stays true). */}
          <rect x="32" y="8" width={3 * R} height={3 * R} fill={ROOM_A} />
          <rect x="110" y="8" width={3 * R} height={3 * R} fill={ROOM_B} />
          <path d={gridLines(32, 8, 3, 3, R)} stroke={PAPER_LINE} strokeWidth="1" />
          <path d={gridLines(110, 8, 3, 3, R)} stroke={PAPER_LINE} strokeWidth="1" />
          <rect x="32" y="8" width={6 * R} height={3 * R} fill="none" stroke={INK} strokeWidth="3" />
          <path d={`M110 8V${8 + 3 * R}`} stroke={INK} strokeWidth="3" />
          {/* the victim … */}
          <circle cx={45} cy={47} r="9.5" fill={CRIMSON} />
          <text
            x="45"
            y="48"
            fontSize="12"
            fill={BONE}
            textAnchor="middle"
            dominantBaseline="central"
          >
            ☠
          </text>
          {/* … alone with exactly ONE suspect: the murderer (ringed) … */}
          <circle cx={97} cy={73} r="8.5" fill={suspectColor(1)} />
          <circle className="mk-tutrules__ring" cx={97} cy={73} r="13" fill="none" stroke={CRIMSON} strokeWidth="2" />
          {/* … while other rooms hold the rest. */}
          <circle cx={149} cy={21} r="8.5" fill={suspectColor(2)} />
        </svg>
        <figcaption className="mk-tutrules__cap">{t('tutorial.rules.victim')}</figcaption>
      </figure>
    </div>
  )
}

// Memoized: pure static illustration — never re-render with the coach's step churn.
export default memo(TutorialRules)
