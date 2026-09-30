import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatMoney } from '../lib/finance.js'
import { downloadFinancialBackup, downloadWeeklyFinancialBackup } from '../lib/treasuryExport.js'
import { previewEditableRows, readEditableWorkbook } from '../lib/treasuryRoundTrip.js'
import '../treasury-import.css'

const FIELD_LABEL = {label:'Libellé',amountCents:'Montant',category:'Catégorie',
  account:'Compte',occurredOn:'Date',note:'Note',eventId:'Événement',person:'Personne'}
const showValue = (key,value) => key==='amountCents' ? formatMoney(value) : String(value || '—')

export default function TreasuryExportImport({data,onReload}) {
  const [preview,setPreview]=useState(null)
  const [filename,setFilename]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')

  const readFile=async(event)=>{
    const file=event.target.files?.[0]
    event.target.value=''
    if(!file)return
    setBusy(true);setError('');setNotice('');setPreview(null);setFilename(file.name)
    try{
      const rows=await readEditableWorkbook(file)
      const result=previewEditableRows(rows,data)
      setPreview(result)
      if(!result.problems.length && !result.changes.length)setNotice('Aucun changement détecté. Les comptes restent inchangés.')
    }catch(e){setError(e.message || 'Impossible de lire le fichier Excel.')}
    finally{setBusy(false)}
  }
  const importChanges=async()=>{
    if(busy || !preview?.changes?.length || preview?.problems?.length)return
    if(!window.confirm('Appliquer les '+preview.changes.length+' modification(s) affichée(s) ? Toutes les corrections seront historisées.'))return
    setBusy(true);setError('');setNotice('')
    try{
      const {data:result,error:rpcError}=await supabase.rpc('treasury_import_edited_entries',{
        p_rows:preview.changes.map(({id,baseline,next})=>({id,baseline,next})),
      })
      if(rpcError)throw rpcError
      await onReload()
      setNotice((result?.updated ?? preview.changes.length)+' opération(s) mises à jour. Import transactionnel terminé et historique conservé.')
      setPreview(null)
    }catch(e){setError(e.message || 'Import annulé : aucun changement de ce lot ne doit être conservé.')}
    finally{setBusy(false)}
  }

  return <section className="txi">
    <header><div><span className="tv2-eyebrow">Excel · édition sécurisée</span><h2>Exportation et réintégration</h2><p>Modifiez les dépenses et recettes dans Excel, prévisualisez les différences, puis appliquez-les aux comptes en un seul lot.</p></div></header>
    {error&&<div className="alert error" role="alert">{error}</div>}
    {notice&&<div className="alert success" role="status">{notice}</div>}
    <div className="txi-actions">
      <button type="button" className="primary-button" onClick={()=>downloadFinancialBackup(data)} disabled={busy}>↓ Télécharger tous les comptes Excel</button>
      <button type="button" className="ghost-button" onClick={()=>downloadWeeklyFinancialBackup(data)} disabled={busy}>↓ Sauvegarde de la semaine</button>
    </div>
    <div className="txi-guide">
      <strong>Comment modifier ton fichier ?</strong>
      <p>Ouvre la première feuille <b>« Écritures modifiables »</b>. Modifie le libellé, le montant, la catégorie, le compte, la date, la note, l’événement ou la personne. Pour les identifiants d’événements et de personnes, utilise les autres feuilles du même classeur.</p>
      <p>Ne modifie pas les identifiants ni la colonne de contrôle, et ne supprime pas des lignes pour annuler une opération : l’annulation se fait dans l’onglet Historique. Les paiements liés aux foyers et les avances déjà remboursées restent protégés et se corrigent directement sur le site.</p>
    </div>
    <label className="txi-upload"><strong>Réintégrer un fichier Excel corrigé</strong><span>Importer un classeur .xlsx créé depuis cette page</span>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={readFile} disabled={busy}/>
    </label>
    {busy&&<p className="txi-hint">Vérification des données…</p>}
    {preview&&<div className="txi-preview">
      <div><h3>Aperçu : {filename}</h3><p>{preview.changes.length} changement(s) détecté(s) · {preview.problems.length} ligne(s) à corriger</p></div>
      {preview.problems.length>0&&<div className="txi-issues"><strong>L’importation est bloquée tant que ces problèmes subsistent.</strong>
        {preview.problems.map((problem,index)=><p key={index}>Ligne {problem.line} : {problem.message}</p>)}
      </div>}
      {preview.changes.map((change)=><article key={change.id} className="txi-change">
        <div><strong>Ligne {change.line} · {change.baseline.label}</strong><small>{change.id}</small></div>
        {change.altered.map((key)=><div key={key} className="txi-difference"><span>{FIELD_LABEL[key] || key}</span><del>{showValue(key,change.baseline[key])}</del><b>→ {showValue(key,change.next[key])}</b></div>)}
      </article>)}
      <div className="txi-confirm"><button type="button" className="ghost-button" onClick={()=>{setPreview(null);setFilename('')}} disabled={busy}>Annuler l’aperçu</button>
        <button type="button" className="primary-button" disabled={busy||Boolean(preview.problems.length)||!preview.changes.length} onClick={importChanges}>Valider et mettre à jour {preview.changes.length} opération(s)</button></div>
    </div>}
  </section>
}
