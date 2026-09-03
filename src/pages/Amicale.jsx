import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'
import '../extra.css'

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

    <div className="mission-grid">
      <article className="mission-card"><span>01</span><h2>Créer du lien</h2><p>Favoriser les rencontres entre collègues et entre générations, dans un cadre convivial au-delà de l'activité professionnelle.</p></article>
      <article className="mission-card"><span>02</span><h2>Partager</h2><p>Faire circuler les informations utiles, valoriser les initiatives et conserver les souvenirs de nos moments communs.</p></article>
      <article className="mission-card"><span>03</span><h2>Se retrouver</h2><p>Organiser des activités culturelles, sportives, familiales et festives adaptées aux attentes des amicalistes.</p></article>
    </div>

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
            <input autoFocus type="text" placeholder="Nom Prénom" value={name} onChange={(e) => setName(e.target.value)} />
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
