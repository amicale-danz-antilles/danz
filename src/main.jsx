import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './styles.css'
import './quality.css'
import './home-app.css'
import './mobile-fixes.css'
import './quality-v2.css'
import './offline-hardening.css'
import './desktop-home-fix.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </AppErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/danz/sw.js', { scope: '/danz/' })
      const notifyUpdate = () => window.dispatchEvent(new CustomEvent('danz-update-ready'))
      const watchWorker = (worker) => {
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate()
        })
      }
      watchWorker(registration.installing)
      registration.addEventListener('updatefound', () => watchWorker(registration.installing))
      registration.update().catch(() => {})
    } catch (_) {
      // L'application reste utilisable même si le navigateur refuse le mode PWA.
    }
  })
}
