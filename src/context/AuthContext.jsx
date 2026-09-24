import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'
import { clearOfflineData, readOfflineData, saveOfflineData } from '../lib/offlineCache.js'

const AuthContext = createContext(null)
const PROFILE_FIELDS = '*'
const PROFILE_TIMEOUT_MS = 9000

const withTimeout = (promise, timeoutMs = PROFILE_TIMEOUT_MS) => Promise.race([
  promise,
  new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), timeoutMs)),
])

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profileUserId, setProfileUserId] = useState(null)
  const [profileRevision, setProfileRevision] = useState(0)

  useEffect(() => {
    if (!supabase) { setSessionReady(true); return undefined }
    let mounted = true

    withTimeout(supabase.auth.getSession()).then(({ data, error }) => {
      if (!mounted) return
      if (!error) setSession(data.session)
      setSessionReady(true)
    }).catch(() => {
      if (!mounted) return
      setSessionReady(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setSessionReady(true)
      if (!nextSession?.user) {
        setProfile(null)
        setProfileUserId(null)
        return
      }
      setProfileUserId((current) => current === nextSession.user.id ? current : null)
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') setProfileRevision((value) => value + 1)
    })

    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase || !sessionReady) return undefined
    let cancelled = false

    const loadProfile = async () => {
      const currentUserId = session?.user?.id || null
      if (!currentUserId) {
        setProfile(null)
        setProfileUserId(null)
        return
      }

      const cached = readOfflineData(currentUserId, 'profile')
      if (!navigator.onLine && cached?.active) {
        setProfile(cached)
        setProfileUserId(currentUserId)
        return
      }

      try {
        const { data, error } = await withTimeout(supabase.from('profiles').select(PROFILE_FIELDS).eq('id', currentUserId).maybeSingle())
        if (cancelled) return
        if (error) throw error

        if (!data?.active) {
          clearOfflineData(currentUserId)
          setProfile(null)
          setProfileUserId(currentUserId)
          await supabase.auth.signOut({ scope: 'local' })
          return
        }

        setProfile(data)
        setProfileUserId(currentUserId)
        saveOfflineData(currentUserId, 'profile', data)
      } catch (_) {
        if (cancelled) return
        if (cached?.active) setProfile(cached)
        setProfileUserId(currentUserId)
      }
    }

    loadProfile()
    return () => { cancelled = true }
  }, [session?.user?.id, sessionReady, profileRevision])

  useEffect(() => {
    if (!supabase) return undefined
    let refreshing = false
    const refreshOnResume = async () => {
      if (refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 6000)
        if (data?.session) {
          setSession(data.session)
          setProfileUserId((current) => current === data.session.user.id ? current : null)
          setProfileRevision((value) => value + 1)
        }
      } catch (_) {
        // Le profil mis en cache reste utilisable si le réseau tarde à revenir.
      } finally {
        refreshing = false
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshOnResume() }
    window.addEventListener('pageshow', refreshOnResume)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pageshow', refreshOnResume)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const loading = !sessionReady || Boolean(session?.user?.id && profileUserId !== session.user.id)

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: profile?.role === 'admin' && profile?.active === true,
    isTreasurer: profile?.role === 'admin' && profile?.active === true && profile?.is_treasurer === true,
    hasAccess: profile?.active === true,
    loading,
    configured: isSupabaseConfigured,
    refreshProfile: () => setProfileRevision((value) => value + 1),
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
      setProfileUserId(data.user.id)
      setSession(data.session)
    },
    requestMembership: async ({ firstName, lastName, applicantType, email, password }) => {
      if (!supabase) throw new Error('Supabase n’est pas encore configuré.')
      const normalizedEmail = email.trim().toLowerCase()
      const normalizedFirstName = firstName.trim()
      const normalizedLastName = lastName.trim()
      const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim()
      const broadApplicantType = applicantType === 'spouse' ? 'spouse' : 'military'
      const militaryReference = applicantType === 'military_other' ? 'other' : 'danz'

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: fullName,
            first_name: normalizedFirstName,
            last_name: normalizedLastName,
            applicant_type: broadApplicantType,
            military_reference: militaryReference,
            situation_label: applicantType,
            membership_request: true,
          },
        },
      })
      if (signUpError) {
        if (/database error/i.test(signUpError.message || '')) throw new Error('Impossible de créer cette demande pour le moment. Vérifiez que cette adresse n’a pas déjà une demande en attente, puis réessayez.')
        throw signUpError
      }
      if (!signUpData?.user?.id || signUpData.user.identities?.length === 0) {
        throw new Error('Un compte existe déjà pour cette adresse e-mail. Essayez de vous connecter ou contactez un administrateur.')
      }

      if (signUpData.session) await supabase.auth.signOut({ scope: 'local' })
      return { ok: true }
    },
    signOut: async () => {
      if (session?.user?.id) clearOfflineData(session.user.id)
      setProfile(null)
      setProfileUserId(null)
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
