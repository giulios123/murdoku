import { generateLevel, fillBoardClues } from '../engine/generator/index.ts'
import { DeductionEngine } from '../engine/solver/DeductionEngine.ts'
import { SearchSolver } from '../engine/solver/SearchSolver.ts'
import { loadLevel } from '../engine/io/LevelLoader.ts'
import type { GenDifficulty } from '../engine/generator/index.ts'
import type { LevelJson } from '../engine/io/LevelSchema.ts'

interface Row {
  cfg: string
  ms: number
  tier: string
  solved: boolean
  rank: number
  unique: boolean
  deepTrial: boolean
}

// Does the FULL (diagnostic) engine need deep trial (deep split / forcing)? If the human
// engine solved it, that's never the case — but we double-check.
function deepTrial(level: LevelJson): boolean {
  const r = new DeductionEngine(loadLevel(level), { contradiction: true }).solve()
  return !!(r.techniqueCounts.caseSplitDeep || r.techniqueCounts.forcing || r.techniqueCounts.satForcing)
}

function check(level: LevelJson, cfg: string, ms: number): Row {
  const puzzle = loadLevel(level)
  const ded = new DeductionEngine(puzzle).solve()
  const unique = new SearchSolver(puzzle).countSolutions(2) === 1
  return {
    cfg,
    ms,
    tier: (level as { difficulty?: string }).difficulty ?? '?',
    solved: ded.solved,
    rank: ded.maxRank,
    unique,
    deepTrial: ded.solved ? false : deepTrial(level),
  }
}

const rows: Row[] = []
const matrix: { diff: GenDifficulty; sizes: number[]; seeds: number[] }[] = [
  // 11/12 cost ~0.6–1.1s per ATTEMPT (many attempts per level) — fewer seeds there.
  { diff: 'hard', sizes: [6, 8, 9, 10], seeds: [1, 2, 3] },
  { diff: 'hard', sizes: [11, 12], seeds: [1, 2] },
  { diff: 'medium', sizes: [6, 8, 9], seeds: [1, 2] },
  { diff: 'medium', sizes: [11, 12], seeds: [1] },
  { diff: 'easy', sizes: [6, 8, 9], seeds: [1, 2] },
  { diff: 'easy', sizes: [11, 12], seeds: [1] },
]
for (const { diff, sizes, seeds } of matrix) {
  for (const size of sizes) {
    for (const seed of seeds) {
      const cfg = `${diff} ${size}x${size}#${seed}`
      try {
        const t0 = performance.now()
        const level = generateLevel({ width: size, height: size, suspects: size - 1, difficulty: diff, seed })
        const ms = Math.round(performance.now() - t0)
        rows.push(check(level, cfg, ms))
      } catch (e) {
        rows.push({ cfg, ms: -1, tier: 'FAIL:' + (e as Error).message, solved: false, rank: -1, unique: false, deepTrial: false })
      }
    }
  }
}

console.log('Konfiguration         Zeit   Label    gelöst Rang eindeutig tiefes-Probieren')
for (const r of rows) {
  const flag = !r.solved || !r.unique || r.deepTrial ? '  <-- PROBLEM' : ''
  console.log(
    `${r.cfg.padEnd(20)} ${(r.ms + 'ms').padStart(7)} ${r.tier.padEnd(8)} ${(r.solved ? 'ja' : 'NEIN').padEnd(6)} ${String(r.rank).padEnd(4)} ${(r.unique ? 'ja' : 'NEIN').padEnd(9)} ${r.deepTrial ? 'JA' : 'nein'}${flag}`,
  )
}
const maxMs = Math.max(...rows.map((r) => r.ms))
const problems = rows.filter((r) => !r.solved || !r.unique || r.deepTrial)
console.log(`\nMax-Zeit: ${maxMs} ms · Probleme: ${problems.length}`)

// Editor-Fill: nimm ein generiertes Brett, leere die Hinweise, fülle neu pro Schwierigkeit.
console.log('\n=== Editor-Fill (fillBoardClues) ===')
const board = generateLevel({ width: 8, height: 8, suspects: 7, difficulty: 'hard', seed: 99 })
const emptyBoard: LevelJson = { ...board, suspects: board.suspects.map((s) => ({ ...s, clues: [] })) }
for (const diff of ['easy', 'medium', 'hard'] as GenDifficulty[]) {
  const t0 = performance.now()
  const filled = fillBoardClues(emptyBoard, { difficulty: diff, seed: 7 })
  const ms = Math.round(performance.now() - t0)
  if (!filled) {
    console.log(`fill ${diff}: ${ms}ms → NULL (kein Ergebnis)`)
    continue
  }
  const r = check(filled, `fill ${diff}`, ms)
  console.log(`fill ${diff}: ${ms}ms · Label ${r.tier} · gelöst ${r.solved ? 'ja' : 'NEIN'} · Rang ${r.rank} · eindeutig ${r.unique ? 'ja' : 'NEIN'}`)
}
