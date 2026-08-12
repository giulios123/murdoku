import { describe, expect, it } from 'vitest'
import type { LevelJson } from '../engine/index.ts'
import { editorStateFromLevel } from './editorModel.ts'

/** Theme-/hand-authored level whose room chars are NO editor slots — opening it must
 *  remap them onto the slots AND every room reference inside the clues along. */
function foreignCharLevel(): LevelJson {
  return {
    schema: 1,
    id: 'fremd',
    size: { width: 4, height: 4 },
    rooms: {
      K: { nameKey: 'room.kitchen', color: '#aabbcc' },
      G: { nameKey: 'room.garden', color: '#ccbbaa' },
    },
    roomMap: ['KKGG', 'KKGG', 'KKGG', 'KKGG'],
    suspects: [
      { id: 'A', name: 'Anna', attributes: { gender: 'f' }, clues: [{ type: 'inRoom', room: 'G' }] },
      {
        id: 'B',
        name: 'Bernd',
        attributes: { gender: 'm' },
        clues: [{ type: 'not', clue: { type: 'inRoomAdjacentTo', room: 'K' } }],
      },
      { id: 'C', name: 'Carla', attributes: { gender: 'f' }, clues: [{ type: 'corner' }] },
    ],
    victim: { name: 'Viktor', attributes: { gender: 'm' } },
  }
}

describe('editorStateFromLevel', () => {
  it('remaps room chars in ALL room-referencing clues (inRoom and inRoomAdjacentTo)', () => {
    const state = editorStateFromLevel(foreignCharLevel())
    // 'K' and 'G' are no editor slots → first free slots '1' and '2' (first-seen order).
    expect(state.roomMap).toEqual(['1122', '1122', '1122', '1122'])
    expect(state.suspects[0].clue.conditions[0].room).toBe('2')
    const adj = state.suspects[1].clue.conditions[0]
    expect(adj.room).toBe('1')
    expect(adj.not).toBe(true)
  })
})
