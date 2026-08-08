import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
// Self-hosted fonts (offline-fähig, kein Google-CDN). Familien-Namen:
// 'Fraunces Variable', 'Spline Sans Variable', 'Special Elite'.
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/fraunces/full-italic.css'
import '@fontsource-variable/spline-sans/index.css'
import '@fontsource/special-elite/index.css'
// Kyrillische Zwillinge (Russisch): die Spiel-Fonts haben kein Kyrillisch, diese drei
// stehen als Fallback in den Font-Stacks. Per unicode-range lädt ein Latein-Nutzer
// davon nichts. Familien: 'Playfair Display Variable', 'PT Mono', 'Golos Text Variable'.
import '@fontsource-variable/playfair-display/index.css'
import '@fontsource-variable/playfair-display/wght-italic.css'
import '@fontsource/pt-mono/index.css'
import '@fontsource-variable/golos-text/index.css'
import './i18n'
import './index.css'
import App from './App.tsx'

// The native Android app hides the system bars (immersive full-screen) — see
// android/.../MainActivity.java. Flag <html> so the CSS can reserve the device
// safe area (camera cutout / rounded corners) ONLY in the app; the browser
// builds (desktop + mobile web) keep the full viewport.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
