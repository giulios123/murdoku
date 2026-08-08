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

  it('changes when the outside flag changes (clue semantics)', async () => {
    const a = await levelHash(baseLevel())
    const other = baseLevel()
    other.rooms['2'] = { nameKey: 'room.garden', color: '#ccbbaa' }
    expect(await levelHash(other)).not.toBe(a)
  })

  it('is independent of the object char legend (types count, chars do not)', async () => {
    const a = await levelHash(baseLevel())
    const relabelled = baseLevel()
    relabelled.objects = {
      x: { type: 'chair', occupiable: true },
      y: { type: 'table', occupiable: false },
    }
    relabelled.topMap = ['x...', '..y.', '....', '....']
    expect(await levelHash(relabelled)).toBe(a)
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
