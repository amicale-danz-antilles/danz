import { createClient } from '@supabase/supabase-js'

const directSupabaseUrl = import.meta.env.VITE_SUPABASE_URL
const proxySupabaseUrl = import.meta.env.VITE_SUPABASE_PROXY_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// En environnement filtré, le navigateur peut joindre un relais HTTPS Cloudflare
// qui transmet ensuite les requêtes vers le projet Supabase. Aucun secret serveur
// n'est placé dans le navigateur : la clé utilisée ici reste la clé publishable.
export const supabaseUrl = proxySupabaseUrl || directSupabaseUrl
export const isUsingSupabaseProxy = Boolean(proxySupabaseUrl)
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
