import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fillBoardClues, generateLevel, themeDefaultObjects } from '../engine/generator/index.ts'
import { DeductionEngine, SearchSolver, loadLevel } from '../engine/index.ts'
import type { ClueJson, LevelJson } from '../engine/index.ts'

/**
 * Authoring tool (08/2026): produce the official launch levels for the new
 * exact-offset-from-anonymous clue family — each of the four variants (neben Objekt /
 * auf Objekt / Merkmal / Objektzelle) in two levels. Deterministic seeds, titles baked
 * in (uniqueness against the WHOLE corpus is machine-checked below, per language).
 *
 * Run: npx tsx src/dev/gen-offsetfrom-levels.ts [--only File1,File2]
 * `--only` regenerates just the named specs (e.g. after a rule change) — the title
 * check then ignores exactly those files in the corpus (their titles are reused).
 */

type LeafPred = (j: ClueJson) => boolean

const hasLeaf = (json: ClueJson, pred: LeafPred): boolean => {
  if (json.type === 'and' || json.type === 'or') return json.clues.some((c) => hasLeaf(c, pred))
  if (json.type === 'not') return hasLeaf(json.clue, pred)
  return pred(json)
}

const levelHasLeaf = (level: LevelJson, pred: LeafPred): boolean =>
  level.suspects.some((s) => (s.clues ?? []).some((c) => hasLeaf(c, pred)))

const nearPred: LeafPred = (j) => j.type === 'offsetFrom' && j.who.kind === 'near'
const onPred: LeafPred = (j) => j.type === 'offsetFrom' && j.who.kind === 'on'
const attrPred: LeafPred = (j) => j.type === 'offsetFrom' && j.who.kind === 'attr'
const objPred: LeafPred = (j) => j.type === 'offsetFromObject'

interface Spec {
  file: string
  size: number
  theme: string
  difficulty: 'medium' | 'hard'
  pred: LeafPred
  label: string
  seed: number
  titles: Record<'de' | 'en' | 'es' | 'pt' | 'fr' | 'ru', string>
}

const SPECS: Spec[] = [
  {
    file: 'Der_vermessene_Tatort', size: 7, theme: 'home', difficulty: 'medium',
    pred: nearPred, label: 'offsetFrom near', seed: 41001,
    titles: {
      de: 'Der vermessene Tatort', en: 'The Measured Crime Scene', es: 'La escena medida',
      pt: 'O Local Medido', fr: 'La Scène mesurée', ru: 'Измеренное место преступления',
    },
  },
  {
    file: 'Schrittmass_des_Moerders', size: 8, theme: 'manor', difficulty: 'hard',
    pred: nearPred, label: 'offsetFrom near', seed: 42001,
    titles: {
      de: 'Schrittmaß des Mörders', en: 'Counted Footsteps', es: 'Pasos contados',
      pt: 'Passos Contados', fr: 'Les Pas comptés', ru: 'Отмеренные шаги',
    },
  },
  {
    file: 'Drei_Zelte_weiter', size: 7, theme: 'camping', difficulty: 'medium',
    pred: onPred, label: 'offsetFrom on', seed: 43001,
    titles: {
      de: 'Drei Zelte weiter', en: 'Two Tents Away', es: 'Acampada fatal',
      pt: 'Acampamento Fatal', fr: 'Camping fatal', ru: 'Роковая стоянка',
    },
  },
  {
    file: 'Zimmer_mit_Abstand', size: 9, theme: 'grandhotel', difficulty: 'hard',
    pred: onPred, label: 'offsetFrom on', seed: 44001,
    titles: {
      de: 'Zimmer mit Abstand', en: 'A Corridor Apart', es: 'Habitaciones a distancia',
      pt: 'Quartos à Distância', fr: 'Chambres à distance', ru: 'Номера на расстоянии',
    },
  },
  {
    file: 'Nachsitzen_fuer_einen_Moerder', size: 7, theme: 'school', difficulty: 'medium',
    pred: attrPred, label: 'offsetFrom attr', seed: 45001,
    titles: {
      de: 'Nachsitzen für einen Mörder', en: 'Detention for a Killer', es: 'Castigo para un asesino',
      pt: 'Castigo para um Assassino', fr: 'Retenue pour un meurtrier', ru: 'Оставлен после уроков',
    },
  },
  {
    file: 'Visite_um_Mitternacht', size: 9, theme: 'hospital', difficulty: 'hard',
    pred: attrPred, label: 'offsetFrom attr', seed: 46001,
    titles: {
      de: 'Visite um Mitternacht', en: 'Midnight Rounds', es: 'Ronda de medianoche',
      pt: 'Ronda da Meia-Noite', fr: 'La Ronde de minuit', ru: 'Полуночный обход',
    },
  },
  {
    file: 'Stallgefluester', size: 7, theme: 'farm', difficulty: 'medium',
    pred: objPred, label: 'offsetFromObject', seed: 47001,
    titles: {
      de: 'Stallgeflüster', en: 'Whispers in the Barn', es: 'Susurros en el establo',
      pt: 'Sussurros no Estábulo', fr: "Murmures à l'étable", ru: 'Шёпот в хлеву',
    },
  },
  {
    file: 'Raubtierfuetterung', size: 8, theme: 'zoo', difficulty: 'hard',
    pred: objPred, label: 'offsetFromObject', seed: 48001,
    titles: {
      de: 'Raubtierfütterung', en: 'Feeding Time', es: 'La hora de la fiera',
      pt: 'A Hora da Fera', fr: "L'Heure du fauve", ru: 'Час хищника',
    },
  },
]

