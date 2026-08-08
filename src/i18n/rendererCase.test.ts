import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLevel } from '../engine/io/LevelLoader.ts'
import { Renderer } from './Renderer.ts'
import type { LevelJson } from '../engine/io/LevelSchema.ts'

/**
 * The declined-language machinery Russian rides on: the `_few` plural bucket (2–4),
 * the `{{fem}}` verb-gender suffix, the `objectPrep`/`objectGen` case aliases of the
 * `object` param, and the explicit `objectEvery.*` override. All of it must be a
 * strict no-op for locales that don't define the extra dictionary entries.
 */
const dir = resolve(process.cwd(), 'levels')
const firstLevel = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()[0]
const puzzle = loadLevel(JSON.parse(readFileSync(resolve(dir, firstLevel), 'utf8')) as LevelJson)

const male = puzzle.suspects.find((s) => String(puzzle.attributesOf(s.id).gender) === 'm')!
const female = puzzle.suspects.find((s) => String(puzzle.attributesOf(s.id).gender) === 'f')!

const dict = {
  rooms: 'ровно {{count}} комнат',
  rooms_one: 'ровно {{count}} комната',
  rooms_few: 'ровно {{count}} комнаты',
  rooms_zero: 'ни одной комнаты',
  plain: '{{count}} Räume',
  was: '{{subject}} был{{fem}} на {{objectPrep}} и рядом с {{object}} к югу от {{objectGen}}',
  every: 'от {{objectEvery}}',
  fem: { m: '', f: 'а' },
  pron: { m: 'он', f: 'она' },
  object: { bed: 'кроватью' },
  objectPrep: { bed: 'кровати' },
  objectGen: { bed: 'кровати' },
  objectEvery: { tree: 'каждого дерева' },
}
const r = new Renderer(dict, puzzle)

describe('russian plural bucket _few', () => {
  it('picks _one/_few/_zero/base by count', () => {
    expect(r.render({ key: 'rooms', params: { count: 1 } })).toBe('ровно 1 комната')
    for (const n of [2, 3, 4]) expect(r.render({ key: 'rooms', params: { count: n } })).toBe(`ровно ${n} комнаты`)
    for (const n of [5, 11, 12]) expect(r.render({ key: 'rooms', params: { count: n } })).toBe(`ровно ${n} комнат`)
    expect(r.render({ key: 'rooms', params: { count: 0 } })).toBe('ни одной комнаты')
  })

  it('is a no-op for keys without a _few sibling', () => {
    expect(r.render({ key: 'plain', params: { count: 3 } })).toBe('3 Räume')
  })
})

describe('fem suffix and object case aliases', () => {
  it('agrees the verb and declines the object per slot', () => {
    const m = r.clue({ key: 'was', params: { object: 'bed' } }, male.id)
    const f = r.clue({ key: 'was', params: { object: 'bed' } }, female.id)
    expect(m).toBe('Он был на кровати и рядом с кроватью к югу от кровати')
    expect(f).toBe('Она была на кровати и рядом с кроватью к югу от кровати')
  })

  it('falls back to the base object form when the case dict is missing', () => {
    const bare = new Renderer({ t: 'auf {{objectPrep}}', object: { bed: 'einem Bett' } }, puzzle)
    expect(bare.render({ key: 't', params: { object: 'bed' } })).toBe('auf einem Bett')
  })

  it('renders nothing for {{fem}} without a fem dict or subject', () => {
    const bare = new Renderer({ t: 'war{{fem}} da' }, puzzle)
    expect(bare.render({ key: 't', params: { subject: male.id } })).toBe('war da')
    expect(r.render({ key: 'was', params: { object: 'bed' } })).toContain('был на')
  })

  it('objectEvery prefers the explicit token over article derivation', () => {
    expect(r.render({ key: 'every', params: { objectEvery: 'tree' } })).toBe('от каждого дерева')
  })
})
