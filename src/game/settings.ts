/**
 * Global app settings behind the gear menu — one shared store so every screen
 * (game, level picker, editor, generator) sees changes immediately. Persisted
 * to localStorage on every update. Language is NOT here: i18next already owns
 * and persists it (see src/i18n/index.ts).
 */
import { useSyncExternalStore } from 'react'
import { loadAppSettings, saveAppSettings } from './storage.ts'
import type { BlockedStyle } from './boardRender.ts'

/** How much the board highlights when a suspect card is selected:
 *  'full' = every cell their statements still allow (intersection, as before),
 *  'reduced' = only what each statement REFERENCES (objects, rooms, traces),
 *  'none' = no selection highlight at all. */
export type HelpMode = 'full' | 'reduced' | 'none'

export interface AppSettings {
  /** Show the elapsed-time counter in the game header. */
  timer: boolean
  helpMode: HelpMode
  /** Tint suspect cards (and the victim's name) by gender. */
  genderColors: boolean
  /** Show the small corner badges revealing the object a placed figure stands/sits on. */
  objectBadges: boolean
  /** Draw the subtle per-room floor patterns on the board (a taste setting). */
  floorTextures: boolean
  /** Extra marking of non-walkable cells beyond the white card ('plain' = as
   *  before, 'dim' = darkened floor, 'hatch' = ink hatching, 'both'). */
  blockedStyle: BlockedStyle
}

export const DEFAULT_SETTINGS: AppSettings = {
  timer: true,
  helpMode: 'full',
  genderColors: true,
  objectBadges: true,
  floorTextures: true,
  blockedStyle: 'plain',
}

let current: AppSettings = loadAppSettings(DEFAULT_SETTINGS)
const listeners = new Set<() => void>()

export function getSettings(): AppSettings {
  return current
}

export function updateSettings(patch: Partial<AppSettings>): void {
  current = { ...current, ...patch }
  saveAppSettings(current)
  for (const notify of listeners) notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current settings, re-rendering the component on every change. */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings)
}
