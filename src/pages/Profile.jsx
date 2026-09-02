import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { PageTitle } from './Actualites.jsx'

export default function Profile(){
 const {user}=useAuth()
 const [profile,setProfile]=useState(null)
 const [password,setPassword]=useState('')
 const [confirm,setConfirm]=useState('')
 const [message,setMessage]=useState('')
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 useEffect(()=>{supabase.from('profiles').select('*').eq('id',user.id).single().then(({data})=>setProfile(data))},[user.id])

 const updatePassword=async(e)=>{
   e.preventDefault(); setError(''); setMessage('')
   if(password.length<8){setError('Le mot de passe doit contenir au moins 8 caractères.');return}
   if(password!==confirm){setError('Les deux mots de passe ne correspondent pas.');return}
   setBusy(true)
   const {error:updateError}=await supabase.auth.updateUser({password})
   if(updateError)setError(updateError.message)
   else{setMessage('Mot de passe enregistré.');setPassword('');setConfirm('')}
   setBusy(false)
 }

 return <><PageTitle eyebrow="Compte" title="Mon profil" text="Les informations liées à votre accès amicaliste." /><div className="profile-card"><div className="profile-avatar">{(profile?.full_name||user.email||'A')[0].toUpperCase()}</div><div><h2>{profile?.full_name||'Amicaliste'}</h2><p>{user.email}</p><span className="role-badge">{profile?.role==='admin'?'Membre du bureau':'Amicaliste'}</span></div></div><div className="text-panel"><h2>Mot de passe</h2><p>Vous pouvez définir ou modifier ici le mot de passe utilisé pour vos prochaines connexions.</p>{error&&<div className="alert error">{error}</div>}{message&&<div className="alert">{message}</div>}<form onSubmit={updatePassword}><label>Nouveau mot de passe<input type="password" minLength="8" required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} /></label><label>Confirmer le mot de passe<input type="password" minLength="8" required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} /></label><button className="primary-button" disabled={busy}>{busy?'Enregistrement…':'Enregistrer le mot de passe'}</button></form></div></>
}
