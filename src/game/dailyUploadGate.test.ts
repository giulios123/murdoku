import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LevelJson } from '../engine/index.ts'
import { uploadUserLevel } from './userlevels.ts'
import { saveDailyLevel } from './storage.ts'

/**
 * Upload-Tor für Rätsel des Tages: Dailys entstehen nur auf dem eigenen Gerät und
 * liegen für immer in `murdoku.daily.levels.v1` — ein UNVERÄNDERTES Daily (auch nur
 * umbenannt/umgefärbt: der kanonische Hash ignoriert Flavor) darf nie als Userlevel
 * hochgeladen werden. Echt umgebaute Level passieren das Tor weiterhin.
 */

/** A small (not necessarily solvable) level — the gate only ever hashes. */
function dailyLevel(): LevelJson {
  return {
    schema: 1,
    id: 'daily-2026-08-14',
    title: 'Rätsel des Tages – 14. August 2026',
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

const store = new Map<string, string>()
const realFetch = globalThis.fetch

beforeEach(() => {
  store.clear()
  // Node-vitest has no localStorage — a Map-backed stub feeds storage.ts.
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  // No test may ever reach the real API.
  globalThis.fetch = () => Promise.reject(new Error('offline'))
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  globalThis.fetch = realFetch
})

describe('daily upload gate', () => {
  it('blocks an unchanged stored daily with its own error', async () => {
    saveDailyLevel('2026-08-14', dailyLevel())
    expect(await uploadUserLevel(dailyLevel())).toEqual({ ok: false, error: 'daily' })
  })

  it('still blocks a reskinned daily (flavor is not a change)', async () => {
    saveDailyLevel('2026-08-14', dailyLevel())
    const reskinned = dailyLevel()
    reskinned.id = 'editor-neu'
    reskinned.title = 'Mein ganz eigener Fall'
    reskinned.author = 'Trickser'
    reskinned.suspects[0].name = 'Anneliese'
    reskinned.rooms['1'] = { nameKey: 'room.library', color: '#123456' }
    expect(await uploadUserLevel(reskinned)).toEqual({ ok: false, error: 'daily' })
  })

  it('lets a really altered daily through to the network step', async () => {
    saveDailyLevel('2026-08-14', dailyLevel())
    const altered = dailyLevel()
    altered.suspects[2].clues = [{ type: 'alone' }]
    // Past the daily/duplicate gates the upload hits fetch — stubbed to fail,
    // so 'network' here proves the gates let it pass.
    expect(await uploadUserLevel(altered)).toEqual({ ok: false, error: 'network' })
  })
})
