import sharp from 'sharp'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'

const publicDir = path.resolve('public')
const source = path.join(publicDir, 'image001-1.png')

try {
  await access(source)
} catch {
  throw new Error('Source du logo officiel introuvable : public/image001-1.png')
}

await mkdir(publicDir, { recursive: true })

const white = { r: 255, g: 255, b: 255, alpha: 1 }

async function cropOuterNeutralBackground(input) {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  const isOuterBackground = (r, g, b, a) => {
    if (a < 20) return true
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return min > 218 && max - min < 18
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      if (isOuterBackground(data[i], data[i + 1], data[i + 2], data[i + 3])) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) return sharp(input).rotate().png().toBuffer()

  const margin = 8
  const left = Math.max(0, minX - margin)
  const top = Math.max(0, minY - margin)
  const right = Math.min(width - 1, maxX + margin)
  const bottom = Math.min(height - 1, maxY + margin)

  return sharp(data, { raw: info })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer()
}

const cleanedSource = await cropOuterNeutralBackground(source)

async function makeIcon(size, filename, paddingRatio) {
  const inner = Math.round(size * (1 - paddingRatio * 2))
  const mark = await sharp(cleanedSource)
    .resize({ width: inner, height: inner, fit: 'contain', withoutEnlargement: false })
    .png()
    .toBuffer()

  const metadata = await sharp(mark).metadata()
  const left = Math.round((size - (metadata.width || inner)) / 2)
  const top = Math.round((size - (metadata.height || inner)) / 2)

  await sharp({ create: { width: size, height: size, channels: 4, background: white } })
    .composite([{ input: mark, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, filename))
}

await Promise.all([
  makeIcon(64, 'favicon-v8.png', 0.04),
  makeIcon(180, 'apple-touch-icon-v8.png', 0.07),
  makeIcon(192, 'icon-192-v8.png', 0.07),
  makeIcon(512, 'icon-512-v8.png', 0.07),
  makeIcon(192, 'icon-maskable-192-v8.png', 0.18),
  makeIcon(512, 'icon-maskable-512-v8.png', 0.18),
])

console.log('Icônes PWA V8 générées depuis public/image001-1.png, nouveau logo officiel de l’Amicale DANZ Antilles.')
