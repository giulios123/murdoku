import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Renderer } from '../i18n/Renderer.ts'
import { createBoardClue, createClue, type BoardClueJson, type ClueJson } from '../engine/index.ts'
import {
  FAQ_CATEGORIES,
  faqLookupForBoardClue,
  faqLookupsForClues,
  faqPuzzle,
  findFaqEntry,
  resolveVariant,
} from './faqEntries.ts'
import { FAQ_BOARDS } from './faqBoards.ts'

/**
 * The Handakte must never lie: every entry's example clue renders as real text in
 * every language, every board illustration has consistent marks (blue ∩ red = ∅,
 * an automatic blue set is never empty), and the reference figures obey the
 * one-per-row/column base rule — a rule violation in an ILLUSTRATION would teach
 * exactly the wrong thing.
 */
const LANGS = ['de', 'en', 'es', 'pt', 'fr', 'ru'] as const
const dicts = Object.fromEntries(
  LANGS.map((lg) => [
    lg,
    JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lg}.json`), 'utf8')),
  ]),
)

const lookup = (dict: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[part]
  }, dict)

const looksLikeKey = (s: string): boolean => /^[a-z][a-zA-Z]*(\.[a-zA-Z_]+)+$/.test(s.trim())
const hasUnfilledSlot = (s: string): boolean => s.includes('{{')

const allVariants = FAQ_CATEGORIES.flatMap((cat) =>
  cat.entries.flatMap((entry) => entry.variants.map((variant) => ({ cat, entry, variant }))),
)

describe('Handakte catalog', () => {
  it('all demo boards load', () => {
    for (const id of Object.keys(FAQ_BOARDS) as (keyof typeof FAQ_BOARDS)[]) {
      expect(faqPuzzle(id).board.occupiableCells().length).toBeGreaterThan(0)
    }
  })

  it('entry ids are unique', () => {
    const ids = FAQ_CATEGORIES.flatMap((c) => c.entries.map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const lg of LANGS) {
    it(`${lg}: every category, entry and chip has its text`, () => {
      const bad: string[] = []
      for (const cat of FAQ_CATEGORIES) {
        if (typeof lookup(dicts[lg], `faq.cat.${cat.id}`) !== 'string') bad.push(`cat.${cat.id}`)
        for (const entry of cat.entries) {
          for (const part of ['title', 'body']) {
            if (typeof lookup(dicts[lg], `faq.e.${entry.id}.${part}`) !== 'string')
              bad.push(`e.${entry.id}.${part}`)
          }
          for (const variant of entry.variants) {
            if (variant.labelKey && typeof lookup(dicts[lg], variant.labelKey) !== 'string')
              bad.push(variant.labelKey)
          }
        }
      }
      expect(bad, bad.join('\n')).toEqual([])
    })

    it(`${lg}: every example clue renders as real text`, () => {
      const bad: string[] = []
      for (const { entry, variant } of allVariants) {
        const view = resolveVariant(entry, variant)
        if (!view) continue
        const r = new Renderer(dicts[lg], view.puzzle)
        const text = view.clue
          ? r.clue(view.clue.describe(), view.subject ?? view.puzzle.suspects[0].id)
          : view.boardClue
            ? r.render(view.boardClue.describe())
            : ''
        if (view.clue || view.boardClue) {
          if (!text.trim() || looksLikeKey(text) || hasUnfilledSlot(text)) {
            bad.push(`${entry.id}/${variant.labelKey ?? 0} → ${JSON.stringify(text)}`)
          }
        }
      }
      expect(bad, bad.join('\n')).toEqual([])
    })
  }

  it('marks are consistent: blue and red never overlap, auto blue never empty', () => {
    const bad: string[] = []
    for (const { entry, variant } of allVariants) {
      const view = resolveVariant(entry, variant)
      if (!view) continue
      const label = `${entry.id}/${variant.labelKey ?? 0}`
      const blue = view.marks.blue ?? new Set()
      const red = view.marks.red ?? new Set()
      for (const cell of red) if (blue.has(cell)) bad.push(`${label}: cell ${cell} both blue and red`)
      // The engine-computed sets must never come out empty — an empty picture would
      // mean the example clue is unsatisfiable on its own demo board.
      if (variant.clue && !variant.marks && blue.size === 0) bad.push(`${label}: auto blue empty`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('every clue kind maps to an existing Handakte entry (in-game lookup)', () => {
    // One sample per ClueJson type — a kind without a mapping would silently offer
    // no "look it up" row in the dossier note.
    const samples: ClueJson[] = [
      { type: 'onObject', object: 'chair' },
      { type: 'nearObject', object: 'table' },
      { type: 'nearObjectAny', objects: ['table', 'bed'] },
      { type: 'nearWindow' },
      { type: 'nearDoor' },
      { type: 'inside' },
      { type: 'outside' },
      { type: 'inRoom', room: 'K' },
      { type: 'inRoomAdjacentTo', room: 'K' },
      { type: 'inRow', row: 0 },
      { type: 'inCol', col: 0 },
      { type: 'corner' },
      { type: 'atWall' },
      { type: 'uniqueOnObject', object: 'chair' },
      { type: 'uniqueNearObject', object: 'table' },
      { type: 'uniqueNearWindow' },
      { type: 'uniqueNearDoor' },
      { type: 'uniqueInside' },
      { type: 'uniqueOutside' },
      { type: 'alone' },
      { type: 'notAlone' },
      { type: 'neighborRoomEmpty' },
      { type: 'neighborRoomCount', count: 1 },
      { type: 'aloneWith', people: ['B'], attribute: 'gender', value: 'f', extraCount: 1 },
      { type: 'roomAttribute', quantifier: 'some', attribute: 'beard', value: true },
      { type: 'direction', of: 'B', dir: 'south' },
      { type: 'directionFromAttr', attribute: 'beard', value: true, dir: 'south' },
      { type: 'insideXor', with: 'B' },
      { type: 'offset', of: 'B', dir: 'west', distance: 1 },
      { type: 'sameRoom', as: 'B' },
      { type: 'adjacentRooms', as: 'B' },
      { type: 'sameLineAsObject', object: 'plant', line: 'col', room: 'any' },
      { type: 'directionFromObject', object: 'plant', dir: 'north', room: 'any' },
      { type: 'sameRoomAsObject', object: 'bed' },
      { type: 'besideSameObject', object: 'table', mate: { kind: 'any' } },
      { type: 'roomCompanion', count: 1, attribute: 'beard', value: true },
      { type: 'roomExists', relation: 'on', object: 'chair' },
      { type: 'not', clue: { type: 'corner' } },
      { type: 'and', clues: [{ type: 'corner' }, { type: 'atWall' }] },
      { type: 'or', clues: [{ type: 'corner' }, { type: 'atWall' }] },
    ]
    const bad: string[] = []
    for (const json of samples) {
      const ids = faqLookupsForClues([createClue(json)])
      if (ids.length === 0) bad.push(`${json.type}: no lookup`)
      for (const id of ids) if (!findFaqEntry(id)) bad.push(`${json.type}: unknown entry ${id}`)
    }
    const boardSamples: BoardClueJson[] = [
      { type: 'countOnObject', object: 'chair', count: 1 },
      { type: 'emptyRooms', count: 1 },
      { type: 'everyRoomCount', count: 2 },
      { type: 'roomOccupancy', op: 'atMost', count: 2 },
      { type: 'countWithAttr', attribute: 'gender', value: 'f', area: 'outside', count: 2 },
    ]
    for (const json of boardSamples) {
      const id = faqLookupForBoardClue(createBoardClue(json))
      if (!id) bad.push(`${json.type}: no lookup`)
      else if (!findFaqEntry(id)) bad.push(`${json.type}: unknown entry ${id}`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('reference figures obey the one-per-row/column rule and stand on free cells', () => {
    const bad: string[] = []
    for (const { entry, variant } of allVariants) {
      const view = resolveVariant(entry, variant)
      if (!view) continue
      const label = `${entry.id}/${variant.labelKey ?? 0}`
      const rows = new Set<number>()
      const cols = new Set<number>()
      const occupiable = new Set(view.puzzle.board.occupiableCells())
      for (const [id, cell] of view.placements) {
        if (!occupiable.has(cell)) bad.push(`${label}: ${id} on blocked cell ${cell}`)
        const { row, col } = view.puzzle.board.rc(cell)
        if (rows.has(row)) bad.push(`${label}: two figures share row ${row}`)
        if (cols.has(col)) bad.push(`${label}: two figures share column ${col}`)
        rows.add(row)
        cols.add(col)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
})
