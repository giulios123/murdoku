/**
 * Android: Beim Fokussieren eines Textfelds fährt die Bildschirmtastatur hoch —
 * das Feld muss danach SICHTBAR bleiben (Dirks Regel). Drei Schichten sorgen dafür:
 *  1. AndroidManifest: `windowSoftInputMode="adjustResize"` (WebView schrumpft),
 *  2. index.html-Viewport: `interactive-widget=resizes-content` (Chromium skaliert
 *     den Layout-Viewport statt nur den visuellen),
 *  3. dieser Fallback: das fokussierte Feld nach der Tastatur-Animation in die
 *     Mitte des (intern scrollenden) Dialogs holen.
 */
import type { FocusEvent } from 'react'

export function keepFieldVisible(e: FocusEvent<HTMLElement>): void {
  const el = e.currentTarget
  // Die Tastatur-Animation braucht einen Moment; danach ist der Viewport final.
  window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
}
