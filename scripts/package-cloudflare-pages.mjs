// Preserve the existing /danz/ public URLs on the parallel Pages host.
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
const root=process.cwd(), source=path.join(root,'dist'), target=path.join(root,'cloudflare-dist'), tmp=path.join(root,'cloudflare-dist.tmp')
if(!(await lstat(source)).isDirectory()||(await lstat(source)).isSymbolicLink())throw new Error('Build dist invalide')
for(const folder of [target,tmp]){
 const info=await lstat(folder).catch(e=>{if(e.code==='ENOENT')return null;throw e})
 if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw new Error('Dossier de sortie invalide : '+folder)
}
await rm(tmp,{recursive:true,force:true})
await mkdir(tmp)
try{
 await cp(source,path.join(tmp,'danz'),{recursive:true,errorOnExist:true,force:false})
 const html=await readFile(path.join(tmp,'danz','index.html'),'utf8')
 const refs=[...html.matchAll(/(?:src|href)=["']\/danz\/([^"'?]+)[^"']*["']/g)].map(m=>m[1])
 if(!refs.some(p=>p.startsWith('assets/')))throw new Error('Bundle /danz/ absent')
 for(const file of new Set([...refs,'sw.js','manifest.webmanifest'])){
  if(file.split('/').includes('..')||!(await lstat(path.join(tmp,'danz',file))).isFile())throw new Error('Ressource manquante : '+file)
 }
 await writeFile(path.join(tmp,'_redirects'),'/ /danz/ 302\n')
 await writeFile(path.join(tmp,'index.html'),'<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Amicale DANZ Antilles</title></head><body><a href="/danz/">Accéder à l’Amicale DANZ</a></body></html>\n')
 await writeFile(path.join(tmp,'404.html'),'<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page introuvable</title></head><body><a href="/danz/">Retour au site DANZ</a></body></html>\n')
 await writeFile(path.join(tmp,'_headers'),'/danz/\n  Cache-Control: no-cache\n/danz/sw.js\n  Cache-Control: no-cache\n/danz/manifest.webmanifest\n  Cache-Control: no-cache\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n')
 await rm(target,{recursive:true,force:true})
 await rename(tmp,target)
 console.log('Cloudflare Pages : cloudflare-dist/danz/ prêt ; configuration GitHub Pages inchangée.')
}catch(e){await rm(tmp,{recursive:true,force:true});throw e}
