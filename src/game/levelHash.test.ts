import { describe, expect, it } from 'vitest'
import type { LevelJson } from '../engine/index.ts'
import { canonicalCore, levelHash } from './levelHash.ts'

/** A small (not necessarily solvable) level — hashing never validates. */
function baseLevel(): LevelJson {
  return {
    schema: 1,
    id: 'editor-test',
    title: 'Der Testfall',
    author: 'Dirk',
    difficulty: 'medium',
    size: { width: 4, height: 4 },
    rooms: {
      '1': { nameKey: 'room.kitchen', color: '#aabbcc' },
      '2': { nameKey: 'room.garden', color: '#ccbbaa', outside: true },
    },
    objects: {
      s: { type: 'chair', occupiable: true },
      t: { type: 'table', occupiable: false },
    },
    roomMap: ['1122', '1122', '1122', '1122'],
    topMap: ['s...', '..t.', '....', '....'],
    windows: [{ r: 0, c: 0, side: 'N' }],
    suspects: [
      { id: 'A', name: 'Anna', attributes: { gender: 'f' }, clues: [{ type: 'onObject', object: 'chair' }] },
      { id: 'B', name: 'Bernd', attributes: { gender: 'm' }, clues: [{ type: 'inRoom', room: '2' }] },
      { id: 'C', name: 'Carla', attributes: { gender: 'f' }, clues: [{ type: 'corner' }] },
    ],
    victim: { name: 'Viktor', attributes: { gender: 'm' } },
  }
}

describe('levelHash', () => {
  it('ignores pure flavor: title, author, names, room names/colors, difficulty, id', async () => {
    const a = await levelHash(baseLevel())
    const reskinned = baseLevel()
    reskinned.id = 'editor-anders'
    reskinned.title = 'Ganz anderer Titel'
    reskinned.author = 'Jemand'
    reskinned.difficulty = 'hard'
    reskinned.suspects[0].name = 'Анна'
    reskinned.victim.name = 'Vladimir'
    reskinned.rooms['1'] = { nameKey: 'room.library', color: '#123456' }
    expect(await levelHash(reskinned)).toBe(a)
  })

  it('changes when a clue changes', async () => {
    const a = await levelHash(baseLevel())
    const other = baseLevel()
    other.suspects[2].clues = [{ type: 'alone' }]
    expect(await levelHash(other)).not.toBe(a)
  })

  it('is independent of the room char legend (shapes count, chars do not)', async () => {
    const a = await levelHash(baseLevel())
    // The same layout as a theme would author it: other chars, remapped clue refs,
    // plus a declared-but-unpainted room slot (the editor declares all 15).
    const relabelled = baseLevel()
    relabelled.rooms = {
      K: { nameKey: 'room.kitchen', color: '#aabbcc' },
      G: { nameKey: 'room.garden', color: '#ccbbaa', outside: true },
      X: { nameKey: 'room.unused', color: '#ffffff' },
    }
    relabelled.roomMap = ['KKGG', 'KKGG', 'KKGG', 'KKGG']
    relabelled.suspects[1].clues = [{ type: 'inRoom', room: 'G' }]
    expect(await levelHash(relabelled)).toBe(a)
  })

  it('ignores the outside flag while no clue uses inside/outside (theme re-skin)', async () => {
    const a = await levelHash(baseLevel())
    const rethemed = baseLevel()
    rethemed.rooms['2'] = { nameKey: 'room.cellar', color: '#ccbbaa' }
    expect(await levelHash(rethemed)).toBe(a)
  })

  it('keeps the outside flag once a clue hinges on inside/outside', async () => {
    const withClue = baseLevel()
    withClue.suspects[2].clues = [{ type: 'outside' }]
    const a = await levelHash(withClue)
    const flipped = baseLevel()
    flipped.suspects[2].clues = [{ type: 'outside' }]
    flipped.rooms['2'] = { nameKey: 'room.garden', color: '#ccbbaa' }
    expect(await levelHash(flipped)).not.toBe(a)
  })

  it('ignores avatar styling no clue references, keeps referenced attributes', async () => {
    const a = await levelHash(baseLevel())
    // gender is not referenced by any clue here → styling AND gender are flavor.
    const styled = baseLevel()
    styled.suspects[0].attributes = { gender: 'm', hairstyle: 'bob', glassesColor: 'red' }
    expect(await levelHash(styled)).toBe(a)

    // A clue referencing hair makes hair count for EVERYONE, styling stays flavor.
    const withHairClue = (hair: string): LevelJson => {
      const l = baseLevel()
      l.suspects[0].attributes = { gender: 'f', hair }
      l.suspects[2].clues = [{ type: 'roomAttribute', quantifier: 'some', attribute: 'hair', value: 'red' }]
      return l
    }
    const red = await levelHash(withHairClue('red'))
    expect(await levelHash(withHairClue('blond'))).not.toBe(red)
  })

  it('treats a window edge the same from either side, ignoring order and duplicates', async () => {
    const a = baseLevel()
    a.windows = [
      { r: 1, c: 0, side: 'N' },
      { r: 0, c: 2, side: 'W' },
    ]
    const b = baseLevel()
    b.windows = [
      { r: 0, c: 1, side: 'E' },
      { r: 0, c: 0, side: 'S' },
      { r: 0, c: 0, side: 'S' },
    ]
    expect(await levelHash(b)).toBe(await levelHash(a))
  })

  it('normalizes editor writing style: empty layers, written-out defaults, excludeSelf', async () => {
    // As a generator/hand-authored level would store it …
    const lean = baseLevel()
    lean.suspects[0].clues = [{ type: 'roomAttribute', quantifier: 'none', attribute: 'beard', value: true }]
    lean.suspects[2].clues = [{ type: 'roomExists', attribute: 'gender', value: 'm', object: 'chair' }]
    // … and the same puzzle as the editor writes it: both layers always present,
    // roomExists' default relation spelled out, excludeSelf always true (subject
    // A has no beard, so it cannot matter), explicit `beard: false` on a suspect.
    const editorStyle = baseLevel()
    editorStyle.groundMap = ['....', '....', '....', '....']
    editorStyle.suspects[0].attributes = { gender: 'f', beard: false }
    editorStyle.suspects[0].clues = [
      { type: 'roomAttribute', quantifier: 'none', attribute: 'beard', value: true, excludeSelf: true },
    ]
    editorStyle.suspects[2].clues = [
      { type: 'roomExists', attribute: 'gender', value: 'm', object: 'chair', relation: 'on' },
    ]
    expect(await levelHash(editorStyle)).toBe(await levelHash(lean))
  })

  it("ignores the victim's hidden random traits (only gender is ever visible)", async () => {
    const withClue = (victimAttrs: Record<string, string | boolean>): LevelJson => {
      const l = baseLevel()
      l.suspects[0].clues = [{ type: 'roomAttribute', quantifier: 'none', attribute: 'beard', value: true }]
      l.victim.attributes = victimAttrs
      return l
    }
    const a = await levelHash(withClue({ gender: 'm', beard: true, hair: 'red' }))
    expect(await levelHash(withClue({ gender: 'm' }))).toBe(a)
  })

  it('is independent of JSON key order', () => {
    const shuffled = {
      ...baseLevel(),
      size: { height: 4, width: 4 },
      victim: { attributes: { gender: 'm' }, name: 'Viktor' },
    } as LevelJson
    expect(canonicalCore(shuffled)).toBe(canonicalCore(baseLevel()))
  })
})
