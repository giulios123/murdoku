/**
 * Generates the Google Play store graphics into ./assets:
 *   - store-icon-512.png      (512×512, language-neutral)
 *   - feature-graphic-de.png  (1024×500, German)
 *   - feature-graphic-en.png  (1024×500, English)
 * Run with:  npx tsx scripts/make-store-assets.ts
 *
 * Feature graphic = "Die Ermittlungswand" (Entwurfsmappe, Akte 24, 13.08.2026):
 * real level boards as tilted evidence polaroids (lido 9×9 + farm 4×4), the
 * daily-mystery calendar leaf, a community card with stars and two pinned
 * suspect coins — all connected by the red case thread. Drawn at 2× with
 * @napi-rs/canvas so the real app fonts render (Fraunces 900 + Special Elite,
 * registered straight from the shipped woff2 files), then downsampled.
 */
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import { avatarSvg } from '../src/game/avatar'
import { suspectColor } from '../src/game/palette'
import { INK, BRASS, BONE, CRIMSON } from './portrait'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = resolve(root, 'assets')
mkdirSync(assetsDir, { recursive: true })

// 1) Store icon 512×512 — downscale the finished 1024 launcher icon (DRY).
await sharp(resolve(assetsDir, 'icon-only.png'))
  .resize(512, 512)
  .png()
  .toFile(resolve(assetsDir, 'store-icon-512.png'))
console.log('wrote assets/store-icon-512.png')

// 2) Feature graphic 1024×500 (one per language).

const W = 1024
const H = 500
const SCALE = 2 // draw at 2×, downsample once — keeps the serifs crisp

const PAPER = '#f2ead9'
const INK_TEXT = '#241f2b'
const BRASS_DARK = '#b98a3e'
const CHIP_EASY = '#4e7d5b'

const fontFile = (pkg: string, file: string) => resolve(root, 'node_modules', pkg, 'files', file)
GlobalFonts.registerFromPath(fontFile('@fontsource/fraunces', 'fraunces-latin-900-normal.woff2'), 'Fraunces')
GlobalFonts.registerFromPath(fontFile('@fontsource/fraunces', 'fraunces-latin-900-italic.woff2'), 'Fraunces')
GlobalFonts.registerFromPath(fontFile('@fontsource/special-elite', 'special-elite-latin-400-normal.woff2'), 'Special Elite')

/** A screenshot region, measured on a reference size so the source can change resolution. */
interface BoardCrop {
  file: string
  basis: readonly [number, number]
  rect: readonly [number, number, number, number]
}
const POOL: BoardCrop = { file: 'murdoku_level_9x9.jpg', basis: [827, 815], rect: [36, 26, 788, 786] }
const FARM: BoardCrop = { file: 'murdoku_level_4x4.jpg', basis: [826, 813], rect: [40, 28, 772, 774] }
/** Hotel restaurant corner, top-cropped to cover the community card's 190×96 window. */
const HOTEL: BoardCrop = { file: 'murdoku_ingame.jpg', basis: [1915, 903], rect: [714, 86, 348, 176] }

interface FeatureTexts {
  pre: string
  tagFirst: string
  tagRest: string
  sub: readonly [string, string, string]
  poolTitle: string
  poolChip: string
  farmChip: string
  leafHd: string
  leafDay: string
  leafMon: string
  leafStreak: string
  ulMeta: string
}
const TEXTS: Record<'de' | 'en', FeatureTexts> = {
  de: {
    pre: 'EIN LOGIK-KRIMI',
    tagFirst: 'M',
    tagRest: 'örderjagd trifft Sudoku',
    sub: ['140+ Fälle · 4×4 bis 12×12', 'Jeden Tag ein neuer Fall', 'Editor · Generator · Community'],
    poolTitle: 'DAS FREIBAD',
    poolChip: '9×9 · SCHWER',
    farmChip: '4×4 · LEICHT',
    leafHd: 'RÄTSEL DES TAGES',
    leafDay: '13.',
    leafMon: 'AUGUST',
    leafStreak: 'Serie: 6 Tage',
    ulMeta: '4,8 (21) · von Mira',
  },
  en: {
    pre: 'A LOGIC WHODUNIT',
    tagFirst: 'M',
    tagRest: 'anhunt meets Sudoku',
    sub: ['140+ cases · 4×4 up to 12×12', 'A new case every day', 'Editor · Generator · Community'],
    poolTitle: 'THE LIDO',
    poolChip: '9×9 · HARD',
    farmChip: '4×4 · EASY',
    leafHd: 'DAILY MYSTERY',
    leafDay: '13',
    leafMon: 'AUGUST',
    leafStreak: 'Streak: 6 days',
    ulMeta: '4.8 (21) · by Mira',
  },
}

