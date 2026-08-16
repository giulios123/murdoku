import { describe, it, expect } from 'vitest'
import { cluesToGroup, groupToClues } from './editorClues.ts'
import type { ClueJson } from '../engine/index.ts'

/**
 * Editor round-trip: a clue opened in the editor and saved again unchanged must come back
 * BYTE-IDENTICAL. Without this, opening a level silently rewrites its clues (or drops the
 * ones the flat builder can't represent) — the parity rule the whole editor rests on.
 *
 * Covers the room-neighbourhood clues added to the "Raum" hub, plus a sample of the
 * pre-existing types so a change to the hub can't quietly break them either.
 */
const CASES: { name: string; json: ClueJson }[] = [
  // --- the new room-neighbourhood aspects ---
  { name: 'inRoomAdjacentTo', json: { type: 'inRoomAdjacentTo', room: '2' } },
  { name: 'inRoomAdjacentTo negiert', json: { type: 'not', clue: { type: 'inRoomAdjacentTo', room: '3' } } },
  { name: 'adjacentRooms', json: { type: 'adjacentRooms', as: 'B' } },
  { name: 'adjacentRooms negiert', json: { type: 'not', clue: { type: 'adjacentRooms', as: 'C' } } },
  { name: 'neighborRoomEmpty', json: { type: 'neighborRoomEmpty' } },
  // The negation is the STRONGER universal reading ("no adjoining room was empty") — it has
  // to survive the round-trip as a `not`, not collapse into the positive form.
  { name: 'neighborRoomEmpty negiert', json: { type: 'not', clue: { type: 'neighborRoomEmpty' } } },
  { name: 'neighborRoomCount', json: { type: 'neighborRoomCount', count: 2 } },
  { name: 'neighborRoomCount mit Richtung', json: { type: 'neighborRoomCount', count: 1, dir: 'south' } },
  { name: 'neighborRoomCount westlich', json: { type: 'neighborRoomCount', count: 3, dir: 'west' } },
  { name: 'neighborRoomCount negiert', json: { type: 'not', clue: { type: 'neighborRoomCount', count: 2, dir: 'north' } } },
  // --- regression: the hub's existing aspects ---
  { name: 'inRoom', json: { type: 'inRoom', room: '1' } },
  { name: 'inRoom alone', json: { type: 'inRoom', room: '1', occupancy: 'alone' } },
  { name: 'sameRoom', json: { type: 'sameRoom', as: 'B' } },
  { name: 'alone', json: { type: 'alone' } },
  { name: 'notAlone', json: { type: 'notAlone' } },
  { name: 'onObject', json: { type: 'onObject', object: 'chair' } },
  { name: 'corner', json: { type: 'corner' } },
  { name: 'direction', json: { type: 'direction', of: 'B', dir: 'northeast' } },
  // --- the exact-offset family incl. the anonymous anchors ---
  { name: 'offset (Person)', json: { type: 'offset', of: 'B', dir: 'west', distance: 2 } },
  { name: 'offset negiert', json: { type: 'not', clue: { type: 'offset', of: 'C', dir: 'south', distance: 1 } } },
  {
    name: 'offsetFrom Merkmal (bool)',
    json: { type: 'offsetFrom', who: { kind: 'attr', attribute: 'beard', value: true }, dir: 'north', distance: 2 },
  },
  {
    name: 'offsetFrom Merkmal (Geschlecht)',
    json: { type: 'offsetFrom', who: { kind: 'attr', attribute: 'gender', value: 'f' }, dir: 'east', distance: 1 },
  },
  {
    name: 'offsetFrom Merkmal (Frisur)',
    json: { type: 'offsetFrom', who: { kind: 'attr', attribute: 'hairstyle', value: 'bob' }, dir: 'west', distance: 3 },
  },
  {
    name: 'offsetFrom neben Objekt (jemand)',
    json: { type: 'offsetFrom', who: { kind: 'near', object: 'plant' }, dir: 'east', distance: 1 },
  },
  {
    name: 'offsetFrom auf Objekt (Verdächtiger)',
    json: { type: 'offsetFrom', who: { kind: 'on', object: 'chair' }, dir: 'south', distance: 2, scope: 'suspects' },
  },
  {
    name: 'offsetFrom negiert',
    json: { type: 'not', clue: { type: 'offsetFrom', who: { kind: 'near', object: 'plant' }, dir: 'north', distance: 1 } },
  },
  { name: 'offsetFromObject', json: { type: 'offsetFromObject', object: 'plant', dir: 'east', distance: 2, room: 'any' } },
  { name: 'offsetFromObject same room', json: { type: 'offsetFromObject', object: 'chair', dir: 'north', distance: 1, room: 'same' } },
  {
    name: 'offsetFromObject negiert',
    json: { type: 'not', clue: { type: 'offsetFromObject', object: 'plant', dir: 'west', distance: 1, room: 'other' } },
  },
]

describe('editor clue round-trip (ClueJson → Condition → ClueJson)', () => {
  for (const { name, json } of CASES) {
    it(name, () => {
      const group = cluesToGroup([json])
      expect(group.conditions.length, `${name}: the flat builder dropped the clue`).toBe(1)
      expect(groupToClues(group)).toEqual([json])
    })
  }

  it('survives an AND of several new aspects', () => {
    const json: ClueJson = {
      type: 'and',
      clues: [
        { type: 'inRoomAdjacentTo', room: '2' },
        { type: 'not', clue: { type: 'neighborRoomEmpty' } },
        { type: 'neighborRoomCount', count: 2, dir: 'east' },
      ],
    }
    expect(groupToClues(cluesToGroup([json]))).toEqual([json])
  })

  it('the new aspects each pick their own roomMode', () => {
    const modeOf = (json: ClueJson): string | undefined => cluesToGroup([json]).conditions[0]?.roomMode
    expect(modeOf({ type: 'inRoomAdjacentTo', room: '2' })).toBe('adjacent')
    expect(modeOf({ type: 'adjacentRooms', as: 'B' })).toBe('adjacent')
    expect(modeOf({ type: 'neighborRoomEmpty' })).toBe('neighborEmpty')
    expect(modeOf({ type: 'neighborRoomCount', count: 2 })).toBe('neighborCount')
    // The two 'adjacent' aspects are told apart by their target, not their mode.
    expect(cluesToGroup([{ type: 'inRoomAdjacentTo', room: '2' }]).conditions[0].adjTarget).toBe('room')
    expect(cluesToGroup([{ type: 'adjacentRooms', as: 'B' }]).conditions[0].adjTarget).toBe('person')
  })
})
