import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function ProtectedRoute({ children }) {
  const { user, hasAccess, loading } = useAuth()

  if (loading) {
    return <div className="screen-center"><div className="spinner" /><p>Ouverture de votre espace…</p></div>
  }

  if (!user || !hasAccess) return <Navigate to="/connexion" replace />
  return children
}