// ---------------------------------------------------------------- helpers

/** Letter-spaced text (canvas has no reliable letterSpacing across renderers). */
function spacedWidth(ctx: SKRSContext2D, text: string, ls: number): number {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + ls
  return w - ls
}
function fillSpaced(ctx: SKRSContext2D, text: string, x: number, y: number, ls: number): void {
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + ls
  }
}

/** Draw with the same semantics as CSS: top-left position, rotation around the centre. */
function rotated(ctx: SKRSContext2D, left: number, top: number, w: number, h: number, deg: number, draw: () => void): void {
  ctx.save()
  ctx.translate(left + w / 2, top + h / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.translate(-w / 2, -h / 2)
  draw()
  ctx.restore()
}

/** The white polaroid/leaf base card with its drop shadow, drawn at local (0,0). */
function paperCard(ctx: SKRSContext2D, w: number, h: number, r: number): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 34
  ctx.shadowOffsetY = 14
  ctx.fillStyle = PAPER
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, r)
  ctx.fill()
  ctx.restore()
}

function drawCrop(ctx: SKRSContext2D, img: Image, c: BoardCrop, dx: number, dy: number, dw: number, dh: number): void {
  const kx = img.width / c.basis[0]
  const ky = img.height / c.basis[1]
  ctx.drawImage(img, c.rect[0] * kx, c.rect[1] * ky, c.rect[2] * kx, c.rect[3] * ky, dx, dy, dw, dh)
}

const CHIP_LS = 1.32
function chipWidth(ctx: SKRSContext2D, text: string): number {
  ctx.font = '11px "Special Elite"'
  return spacedWidth(ctx, text, CHIP_LS) + 18
}
function drawChip(ctx: SKRSContext2D, x: number, baseline: number, text: string, color: string): void {
  ctx.font = '11px "Special Elite"'
  const w = spacedWidth(ctx, text, CHIP_LS) + 18
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x, baseline - 13.5, w, 18, 9)
  ctx.stroke()
  ctx.fillStyle = color
  fillSpaced(ctx, text, x + 9, baseline, CHIP_LS)
}

function star(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  const rIn = r * 0.46
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : rIn
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + rad * Math.cos(a)
    const y = cy + rad * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
}

// ---------------------------------------------------------------- elements

/** Tilted evidence polaroid: board photo + caption line (optional title + difficulty chip). */
function evidencePolaroid(
  ctx: SKRSContext2D,
  img: Image,
  crop: BoardCrop,
  opts: { left: number; top: number; width: number; rot: number; title?: string; chip: string; chipColor: string },
): void {
  const imgW = opts.width - 22
  const imgH = (imgW * crop.rect[3]) / crop.rect[2]
  const capH = opts.title ? 36 : 34
  const h = 11 + imgH + capH
  rotated(ctx, opts.left, opts.top, opts.width, h, opts.rot, () => {
    paperCard(ctx, opts.width, h, 3)
    drawCrop(ctx, img, crop, 11, 11, imgW, imgH)
    const baseline = 11 + imgH + capH / 2 + 4.5
    const chipW = chipWidth(ctx, opts.chip)
    let x: number
    if (opts.title) {
      ctx.font = '12.5px "Special Elite"'
      const titleW = spacedWidth(ctx, opts.title, 0.75)
      x = (opts.width - (titleW + 8 + chipW)) / 2
      ctx.fillStyle = INK_TEXT
      fillSpaced(ctx, opts.title, x, baseline, 0.75)
      x += titleW + 8
    } else {
      x = (opts.width - chipW) / 2
    }
    drawChip(ctx, x, baseline, opts.chip, opts.chipColor)
  })
}

