import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Actualites from './pages/Actualites.jsx'
import Agenda from './pages/Agenda.jsx'
import Documents from './pages/Documents.jsx'
import Galerie from './pages/Galerie.jsx'
import Amicale from './pages/Amicale.jsx'
import Profile from './pages/Profile.jsx'
import AdminRequests from './pages/AdminRequests.jsx'

export default function App(){
 return <Routes>
  <Route path="/connexion" element={<Login/>}/>
  <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
    <Route index element={<Dashboard/>}/>
    <Route path="actualites" element={<Actualites/>}/>
    <Route path="agenda" element={<Agenda/>}/>
    <Route path="documents" element={<Documents/>}/>
    <Route path="galerie" element={<Galerie/>}/>
    <Route path="amicale" element={<Amicale/>}/>
    <Route path="profil" element={<Profile/>}/>
    <Route path="administration/demandes" element={<AdminRequests/>}/>
  </Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}
