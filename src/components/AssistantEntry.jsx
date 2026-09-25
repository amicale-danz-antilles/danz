import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import useOnlineStatus from '../hooks/useOnlineStatus.js'
import DanzAssistant from './DanzAssistant.jsx'
export default function AssistantEntry() {
  const { user, isTreasurer } = useAuth()
  const online = useOnlineStatus()
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    if (!user?.id || !isTreasurer) { setAllowed(false); return }
    let active = true
    supabase.rpc('danz_assistant_access').then(({ data, error }) => {
      if (active) setAllowed(!error && data === true)
    }).catch(() => { if (active) setAllowed(false) })
    return () => { active = false }
  }, [user?.id, isTreasurer])
  useEffect(() => {
    if (!user?.id) return
    let active = true
    const refresh = async () => {
      const { data, error } = await supabase.from('site_preferences').select('accent_color').eq('id', 1).maybeSingle()
      if (active && !error && /^#[0-9a-fA-F]{6}$/.test(data?.accent_color || ''))
        document.documentElement.style.setProperty('--sea', data.accent_color)
    }
    refresh().catch(() => {})
    window.addEventListener('danz-assistant-change', refresh)
    return () => { active = false; window.removeEventListener('danz-assistant-change', refresh) }
  }, [user?.id])
  return allowed && online ? <DanzAssistant /> : null
}
