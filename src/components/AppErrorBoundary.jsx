import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('Erreur application DANZ', error)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return <main className="fatal-error" role="alert">
      <img src="/danz/amicale-danz-icon.png" alt="" />
      <span className="eyebrow">Amicale DANZ Antilles</span>
      <h1>La page doit être rechargée</h1>
      <p>Une mise à jour ou une erreur temporaire a interrompu l’affichage. Vos données ne sont pas modifiées.</p>
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>Recharger l’application</button>
    </main>
  }
}
