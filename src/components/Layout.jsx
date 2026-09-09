import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import OfflineDataSync from './OfflineDataSync.jsx'
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

  const logout = async () => { await signOut(); navigate('/connexion') }
  const memberDetails = []
  if (profile?.applicant_type === 'military') memberDetails.push('Militaire DANZ')
  if (profile?.applicant_type === 'spouse') memberDetails.push('Conjoint(e)')
  if (profile?.is_amicaliste === true) memberDetails.push('Amicaliste')
  else if (profile?.is_amicaliste === false) memberDetails.push('Non-amicaliste')

  const spaceTitle = isAdmin ? 'Espace administrateur' : 'Espace membre'
  const spaceSubtitle = isAdmin
    ? ['Administration', ...memberDetails].join(' · ')
    : memberDetails.join(' · ') || 'Compte membre validé'

  return <div className="app-shell">
    <OfflineDataSync userId={user?.id}/>
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Navigation principale">
      <div className="brand"><img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{width:52,height:52,objectFit:'contain',borderRadius:'12px'}}/><div><strong>Amicale DANZ</strong><span>Antilles</span></div></div>
      <nav>
        {links.map(([to,label,icon])=><NavLink key={to} to={to} end={to==='/' } onClick={()=>setOpen(false)}><span className="nav-icon">{icon}</span>{label}</NavLink>)}
        {isAdmin&&<NavLink to="/administration" onClick={()=>setOpen(false)}><span className="nav-icon">⚙</span>Administration</NavLink>}
      </nav>
      <div className="sidebar-footer">
        <NavLink className="member-chip profile-chip-link" to="/profil" onClick={()=>setOpen(false)} title="Ouvrir mon profil">
          <span>{(profile?.full_name||user?.email||'A')[0].toUpperCase()}</span>
          <small><strong>{profile?.full_name||user?.email}</strong><em>Mon profil</em></small>
        </NavLink>
        <NavLink to="/confidentialite" onClick={()=>setOpen(false)} style={{fontSize:'11px',color:'var(--muted)',textAlign:'center'}}>Confidentialité & RGPD</NavLink>
        <button className="ghost-button" onClick={logout}>Se déconnecter</button>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar"><button className="menu-button" aria-label={open?'Fermer le menu':'Ouvrir le menu'} aria-expanded={open} onClick={()=>setOpen(!open)}>☰</button><div><strong>{spaceTitle}</strong><span>{spaceSubtitle}</span></div></header>
      {!online&&<div className="offline-banner" role="status">Mode hors ligne · Accueil, Agenda, Bons plans, Sondages et Albums utilisent leur dernière copie disponible. Toutes les modifications et les téléchargements nécessitent Internet.</div>}
      <main className={`page ${inAdministration?'admin-surface':'public-surface'}`}><Outlet/></main>
      <footer>Amicale DANZ Antilles · Espace privé · <NavLink to="/confidentialite">Confidentialité</NavLink></footer>
    </div>
    {open&&<button aria-label="Fermer le menu" className="backdrop" onClick={()=>setOpen(false)}/>} 
  </div>
}
