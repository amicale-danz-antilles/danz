import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { eventPeople, eventOverview, buildEventGroups } from '../lib/eventFinance.js'
import { formatMoney } from '../lib/finance.js'
import '../treasury-events.css'

const parseMoney = (value) => {
  const text = String(value ?? '').replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN
  const cents = Math.round(Number(text) * 100)
  return Number.isSafeInteger(cents) ? cents : NaN
}
const dateToday = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
}
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : 'Sans date'
const money = (cents) => formatMoney(cents)
const categories = [['activity','Participation'],['meal','Repas'],['drinks','Boissons'],['other','Autre'],['adjustment','Régularisation']]
const defaultEventForm = () => ({title:'',date:dateToday()})
const icon = (type) => type === 'child' ? '🧒' : type === 'offline' ? '○' : '●'
const personCategory = (person) => person.type === 'child' ? 'Enfant' : person.type === 'offline' ? 'Sans compte' : 'Compte membre'
const dueMembership = (person, subscriptions, fee, charges, eventId) => {
  if (person.type === 'child') return {allowed:false,note:'Pas de cotisation enfant',fee:0}
  const pending = subscriptions.find((s) => s.user_id === person.id && person.type === 'account' && s.status === 'pending')
  if (pending) {
    const charge = charges.find((c) => c.id === pending.charge_id)
    if (charge?.event_id && charge.event_id !== eventId)
      return {allowed:false,note:'Cotisation liée à une autre soirée',fee:pending.amount_cents}
    return {allowed:true,note:'Cotisation déjà appelée',fee:pending.amount_cents}
  }
  const cutoff = new Date();cutoff.setDate(cutoff.getDate()+60)
  const cutoffDay = [cutoff.getFullYear(),String(cutoff.getMonth()+1).padStart(2,'0'),String(cutoff.getDate()).padStart(2,'0')].join('-')
  if (person.amicaliste && person.until && person.until > cutoffDay) return {allowed:false,note:'Cotisation à jour',fee:0}
  return {allowed:true,note:person.amicaliste ? 'Renouvellement' : 'Nouvelle cotisation',fee}
}
const personPrice = (person, event) => {
  if (!event?.pricing_enabled) return ''
  if (person.type === 'child') return event.child_prices?.[person.ageCategory] ? String(event.child_prices[person.ageCategory]/100).replace('.',',') : ''
  return String((person.amicaliste ? event.member_meal_cents : event.nonmember_meal_cents)/100).replace('.',',')
}
const amountFor = (person, event, global) => global !== '' ? global : personPrice(person, event)

