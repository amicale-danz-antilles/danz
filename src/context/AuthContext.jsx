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

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (!error) setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase) return

    let cancelled = false

    const loadProfile = async () => {
      if (!session?.user) {
        setProfile(null)
        return
      }

      setLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, active, access_type, applicant_type, is_amicaliste')
        .eq('id', session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (error || !data?.active) {
        setProfile(null)
        setLoading(false)
        await supabase.auth.signOut({ scope: 'local' })
        return
      }

      setProfile(data)
      setLoading(false)
    }

    loadProfile()
    return () => { cancelled = true }
  }, [session?.user?.id])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: profile?.role === 'admin' && profile?.access_type === 'admin' && profile?.active === true,
    hasAccess: profile?.active === true,
    loading,
    configured: isSupabaseConfigured,
    requestMemberLogin: async (email, accessType) => {
      if (!supabase) throw new Error('Supabase n’est pas encore configuré.')
      const { data, error } = await supabase.functions.invoke('send-member-login-link', {
        body: { email: email.trim().toLowerCase(), accessType },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
    },
    signInAdmin: async (email, password) => {
      if (!supabase) throw new Error('Supabase n’est pas encore configuré.')
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (error) throw error

      const { data: adminProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, active, access_type, applicant_type, is_amicaliste')
        .eq('id', data.user.id)
        .single()

      if (profileError || adminProfile?.role !== 'admin' || adminProfile?.access_type !== 'admin' || adminProfile?.active !== true) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('Cet accès est réservé aux administrateurs validés.')
      }

      setProfile(adminProfile)
      setSession(data.session)
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
