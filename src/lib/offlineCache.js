const PREFIX='danz-offline-v1'
export const OFFLINE_TTL_MS=12*60*60*1000

const storage=()=>{try{return window.localStorage}catch{return null}}
const key=(userId,name)=>`${PREFIX}:${userId}:${name}`

export function saveOfflineData(userId,name,data){
 if(!userId)return
 const store=storage();if(!store)return
 try{store.setItem(key(userId,name),JSON.stringify({savedAt:Date.now(),data}))}catch{}
}

export function readOfflineData(userId,name){
 if(!userId)return null
 const store=storage();if(!store)return null
 try{
  const raw=store.getItem(key(userId,name));if(!raw)return null
  const parsed=JSON.parse(raw)
  if(!parsed?.savedAt||Date.now()-parsed.savedAt>OFFLINE_TTL_MS){store.removeItem(key(userId,name));return null}
  return parsed.data??null
 }catch{return null}
}

export function clearOfflineData(userId){
 const store=storage();if(!store||!userId)return
 try{
  const prefix=`${PREFIX}:${userId}:`
  for(let i=store.length-1;i>=0;i-=1){const k=store.key(i);if(k?.startsWith(prefix))store.removeItem(k)}
 }catch{}
}
