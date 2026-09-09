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
  try {
    await access(candidate)
    source = candidate
    break
  } catch {}
}

if (!source) throw new Error('Source d’icône introuvable dans public/.')
await mkdir(publicDir, { recursive: true })

const background = { r: 247, g: 250, b: 251, alpha: 1 }

// L'image historique contient des marges/bandes sur les côtés. On les retire
// avant tout redimensionnement afin que l'insigne garde sa géométrie réelle.
const cleanedSource = await sharp(source)
  .rotate()
  .trim({ threshold: 14 })
  .png()
  .toBuffer()

async function makeIcon(size, filename, paddingRatio = 0.09) {
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
  makeIcon(180, 'apple-touch-icon-v3.png'),
  makeIcon(192, 'icon-192-v3.png'),
  makeIcon(512, 'icon-512-v3.png'),
])

console.log('Icônes PWA V3 générées après suppression des marges latérales, sans déformation.')
