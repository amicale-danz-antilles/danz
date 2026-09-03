import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

const links = [
  ['/', 'Accueil', '⌂'],
  ['/agenda', 'Agenda', '◷'],
  ['/sondages', 'Sondages', '✓'],
  ['/bons-plans', 'Bons plans', '★'],
  ['/galerie', 'Galerie', '▦'],
  ['/profil', 'Mon profil', '○'],
]

export default function Layout() {
  const { user, profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const logout = async () => { await signOut(); navigate('/connexion') }
  const memberDetails = []
  if (!isAdmin) {
    memberDetails.push(profile?.applicant_type === 'spouse' ? 'Conjoint(e)' : 'Militaire DANZ')
    if (profile?.is_amicaliste === true) memberDetails.push('Amicaliste')
  }
  const spaceTitle = isAdmin ? 'Espace administrateur' : 'Espace membre'
  const spaceSubtitle = isAdmin ? 'Administration et vie de l’amicale' : memberDetails.join(' · ') || 'Compte membre validé'

  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" style={{width:52,height:52,objectFit:'contain',borderRadius:'12px'}}/><div><strong>Amicale DANZ</strong><span>Antilles</span></div></div>
      <nav>
        {links.map(([to,label,icon])=><NavLink key={to} to={to} end={to==='/' } onClick={()=>setOpen(false)}><span className="nav-icon">{icon}</span>{label}</NavLink>)}
        {isAdmin&&<><NavLink to="/administration/contenus" onClick={()=>setOpen(false)}><span className="nav-icon">＋</span>Publier</NavLink><NavLink to="/administration/demandes" onClick={()=>setOpen(false)}><span className="nav-icon">⚙</span>Demandes d’accès</NavLink></>}
      </nav>
      <div className="sidebar-footer"><div className="member-chip"><span>{(profile?.full_name||user?.email||'A')[0].toUpperCase()}</span><small>{profile?.full_name||user?.email}</small></div><button className="ghost-button" onClick={logout}>Se déconnecter</button></div>
    </aside>
    <div className="main-column"><header className="topbar"><button className="menu-button" aria-label="Ouvrir le menu" onClick={()=>setOpen(!open)}>☰</button><div><strong>{spaceTitle}</strong><span>{spaceSubtitle}</span></div></header><main className="page"><Outlet/></main><footer>Amicale DANZ Antilles · Espace privé</footer></div>
    {open&&<button aria-label="Fermer le menu" className="backdrop" onClick={()=>setOpen(false)}/>} 
  </div>
}
