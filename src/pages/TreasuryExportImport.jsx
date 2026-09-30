import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatMoney } from '../lib/finance.js'
import { downloadFinancialBackup, downloadWeeklyFinancialBackup } from '../lib/treasuryExport.js'
import { downloadPartialFinancialBackup } from '../lib/treasuryPartialExport.js'
import { editableEntry, normalizedEntry, previewEditableRows, readEditableWorkbook } from '../lib/treasuryRoundTrip.js'
import '../treasury-import.css'

const FIELD_LABEL = { label:'Libellé', amountCents:'Montant', category:'Catégorie',
  account:'Compte', occurredOn:'Date', note:'Note', eventId:'Événement', person:'Personne' }
const showValue = (key, value) => key === 'amountCents' ? formatMoney(value) : String(value || '—')
const DEFAULT_FILTERS = { from:'', to:'', kind:'all', account:'all', event:'all', search:'' }
const accountMatches = (method, scope) => scope === 'all' || (scope === 'bank'
  ? ['bank_transfer', 'card'].includes(method) : method === scope)

export default function TreasuryExportImport({ data, onReload }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  // null = toutes les écritures visibles sont cochées. Un tableau = sélection manuelle.
  const [selectedIds, setSelectedIds] = useState(null)
  const [preview, setPreview] = useState(null)
  const [selectedChangeIds, setSelectedChangeIds] = useState(null)
  const [filename, setFilename] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setSelectedIds(null)
  }
  const matches = (data.entries || []).filter(editableEntry).filter((entry) => {
    const item = normalizedEntry(entry)
    const text = [item.label, item.note, item.category].join(' ').toLocaleLowerCase('fr-FR')
    return (!filters.from || item.occurredOn >= filters.from)
      && (!filters.to || item.occurredOn <= filters.to)
      && (filters.kind === 'all' || item.kind === filters.kind)
      && accountMatches(item.account, filters.account)
      && (filters.event === 'all' || (filters.event === 'none' ? !item.eventId : item.eventId === filters.event))
      && text.includes(filters.search.trim().toLocaleLowerCase('fr-FR'))
  }).sort((a, b) => normalizedEntry(b).occurredOn.localeCompare(normalizedEntry(a).occurredOn))
  const selectedSet = new Set(selectedIds === null ? matches.map((entry) => entry.id) : selectedIds)
  const selected = matches.filter((entry) => selectedSet.has(entry.id))
  const selectedChangeSet = new Set(selectedChangeIds === null ? (preview?.changes || []).map((change) => change.id) : selectedChangeIds)
  const selectedChanges = (preview?.changes || []).filter((change) => selectedChangeSet.has(change.id))

  const toggleEntry = (id) => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds([...next])
  }
  const exportSelected = () => {
    setError('')
    setNotice('')
    try {
      downloadPartialFinancialBackup(data, selected.map((entry) => entry.id))
      setNotice(selected.length + ' opération(s) exportée(s). Le fichier peut être réimporté seul, sans le reste des comptes.')
    } catch (e) { setError(e.message || 'Impossible de créer la sélection Excel.') }
  }
  const readFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true); setError(''); setNotice(''); setPreview(null); setSelectedChangeIds(null); setFilename(file.name)
    try {
      const rows = await readEditableWorkbook(file)
      const result = previewEditableRows(rows, data)
      setPreview(result)
      if (!result.problems.length && !result.changes.length) setNotice('Aucun changement détecté. Les comptes restent inchangés.')
    } catch (e) { setError(e.message || 'Impossible de lire le fichier Excel.') }
    finally { setBusy(false) }
  }
  const importChanges = async () => {
    if (busy || !selectedChanges.length || preview?.problems?.length) return
    if (!window.confirm('Appliquer uniquement les ' + selectedChanges.length + ' modification(s) cochée(s) ? Les autres écritures et modifications non cochées resteront inchangées.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { data: result, error: rpcError } = await supabase.rpc('treasury_import_edited_entries', {
        p_rows: selectedChanges.map(({ id, baseline, next }) => ({ id, baseline, next })),
      })
      if (rpcError) throw rpcError
      await onReload()
      setNotice((result?.updated ?? selectedChanges.length) + ' opération(s) mises à jour. Le reste des comptes est inchangé et les corrections sont historisées.')
      setPreview(null); setSelectedChangeIds(null)
    } catch (e) { setError(e.message || 'Import annulé : aucune correction de ce lot ne doit être conservée.') }
    finally { setBusy(false) }
  }

  return <section className="txi">
    <header><div><span className="tv2-eyebrow">Excel · édition sécurisée</span><h2>Exportation et réintégration</h2>
      <p>Choisis une partie des écritures, modifie-la dans Excel, puis réimporte uniquement les corrections souhaitées.</p></div></header>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}

    <section className="txi-scope" aria-labelledby="txi-scope-title">
      <div><h3 id="txi-scope-title">Exporter uniquement une sélection</h3>
        <p>Filtre par période, compte, événement, type ou recherche, puis coche précisément les opérations à modifier.</p></div>
      <div className="txi-filters">
        <label>Du <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => updateFilter('from', event.target.value)}/></label>
        <label>Au <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => updateFilter('to', event.target.value)}/></label>
        <label>Compte
          <select value={filters.account} onChange={(event) => updateFilter('account', event.target.value)}>
            <option value="all">Tous les modes</option><option value="bank">Revolut (carte et virement)</option>
            <option value="cash">Espèces</option><option value="personal_advance">Avances à rembourser</option>
            <option value="unassigned">À ventiler (Excel)</option>
          </select></label>
        <label>Type
          <select value={filters.kind} onChange={(event) => updateFilter('kind', event.target.value)}>
            <option value="all">Recettes et dépenses</option><option value="income">Recettes</option><option value="expense">Dépenses</option>
          </select></label>
        <label>Événement
          <select value={filters.event} onChange={(event) => updateFilter('event', event.target.value)}>
            <option value="all">Tous les événements</option><option value="none">Sans événement</option>
            {(data.events || []).map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
          </select></label>
        <label>Recherche
          <input type="search" placeholder="Libellé, catégorie, note…" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)}/>
        </label>
      </div>
      <div className="txi-selection-tools">
        <strong>{matches.length} écriture(s) trouvée(s) · {selected.length} sélectionnée(s)</strong>
        <button type="button" className="ghost-button" onClick={() => setSelectedIds(null)} disabled={busy || !matches.length}>Tout sélectionner</button>
        <button type="button" className="ghost-button" onClick={() => setSelectedIds([])} disabled={busy || !selected.length}>Tout désélectionner</button>
        <button type="button" className="ghost-button" onClick={() => {setFilters(DEFAULT_FILTERS); setSelectedIds(null)}} disabled={busy}>Effacer les filtres</button>
      </div>
      <details className="txi-selection-list">
        <summary>Choisir les écritures une par une</summary>
        {matches.slice(0, 150).map((entry) => {
          const item = normalizedEntry(entry)
          return <label key={entry.id}>
            <input type="checkbox" checked={selectedSet.has(entry.id)} disabled={busy} onChange={() => toggleEntry(entry.id)}/>
            <span>{item.occurredOn} · {item.kind === 'income' ? 'Recette' : 'Dépense'} · {item.label}
              <small>{formatMoney(item.amountCents)} · {item.account}</small></span>
          </label>
        })}
        {!matches.length && <p>Aucune écriture modifiable dans ce périmètre.</p>}
        {matches.length > 150 && <p>Les 150 premières opérations sont affichées. Affine les filtres pour choisir individuellement les autres.</p>}
      </details>
      <div className="txi-selection-download">
        <button type="button" className="primary-button" onClick={exportSelected}
          disabled={busy || !selected.length || selected.length > 500}>
          ↓ Exporter ces {selected.length} écriture(s) en Excel
        </button>
        {selected.length > 500 && <p role="alert">500 opérations maximum par fichier modifiable. Affine tes filtres ou désélectionne certaines lignes.</p>}
        <small>Les écritures protégées (cotisations de foyer, avances déjà remboursées, opérations annulées) se gèrent sur le site et ne figurent pas parmi les lignes modifiables.</small>
      </div>
    </section>

    <div className="txi-actions">
      <button type="button" className="ghost-button" onClick={() => downloadFinancialBackup(data)} disabled={busy}>↓ Sauvegarde complète de tous les comptes</button>
      <button type="button" className="ghost-button" onClick={() => downloadWeeklyFinancialBackup(data)} disabled={busy}>↓ Sauvegarde complète de la semaine</button>
    </div>
    <div className="txi-guide">
      <strong>Comment modifier et réimporter seulement cette partie ?</strong>
      <p>Dans ton fichier partiel, modifie la feuille <b>« Écritures modifiables »</b> : libellé, montant, catégorie, compte, date, note, événement ou personne. Les autres feuilles apportent les identifiants de référence.</p>
      <p>Ne change ni les identifiants, ni le statut, ni le type, ni la référence de contrôle. Ne supprime pas de ligne pour annuler une opération : utilise l’onglet Historique. Au réimport, les lignes absentes du fichier et celles sans modification sont ignorées. Un fichier partiel n’indique pas le solde bancaire global.</p>
    </div>
    <label className="txi-upload"><strong>Réintégrer un fichier Excel corrigé, complet ou partiel</strong>
      <span>Importer un classeur .xlsx exporté depuis DANZ. Tu pourras encore sélectionner les corrections à appliquer.</span>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={readFile} disabled={busy}/>
    </label>
    {busy && <p className="txi-hint">Vérification des données…</p>}
    {preview && <div className="txi-preview">
      <div><h3>Aperçu : {filename}</h3><p>{preview.changes.length} changement(s) détecté(s) · {preview.problems.length} ligne(s) à corriger</p></div>
      {preview.problems.length > 0 && <div className="txi-issues"><strong>L’importation est bloquée tant que ces problèmes subsistent.</strong>
        {preview.problems.map((problem, index) => <p key={index}>Ligne {problem.line} : {problem.message}</p>)}
      </div>}
      {preview.changes.length > 0 && <div className="txi-selection-tools">
        <strong>{selectedChanges.length} correction(s) cochée(s) sur {preview.changes.length}</strong>
        <button type="button" className="ghost-button" onClick={() => setSelectedChangeIds(null)} disabled={busy}>Tout cocher</button>
        <button type="button" className="ghost-button" onClick={() => setSelectedChangeIds([])} disabled={busy}>Tout décocher</button>
      </div>}
      {preview.changes.map((change) => <article key={change.id} className="txi-change">
        <label className="txi-change-checkbox"><input type="checkbox" checked={selectedChangeSet.has(change.id)} disabled={busy}
          onChange={() => {
            const next = new Set(selectedChangeSet)
            if (next.has(change.id)) next.delete(change.id)
            else next.add(change.id)
            setSelectedChangeIds([...next])
          }}/>
          <span><strong>Ligne {change.line} · {change.baseline.label}</strong><small>{change.id}</small></span></label>
        {change.altered.map((key) => <div key={key} className="txi-difference">
          <span>{FIELD_LABEL[key] || key}</span><del>{showValue(key, change.baseline[key])}</del><b>→ {showValue(key, change.next[key])}</b>
        </div>)}
      </article>)}
      <div className="txi-confirm"><button type="button" className="ghost-button" onClick={() => {setPreview(null);setFilename('');setSelectedChangeIds(null)}} disabled={busy}>Annuler l’aperçu</button>
        <button type="button" className="primary-button" disabled={busy || Boolean(preview.problems.length) || !selectedChanges.length} onClick={importChanges}>
          Valider et mettre à jour {selectedChanges.length} opération(s)
        </button></div>
    </div>}
  </section>
}
