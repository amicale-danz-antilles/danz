import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Privacy from './pages/Privacy.jsx'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Agenda = lazy(() => import('./pages/Agenda.jsx'))
const Galerie = lazy(() => import('./pages/Galerie.jsx'))
const BonsPlans = lazy(() => import('./pages/BonsPlans.jsx'))
const Sondages = lazy(() => import('./pages/Sondages.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const Amicale = lazy(() => import('./pages/Amicale.jsx'))
const AdminRequests = lazy(() => import('./pages/AdminRequests.jsx'))
const AdminContent = lazy(() => import('./pages/AdminContent.jsx'))
const AdminUsers = lazy(() => import('./pages/AdminUsers.jsx'))

function PageLoader(){
 return <div className="route-loader" role="status" aria-live="polite"><span className="route-loader-spinner"/><span>Chargement…</span></div>
}

const withLoader = (element) => <Suspense fallback={<PageLoader/>}>{element}</Suspense>

export default function App(){
 return <Routes>
  <Route path="/connexion" element={<Login/>}/>
  <Route path="/confidentialite" element={<Privacy/>}/>
  <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
    <Route index element={withLoader(<Dashboard/>)}/>
    <Route path="agenda" element={withLoader(<Agenda/>)}/>
    <Route path="sondages" element={withLoader(<Sondages/>)}/>
    <Route path="galerie" element={withLoader(<Galerie/>)}/>
    <Route path="bons-plans" element={withLoader(<BonsPlans/>)}/>
    <Route path="profil" element={withLoader(<Profile/>)}/>
    <Route path="actualites" element={<Navigate to="/" replace/>}/>
    <Route path="documents" element={<Navigate to="/" replace/>}/>
    <Route path="amicale" element={<Navigate to="/" replace/>}/>

    <Route path="administration" element={withLoader(<AdminRequests/>)}/>
    <Route path="administration/utilisateurs" element={withLoader(<AdminUsers/>)}/>
    <Route path="administration/contenus" element={withLoader(<AdminContent/>)}/>
    <Route path="administration/galerie" element={withLoader(<Galerie/>)}/>
    <Route path="administration/bons-plans" element={withLoader(<BonsPlans/>)}/>
    <Route path="administration/sondages" element={withLoader(<Sondages/>)}/>
    <Route path="administration/bureau" element={withLoader(<Amicale/>)}/>
    <Route path="administration/demandes" element={<Navigate to="/administration" replace/>}/>
  </Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}
