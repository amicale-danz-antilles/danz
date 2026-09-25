import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
const fallback = 'Publications, rendez-vous, recensements et vie de votre foyer.'
export default function SiteHomeSubtitle() {
  const [subtitle, setSubtitle] = useState(fallback)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      const { data, error } = await supabase.from('site_preferences').select('home_subtitle').eq('id', 1).maybeSingle()
      if (active && !error && data?.home_subtitle) setSubtitle(data.home_subtitle)
    }
    refresh().catch(() => {})
    window.addEventListener('danz-assistant-change', refresh)
    return () => { active = false; window.removeEventListener('danz-assistant-change', refresh) }
  }, [])
  return <p>{subtitle}</p>
}
