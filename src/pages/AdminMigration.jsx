import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageTitle } from './Actualites.jsx'
import '../admin-migration.css'

const STATUS_LABELS = {validated:'Validée',in_progress:'En cours',pending:'À réaliser',blocked:'Bloquée'}
const STATUS_CSS = {validated:'complete',in_progress:'working',pending:'waiting',blocked:'blocked'}
const progressUrl = `${import.meta.env.BASE_URL}migration-status.json`

export default function AdminMigration(){
  const [report,setReport] = useState(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const load=async()=>{
    setLoading(true);setError('')
    try {
      const res=await fetch(`${progressUrl}?v=${Date.now()}`,{cache:'no-store'})
      if(!res.ok)throw new Error(`HTTP ${res.status}`)
      const data=await res.json()
      if(data.schema_version!==1||!Array.isArray(data.stages)||!Array.isArray(data.gates))throw new Error('Format du suivi invalide')
      setReport(data)
    }catch(e){setError(`Suivi indisponible : ${e.message}. Le statut antérieur, s’il est affiché, peut être périmé.`)}
    finally{setLoading(false)}
  }
  useEffect(()=>{load()},[])
  const validated=useMemo(()=>report?.stages?.filter(s=>s.status==='validated').length||0,[report])
  const stages=report?.stages||[]
  const verifiedAt=report?.updated_at?new Date(report.updated_at+'T12:00:00').toLocaleDateString('fr-FR'):'—'
  return <div className="migration-page">
    <PageTitle eyebrow="Administration · Transition technique" title="Migration de Supabase vers Nhost" text="Suivi des étapes réellement validées et des vérifications nécessaires pour protéger les comptes et les données."/>
    <div className="migration-actions"><Link className="ghost-button" to="/administration">← Administration</Link><button type="button" className="secondary-button" onClick={load} disabled={loading}>{loading?'Actualisation…':'↻ Actualiser le suivi'}</button></div>
    {error&&<div className="alert warning" role="status">{error}</div>}
    {report&&<>
      <section className="migration-summary" aria-label="État général de la migration">
        <div className="migration-count">
          <span className="eyebrow">Avancement vérifié</span><strong>{validated} / {stages.length}</strong>
          <span>étapes validées</span>
          <progress max={stages.length} value={validated} aria-label="Étapes de migration validées"/>
          <small>Ce compteur ne mesure pas le volume de données transférées.</small>
        </div>
        <div className="migration-current">
          <span className="migration-badge working">Production maintenue</span>
          <h2>{report.current_production}</h2>
          <p><strong>Environnement de test :</strong> {report.staging}</p>
          <p><strong>Données réelles transférées :</strong> {report.real_data_transferred?'Oui, à vérifier':'Non'}</p>
          <p><strong>Basculement :</strong> {report.cutover_ready?'Prêt pour une validation humaine':'Verrouillé — aucune action automatique'}</p>
          <small>Suivi actualisé le {verifiedAt}.</small>
        </div>
      </section>
      <section className="migration-next"><span className="eyebrow">Prochaine action</span><p>{report.next_action}</p></section>
      <section>
        <div className="admin-section-heading"><div><span className="eyebrow">Feuille de route</span><h2>Étapes et contrôles</h2></div></div>
        <div className="migration-roadmap">{stages.map((step,index)=><article className="migration-step" key={step.id}>
          <div className={`migration-step-number ${STATUS_CSS[step.status]||'waiting'}`}>{index+1}</div>
          <div><div className="migration-step-heading"><h3>{step.title}</h3><span className={`migration-badge ${STATUS_CSS[step.status]||'waiting'}`}>{STATUS_LABELS[step.status]||step.status}</span></div>
          <p>{step.detail}</p>{step.evidence_url&&<a href={step.evidence_url} target="_blank" rel="noopener noreferrer">Consulter le livrable ou le test ↗</a>}</div>
        </article>)}</div>
      </section>
      <section className="migration-gates">
        <div className="admin-section-heading"><div><span className="eyebrow">Protection des données</span><h2>Conditions obligatoires du basculement</h2></div></div>
        {report.gates.map(g=><div className="migration-gate" key={g.id}><span aria-hidden="true">{g.passed?'✓':'○'}</span><strong>{g.title}</strong><span>{g.passed?'Vérifié':'Non vérifié'}</span></div>)}
        <p>Aucun transfert définitif ni changement de fournisseur ne sera entrepris sur la seule base de ce tableau. Une validation des sauvegardes, des rapprochements et des droits est indispensable.</p>
      </section>
      <div className="migration-resources"><Link className="secondary-button" to="/administration/sauvegardes">Sauvegardes et exports</Link><Link className="secondary-button" to="/administration/systeme">État du système</Link><a className="ghost-button" href="https://github.com/amicale-danz-antilles/danz/actions" target="_blank" rel="noopener noreferrer">Derniers déploiements GitHub ↗</a></div>
      <small className="migration-fineprint">{report.notes}</small>
    </>}
    {!report&&loading&&<div className="skeleton-card tall" aria-label="Chargement du suivi"/>}
  </div>
}
