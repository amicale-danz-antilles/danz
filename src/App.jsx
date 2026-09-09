import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Privacy from './pages/Privacy.jsx'
import useOnlineStatus from './hooks/useOnlineStatus.js'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Agenda = lazy(() => import('./pages/Agenda.jsx'))
const Galerie = lazy(() => import('./pages/Galerie.jsx'))
const BonsPlans = lazy(() => import('./pages/BonsPlans.jsx'))
const Sondages = lazy(() => import('./pages/Sondages.jsx'))
const OfflineGalerie = lazy(() => import('./pages/offline/OfflineGalerie.jsx'))
const OfflineBonsPlans = lazy(() => import('./pages/offline/OfflineBonsPlans.jsx'))
const OfflineSondages = lazy(() => import('./pages/offline/OfflineSondages.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const Amicale = lazy(() => import('./pages/Amicale.jsx'))
const AdminRequests = lazy(() => import('./pages/AdminRequests.jsx'))
const AdminContent = lazy(() => import('./pages/AdminContent.jsx'))
const AdminUsers = lazy(() => import('./pages/AdminUsers.jsx'))
const AdminBackup = lazy(() => import('./pages/AdminBackup.jsx'))
const AdminSystemStatus = lazy(() => import('./pages/AdminSystemStatus.jsx'))

function PageLoader(){
 return <div className="route-loader" role="status" aria-live="polite"><span className="route-loader-spinner"/><span>Chargement…</span></div>
}

const withLoader = (element) => <Suspense fallback={<PageLoader/>}>{element}</Suspense>

function OfflineAware({online:OnlineComponent,offline:OfflineComponent}){
 const online=useOnlineStatus()
 return online?<OnlineComponent/>:<OfflineComponent/>
}

function OnlineOnly({children}){
 const online=useOnlineStatus()
 if(online)return children
 return <section className="system-offline-required"><h2>Connexion Internet requise</h2><p>Les actions d’administration ne sont jamais exécutées depuis une copie hors ligne. Reconnectez cet appareil pour administrer le site ou modifier les données.</p></section>
}

export default function App(){
 return <Routes>
  <Route path="/connexion" element={<Login/>}/>
  <Route path="/confidentialite" element={<Privacy/>}/>
  <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
    <Route index element={withLoader(<Dashboard/>)}/>
    <Route path="agenda" element={withLoader(<Agenda/>)}/>
    <Route path="sondages" element={withLoader(<OfflineAware online={Sondages} offline={OfflineSondages}/>)}/>
    <Route path="galerie" element={withLoader(<OfflineAware online={Galerie} offline={OfflineGalerie}/>)}/>
    <Route path="bons-plans" element={withLoader(<OfflineAware online={BonsPlans} offline={OfflineBonsPlans}/>)}/>
    <Route path="profil" element={withLoader(<Profile/>)}/>
    <Route path="actualites" element={<Navigate to="/" replace/>}/>
    <Route path="documents" element={<Navigate to="/" replace/>}/>
    <Route path="amicale" element={<Navigate to="/" replace/>}/>

    <Route path="administration" element={withLoader(<OnlineOnly><AdminRequests/></OnlineOnly>)}/>
    <Route path="administration/utilisateurs" element={withLoader(<OnlineOnly><AdminUsers/></OnlineOnly>)}/>
    <Route path="administration/sauvegardes" element={withLoader(<OnlineOnly><AdminBackup/></OnlineOnly>)}/>
    <Route path="administration/systeme" element={withLoader(<OnlineOnly><AdminSystemStatus/></OnlineOnly>)}/>
    <Route path="administration/contenus" element={withLoader(<OnlineOnly><AdminContent/></OnlineOnly>)}/>
    <Route path="administration/galerie" element={withLoader(<OnlineOnly><Galerie/></OnlineOnly>)}/>
    <Route path="administration/bons-plans" element={withLoader(<OnlineOnly><BonsPlans/></OnlineOnly>)}/>
    <Route path="administration/sondages" element={withLoader(<OnlineOnly><Sondages/></OnlineOnly>)}/>
    <Route path="administration/bureau" element={withLoader(<OnlineOnly><Amicale/></OnlineOnly>)}/>
    <Route path="administration/demandes" element={<Navigate to="/administration" replace/>}/>
  </Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}
