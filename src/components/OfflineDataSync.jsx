import { useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { saveOfflineData } from '../lib/offlineCache.js'
import { resolvePrivateMediaBatch } from '../lib/mediaStorage.js'

const THUMB_CACHE='danz-private-thumbs-v2'
const MAX_OFFLINE_THUMB=1.5*1024*1024
const thumbPath=(userId,albumId)=>`/danz/offline-thumb/${encodeURIComponent(userId)}/${encodeURIComponent(albumId)}`

async function cacheThumb(userId,album,url){
  if(!('caches' in window)||!url)return false
  const size=Number(album.file_size||0)
  if(!size||size>MAX_OFFLINE_THUMB)return false
  try{
    const response=await fetch(url,{cache:'no-store'})
    if(!response.ok)return false
    const blob=await response.blob()
    if(blob.size>MAX_OFFLINE_THUMB)return false
    const cache=await caches.open(THUMB_CACHE)
    const headers=new Headers({'Content-Type':blob.type||album.mime_type||'image/jpeg','Cache-Control':'private, max-age=43200'})
    await cache.put(new Request(new URL(thumbPath(userId,album.id),window.location.origin)),new Response(blob,{headers}))
    return true
  }catch{return false}
}

export default function OfflineDataSync({userId}){
  useEffect(()=>{
    if(!userId||!navigator.onLine)return undefined
    let cancelled=false
    const timer=window.setTimeout(async()=>{
      try{
        const [dealsResult,pollsResult,albumsResult,eventsResult]=await Promise.all([
          supabase.from('good_deals').select('id,title,category,description,offer_text,address,municipality,latitude,longitude,map_verified,phone,email,website_url,valid_until,audience,created_at').order('created_at',{ascending:false}),
          supabase.from('polls').select('id,title,description,closes_at,active,created_at').order('created_at',{ascending:false}),
          supabase.from('event_albums').select('id,event_id,storage_provider,storage_path,image_url,mime_type,file_size,transfer_expires_at,item_count,download_note,updated_at').order('updated_at',{ascending:false}),
          supabase.from('events').select('id,title,description,location,starts_at,audience').order('starts_at',{ascending:false}),
        ])
        if(cancelled)return

        const deals=dealsResult.data||[]
        if(!dealsResult.error)saveOfflineData(userId,'good-deals',deals)

        const polls=pollsResult.data||[]
        let pollOptions=[],ownVotes=[]
        if(!pollsResult.error&&polls.length){
          const ids=polls.map(item=>item.id)
          const [optionsResult,votesResult]=await Promise.all([
            supabase.from('poll_options').select('id,poll_id,label,sort_order,vote_count').in('poll_id',ids).order('sort_order'),
            supabase.from('poll_votes').select('poll_id,option_id').eq('user_id',userId),
          ])
          pollOptions=optionsResult.data||[]
          ownVotes=votesResult.data||[]
          if(!optionsResult.error&&!votesResult.error)saveOfflineData(userId,'polls',{polls,options:pollOptions,votes:ownVotes})
        }else if(!pollsResult.error){
          saveOfflineData(userId,'polls',{polls:[],options:[],votes:[]})
        }

        const albums=albumsResult.data||[],events=eventsResult.data||[]
        if(!albumsResult.error&&!eventsResult.error){
          const eventById=new Map(events.map(event=>[event.id,event]))
          const urls=await resolvePrivateMediaBatch(albums,{entity:'album',fallbackBucket:'gallery'})
          const offlineAlbums=[]
          for(const album of albums){
            if(cancelled)return
            const event=eventById.get(album.event_id)
            if(!event)continue
            const sourceUrl=urls.get(album.id)||album.image_url||null
            const hasCachedThumb=await cacheThumb(userId,album,sourceUrl)
            offlineAlbums.push({
              id:album.id,
              event_id:album.event_id,
              item_count:album.item_count,
              transfer_expires_at:album.transfer_expires_at,
              download_note:album.download_note,
              updated_at:album.updated_at,
              event,
              offline_thumb:hasCachedThumb?thumbPath(userId,album.id):null,
            })
          }
          saveOfflineData(userId,'albums',offlineAlbums)
        }

        saveOfflineData(userId,'offline-sync',{
          syncedAt:new Date().toISOString(),
          goodDeals:dealsResult.error?null:deals.length,
          polls:pollsResult.error?null:polls.length,
          albums:albumsResult.error?null:albums.length,
        })
      }catch{}
    },1200)
    return()=>{cancelled=true;window.clearTimeout(timer)}
  },[userId])
  return null
}
