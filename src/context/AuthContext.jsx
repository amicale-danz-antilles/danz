import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return undefined
    }

    let mounted = true

    const loadProfile = async (nextSession) => {
      if (!nextSession?.user) {
        if (mounted) setProfile(null)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', nextSession.user.id)
        .maybeSingle()
      if (mounted) setProfile(data ?? null)
    }

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return
      if (!error) {
        setSession(data.session)
        await loadProfile(data.session)
      }
      if (mounted) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      await loadProfile(nextSession)
      if (mounted) setLoading(false)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: profile?.role === 'admin',
    loading,
    configured: isSupabaseConfigured,
    signIn: async (email, password) => {
      if (!supabase) throw new Error('Supabase n’est pas encore configuré.')
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut()
    },
  }), [session, profile, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return context
}
