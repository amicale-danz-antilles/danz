const PREFIX='danz-offline-v2'
const LEGACY_PREFIXES=['danz-offline-v1:']
const PRIVATE_MEDIA_CACHE='danz-private-thumbs-v2'

// Les copies textuelles restent disponibles trois semaines. Elles sont remplacées
// dès qu'une synchronisation plus récente réussit et supprimées à la déconnexion.
export const OFFLINE_TTL_MS=21*24*60*60*1000

const storage=()=>{try{return window.localStorage}catch{return null}}
const key=(userId,name)=>`${PREFIX}:${userId}:${name}`

function purgeLegacyOfflineData(){
 const store=storage();if(!store)return
 try{
  for(let i=store.length-1;i>=0;i-=1){
   const k=store.key(i)
   if(k&&LEGACY_PREFIXES.some(prefix=>k.startsWith(prefix)))store.removeItem(k)
  }
 }catch{}
}
purgeLegacyOfflineData()

export function saveOfflineData(userId,name,data){
 if(!userId)return
 const store=storage();if(!store)return
 try{store.setItem(key(userId,name),JSON.stringify({savedAt:Date.now(),data}))}catch{}
}

export function readOfflineEntry(userId,name){
 if(!userId)return null
 const store=storage();if(!store)return null
 try{
  const raw=store.getItem(key(userId,name));if(!raw)return null
  const parsed=JSON.parse(raw)
  if(!parsed?.savedAt||Date.now()-parsed.savedAt>OFFLINE_TTL_MS){store.removeItem(key(userId,name));return null}
  return parsed
 }catch{return null}
}

export function readOfflineData(userId,name){
 return readOfflineEntry(userId,name)?.data??null
}

export function clearOfflineData(userId){
 const store=storage();if(store&&userId){
  try{
   const prefixes=[`${PREFIX}:${userId}:`,...LEGACY_PREFIXES.map(prefix=>`${prefix}${userId}:`)]
   for(let i=store.length-1;i>=0;i-=1){const k=store.key(i);if(k&&prefixes.some(prefix=>k.startsWith(prefix)))store.removeItem(k)}
  }catch{}
 }
 if('caches' in window&&userId){
  caches.open(PRIVATE_MEDIA_CACHE).then(async cache=>{
   const requests=await cache.keys()
   const mediaMarker=`/danz/offline-media/${encodeURIComponent(userId)}/`
   const legacyMarker=`/danz/offline-thumb/${encodeURIComponent(userId)}/`
   await Promise.all(requests.filter(request=>{
    const path=new URL(request.url).pathname
    return path.startsWith(mediaMarker)||path.startsWith(legacyMarker)
   }).map(request=>cache.delete(request)))
  }).catch(()=>{})
 }
}
