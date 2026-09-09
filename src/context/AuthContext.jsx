import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'
import { clearOfflineData, readOfflineData, saveOfflineData } from '../lib/offlineCache.js'

const AuthContext = createContext(null)
const PROFILE_FIELDS = 'id, full_name, email, role, active, access_type, applicant_type, is_amicaliste'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) { setLoading(false); return undefined }
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
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false

    const loadProfile = async () => {
      if (!session?.user) { setProfile(null); return }
      setLoading(true)
      const cached = readOfflineData(session.user.id, 'profile')

      if (!navigator.onLine && cached?.active) {
        setProfile(cached)
        setLoading(false)
        return
      }

      const { data, error } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', session.user.id).maybeSingle()
      if (cancelled) return

      if (error) {
        if (cached?.active) setProfile(cached)
        else setProfile(null)
        setLoading(false)
        return
      }

      if (!data?.active) {
        clearOfflineData(session.user.id)
        setProfile(null)
        setLoading(false)
        await supabase.auth.signOut({ scope: 'local' })
        return
      }

      setProfile(data)
      saveOfflineData(session.user.id, 'profile', data)
      setLoading(false)
    }

    loadProfile()
    return () => { cancelled = true }
  }, [session?.user?.id])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: profile?.role === 'admin' && profile?.active === true,
    hasAccess: profile?.active === true,
    loading,
    configured: isSupabaseConfigured,
    signIn: async (email, password) => {
      if (!supabase) throw new Error('Supabase n’est pas encore configuré.')
      const normalizedEmail = email.trim().toLowerCase()
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
      if (error) throw error

      const { data: accountProfile, error: profileError } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', data.user.id).maybeSingle()
      if (profileError || !accountProfile) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('Votre profil utilisateur est introuvable. Contactez un administrateur.')
      }
      if (accountProfile.active !== true) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('Votre compte existe mais n’a pas encore été approuvé par un administrateur.')
      }

      saveOfflineData(data.user.id, 'profile', accountProfile)
      setProfile(accountProfile)
      setSession(data.session)
    },
    requestMembership: async ({ firstName, lastName, applicantType, email, password }) => {
      if (!supabase) throw new Error('Supabase n’est pas encore configuré.')
      const normalizedEmail = email.trim().toLowerCase()
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { full_name: fullName } },
      })
      if (signUpError) throw signUpError
      if (!signUpData?.user?.id || signUpData.user.identities?.length === 0) {
        throw new Error('Un compte existe déjà pour cette adresse e-mail. Essayez de vous connecter ou contactez un administrateur.')
      }

      const { error: requestError } = await supabase.from('membership_requests').insert({
        auth_user_id: signUpData.user.id,
        full_name: fullName,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        applicant_type: applicantType === 'spouse' ? 'spouse' : 'military',
        is_amicaliste: false,
        requested_access: 'member',
        email: normalizedEmail,
        status: 'pending',
      })

      if (signUpData.session) await supabase.auth.signOut({ scope: 'local' })
      if (requestError) {
        if (requestError.code === '23505') throw new Error('Une demande est déjà en attente pour cette adresse e-mail.')
        throw requestError
      }
      return { ok: true }
    },
    signOut: async () => {
      if (session?.user?.id) clearOfflineData(session.user.id)
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
