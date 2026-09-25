import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
const dist = path.resolve('dist')
const required = ['index.html','manifest.webmanifest','sw.js','image001-1.png','favicon-v8.png','apple-touch-icon-v8.png','icon-192-v8.png','icon-512-v8.png','icon-maskable-192-v8.png','icon-maskable-512-v8.png']
async function assertFile(relativePath) { const filePath=path.join(dist,relativePath); await access(filePath); const info=await stat(filePath); if(!info.isFile()||info.size===0) throw new Error(`Fichier de production invalide : ${relativePath}`) }
for (const file of required) await assertFile(file)
const [html,manifestText,serviceWorker]=await Promise.all([readFile(path.join(dist,'index.html'),'utf8'),readFile(path.join(dist,'manifest.webmanifest'),'utf8'),readFile(path.join(dist,'sw.js'),'utf8')])
if(!html.includes('Amicale DANZ Antilles'))throw new Error('Le titre de production est absent du HTML.')
if(!html.includes('/danz/favicon-v8.png'))throw new Error('Le favicon officiel n’est pas référencé dans le HTML.')
if(!html.includes('/danz/apple-touch-icon-v8.png'))throw new Error('L’icône iOS officielle n’est pas référencée dans le HTML.')
const manifest=JSON.parse(manifestText)
if(manifest.start_url!=='/danz/#/'||manifest.scope!=='/danz/')throw new Error('Le manifeste PWA ne cible pas le bon périmètre.')
for(const icon of manifest.icons||[]){const pathname=String(icon.src||'').split('?')[0].replace(/^\/danz\//,'');if(!pathname)throw new Error('Une icône PWA n’a pas de chemin valide.');await assertFile(pathname)}
if(!serviceWorker.includes("const CACHE_NAME = 'danz-shell-v33'"))throw new Error('La version attendue du cache PWA v33 est absente.')
if(!serviceWorker.includes('/danz/image001-1.png'))throw new Error('Le logo officiel n’est pas précaché par le service worker.')
const assetRefs=[...html.matchAll(/(?:src|href)=["']\/danz\/assets\/([^"'?]+)[^"']*["']/g)].map(m=>`assets/${m[1]}`)
if(!assetRefs.length)throw new Error('Aucun bundle Vite n’est référencé par le HTML de production.')
for(const asset of new Set(assetRefs))await assertFile(asset)
console.log(`Build de production vérifié : ${required.length} fichiers essentiels + ${new Set(assetRefs).size} bundle(s).`)