const onlyArg = process.argv.indexOf('--only')
const only =
  onlyArg >= 0 && process.argv[onlyArg + 1] ? new Set(process.argv[onlyArg + 1].split(',')) : null
const specs = only ? SPECS.filter((s) => only.has(s.file)) : SPECS
if (only && specs.length !== only.size) {
  console.error(`✗ --only nennt unbekannte Specs (bekannt: ${SPECS.map((s) => s.file).join(', ')})`)
  process.exit(1)
}

// --- title uniqueness against the WHOLE corpus, per language (hard requirement) ---
const levelsDir = resolve(process.cwd(), 'levels')
const existing = readdirSync(levelsDir)
  .filter((f) => f.endsWith('.json') && !specs.some((s) => f === `${s.file}.json`))
  .map((f) => JSON.parse(readFileSync(resolve(levelsDir, f), 'utf8')) as LevelJson)
const usedTitles = new Map<string, Set<string>>()
const norm = (s: string) => s.trim().toLowerCase()
for (const l of existing) {
  const titles = { de: l.title, ...(l.titles ?? {}) } as Record<string, string | undefined>
  for (const [lang, t] of Object.entries(titles)) {
    if (!t) continue
    if (!usedTitles.has(lang)) usedTitles.set(lang, new Set())
    usedTitles.get(lang)!.add(norm(t))
  }
}
let titleClash = false
const plannedPerLang = new Map<string, Set<string>>()
for (const spec of specs) {
  for (const [lang, t] of Object.entries(spec.titles)) {
    if (usedTitles.get(lang)?.has(norm(t))) {
      console.error(`✗ Titel-Kollision mit Korpus (${lang}): "${t}" (${spec.file})`)
      titleClash = true
    }
    if (!plannedPerLang.has(lang)) plannedPerLang.set(lang, new Set())
    if (plannedPerLang.get(lang)!.has(norm(t))) {
      console.error(`✗ Titel doppelt unter den NEUEN Leveln (${lang}): "${t}"`)
      titleClash = true
    }
    plannedPerLang.get(lang)!.add(norm(t))
  }
}
if (titleClash) process.exit(1)

// --- generate ---------------------------------------------------------------
for (const spec of specs) {
  const suspects = spec.size - 1
  let done = false
  for (let attempt = 0; attempt < 12 && !done; attempt++) {
    const seed = spec.seed + attempt * 101
    let base: LevelJson
    try {
      base = generateLevel({
        width: spec.size,
        height: spec.size,
        suspects,
        seed,
        themeId: spec.theme,
        difficulty: spec.difficulty,
        objects: themeDefaultObjects(spec.theme),
      })
    } catch {
      continue
    }
    const filled = fillBoardClues(base, {
      difficulty: spec.difficulty,
      seed: seed * 31 + 7,
      requiredClues: [spec.pred],
      budget: { maxAttempts: 800, softMs: 10000, hardMs: 30000 },
    })
    if (!filled) continue
    if (!levelHasLeaf(filled, spec.pred)) continue
    // Prefer the target tier; keep hunting a few attempts if the label came out lower.
    if (filled.difficulty !== spec.difficulty && attempt < 9) continue

    // Independent verification: unique AND pure-forward solvable (the ship gates again).
    const puzzle = loadLevel(filled)
    if (new SearchSolver(puzzle).countSolutions(2) !== 1) continue
    const deduction = new DeductionEngine(puzzle).solve()
    if (!deduction.solved) continue

    filled.id = spec.file.toLowerCase().replace(/_/g, '-')
    filled.title = spec.titles.de
    filled.titles = { ...spec.titles }
    const path = resolve(levelsDir, `${spec.file}.json`)
    writeFileSync(path, JSON.stringify(filled, null, 2) + '\n', 'utf8')
    const kinds = ['offsetFrom near', 'offsetFrom on', 'offsetFrom attr', 'offsetFromObject']
      .filter((_, i) => levelHasLeaf(filled, [nearPred, onPred, attrPred, objPred][i]))
    console.log(
      `✓ ${spec.file}.json  ${spec.size}x${spec.size} ${spec.theme} ${filled.difficulty}` +
        `  [${spec.label}] enthält: ${kinds.join(', ')} (Versuch ${attempt + 1})`,
    )
    done = true
  }
  if (!done) console.error(`✗ ${spec.file}: kein Level gefunden — Spec anpassen (Seed/Größe)`)
}
