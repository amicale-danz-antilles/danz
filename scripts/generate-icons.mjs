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

async function removeSideBars(input) {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info

  const removableColumn = (x) => {
    let removable = 0
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      if (a < 20 || (r < 30 && g < 30 && b < 30)) removable += 1
    }
    return removable / height > 0.92
  }

  let left = 0
  let right = width - 1
  while (left < right && removableColumn(left)) left += 1
  while (right > left && removableColumn(right)) right -= 1

  const cropWidth = Math.max(1, right - left + 1)
  return sharp(data, { raw: info })
    .extract({ left, top: 0, width: cropWidth, height })
    .png()
    .toBuffer()
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
  makeIcon(64, 'favicon-v5.png', 0.04),
  makeIcon(180, 'apple-touch-icon-v5.png', 0.08),
  makeIcon(192, 'icon-192-v5.png', 0.08),
  makeIcon(512, 'icon-512-v5.png', 0.08),
  makeIcon(192, 'icon-maskable-192-v5.png', 0.18),
  makeIcon(512, 'icon-maskable-512-v5.png', 0.18),
])

console.log('Icônes PWA V5 générées depuis public/amicale-danz-icon.png, sans bandes latérales et avec variantes maskable.')
