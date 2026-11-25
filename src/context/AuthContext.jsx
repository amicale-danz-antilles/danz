import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'
import { clearOfflineData, readOfflineData, saveOfflineData } from '../lib/offlineCache.js'
import { clearPrivateMediaUrlCache } from '../lib/mediaStorage.js'
import useOnlineStatus from '../hooks/useOnlineStatus.js'

const AuthContext = createContext(null)
const PROFILE_FIELDS = '*'
const PROFILE_TIMEOUT_MS = 9000

const withTimeout = (promise, timeoutMs = PROFILE_TIMEOUT_MS) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs) }),
  ]).finally(() => window.clearTimeout(timer))
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profileUserId, setProfileUserId] = useState(null)
  const [profileRevision, setProfileRevision] = useState(0)
  const [verifiedProfileUserId, setVerifiedProfileUserId] = useState(null)
  const online = useOnlineStatus()
  const sessionUserId = useRef(null)
  const sessionRevision = useRef(0)
  const identityRevision = useRef(0)

  const applySession = useCallback((nextSession) => {
    const nextUserId = nextSession?.user?.id || null
    const previousUserId = sessionUserId.current
    if (previousUserId !== nextUserId) {
      identityRevision.current += 1
      clearPrivateMediaUrlCache()
      if (previousUserId && !nextUserId) clearOfflineData(previousUserId)
      setProfile(null)
      setProfileUserId(null)
      setVerifiedProfileUserId(null)
    }
    sessionUserId.current = nextUserId
    sessionRevision.current += 1
    setSession(nextSession)
    setSessionReady(true)
  }, [])

  useEffect(() => {
    if (!supabase) { setSessionReady(true); return undefined }
    let mounted = true

    const initialRevision = sessionRevision.current
    withTimeout(supabase.auth.getSession()).then(({ data, error }) => {
      if (!mounted) return
      if (!error && sessionRevision.current === initialRevision) applySession(data.session)
      setSessionReady(true)
    }).catch(() => {
      if (!mounted) return
      setSessionReady(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return
      applySession(nextSession)
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') setProfileRevision((value) => value + 1)
    })

    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [applySession])

  useEffect(() => {
    if (!supabase || !sessionReady) return undefined
    let cancelled = false

    const loadProfile = async () => {
      const currentUserId = session?.user?.id || null
      if (!currentUserId) {
        setProfile(null)
        setProfileUserId(null)
        setVerifiedProfileUserId(null)
        return
      }

      const requestIdentity = identityRevision.current
      const isCurrent = () => !cancelled && sessionUserId.current === currentUserId && identityRevision.current === requestIdentity
      const storedProfile = readOfflineData(currentUserId, 'profile')
      const cached = storedProfile?.id === currentUserId && storedProfile.active === true ? storedProfile : null
      if (!online) {
        setProfile(cached)
        setVerifiedProfileUserId(null)
        setProfileUserId(currentUserId)
        return
      }

      try {
        const { data, error } = await withTimeout(supabase.from('profiles').select(PROFILE_FIELDS).eq('id', currentUserId).maybeSingle())
        if (!isCurrent()) return
        if (error) throw error

        if (data?.id !== currentUserId || !data?.active) {
          clearOfflineData(currentUserId)
          setProfile(null)
          setVerifiedProfileUserId(null)
          setProfileUserId(currentUserId)
          await supabase.auth.signOut({ scope: 'local' })
          return
        }

        setProfile(data)
        setVerifiedProfileUserId(currentUserId)
        setProfileUserId(currentUserId)
        saveOfflineData(currentUserId, 'profile', data)
      } catch (_) {
        if (!isCurrent()) return
        setProfile(cached)
        setVerifiedProfileUserId(null)
        setProfileUserId(currentUserId)
      }
    }

    loadProfile()
    return () => { cancelled = true }
  }, [session?.user?.id, sessionReady, profileRevision, online])

  useEffect(() => {
    if (!supabase) return undefined
    let refreshing = false
    let cancelled = false
    const refreshOnResume = async () => {
      if (refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try {
        const revision = sessionRevision.current
        const { data, error } = await withTimeout(supabase.auth.getSession(), 6000)
        if (cancelled || sessionRevision.current !== revision) return
        if (error) throw error
        applySession(data?.session || null)
        setProfileRevision((value) => value + 1)
      } catch (_) {
        // Le cache permet la lecture, jamais l'administration sans profil vérifié.
        if (!cancelled) setVerifiedProfileUserId(null)
      } finally {
        refreshing = false
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshOnResume() }
    window.addEventListener('pageshow', refreshOnResume)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.removeEventListener('pageshow', refreshOnResume)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [applySession])

  const loading = !sessionReady || Boolean(session?.user?.id && profileUserId !== session.user.id)

  const currentUserId = session?.user?.id || null
  const profileMatchesUser = Boolean(currentUserId && profileUserId === currentUserId && profile?.id === currentUserId)
  const verifiedAdmin = online && profileMatchesUser && verifiedProfileUserId === currentUserId && profile?.role === 'admin' && profile?.active === true

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: verifiedAdmin,
    isTreasurer: verifiedAdmin && profile?.is_treasurer === true,
    hasAccess: profileMatchesUser && profile?.active === true,
    loading,
    configured: isSupabaseConfigured,
    refreshProfile: () => setProfileRevision((value) => value + 1),
    signIn: async (email, password) => {
      if (!supabase) throw new Error('Supabase n’est pas encore configuré.')
      const normalizedEmail = email.trim().toLowerCase()
      const startRevision = sessionRevision.current
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
      if (error) throw error
      if (sessionRevision.current === startRevision) applySession(data.session)
      const signedInUserId = data.user.id
      const signedInIdentity = identityRevision.current
      const stillSignedIn = () => sessionUserId.current === signedInUserId && identityRevision.current === signedInIdentity
      if (!stillSignedIn()) throw new Error('La session a changé. Reconnectez-vous.')

      const { data: accountProfile, error: profileError } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', data.user.id).maybeSingle()
      if (!stillSignedIn()) throw new Error('La session a changé. Reconnectez-vous.')
      if (profileError || accountProfile?.id !== signedInUserId) {
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
      setVerifiedProfileUserId(data.user.id)
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
      clearPrivateMediaUrlCache()
      applySession(null)
      if (supabase) await supabase.auth.signOut()
    },
  }), [session, profile, loading, profileMatchesUser, verifiedAdmin, applySession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return context
}
