import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageTitle } from './Actualites.jsx'
import '../migration-status.css'

const STATUS_FILE = '/danz/migration-status.json'
const TEST_SERVICES = [
  { key: 'auth', label: 'Authentification Nhost', url: 'https://mdlqqvchbymlsctnrpvd.auth.us-east-1.nhost.run/v1/version' },
  { key: 'graphql', label: 'GraphQL Nhost', url: 'https://mdlqqvchbymlsctnrpvd.graphql.us-east-1.nhost.run/v1' },
  { key: 'storage', label: 'Stockage Nhost', url: 'https://mdlqqvchbymlsctnrpvd.storage.us-east-1.nhost.run/v1/files/00000000-0000-0000-0000-000000000000' },
]
const STATES = {
  validated: { label: 'Validé', css: 'validated' },
  in_progress: { label: 'En cours', css: 'progress' },
  pending: { label: 'À réaliser', css: 'pending' },
  blocked: { label: 'En attente de prérequis', css: 'blocked' },
}
const today = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Non renseigné'

async function testService(service) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 9000)
  try {
    const init = { cache: 'no-store', credentials: 'omit', mode: 'cors', signal: controller.signal }
    if (service.key === 'graphql') {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify({ query: 'query DanzMigrationConnectivity { __typename }' })
    }
    const response = await fetch(service.url, init)
    if (service.key === 'auth') {
      const data = await response.json().catch(() => null)
      return { ok: response.ok && Boolean(data?.version), message: response.ok ? 'API accessible depuis ce navigateur' : 'Réponse HTTP ' + response.status }
    }
    if (service.key === 'graphql') {
      const data = await response.json().catch(() => null)
      return { ok: response.ok && data?.data?.__typename === 'query_root', message: response.ok && data?.data?.__typename === 'query_root' ? 'POST GraphQL/CORS accessible' : 'HTTP ' + response.status + ' · réponse à vérifier' }
    }
    return { ok: response.status === 403 || response.status === 401, message: response.status === 403 || response.status === 401 ? 'Serveur accessible ; accès anonyme refusé comme prévu' : 'HTTP ' + response.status + ' · résultat à vérifier' }
  } catch (error) {
    return { ok: false, message: error.name === 'AbortError' ? 'Délai dépassé' : 'Requête bloquée ou CORS indisponible' }
  } finally {
    window.clearTimeout(timeout)
  }
}

export default function AdminMigrationStatus() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checks, setChecks] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(STATUS_FILE, { cache: 'no-store' })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const data = await response.json()
      if (data.schema_version !== 1 || !Array.isArray(data.milestones)) throw new Error('Format du suivi inattendu')
      setStatus(data)
    } catch (err) {
      setError('Impossible de récupérer le suivi publié : ' + (err.message || 'réseau indisponible'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const runChecks = async () => {
    setChecking(true)
    const results = await Promise.all(TEST_SERVICES.map(testService))
    setChecks(results)
    setChecking(false)
  }

  const totals = useMemo(() => {
    const steps = status?.milestones || []
    return { validated: steps.filter(step => step.state === 'validated').length, total: steps.length, progress: steps.filter(step => step.state === 'in_progress').length }
  }, [status])

  return <div className="migration-admin-page">
    <PageTitle eyebrow="Administration · Transition technique" title="Migration vers Nhost" text="Suivez les validations réelles, les étapes en attente et les conditions requises avant le basculement. Les états sont publiés et versionnés avec le site." />
    <div className="migration-actions">
      <Link className="ghost-button" to="/administration">← Administration</Link>
      <button className="secondary-button" type="button" disabled={loading} onClick={refresh}>{loading ? 'Actualisation…' : '↻ Actualiser le suivi'}</button>
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {!status && loading && <div className="skeleton-card tall" />}
    {status && <>
      <section className="migration-overview">
        <div className="migration-overview-head"><div><span className="eyebrow">État de référence</span><h2>{status.current_phase}</h2><p>{status.intro}</p></div><span className="migration-live-tag">Site actuel : {status.production_backend}</span></div>
        <div className="migration-meter" role="progressbar" aria-valuemin="0" aria-valuemax={totals.total} aria-valuenow={totals.validated} aria-label="Étapes validées">
          <div style={{ width: totals.total ? (totals.validated / totals.total * 100) + '%' : '0%' }} />
        </div>
        <div className="migration-metrics"><strong>{totals.validated} / {totals.total} étapes validées</strong><span>{totals.progress} en cours · Mis à jour le {today(status.updated_on)}</span></div>
        <p className="migration-safety"><strong>Aucun transfert réel :</strong> {status.real_data_transferred ? 'Vérifiez les rapports de rapprochement et les sauvegardes.' : 'les essais actuels utilisent uniquement des comptes et des données fictifs.'}</p>
      </section>
      <section className="migration-status-list">
        <div className="admin-section-heading"><div><span className="eyebrow">Feuille de route</span><h2>Étapes et preuves</h2></div></div>
        <div className="migration-stage-grid">
          {status.milestones.map((step, i) => {
            const state = STATES[step.state] || STATES.pending
            return <article key={step.id} className={'migration-stage ' + state.css}>
              <div className="migration-stage-top"><span className="migration-stage-index">{String(i + 1).padStart(2, '0')}</span><span className={'migration-stage-badge ' + state.css}>{state.label}</span></div>
              <h3>{step.title}</h3><p>{step.detail}</p>
              {step.evidence && <a href={step.evidence} target="_blank" rel="noopener noreferrer">Voir la référence ↗</a>}
            </article>
          })}
        </div>
      </section>
      <section className="migration-service-section">
        <div className="admin-section-heading"><div><span className="eyebrow">Contrôle facultatif</span><h2>Accessibilité Nhost depuis cet appareil</h2></div><button type="button" className="secondary-button" disabled={checking} onClick={runChecks}>{checking ? 'Tests…' : 'Tester maintenant'}</button></div>
        <p>Ces requêtes vérifient uniquement la connectivité vers le projet américain fictif. Elles ne valident ni les comptes réels, ni les opérations privées, ni la région européenne définitive.</p>
        {checks && <div className="migration-check-grid">{TEST_SERVICES.map((service, i) => <article key={service.key} className={checks[i]?.ok ? 'ok' : 'warning'}><strong>{service.label}</strong><small>{checks[i]?.message}</small></article>)}</div>}
      </section>
      <section className="migration-overview migration-guard">
        <h2>Conditions avant la mise en production</h2>
        <p>Le transfert réel reste bloqué tant que la région et les conditions de traitement des données ne sont pas validées, que les sauvegardes ne sont pas testées et que les comptes, les permissions et la trésorerie n'ont pas réussi leur recette complète.</p>
        <div className="migration-link-row"><a href={status.links.migration_plan} target="_blank" rel="noopener noreferrer">Plan technique versionné ↗</a><a href={status.links.sandbox} target="_blank" rel="noopener noreferrer">Banc d'essai fictif ↗</a></div>
      </section>
    </>}
  </div>
}
