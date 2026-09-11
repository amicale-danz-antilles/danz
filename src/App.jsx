import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import { useAuth } from './context/AuthContext.jsx'
import useOnlineStatus from './hooks/useOnlineStatus.js'
import Login from './pages/Login.jsx'
import Privacy from './pages/Privacy.jsx'
import Agenda from './pages/Agenda.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Galerie from './pages/Galerie.jsx'
import BonsPlans from './pages/BonsPlans.jsx'
import Sondages from './pages/Sondages.jsx'
import Profile from './pages/Profile.jsx'
import OfflineDashboard from './pages/offline/OfflineDashboard.jsx'
import OfflineAgenda from './pages/offline/OfflineAgenda.jsx'
import OfflineGalerie from './pages/offline/OfflineGalerie.jsx'
import OfflineBonsPlans from './pages/offline/OfflineBonsPlans.jsx'
import OfflineSondages from './pages/offline/OfflineSondages.jsx'

// Les écrans membre sont inclus dans le shell PWA pour rester ouvrables hors ligne.
// Les écrans d'administration, volontairement online-only, restent découpés à la demande.
const Amicale = lazy(() => import('./pages/Amicale.jsx'))
const AdminRequests = lazy(() => import('./pages/AdminRequests.jsx'))
const AdminContent = lazy(() => import('./pages/AdminContent.jsx'))
const AdminUsers = lazy(() => import('./pages/AdminUsers.jsx'))
const AdminBackup = lazy(() => import('./pages/AdminBackup.jsx'))
const AdminSystemStatus = lazy(() => import('./pages/AdminSystemStatus.jsx'))

function PageLoader() {
  return <div className="route-loader" role="status" aria-live="polite"><span className="route-loader-spinner" /><span>Chargement…</span></div>
}

function OfflineAware({ online: OnlineComponent, offline: OfflineComponent }) {
  const online = useOnlineStatus()
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const onSync = () => setRevision((value) => value + 1)
    window.addEventListener('danz-offline-sync-complete', onSync)
    return () => window.removeEventListener('danz-offline-sync-complete', onSync)
  }, [])

  return online ? <OnlineComponent key={`online-${revision}`} /> : <OfflineComponent />
}

function OnlineOnly({ children }) {
  const online = useOnlineStatus()
  if (online) return children
  return <section className="system-offline-required"><h2>Connexion Internet requise</h2><p>Les actions d’administration ne sont jamais exécutées depuis une copie hors ligne. Reconnectez cet appareil pour administrer le site ou modifier les données.</p></section>
}

function AdminOnly({ children }) {
  const { isAdmin } = useAuth()
  return isAdmin ? children : <Navigate to="/" replace />
}

const adminOnline = (element) => <AdminOnly><OnlineOnly><Suspense fallback={<PageLoader />}>{element}</Suspense></OnlineOnly></AdminOnly>

export default function App() {
  return <Routes>
    <Route path="/connexion" element={<Login />} />
    <Route path="/confidentialite" element={<Privacy />} />
    <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
      <Route index element={<OfflineAware online={Dashboard} offline={OfflineDashboard} />} />
      <Route path="agenda" element={<OfflineAware online={Agenda} offline={OfflineAgenda} />} />
      <Route path="sondages" element={<OfflineAware online={Sondages} offline={OfflineSondages} />} />
      <Route path="galerie" element={<OfflineAware online={Galerie} offline={OfflineGalerie} />} />
      <Route path="bons-plans" element={<OfflineAware online={BonsPlans} offline={OfflineBonsPlans} />} />
      <Route path="profil" element={<Profile />} />
      <Route path="actualites" element={<Navigate to="/" replace />} />
      <Route path="documents" element={<Navigate to="/" replace />} />
      <Route path="amicale" element={<Navigate to="/" replace />} />

      <Route path="administration" element={adminOnline(<AdminRequests />)} />
      <Route path="administration/utilisateurs" element={adminOnline(<AdminUsers />)} />
      <Route path="administration/sauvegardes" element={adminOnline(<AdminBackup />)} />
      <Route path="administration/systeme" element={adminOnline(<AdminSystemStatus />)} />
      <Route path="administration/contenus" element={adminOnline(<AdminContent />)} />
      <Route path="administration/galerie" element={<Navigate to="/administration/contenus?type=albums" replace />} />
      <Route path="administration/bons-plans" element={adminOnline(<BonsPlans />)} />
      <Route path="administration/sondages" element={adminOnline(<Sondages />)} />
      <Route path="administration/bureau" element={adminOnline(<Amicale />)} />
      <Route path="administration/demandes" element={<Navigate to="/administration" replace />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
