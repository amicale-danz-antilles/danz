import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import OfflineDataSync from './OfflineDataSync.jsx'
import OfflineMutationSync from './OfflineMutationSync.jsx'
import { clearOfflineMutations, listOfflineMutations } from '../lib/offlineMutations.js'
import '../admin-central.css'

const links = [
  ['/', 'Accueil', '⌂'],
  ['/agenda', 'Agenda', '◷'],
  ['/sondages', 'Sondages', '✓'],
  ['/bons-plans', 'Bons plans', '★'],
  ['/galerie', 'Galerie', '▦'],
]

export default function Layout() {
  const { user, profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [updateReady, setUpdateReady] = useState(false)
  const [queueState, setQueueState] = useState({ total: 0, failed: 0 })
  const [syncNotice, setSyncNotice] = useState('')
  const inAdministration = location.pathname.startsWith('/administration')

  useEffect(() => {
    setOpen(false)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const onUpdate = () => setUpdateReady(true)
    window.addEventListener('danz-update-ready', onUpdate)
    return () => window.removeEventListener('danz-update-ready', onUpdate)
  }, [])

  useEffect(() => {
    const refresh = async () => {
      if (!user?.id) return setQueueState({ total: 0, failed: 0 })
      const rows = await listOfflineMutations(user.id).catch(() => [])
      setQueueState({ total: rows.length, failed: rows.filter((row) => row.status === 'error').length })
    }
    const onComplete = (event) => {
      refresh()
      const synced = Number(event.detail?.synced || 0)
      const failed = Number(event.detail?.failed || 0)
      if (synced && !failed) setSyncNotice(`${synced} modification${synced > 1 ? 's' : ''} hors ligne synchronisée${synced > 1 ? 's' : ''}.`)
      else if (synced || failed) setSyncNotice(`${synced} synchronisée${synced > 1 ? 's' : ''}, ${failed} à vérifier.`)
    }
    refresh()
    window.addEventListener('danz-offline-queue-changed', refresh)
    window.addEventListener('danz-offline-sync-complete', onComplete)
    return () => {
      window.removeEventListener('danz-offline-queue-changed', refresh)
      window.removeEventListener('danz-offline-sync-complete', onComplete)
    }
  }, [user?.id])

  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const logout = async () => {
    if (queueState.total > 0 && !window.confirm(`${queueState.total} modification${queueState.total > 1 ? 's sont' : ' est'} encore en attente de synchronisation. Se déconnecter les supprimera de cet appareil. Continuer ?`)) return
    if (user?.id) await clearOfflineMutations(user.id).catch(() => {})
    await signOut()
    navigate('/connexion')
  }

  const memberDetails = []
  if (profile?.applicant_type === 'spouse') memberDetails.push('Conjoint(e) DANZ')
  else if (profile?.applicant_type === 'military' && profile?.military_reference === 'other') memberDetails.push('Militaire hors DANZ')
  else if (profile?.applicant_type === 'military') memberDetails.push('Militaire DANZ')
  if (profile?.is_amicaliste === true) memberDetails.push('Amicaliste')
  else if (profile?.is_amicaliste === false) memberDetails.push('Non-amicaliste')

  const spaceTitle = isAdmin ? 'Espace administrateur' : 'Espace membre'
  const spaceSubtitle = isAdmin
    ? ['Administration', ...memberDetails].join(' · ')
    : memberDetails.join(' · ') || 'Compte membre validé'

  return <div className="app-shell">
    <OfflineDataSync userId={user?.id} />
    <OfflineMutationSync userId={user?.id} />
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Navigation principale">
      <div className="brand"><img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{ width: 52, height: 52, objectFit: 'contain', borderRadius: '12px' }} /><div><strong>Amicale DANZ</strong><span>Antilles</span></div></div>
      <nav>
        {links.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}><span className="nav-icon">{icon}</span>{label}</NavLink>)}
        {isAdmin && <NavLink to="/administration" onClick={() => setOpen(false)}><span className="nav-icon">⚙</span>Administration</NavLink>}
      </nav>
      <div className="sidebar-footer">
        <NavLink className="member-chip profile-chip-link" to="/profil" onClick={() => setOpen(false)} title="Ouvrir mon profil">
          <span>{(profile?.full_name || user?.email || 'A')[0].toUpperCase()}</span>
          <small><strong>{profile?.full_name || user?.email}</strong><em>Mon profil</em></small>
        </NavLink>
        <NavLink to="/confidentialite" onClick={() => setOpen(false)} style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center' }}>Confidentialité & RGPD</NavLink>
        <button className="ghost-button" onClick={logout}>Se déconnecter</button>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar"><button className="menu-button" aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={open} onClick={() => setOpen(!open)}>☰</button><div><strong>{spaceTitle}</strong><span>{spaceSubtitle}</span></div></header>
      {updateReady && <div className="app-update-banner" role="status"><span>Une nouvelle version de l’application est prête.</span><button type="button" onClick={() => window.location.reload()}>Mettre à jour</button></div>}
      {!online && <div className="offline-banner" role="status">Mode hors ligne · Les dernières copies restent disponibles. Les votes et propositions de bons plans sont enregistrés sur cet appareil puis synchronisés automatiquement. L’administration et les téléchargements restent en ligne uniquement.</div>}
      {queueState.total > 0 && <div className={`offline-queue-banner ${queueState.failed ? 'has-error' : ''}`} role="status"><strong>{queueState.total} modification{queueState.total > 1 ? 's' : ''} en attente</strong><span>{online ? 'Synchronisation automatique en cours ou au prochain rafraîchissement.' : 'Elles restent stockées sur cet appareil jusqu’au retour d’Internet.'}{queueState.failed ? ` ${queueState.failed} action${queueState.failed > 1 ? 's ont' : ' a'} rencontré une erreur serveur et sera retentée.` : ''}</span></div>}
      {syncNotice && online && <div className="offline-sync-success" role="status"><span>{syncNotice}</span><button type="button" aria-label="Masquer" onClick={() => setSyncNotice('')}>×</button></div>}
      <main className={`page ${inAdministration ? 'admin-surface' : 'public-surface'}`}><Outlet /></main>
      <footer>Amicale DANZ Antilles · Espace privé · <NavLink to="/confidentialite">Confidentialité</NavLink></footer>
    </div>
    {open && <button aria-label="Fermer le menu" className="backdrop" onClick={() => setOpen(false)} />}
  </div>
}
