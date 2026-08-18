import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLevel } from '../io/LevelLoader.ts'
import { referencedTraitKinds } from './clueRefs.ts'
import type { ClueJson } from './ClueFactory.ts'
import type { BoardClueJson, LevelJson } from '../io/LevelSchema.ts'

/**
 * `referencedTraitKinds` steuert die Text-Chips der Druckbogen/Buch-Karten: eine
 * Merkmals-Ausprägung („Blond") wird nur ausgeschrieben, wenn irgendein Hinweis
 * die Merkmals-ART nennt. Ein hier übersehener Träger heißt: der Spieler muss
 * Haarfarben auf Papier raten — deshalb sind alle drei Hinweis-Heimaten
 * (Verdächtigen-Hinweise, globale Hinweise, Board-Clues) festgenagelt, inklusive
 * Verschachtelung in not/and.
 */
const readLevel = (f: string): LevelJson =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'levels', f), 'utf8'))

/** Basislevel ohne jeden Hinweis — jeder Fall unten fügt genau einen hinzu. */
const base = (): LevelJson => {
  const l = readLevel('Der_Mord_zu_Hause.json')
  return {
    ...l,
    suspects: l.suspects.map((s) => ({ ...s, clues: [] })),
    globalClues: [],
    boardClues: [],
  }
}
const withClue = (clue: ClueJson): LevelJson => {
  const l = base()
  return { ...l, suspects: l.suspects.map((s, i) => (i === 0 ? { ...s, clues: [clue] } : s)) }
}

describe('referencedTraitKinds', () => {
  it('empty without any trait-bearing clue', () => {
    expect(referencedTraitKinds(loadLevel(base())).size).toBe(0)
  })

  it('finds the attribute of a suspect clue (roomCompanion)', () => {
    const level = withClue({ type: 'roomCompanion', count: 1, attribute: 'hair', value: 'blond' })
    expect(referencedTraitKinds(loadLevel(level))).toEqual(new Set(['hair']))
  })

  it('recurses into not/and wrappers', () => {
    const level = withClue({
      type: 'not',
      clue: {
        type: 'and',
        clues: [
          { type: 'roomCompanion', count: 1, attribute: 'glassesColor', value: 'gold' },
          { type: 'alone' },
        ],
      },
    })
    expect(referencedTraitKinds(loadLevel(level))).toEqual(new Set(['glassesColor']))
  })

  it('finds the attribute of a board clue (countWithAttr)', () => {
    const bc: BoardClueJson = { type: 'countWithAttr', attribute: 'gender', value: 'f', area: 'inside', count: 2 }
    const level = { ...base(), boardClues: [bc] }
    expect(referencedTraitKinds(loadLevel(level))).toEqual(new Set(['gender']))
  })
})
