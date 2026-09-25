import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import '../assistant-danz.css'

const greeting = { role: 'assistant', content: 'Bonjour ! Je suis ton assistant DANZ privé. Demande-moi une information ou une modification. Je te demanderai toujours confirmation avant de changer quoi que ce soit.' }
async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('danz-assistant', { body })
  if (error) {
    let detail
    try { detail = await error.context?.json?.() } catch (_) {}
    throw new Error(detail?.error || error.message || 'Assistant indisponible.')
  }
  if (data?.error) throw new Error(data.error)
  return data
}
export default function DanzAssistant() {
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(null)
  const [messages, setMessages] = useState([greeting])
  const [draft, setDraft] = useState('')
  const [proposal, setProposal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef(null)
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'end' }) }, [messages, proposal, open, error])
  useEffect(() => {
    if (!open) return undefined
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])
  async function show() {
    setOpen(true)
    setError('')
    try {
      const state = await invoke({ mode: 'status' })
      setReady(state.ready)
      if (!state.ready) setError(state.message || 'OPENAI_API_KEY doit être renseignée dans Supabase.')
    } catch (err) { setReady(false); setError(err.message) }
  }
  async function send(value = draft) {
    const content = value.trim()
    if (!content || busy || proposal || ready !== true) return
    const next = [...messages, { role: 'user', content }]
    setMessages(next)
    setDraft('')
    setBusy(true)
    setError('')
    try {
      const answer = await invoke({ mode: 'chat', messages: next.slice(-12).map(({ role, content: text }) => ({ role, content: text.slice(0, 1800) })) })
      setMessages((old) => [...old, { role: 'assistant', content: answer.reply }])
      setProposal(answer.proposal || null)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  async function decide(mode) {
    if (!proposal || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await invoke({ mode, action_id: proposal.id })
      setMessages((old) => [...old, { role: 'assistant', content: result.reply }])
      setProposal(null)
      if (mode === 'confirm') window.dispatchEvent(new Event('danz-assistant-change'))
    } catch (err) {
      setError(err.message)
      if (/expirée|déjà traitée/i.test(err.message)) setProposal(null)
    } finally { setBusy(false) }
  }
  return <>
    <button className="danz-ai-launch" type="button" aria-expanded={open} aria-haspopup="dialog"
      onClick={open ? () => setOpen(false) : show}>{open ? '✕ Fermer' : '✦ Assistant DANZ'}</button>
    {open && <section className="danz-ai-panel" role="dialog" aria-labelledby="danz-ai-title">
      <header className="danz-ai-header"><div><small>✦ Accès personnel</small><h2 id="danz-ai-title">Mon assistant DANZ</h2><p>Aucune modification sans confirmation</p></div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Fermer l’assistant">✕</button></header>
      <div className="danz-ai-feed" role="log" aria-live="polite">
        {messages.map((m, i) => <div key={i} className={'danz-ai-message ' + (m.role === 'user' ? 'user' : 'bot')}>{m.content}</div>)}
        {messages.length === 1 && ready && <div className="danz-ai-examples">
          {['Quel est le solde de Revolut et de la caisse ?', 'Quels sont les prochains événements ?', 'Je veux modifier le sous-titre du site.'].map((s) =>
            <button key={s} type="button" onClick={() => send(s)} disabled={busy}>{s}</button>)}
        </div>}
        {proposal && <div className="danz-ai-confirm"><strong>Modification à valider</strong><p>{proposal.summary}</p>
          {proposal.details?.map((detail, i) => <p className="danz-ai-change" key={i}>{detail}</p>)}
          <small>Cette proposition expire à {new Date(proposal.expires_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.</small>
          <div><button type="button" disabled={busy} onClick={() => decide('confirm')}>Confirmer</button>
            <button type="button" disabled={busy} onClick={() => decide('reject')}>Refuser</button></div></div>}
        {busy && <p className="danz-ai-status" role="status">Traitement en cours…</p>}
        {error && <p className="danz-ai-error" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form className="danz-ai-compose" onSubmit={(e) => { e.preventDefault(); send() }}>
        <label htmlFor="danz-ai-text">Ta demande</label>
        <div><textarea id="danz-ai-text" rows="2" maxLength="1800" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          placeholder={ready === false ? 'Clé API à configurer' : proposal ? 'Valide ou refuse la proposition.' : 'Pose ta question…'}
          disabled={busy || Boolean(proposal) || ready !== true} />
          <button type="submit" disabled={!draft.trim() || busy || Boolean(proposal) || ready !== true} aria-label="Envoyer">➤</button></div>
        <small>Réservé à ton compte · Connexion Internet requise</small>
      </form>
    </section>}
  </>
}
