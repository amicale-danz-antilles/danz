import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

const links = [
  ['/', 'Accueil', '⌂'],
  ['/actualites', 'Actualités', '◫'],
  ['/agenda', 'Agenda', '◷'],
  ['/documents', 'Documents', '▤'],
  ['/galerie', 'Galerie', '▦'],
  ['/amicale', "L'Amicale", '♡'],
  ['/profil', 'Mon profil', '○'],
]

export default function Layout() {
  const { user, profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const logout = async () => {
    await signOut()
    navigate('/connexion')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">DA</div>
          <div><strong>Amicale DANZ</strong><span>Antilles</span></div>
        </div>
        <nav>
          {links.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>
              <span className="nav-icon">{icon}</span>{label}
            </NavLink>
          ))}
          {isAdmin && <NavLink to="/administration/demandes" onClick={() => setOpen(false)}><span className="nav-icon">⚙</span>Administration</NavLink>}
        </nav>
        <div className="sidebar-footer">
          <div className="member-chip"><span>{(profile?.full_name || user?.email || 'A')[0].toUpperCase()}</span><small>{profile?.full_name || user?.email}</small></div>
          <button className="ghost-button" onClick={logout}>Se déconnecter</button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button className="menu-button" aria-label="Ouvrir le menu" onClick={() => setOpen(!open)}>☰</button>
          <div><strong>Espace amicalistes</strong><span>{isAdmin ? 'Administration et vie de l’amicale' : 'Réservé aux membres de la DANZ Antilles'}</span></div>
        </header>
        <main className="page"><Outlet /></main>
        <footer>Amicale DANZ Antilles · Espace privé</footer>
      </div>
      {open && <button aria-label="Fermer le menu" className="backdrop" onClick={() => setOpen(false)} />}
    </div>
  )
}
