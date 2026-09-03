import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'
import '../polls-bureau.css'

export default function Amicale(){
  const { isAdmin, user } = useAuth()
  const [bureau, setBureau] = useState([])
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadBureau = async () => {
    const { data, error: loadError } = await supabase
      .from('bureau_members')
      .select('role_key,role_label,full_name,sort_order')
      .order('sort_order')
    if (loadError) setError(loadError.message)
    setBureau(data || [])
  }

  useEffect(() => { loadBureau() }, [])

  const beginEdit = (member) => {
    if (!isAdmin) return
    setEditing(member.role_key)
    setName(member.full_name || '')
    setError('')
  }

  const saveMember = async (member) => {
    setSaving(true)
    setError('')
    const { error: updateError } = await supabase
      .from('bureau_members')
      .update({
        full_name: name.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq('role_key', member.role_key)
    if (updateError) setError(updateError.message)
    else {
      setEditing(null)
      setName('')
      await loadBureau()
    }
    setSaving(false)
  }

  return <>
    <PageTitle eyebrow="Qui sommes-nous ?" title="L'Amicale" text="Un espace de convivialité, d'entraide et de partage pour les membres de la DANZ Antilles." />

    <section className="text-panel">
      <span className="eyebrow">L’association</span>
      <h2>Amicale DANZ Antilles</h2>
      <p><span className="role-badge">Depuis début 2025 · Association loi 1901</span></p>
      <p>Créée au début de l’année 2025, l’Amicale DANZ Antilles est une association régie par la loi du 1er juillet 1901 relative au contrat d’association.</p>
      <p>Elle a pour vocation de créer du lien entre les membres, de faciliter le partage d’informations et d’initiatives, et d’organiser des moments de rencontre conviviaux, culturels, sportifs, familiaux ou festifs.</p>
    </section>

    <section className="text-panel bureau-panel">
      <div className="bureau-heading">
        <div><span className="eyebrow">Organisation</span><h2>Membres du bureau</h2></div>
        {isAdmin && <small>Appuyez sur une fonction pour renseigner ou modifier le nom.</small>}
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="bureau-grid">
        {bureau.map((member) => <article
          className={`bureau-card ${isAdmin ? 'bureau-card-editable' : ''}`}
          key={member.role_key}
          onClick={() => beginEdit(member)}
        >
          {editing === member.role_key ? <div className="bureau-edit" onClick={(e) => e.stopPropagation()}>
            <span>{member.role_label}</span>
            <input autoFocus type="text" placeholder="Prénom Nom" value={name} onChange={(e) => setName(e.target.value)} />
            <div>
              <button type="button" className="secondary-button" disabled={saving} onClick={() => saveMember(member)}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              <button type="button" className="ghost-button" disabled={saving} onClick={() => { setEditing(null); setName('') }}>Annuler</button>
            </div>
          </div> : <>
            <span className="bureau-role">{member.role_label}</span>
            <strong>{member.full_name || 'À renseigner'}</strong>
            {isAdmin && <small>✏️ Modifier</small>}
          </>}
        </article>)}
      </div>
    </section>
  </>
}
