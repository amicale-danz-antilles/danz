import sharp from 'sharp'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'

const publicDir = path.resolve('public')
const source = path.join(publicDir, 'amicale-danz-icon.png')

try {
  await access(source)
} catch {
  throw new Error('Source d’icône introuvable : public/amicale-danz-icon.png')
}

await mkdir(publicDir, { recursive: true })

const background = { r: 247, g: 250, b: 251, alpha: 1 }
const white = { r: 255, g: 255, b: 255, alpha: 1 }

async function trimOuterWhitespace(input) {
  return sharp(input)
    .rotate()
    .flatten({ background: white })
    .trim({ background: white, threshold: 18 })
    .ensureAlpha()
    .png()
    .toBuffer()
}

async function removeSideBars(input) {
  const firstTrim = await trimOuterWhitespace(input)
  const { data, info } = await sharp(firstTrim).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info

  const darkColumn = (x) => {
    let dark = 0
    let visible = 0
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      if (a < 20) continue
      visible += 1
      if (r < 42 && g < 42 && b < 42) dark += 1
    }
    return visible > 0 && dark / visible > 0.58
  }

  let left = 0
  let right = width - 1
  while (left < right && darkColumn(left)) left += 1
  while (right > left && darkColumn(right)) right -= 1

  const cropWidth = Math.max(1, right - left + 1)
  const withoutBars = await sharp(data, { raw: info })
    .extract({ left, top: 0, width: cropWidth, height })
    .png()
    .toBuffer()

  // Une fois les bandes noires retirées, supprimer le blanc qui les séparait du blason.
  return trimOuterWhitespace(withoutBars)
}

const cleanedSource = await removeSideBars(source)

async function makeIcon(size, filename, paddingRatio) {
  const inner = Math.round(size * (1 - paddingRatio * 2))
  const mark = await sharp(cleanedSource)
    .resize({ width: inner, height: inner, fit: 'contain', withoutEnlargement: false })
    .png()
    .toBuffer()

  const metadata = await sharp(mark).metadata()
  const left = Math.round((size - (metadata.width || inner)) / 2)
  const top = Math.round((size - (metadata.height || inner)) / 2)

  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, filename))
}

await Promise.all([
  makeIcon(64, 'favicon-v6.png', 0.04),
  makeIcon(180, 'apple-touch-icon-v6.png', 0.08),
  makeIcon(192, 'icon-192-v6.png', 0.08),
  makeIcon(512, 'icon-512-v6.png', 0.08),
  makeIcon(192, 'icon-maskable-192-v6.png', 0.18),
  makeIcon(512, 'icon-maskable-512-v6.png', 0.18),
])

console.log('Icônes PWA V6 générées depuis public/amicale-danz-icon.png après suppression du blanc extérieur et des bandes noires latérales.')
