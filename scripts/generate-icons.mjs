import sharp from 'sharp'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'

const publicDir = path.resolve('public')
const sourceCandidates = [
  path.join(publicDir, 'Insigne CND - ANTILLES.png'),
  path.join(publicDir, 'app-icon.png'),
]

let source = null
for (const candidate of sourceCandidates) {
  try { await access(candidate); source = candidate; break } catch {}
}
if (!source) throw new Error('Source d’icône introuvable dans public/.')
await mkdir(publicDir, { recursive: true })

const background = { r: 247, g: 250, b: 251, alpha: 1 }

async function removeSideBars(input) {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const darkColumn = (x) => {
    let dark = 0
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * channels
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a < 16 || (r < 28 && g < 28 && b < 28)) dark += 1
    }
    return dark / height > 0.92
  }

  let left = 0
  let right = width - 1
  while (left < right && darkColumn(left)) left += 1
  while (right > left && darkColumn(right)) right -= 1

  // Petite marge de sécurité pour ne pas coller le dessin au bord du recadrage.
  left = Math.max(0, left - 2)
  right = Math.min(width - 1, right + 2)
  const cropWidth = Math.max(1, right - left + 1)

  return sharp(data, { raw: info })
    .extract({ left, top: 0, width: cropWidth, height })
    .png()
    .toBuffer()
}

const cleanedSource = await removeSideBars(source)

async function makeIcon(size, filename, paddingRatio = 0.10) {
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
  makeIcon(180, 'apple-touch-icon-v4.png'),
  makeIcon(192, 'icon-192-v4.png'),
  makeIcon(512, 'icon-512-v4.png'),
])

console.log('Icônes PWA V4 générées après suppression explicite des bandes noires latérales.')
