import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Agenda from './pages/Agenda.jsx'
import Galerie from './pages/Galerie.jsx'
import BonsPlans from './pages/BonsPlans.jsx'
import Sondages from './pages/Sondages.jsx'
import Profile from './pages/Profile.jsx'
import Amicale from './pages/Amicale.jsx'
import AdminRequests from './pages/AdminRequests.jsx'
import AdminContent from './pages/AdminContent.jsx'

export default function App(){
 return <Routes>
  <Route path="/connexion" element={<Login/>}/>
  <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
    <Route index element={<Dashboard/>}/>
    <Route path="agenda" element={<Agenda/>}/>
    <Route path="sondages" element={<Sondages/>}/>
    <Route path="galerie" element={<Galerie/>}/>
    <Route path="bons-plans" element={<BonsPlans/>}/>
    <Route path="profil" element={<Profile/>}/>
    <Route path="actualites" element={<Navigate to="/" replace/>}/>
    <Route path="documents" element={<Navigate to="/" replace/>}/>
    <Route path="amicale" element={<Navigate to="/" replace/>}/>

    <Route path="administration" element={<AdminRequests/>}/>
    <Route path="administration/contenus" element={<AdminContent/>}/>
    <Route path="administration/galerie" element={<Galerie/>}/>
    <Route path="administration/bons-plans" element={<BonsPlans/>}/>
    <Route path="administration/sondages" element={<Sondages/>}/>
    <Route path="administration/bureau" element={<Amicale/>}/>
    <Route path="administration/demandes" element={<Navigate to="/administration" replace/>}/>
  </Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}