/** The daily-mystery calendar leaf: brass binding, big day number, streak line. */
function dailyLeaf(ctx: SKRSContext2D, left: number, top: number, w: number, rot: number, t: FeatureTexts): void {
  const h = 154
  rotated(ctx, left, top, w, h, rot, () => {
    paperCard(ctx, w, h, 6)
    ctx.fillStyle = BRASS
    ctx.beginPath()
    ctx.roundRect(0, 0, w, 26, 6)
    ctx.fill()
    ctx.fillRect(0, 13, w, 13)
    ctx.fillStyle = INK.c1
    for (const hx of [39.5, w - 39.5]) {
      ctx.beginPath()
      ctx.arc(hx, 13, 5.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = INK_TEXT
    ctx.font = '10.5px "Special Elite"'
    fillSpaced(ctx, t.leafHd, (w - spacedWidth(ctx, t.leafHd, 2.1)) / 2, 45, 2.1)
    ctx.font = '900 58px Fraunces'
    ctx.fillText(t.leafDay, (w - ctx.measureText(t.leafDay).width) / 2, 97)
    ctx.font = '12px "Special Elite"'
    fillSpaced(ctx, t.leafMon, (w - spacedWidth(ctx, t.leafMon, 1.68)) / 2, 116, 1.68)
    ctx.strokeStyle = 'rgba(36,31,43,0.3)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(10, 127)
    ctx.lineTo(w - 10, 127)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = '11px "Special Elite"'
    const textW = ctx.measureText(t.leafStreak).width
    const sx = (w - (14 + textW)) / 2
    ctx.strokeStyle = CRIMSON
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(sx, 140)
    ctx.lineTo(sx + 3.2, 143.5)
    ctx.lineTo(sx + 9, 135.5)
    ctx.stroke()
    ctx.fillStyle = INK_TEXT
    ctx.fillText(t.leafStreak, sx + 14, 144)
  })
}

/** Community-level card: board snippet + star rating row. */
function communityCard(ctx: SKRSContext2D, img: Image, left: number, top: number, w: number, rot: number, meta: string): void {
  const h = 139
  rotated(ctx, left, top, w, h, rot, () => {
    paperCard(ctx, w, h, 3)
    drawCrop(ctx, img, HOTEL, 11, 11, w - 22, 96)
    ctx.font = '12px "Special Elite"'
    const starsW = 5 * 14
    const textW = ctx.measureText(meta).width
    let x = (w - (starsW + 7 + textW)) / 2
    ctx.fillStyle = BRASS_DARK
    for (let i = 0; i < 5; i++) star(ctx, x + 7 + i * 14, 122, 6.5)
    x += starsW + 7
    ctx.fillStyle = INK_TEXT
    ctx.fillText(meta, x, 126)
  })
}

function tapeStrip(ctx: SKRSContext2D, left: number, top: number, w: number, h: number, deg: number): void {
  rotated(ctx, left, top, w, h, deg, () => {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.25)'
    ctx.shadowBlur = 5
    ctx.shadowOffsetY = 2
    ctx.fillStyle = 'rgba(236,230,218,0.5)'
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  })
}

/** The red case thread with brass pins (drawn beneath the cards, like on the mockup). */
function caseThread(ctx: SKRSContext2D): void {
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = CRIMSON
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(432, 64)
  ctx.bezierCurveTo(540, 30, 640, 40, 706, 60)
  ctx.bezierCurveTo(800, 88, 850, 60, 872, 92)
  ctx.bezierCurveTo(900, 140, 830, 220, 776, 288)
  ctx.bezierCurveTo(740, 340, 706, 352, 664, 366)
  ctx.stroke()
  ctx.restore()
  for (const [px, py] of [[432, 64], [706, 60], [872, 92], [664, 366]]) {
    ctx.fillStyle = BRASS
    ctx.strokeStyle = '#8a6428'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(px, py, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

/** MURDOKU with the crimson italic O, exactly like the app's start screen. */
function wordmark(ctx: SKRSContext2D, x: number, baseline: number, px: number): void {
  const upright = `900 ${px}px Fraunces`
  ctx.font = upright
  ctx.fillStyle = BONE
  const wMurd = ctx.measureText('MURD').width
  ctx.fillText('MURD', x, baseline)
  ctx.font = `italic 900 ${px}px Fraunces`
  ctx.fillStyle = CRIMSON
  const wO = ctx.measureText('O').width
  ctx.fillText('O', x + wMurd, baseline)
  ctx.font = upright
  ctx.fillStyle = BONE
  ctx.fillText('KU', x + wMurd + wO, baseline)
}

// ---------------------------------------------------------------- assembly

const screenshot = (c: BoardCrop) => loadImage(resolve(root, 'screenshots', c.file))
const [poolImg, farmImg, hotelImg] = await Promise.all([screenshot(POOL), screenshot(FARM), screenshot(HOTEL)])

/** Suspect coin from the real avatar renderer, rasterized at device resolution. */
async function suspectCoin(attrs: Parameters<typeof avatarSvg>[0], colorIdx: number, letter: string, size: number): Promise<Image> {
  const dev = size * SCALE
  const png = await sharp(Buffer.from(avatarSvg(attrs, suspectColor(colorIdx), letter)), { density: (72 * dev) / 100 })
    .resize(dev, dev)
    .png()
    .toBuffer()
  return loadImage(png)
}
const coinC = await suspectCoin({ gender: 'm', hair: 'brown', hairstyle: 'slick', beard: true }, 2, 'C', 72)
const coinA = await suspectCoin({ gender: 'f', hair: 'black', hairstyle: 'bob' }, 0, 'A', 60)

const noiseImg = await sharp({
  create: { width: 512, height: 512, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 26 } },
})
  .png()
  .toBuffer()
  .then(loadImage)

async function feature(lang: 'de' | 'en'): Promise<void> {
  const t = TEXTS[lang]
  const canvas = createCanvas(W * SCALE, H * SCALE)
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Ink backdrop: elliptic radial gradient like the app (ellipse 90%/110% at 70%/42%).
  const ky = 550 / 922
  ctx.save()
  ctx.scale(1, ky)
  const bg = ctx.createRadialGradient(716, 210 / ky, 0, 716, 210 / ky, 922)
  bg.addColorStop(0, INK.c0)
  bg.addColorStop(0.58, INK.c1)
  bg.addColorStop(1, INK.c2)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H / ky)
  ctx.restore()

  caseThread(ctx)
  evidencePolaroid(ctx, poolImg, POOL, { left: 402, top: 40, width: 272, rot: -4.5, title: t.poolTitle, chip: t.poolChip, chipColor: CRIMSON })
  evidencePolaroid(ctx, farmImg, FARM, { left: 652, top: 26, width: 174, rot: 6, chip: t.farmChip, chipColor: CHIP_EASY })
  dailyLeaf(ctx, 848, 118, 152, -2, t)
  communityCard(ctx, hotelImg, 560, 336, 212, 2.5, t.ulMeta)
  tapeStrip(ctx, 622, 326, 74, 22, 3)

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 8
  rotated(ctx, 800, 344, 72, 72, 5, () => ctx.drawImage(coinC, 0, 0, 72, 72))
  rotated(ctx, 892, 384, 60, 60, -6, () => ctx.drawImage(coinA, 0, 0, 60, 60))
  ctx.restore()

  // Left stage: eyebrow, wordmark, tagline (crimson initial), three-line subline.
  ctx.fillStyle = BRASS
  ctx.font = '12px "Special Elite"'
  fillSpaced(ctx, t.pre, 56, 132, 5.04)
  wordmark(ctx, 56, 190, 54)
  ctx.font = '21px "Special Elite"'
  ctx.fillStyle = CRIMSON
  ctx.fillText(t.tagFirst, 58, 233)
  ctx.fillStyle = BONE
  ctx.fillText(t.tagRest, 58 + ctx.measureText(t.tagFirst).width, 233)
  ctx.fillStyle = BRASS
  ctx.font = '15px "Special Elite"'
  t.sub.forEach((line, i) => ctx.fillText(line, 58, 272 + i * 25.5))

  // Film grain over everything.
  ctx.globalAlpha = 0.055
  for (let gx = 0; gx < W; gx += 256)
    for (let gy = 0; gy < H; gy += 256) ctx.drawImage(noiseImg, 0, 0, 512, 512, gx, gy, 256, 256)
  ctx.globalAlpha = 1

  const file = `feature-graphic-${lang}.png`
  await sharp(canvas.toBuffer('image/png')).resize(W, H).png().toFile(resolve(assetsDir, file))
  console.log('wrote assets/' + file)
}

await feature('de')
await feature('en')
