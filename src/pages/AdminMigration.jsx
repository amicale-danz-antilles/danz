import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { PageTitle } from './Actualites.jsx'
import '../migration-progress.css'

const STATUS_URL = '/danz/migration-status.json'
const labels = { validated: 'Validé', in_progress: 'En cours', pending: 'À réaliser', blocked: 'Prérequis bloquant' }
const sources = [
  ['profiles', 'Profils'],
  ['households', 'Foyers'],
  ['events', 'Événements'],
  ['good_deals', 'Bons plans'],
  ['treasury_entries', 'Écritures de trésorerie'],
  ['household_payments', 'Paiements de foyer'],
]
const dateLabel = date => date ? new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date indisponible'

function validateManifest(data) {
  if (data?.schema_version !== 1 || !Array.isArray(data.milestones) || !data.production || !data.gates) throw new Error('Le fichier de suivi est invalide.')
  if (data.production.cutover_complete && !Object.values(data.gates).every(Boolean)) throw new Error('Basculement non certifié : des contrôles restent incomplets.')
  return data
}

export default function AdminMigration() {
  const { isAdmin, loading: authLoading } = useAuth()
  const [manifest, setManifest] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [liveCounts, setLiveCounts] = useState(null)
  const [sourceError, setSourceError] = useState('')
  const [checkedAt, setCheckedAt] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    setStatusError('')
    setSourceError('')
    const requests = [
      fetch(STATUS_URL + '?ts=' + Date.now(), { cache: 'no-store' })
        .then(response => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json() })
        .then(validateManifest)
        .then(setManifest)
        .catch(() => setStatusError('Impossible de récupérer le dernier suivi GitHub Pages. Les précédentes informations restent affichées.')),
    ]
    if (supabase) {
      requests.push((async () => {
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), 9000)
        try {
          const results = await Promise.all(sources.map(async ([table]) => {
            const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).abortSignal(abort.signal)
            if (error) throw error
            return [table, count]
          }))
          setLiveCounts(Object.fromEntries(results))
          setCheckedAt(new Date())
        } catch (_) {
          setSourceError('Comptages Supabase indisponibles sur ce réseau. Le suivi des étapes reste consultable.')
        } finally {
          clearTimeout(timer)
        }
      })())
    }
    await Promise.allSettled(requests)
    setBusy(false)
  }, [])

  useEffect(() => { if (isAdmin) refresh() }, [isAdmin, refresh])
  const totals = useMemo(() => {
    const entries = manifest?.milestones || []
    return { all: entries.length, validated: entries.filter(item => item.state === 'validated').length }
  }, [manifest])
  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  return <div className="migration-page">
    <PageTitle eyebrow="Administration · Projet Nhost" title="Suivi de la migration"
      text="Suivez les validations techniques et la préparation du basculement sans interrompre le fonctionnement actuel de DANZ." />
    <div className="migration-toolbar">
      <Link className="ghost-button" to="/administration">← Administration</Link>
      <button className="secondary-button" onClick={refresh} disabled={busy}>{busy ? 'Actualisation…' : '↻ Actualiser le suivi'}</button>
    </div>
    {statusError && <div className="alert error" role="alert">{statusError}</div>}
    {manifest && <>
      <section className="migration-hero">
        <div><span className="eyebrow">État publié le {dateLabel(manifest.updated_on)}</span>
          <h2>{manifest.phase}</h2>
          <p>{manifest.overview}</p>
          <div className="migration-pills">
            <span className="migration-pill on">Production : Supabase</span>
            <span className="migration-pill staging">Essais : Nhost (États-Unis)</span>
            <span className="migration-pill blocked">Aucune donnée réelle transférée</span>
          </div>
        </div>
        <div className="migration-count"><strong>{totals.validated}<small> / {totals.all}</small></strong><span>jalons validés</span><small>Ce ratio ne mesure pas le volume de travail ni les données transférées.</small></div>
      </section>
      <section className="migration-checkpoints">
        <div className="admin-section-heading"><div><span className="eyebrow">Plan de migration</span><h2>Étapes et justificatifs</h2></div></div>
        <div className="migration-steps">{manifest.milestones.map((step, index) =>
          <article key={step.id} className={'migration-step migration-step-' + step.state}>
            <div className="migration-step-index">{String(index + 1).padStart(2, '0')}</div>
            <div><div className="migration-step-top"><h3>{step.title}</h3><span className={'migration-state ' + step.state}>{labels[step.state] || step.state}</span></div>
              <p>{step.detail}</p>
              {step.evidence && <a href={step.evidence} target="_blank" rel="noopener noreferrer">Voir le test ou les éléments techniques ↗</a>}
            </div>
          </article>
        )}</div>
      </section>
      <section className="migration-panel">
        <span className="eyebrow">Sécurité avant basculement</span>
        <h2>Conditions obligatoires</h2>
        <div className="migration-gates">
          {[
            ['approved_region', 'Hébergement définitif approuvé'],
            ['restore_tested', 'Sauvegarde restaurée avec succès'],
            ['fake_auth_import_passed', 'Identifiants importés sur compte fictif'],
            ['target_permissions_audited', 'Permissions Nhost auditées'],
            ['storage_and_functions_passed', 'Fichiers et fonctions testés'],
            ['app_acceptance_passed', 'Toutes les fonctions DANZ validées'],
            ['inventories_match', 'Inventaires source et cible identiques'],
            ['final_source_freeze', 'Dernière synchronisation sous gel des écritures'],
            ['production_cutover_authorized', 'Basculement expressément autorisé'],
          ].map(([key, label]) => <div className="migration-gate" key={key}><span aria-hidden="true">{manifest.gates[key] ? '✓' : '○'}</span><span>{label}</span><strong>{manifest.gates[key] ? 'Validé' : 'En attente'}</strong></div>)}
        </div>
        <p className="migration-disclaimer">Les cases sont mises à jour lors de publications vérifiées dans GitHub. Elles ne sont pas modifiables depuis cette page ; aucune action de migration n'est déclenchée ici.</p>
      </section>
    </>}
    <section className="migration-panel">
      <div className="admin-section-heading"><div><span className="eyebrow">Situation actuelle</span><h2>Contrôle de la base source</h2></div><span className="migration-small">{checkedAt ? 'Contrôlé le ' + checkedAt.toLocaleString('fr-FR') : 'Pas de contrôle récent'}</span></div>
      {sourceError && <div className="migration-note">{sourceError}</div>}
      {liveCounts ? <div className="migration-source-grid">
        {sources.map(([key, name]) => <div className="migration-source" key={key}><strong>{Number(liveCounts[key] ?? 0).toLocaleString('fr-FR')}</strong><span>{name}</span></div>)}
      </div> : <p className="migration-disclaimer">Les comptages anonymisés de Supabase sont disponibles après connexion administrateur sur un réseau qui autorise Supabase.</p>}
      <p className="migration-disclaimer">Il s'agit uniquement des comptages de la source Supabase, pas de données déjà transférées. Les comptes d'authentification et les contrôles financiers détaillés nécessitent un rapprochement serveur dédié.</p>
    </section>
    <section className="migration-panel migration-links">
      <h2>Documents et accès</h2>
      <a href="/danz/suivi-migration.html" target="_blank" rel="noopener noreferrer">Suivi consultable depuis le poste professionnel ↗</a>
      <a href="https://github.com/amicale-danz-antilles/danz/blob/main/docs/migration-nhost-preparation.md" target="_blank" rel="noopener noreferrer">Plan technique de migration ↗</a>
      <Link to="/administration/sauvegardes">Sauvegardes et exports administrateur →</Link>
    </section>
  </div>
}