export default function EventTreasury({ data, onReload, user }) {
  const events = data.events || []
  const [chosenEventId, setChosenEventId] = useState('')
  const [newEventOpen,setNewEventOpen] = useState(false)
  const [newEvent,setNewEvent] = useState(defaultEventForm)
  const [draft,setDraft] = useState({})
  const [query,setQuery] = useState('')
  const [householdFilter,setHouseholdFilter] = useState('')
  const [selectionFilter,setSelectionFilter] = useState('all')
  const [category,setCategory] = useState('activity')
  const [label,setLabel] = useState('')
  const [globalAmount,setGlobalAmount] = useState('')
  const [expanded,setExpanded] = useState({})
  const [checked,setChecked] = useState({})
  const [quick,setQuick] = useState(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const batchRef=useRef({payload:'',id:''})
  const { people, byKey } = useMemo(() => eventPeople(data),[data])
  const chosenId = chosenEventId || events[0]?.id || ''
  const activeEvent = events.find((e) => e.id === chosenId)
  const groups = useMemo(() => chosenId ? buildEventGroups(chosenId,data) : [],[chosenId,data])
  const overview = useMemo(() => chosenId ? eventOverview(chosenId,data) : null,[chosenId,data])
  const participating = useMemo(() => new Set(groups.flatMap((g) => g.people.map((p) => p.key))),[groups])
  const fee = Number(data.settings?.membership_fee_cents ?? 6000)
  const selected = Object.entries(draft).filter(([,value]) => value.selected).map(([key,value]) => ({person:byKey[key],...value})).filter((row)=>row.person)
  const selectedTotals = selected.reduce((acc,row) => {
    acc.event += Number.isFinite(parseMoney(row.amount)) ? parseMoney(row.amount) : 0
    if (row.membership) acc.membership += dueMembership(row.person,data.subscriptions || [],fee,data.charges || [],chosenId).fee
    acc.households.add(row.person.householdId)
    return acc
  },{event:0,membership:0,households:new Set()})
  const filteredPeople = people.filter((person) => {
    const text = (person.name + ' ' + person.householdName + ' ' + person.email).toLocaleLowerCase('fr')
    return text.includes(query.trim().toLocaleLowerCase('fr'))
      && (!householdFilter || person.householdId === householdFilter)
      && (selectionFilter !== 'selected' || draft[person.key]?.selected)
      && (selectionFilter !== 'new' || !participating.has(person.key))
  })
  const setPerson = (person, patch) => setDraft((previous) => ({
    ...previous,[person.key]:{selected:false,amount:amountFor(person,activeEvent,globalAmount),membership:false,...previous[person.key],...patch}
  }))
  const switchEvent = (id) => {
    setChosenEventId(id);setDraft({});setQuery('');setHouseholdFilter('');setChecked({});setQuick(null);setError('');setNotice('')
  }
  const applyGlobal = () => setDraft((prev) => Object.fromEntries(
    Object.entries(prev).map(([key,row]) => [key,row.selected ? {...row,amount:globalAmount} : row])
  ))
  const selectVisible = (value) => setDraft((prev) => {
    const next={...prev}
    for (const p of filteredPeople) next[p.key]={selected:value,amount:amountFor(p,activeEvent,globalAmount),membership:false,...prev[p.key],selected:value}
    return next
  })

  const execute = async (callback,message) => {
    if (busy) return false
    setBusy(true);setError('');setNotice('')
    try {
      await callback()
      await onReload()
      setNotice(message)
      return true
    } catch(e){setError(e.message || 'L’enregistrement a échoué.');return false}
    finally{setBusy(false)}
  }
  const makeRows = (rows) => rows.map(({person,amount,membership,chargeCategory,chargeLabel}) => {
    const cents = parseMoney(amount || '0')
    if (!person?.householdId) throw new Error('Rattachez chaque personne à un foyer avant de facturer.')
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000000)
      throw new Error('Corrigez les montants : deux décimales maximum et montant positif.')
    const member = membership && dueMembership(person,data.subscriptions || [],fee,data.charges || [],chosenId)
    if (membership && !member.allowed) throw new Error('Cotisation non disponible pour ' + person.name + '.')
    return {
      person_type:person.type,person_id:person.id,amount_cents:cents,
      membership:Boolean(membership),category:chargeCategory || category,
      label:(chargeLabel || label.trim() || ('Participation · ' + activeEvent.title)).slice(0,180),
    }
  })
  const sendRows = async (rows,{clear=false}={}) => {
    if(!activeEvent) return
    let payload
    try{payload=makeRows(rows)}catch(e){setError(e.message);return}
    if(!payload.length)return
    if (clear && rows.some((r)=>participating.has(r.person.key)&&parseMoney(r.amount)>0) &&
      !window.confirm('Certaines personnes sont déjà inscrites. Confirmer la création de dépenses supplémentaires pour elles ?'))return
    const signature=JSON.stringify({event:activeEvent.id,payload})
    if (batchRef.current.payload!==signature)batchRef.current={payload:signature,id:crypto.randomUUID()}
    const success=await execute(async()=>{
      const {data:result,error:saveError}=await supabase.rpc('treasury_assign_event_charges',{
        p_event_id:activeEvent.id,p_batch_id:batchRef.current.id,p_rows:payload
      })
      if(saveError)throw saveError
      return result
    },payload.length+' personne(s) enregistrée(s) dans '+activeEvent.title+'.')
    // Conserver la clé de lot si l'enregistrement a réussi mais le rechargement a échoué :
    // retenter ne créera jamais les mêmes dettes une deuxième fois.
    if(success){
      if(clear){setDraft({});setGlobalAmount('');setLabel('')}
      setQuick(null)
      batchRef.current={payload:'',id:''}
    }
    return success
  }
  const createEvent = (event) => {
    event.preventDefault()
    if(newEvent.title.trim().length<3 || !newEvent.date){setError('Renseignez un titre et une date.');return}
    execute(async()=>{
      const {data:created,error:e}=await supabase.from('events').insert({
        title:newEvent.title.trim(),starts_at:new Date(newEvent.date+'T18:00:00').toISOString(),created_by:user.id,
        published:false,notify_on_publish:false,audience:'everyone',pricing_enabled:false
      }).select('id').single()
      if(e)throw e
      setChosenEventId(created.id);setNewEventOpen(false);setNewEvent(defaultEventForm());setDraft({})
    },'Événement financier créé : il n’est pas publié dans l’agenda.')
  }
  const collect = (group,method) => {
    const unpaid=group.charges.filter((c)=>c.status==='open'&&c.dueCents>0&&checked[c.id]!==false)
    if(!unpaid.length){setError('Cochez au moins une dette de ce foyer.');return}
    const total=unpaid.reduce((sum,row)=>sum+row.dueCents,0)
    const account=method==='cash'?'la caisse (liquide)':'Revolut'
    if(!window.confirm('Confirmer le règlement réel de '+money(total)+' par le foyer « '+group.name+' » sur '+account+' ? Seules les dettes cochées seront réglées.'))return
    execute(async()=>{
      const {error:e}=await supabase.rpc('treasury_collect_event',{
        p_event_id:chosenId,p_household_id:group.householdId,p_charge_ids:unpaid.map((c)=>c.id),p_method:method
      })
      if(e)throw e
      setChecked({})
    },'Paiement confirmé pour '+group.name+' : '+money(total)+'.')
  }
  const quickCharge = (event) => {
    event.preventDefault()
    if(!quick)return
    const person=byKey[quick.personKey]
    sendRows([{person,amount:quick.amount,membership:quick.membership,chargeCategory:quick.category,chargeLabel:quick.label}],{clear:false})
  }
  const addMembership = (person) => {
    if(!window.confirm('Appeler la cotisation de '+money(dueMembership(person,data.subscriptions || [],fee,data.charges || [],chosenId).fee)+' pour '+person.name+' sur cet événement ? Le paiement sera enregistré séparément.'))return
    sendRows([{person,amount:'0',membership:true}],{clear:false})
  }

  return <div className="evt-finance">
    {error && <div className="alert error" role="alert">{error}<button type="button" aria-label="Fermer" onClick={()=>setError('')}>×</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <div className="evt-headline"><div><span className="tv2-eyebrow">Suivi financier par événement</span><h2>Mes événements</h2><p>Une fiche par soirée : participants, foyers, dettes, cotisations et encaissements au même endroit.</p></div><button type="button" className="tv2-action" onClick={()=>setNewEventOpen((v)=>!v)}>＋ Événement interne</button></div>
    {newEventOpen && <form className="tv2-panel evt-create" onSubmit={createEvent}>
      <div><h3>Créer une fiche d’événement</h3><p>Événement privé, non publié dans l’agenda et sans notification. Vous pourrez ensuite lui rattacher des participants.</p></div>
      <label>Nom de l’événement<input required maxLength={160} autoFocus value={newEvent.title} onChange={(e)=>setNewEvent({...newEvent,title:e.target.value})} placeholder="Soirée Time’s Up" /></label>
      <label>Date<input required type="date" value={newEvent.date} onChange={(e)=>setNewEvent({...newEvent,date:e.target.value})} /></label>
      <button className="primary-button" disabled={busy}>Créer et ouvrir</button>
    </form>}
    {events.length ? <div className="evt-event-strip" role="list" aria-label="Choisir un événement">{events.map((ev)=>{
      const totals=eventOverview(ev.id,data)
      const fraction=totals.total>0?Math.min(100,totals.paid/totals.total*100):0
      return <button role="listitem" type="button" className={'evt-event-card '+(chosenId===ev.id?'active':'')} key={ev.id} onClick={()=>switchEvent(ev.id)} aria-current={chosenId===ev.id?'true':undefined}>
        <small>{dateLabel(ev.starts_at)}{ev.published===false?' · Interne':''}</small>
        <strong>{ev.title}</strong>
        <span>{totals.participants} participant{totals.participants>1?'s':''} · {totals.households} foyer{totals.households>1?'s':''}</span>
        <div className="evt-card-money"><b>{money(totals.due)} dû</b><em>{money(totals.paid)} encaissé</em></div>
        <span className="evt-bar"><i style={{width:fraction+'%'}}/></span>
      </button>
    })}</div> : <div className="tv2-panel"><h3>Aucun événement enregistré</h3><p>Créez votre première fiche pour attribuer les dépenses d’une soirée aux bons foyers.</p></div>}

    {activeEvent && <>
      <header className="evt-selected-head"><div><span className="tv2-eyebrow">Événement sélectionné · {dateLabel(activeEvent.starts_at)}</span><h2>{activeEvent.title}</h2></div><span className="evt-tag">{activeEvent.published?'Dans l’agenda':'Événement interne'}</span></header>
      <div className="evt-totals">
        <article><small>Participants</small><strong>{overview.participants}</strong><span>{overview.households} foyers</span></article>
        <article><small>Total facturé</small><strong>{money(overview.total)}</strong><span>Participation + cotisations liées</span></article>
        <article><small>Déjà encaissé</small><strong>{money(overview.paid)}</strong><span>Règlements confirmés</span></article>
        <article className={overview.due>0?'evt-due':''}><small>Reste à recevoir</small><strong>{money(overview.due)}</strong><span>{overview.charges} dette(s) actives</span></article>
      </div>
      <details className="tv2-panel evt-add-people" open={Object.values(draft).some((d)=>d.selected)||undefined}>
        <summary><strong>＋ Inscrire / facturer plusieurs personnes</strong><span>Choisir 15 participants, répartir automatiquement sur leurs foyers et ajouter les cotisations</span></summary>
        <div className="evt-add-content">
          <div className="evt-tools">
            <label>Libellé de la dépense<input value={label} onChange={(e)=>setLabel(e.target.value)} placeholder={'Ex. Participation · '+activeEvent.title} maxLength={180}/></label>
            <label>Type de dépense<select value={category} onChange={(e)=>setCategory(e.target.value)}>{categories.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label>
            <label>Montant commun (€)<input inputMode="decimal" value={globalAmount} onChange={(e)=>setGlobalAmount(e.target.value)} placeholder={activeEvent.pricing_enabled?'Tarif prévu ou saisie libre':'Ex. 15,00'}/></label>
            <button type="button" className="ghost-button" onClick={applyGlobal} disabled={!selected.length||!globalAmount}>Appliquer aux sélectionnés</button>
          </div>
          <div className="evt-filterbar">
            <input value={query} type="search" aria-label="Rechercher une personne" onChange={(e)=>setQuery(e.target.value)} placeholder="Nom, foyer, e-mail…" />
            <select aria-label="Filtrer par foyer" value={householdFilter} onChange={(e)=>setHouseholdFilter(e.target.value)}><option value="">Tous les foyers</option>{data.households.map((h)=><option key={h.id} value={h.id}>{h.name}</option>)}</select>
            <select aria-label="Filtrer les participants" value={selectionFilter} onChange={(e)=>setSelectionFilter(e.target.value)}><option value="all">Toutes les personnes</option><option value="new">Pas encore inscrits</option><option value="selected">Ma sélection</option></select>
            <button type="button" className="ghost-button" onClick={()=>selectVisible(true)}>Tout sélectionner</button>
            <button type="button" className="ghost-button" onClick={()=>selectVisible(false)}>Tout désélectionner</button>
          </div>
          <div className="evt-roster">
            <div className="evt-roster-head"><span>Participant / foyer</span><span>Participation (€)</span><span>＋ Cotisation</span></div>
            {filteredPeople.map((person)=>{
              const row=draft[person.key] || {selected:false,amount:amountFor(person,activeEvent,globalAmount),membership:false}
              const member=dueMembership(person,data.subscriptions || [],fee,data.charges || [],chosenId)
              return <div className={'evt-roster-row '+(row.selected?'selected':'')} key={person.key}>
                <label className="evt-person-toggle"><input type="checkbox" checked={row.selected} onChange={(e)=>setPerson(person,{selected:e.target.checked})}/><span className="evt-avatar" aria-hidden="true">{icon(person.type)}</span><span className="evt-person-text"><strong>{person.name}</strong><small>{person.householdName} · {personCategory(person)}{participating.has(person.key)?' · Déjà inscrit':''}</small></span></label>
                <input className="evt-money-input" inputMode="decimal" aria-label={'Montant pour '+person.name} value={row.amount} placeholder="0,00" onChange={(e)=>setPerson(person,{selected:true,amount:e.target.value})}/>
                <label className="evt-member-toggle" title={member.note}><input type="checkbox" disabled={!member.allowed} checked={Boolean(row.membership)} onChange={(e)=>setPerson(person,{selected:true,membership:e.target.checked})}/><span>{member.allowed?'＋ '+money(member.fee):member.note}</span></label>
              </div>
            })}
          </div>
          {!filteredPeople.length && <p className="tv2-empty">Aucune personne correspondante. Ajoutez d’abord les personnes sans compte dans « Membres & accès ».</p>}
          <div className="evt-batch-footer"><div><strong>{selected.length} personne{selected.length>1?'s':''} · {selectedTotals.households.size} foyer{selectedTotals.households.size>1?'s':''}</strong><small>{money(selectedTotals.event)} de participations + {money(selectedTotals.membership)} de cotisations à appeler.</small></div>
          <button type="button" disabled={busy||!selected.length} className="primary-button" onClick={()=>sendRows(selected,{clear:true})}>{busy?'Enregistrement…':'Enregistrer les '+selected.length+' participants'}</button></div>
          <p className="tv2-hint">Sélectionner une personne déjà inscrite avec un montant non nul crée une dépense supplémentaire. Un montant de 0 € permet d’ajouter seulement sa présence ou sa cotisation. Aucun encaissement n’est créé avant de confirmer un paiement réel.</p>
        </div>
      </details>

      <section className="evt-households"><div className="evt-section-heading"><div><span className="tv2-eyebrow">Suivi par foyer</span><h3>Dettes et règlements · {groups.length} foyers</h3></div><small>Chaque ligne indique qui doit quoi et ce qui a déjà été encaissé.</small></div>
        {groups.length===0 && <div className="tv2-panel evt-empty"><strong>Aucun participant ou aucune dette pour cet événement.</strong><span>Utilisez le formulaire au-dessus pour inscrire les participants et les rattacher aux foyers existants.</span></div>}
        {groups.map((group)=>{
          const isOpen=expanded[group.householdId] !== false
          const dueCharges=group.charges.filter((c)=>c.status==='open'&&c.dueCents>0)
          const toPay=dueCharges.filter((c)=>checked[c.id]!==false)
          const selectedTotal=toPay.reduce((sum,c)=>sum+c.dueCents,0)
          return <article className={'evt-household '+(group.due===0?'evt-settled':'')} key={group.householdId}>
            <button type="button" className="evt-household-head" onClick={()=>setExpanded((v)=>({...v,[group.householdId]:!isOpen}))} aria-expanded={isOpen}>
              <span className="evt-chevron">{isOpen?'⌄':'›'}</span><span className="evt-household-name"><strong>{group.name}</strong><small>{group.people.map((p)=>p.name.replace(' (ancienne fiche)','')).join(' · ') || 'Dette du foyer'} · {group.charges.filter((c)=>c.status==='open').length} ligne(s)</small></span>
              <span className="evt-household-stats"><b>{money(group.due)} restant</b><small>{money(group.paid)} / {money(group.total)} réglés</small></span><span className={'evt-household-state '+(group.due>0?'due':'ok')}>{group.due>0?'À encaisser':'À jour'}</span>
            </button>
            {isOpen && <div className="evt-household-body">
              <div className="evt-charge-list">
                {group.charges.map((charge)=>{
                  const isDue=charge.dueCents>0&&charge.status==='open'
                  const owner=byKey[charge.personKey]
                  const canMember=owner && dueMembership(owner,data.subscriptions || [],fee,data.charges || [],chosenId).allowed
                  return <div className={'evt-charge '+(!isDue?'paid':'')} key={charge.id}>
                    <label className="evt-charge-check"><input type="checkbox" aria-label={'Encaisser '+charge.label+' pour '+charge.personName} checked={isDue&&checked[charge.id]!==false} disabled={!isDue} onChange={(e)=>setChecked((p)=>({...p,[charge.id]:e.target.checked}))}/>
                      <span className="evt-charge-details"><strong>{charge.personName} · {charge.label}</strong><small>{charge.category==='membership'?'Cotisation':categories.find(([id])=>id===charge.category)?.[1] || charge.category} · {money(charge.amount_cents)} facturé{charge.paidCents>0?' · '+money(charge.paidCents)+' payé':''}</small></span></label>
                    <span className="evt-charge-amount">{isDue?money(charge.dueCents):charge.status==='cancelled'?'Annulé':'Soldé'}</span>
                    {canMember&&charge.category!=='membership'&&<button type="button" className="evt-inline" disabled={busy} onClick={()=>addMembership(owner)}>＋ Cotisation</button>}
                  </div>
                })}
              </div>
              {group.people.length>0 && <div className="evt-person-pills">{group.people.map((p)=>{
                const membership=dueMembership(p,data.subscriptions || [],fee,data.charges || [],chosenId)
                return <span className="evt-person-pill" key={p.key}><strong>{p.name.replace(' (ancienne fiche)','')}</strong><small>{p.type==='child'?'Enfant':p.amicaliste?'Amicaliste':membership.note}</small>
                  <button type="button" disabled={busy} onClick={()=>setQuick({personKey:p.key,amount:'',category:'activity',label:'Participation · '+activeEvent.title,membership:false})}>＋ Dette</button>
                  {membership.allowed&&<button type="button" disabled={busy} onClick={()=>addMembership(p)}>＋ Cotisation</button>}
                </span>
              })}</div>}
              {quick && group.people.some((p)=>p.key===quick.personKey) && <form className="evt-quick-form" onSubmit={quickCharge}>
                <strong>Nouvelle dette pour {byKey[quick.personKey]?.name}</strong>
                <input aria-label="Libellé" required value={quick.label} maxLength={180} onChange={(e)=>setQuick({...quick,label:e.target.value})}/>
                <input aria-label="Montant en euros" required inputMode="decimal" placeholder="€" value={quick.amount} onChange={(e)=>setQuick({...quick,amount:e.target.value})}/>
                <select aria-label="Catégorie" value={quick.category} onChange={(e)=>setQuick({...quick,category:e.target.value})}>{categories.map(([k,v])=><option value={k} key={k}>{v}</option>)}</select>
                <button type="submit" className="primary-button" disabled={busy}>Ajouter</button>
                <button type="button" className="ghost-button" onClick={()=>setQuick(null)}>Annuler</button>
              </form>}
              {dueCharges.length>0 && <div className="evt-pay-footer"><span><strong>{toPay.length} dette{toPay.length>1?'s':''} cochée{toPay.length>1?'s':''}</strong><b>{money(selectedTotal)}</b></span><button type="button" disabled={!toPay.length||busy} className="evt-pay-cash" onClick={()=>collect(group,'cash')}>✓ Reçu en caisse</button><button type="button" disabled={!toPay.length||busy} className="evt-pay-bank" onClick={()=>collect(group,'bank_transfer')}>✓ Reçu sur Revolut</button></div>}
              {!group.charges.length && <p className="tv2-hint">Présence enregistrée, aucune dépense attribuée pour le moment.</p>}
            </div>}
          </article>
        })}
      </section>
      <div className="evt-footer-note">Les charges et les paiements apparaissent aussi dans « Cotisations & dettes », les comptes Revolut/caisse et la sauvegarde Excel complète. Les paiements bancaires ne sont confirmés qu’après réception effective.</div>
    </>}
  </div>
}
