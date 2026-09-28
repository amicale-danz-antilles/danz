import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { chargePaidCents, chargeResidualCents, formatMoney } from '../lib/finance.js'
import { eventPeople, eventParticipationKey } from '../lib/eventFinance.js'
import { eventManagementEconomics, isMemberForEvent } from '../lib/membershipProfitability.js'
import { ledgerBalances } from '../lib/treasuryLedger.js'
import '../treasury-events.css'

const day = () => {
  const d = new Date()
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
}
const parseMoney = (value) => {
  const normalized=String(value ?? '').trim().replace(/\s/g,'').replace(',','.')
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized)*100) : NaN
}
const euros = (cents) => String(Number(cents || 0)/100).replace('.',',')
const eventDate = (value) => value ? new Date(value).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}) : '—'
const groupLabel = (group) => group==='member'?'Amicaliste':group==='child'?'Enfant':group==='guest'?'Extérieur':'Non-amicaliste'
const accountLabel = (method) => method==='cash'?'Caisse liquide':method==='personal_advance'?'Avance personnelle':'Revolut'

function priceFor(event,group){
  if(group==='member') return Number(event?.member_meal_cents || 0)
  if(group==='child') return Number(event?.child_prices?.default || 0)
  return Number(event?.nonmember_meal_cents || 0)
}

export default function EventTreasury({ data, onReload, user }) {
  const events=data.events || []
  const { people,byKey }=useMemo(()=>eventPeople(data),[data])
  const [eventId,setEventId]=useState('')
  const activeEvent=events.find((event)=>event.id===(eventId || events[0]?.id))
  const activeId=activeEvent?.id || ''
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [panel,setPanel]=useState('')
  const [newEvent,setNewEvent]=useState({title:'',date:day(),member:'0',nonmember:'',child:''})
  const [rules,setRules]=useState({member:'0',nonmember:'',child:''})
  const [participant,setParticipant]=useState({personKey:'',group:'nonmember',amount:''})
  const [guest,setGuest]=useState({name:'',email:'',group:'guest',amount:''})
  const [expense,setExpense]=useState({label:'Courses',amount:'',method:'bank_transfer',advancedBy:'',date:day(),note:''})
  const [editing,setEditing]=useState(null)
  const [editDraft,setEditDraft]=useState({group:'nonmember',amount:''})

  useEffect(()=>{
    if(!activeEvent)return
    setRules({
      member:euros(activeEvent.member_meal_cents),
      nonmember:euros(activeEvent.nonmember_meal_cents),
      child:euros(activeEvent.child_prices?.default || 0),
    })
    setParticipant({personKey:'',group:'nonmember',amount:euros(activeEvent.nonmember_meal_cents)})
    setGuest({name:'',email:'',group:'guest',amount:euros(activeEvent.nonmember_meal_cents)})
    setExpense({label:'Courses',amount:'',method:'bank_transfer',advancedBy:'',date:day(),note:''})
    setEditing(null);setPanel('');setError('');setNotice('')
  },[activeId])

  const balances=ledgerBalances(data.opening,data.entries || [],data.transfers || [])
  const economics=activeEvent ? eventManagementEconomics(activeEvent,data) : null
  const eventEntries=(data.entries || []).filter((entry)=>entry.event_id===activeId && entry.status!=='cancelled')
    .sort((a,b)=>new Date(b.occurred_at || b.created_at)-new Date(a.occurred_at || a.created_at))
  const pendingAdvances=eventEntries.filter((entry)=>entry.kind==='expense' && entry.payment_method==='personal_advance' && entry.status==='pending')
  const settledExpenses=eventEntries.filter((entry)=>entry.kind==='expense' && entry.status==='settled')

  const rows=useMemo(()=>{
    if(!activeId)return []
    return (data.eventParticipants || []).filter((row)=>row.event_id===activeId).map((row)=>{
      const key=eventParticipationKey(row)
      const person=byKey[key]
      const charge=row.charge_id ? (data.charges || []).find((item)=>item.id===row.charge_id) : (data.charges || []).find((item)=>
        item.event_id===activeId && item.status!=='cancelled' && item.category!=='membership' &&
        ((row.user_id && item.user_id===row.user_id)||(row.offline_person_id && item.offline_person_id===row.offline_person_id)||(row.household_member_id && item.household_member_id===row.household_member_id))
      )
      const paid=charge ? chargePaidCents(charge.id,data.allocations || [],data.payments || []) : 0
      const due=charge && charge.status!=='cancelled' ? chargeResidualCents(charge,data.allocations || [],data.payments || []) : 0
      return {row,key,person,charge,paid,due}
    }).filter((item)=>item.person).sort((a,b)=>b.due-a.due || a.person.name.localeCompare(b.person.name,'fr'))
  },[activeId,data.eventParticipants,data.charges,data.allocations,data.payments,byKey])

  const participantKeys=new Set(rows.map((item)=>item.key))
  const availablePeople=people.filter((person)=>!participantKeys.has(person.key)).sort((a,b)=>a.name.localeCompare(b.name,'fr'))
  const payers=people.filter((person)=>person.type!=='child').sort((a,b)=>a.name.localeCompare(b.name,'fr'))

  const isMemberAtEvent=(person)=>{
    if(!activeEvent || !person || person.type==='child')return false
    if(isMemberForEvent(person,data.subscriptions || [],activeEvent.starts_at))return true
    const eventDay=String(activeEvent.starts_at || '').slice(0,10)
    return Boolean(person.until && eventDay && person.until>=eventDay && person.amicaliste)
  }
  const suggestedGroup=(person)=>person?.type==='child'?'child':isMemberAtEvent(person)?'member':'nonmember'

  const run=async(callback,message)=>{
    if(busy)return false
    setBusy(true);setError('');setNotice('')
    try{await callback();await onReload();setNotice(message);return true}
    catch(err){setError(err.message || 'L’enregistrement a échoué.');return false}
    finally{setBusy(false)}
  }

  const saveRules=async(event)=>{
    event.preventDefault()
    if(!activeEvent)return
    const member=parseMoney(rules.member),nonmember=parseMoney(rules.nonmember),child=parseMoney(rules.child)
    if([member,nonmember,child].some((value)=>!Number.isSafeInteger(value)||value<0)){
      setError('Indiquez trois tarifs valides. Utilisez 0 pour une gratuité.');return
    }
    await run(async()=>{
      const {error:e}=await supabase.from('events').update({
        pricing_enabled:true,member_meal_cents:member,nonmember_meal_cents:nonmember,
        child_prices:{...(activeEvent.child_prices || {}),default:child},
        pricing_notes:'Tarifs de gestion définis dans la trésorerie',
      }).eq('id',activeEvent.id)
      if(e)throw e
    },'Tarifs enregistrés. Les prochains participants utiliseront automatiquement ces montants.')
  }

  const createEvent=async(event)=>{
    event.preventDefault()
    const member=parseMoney(newEvent.member),nonmember=parseMoney(newEvent.nonmember),child=parseMoney(newEvent.child)
    if(newEvent.title.trim().length<3 || !newEvent.date || [member,nonmember,child].some((v)=>!Number.isSafeInteger(v)||v<0)){
      setError('Renseignez le nom, la date et les trois tarifs. Utilisez 0 pour une gratuité.');return
    }
    let created=''
    const ok=await run(async()=>{
      const {data:row,error:e}=await supabase.from('events').insert({
        title:newEvent.title.trim(),starts_at:new Date(newEvent.date+'T18:00:00').toISOString(),
        created_by:user.id,published:false,notify_on_publish:false,audience:'everyone',
        pricing_enabled:true,member_meal_cents:member,nonmember_meal_cents:nonmember,
        child_prices:{default:child},pricing_notes:'Événement financier créé depuis la trésorerie',
      }).select('id').single()
      if(e)throw e
      created=row.id
    },'Événement créé. Vous pouvez maintenant ajouter les participants et les courses.')
    if(ok){setEventId(created);setNewEvent({title:'',date:day(),member:'0',nonmember:'',child:''})}
  }

  const choosePerson=(key)=>{
    const person=byKey[key]
    const group=suggestedGroup(person)
    setParticipant({personKey:key,group,amount:euros(priceFor(activeEvent,group))})
  }
  const changeParticipantGroup=(group)=>setParticipant((current)=>({...current,group,amount:euros(priceFor(activeEvent,group))}))
  const changeGuestGroup=(group)=>setGuest((current)=>({...current,group,amount:euros(priceFor(activeEvent,group))}))

  const addParticipant=async(event)=>{
    event.preventDefault()
    const person=byKey[participant.personKey]
    const amount=parseMoney(participant.amount)
    if(!person || !Number.isSafeInteger(amount)||amount<0){setError('Choisissez une personne et un montant valide.');return}
    const ok=await run(async()=>{
      const {error:e}=await supabase.rpc('treasury_event_set_participant_finance',{
        p_event_id:activeId,p_person_type:person.type,p_person_id:person.id,
        p_pricing_group:participant.group,p_price_cents:amount,p_label:'Participation · '+activeEvent.title,
      })
      if(e)throw e
    },person.name+' ajouté · '+(amount===0?'gratuit':formatMoney(amount)+' à payer')+'.')
    if(ok){setParticipant({personKey:'',group:'nonmember',amount:euros(activeEvent.nonmember_meal_cents)});setPanel('')}
  }

  const addGuest=async(event)=>{
    event.preventDefault()
    const amount=parseMoney(guest.amount)
    if(guest.name.trim().length<2 || !Number.isSafeInteger(amount)||amount<0){setError('Indiquez le nom et un montant valide.');return}
    const ok=await run(async()=>{
      const {error:e}=await supabase.rpc('treasury_event_create_guest',{
        p_event_id:activeId,p_name:guest.name.trim(),p_email:guest.email.trim()||null,
        p_pricing_group:guest.group,p_price_cents:amount,p_label:'Participation · '+activeEvent.title,
      })
      if(e)throw e
    },guest.name.trim()+' ajouté sans compte · '+(amount===0?'gratuit':formatMoney(amount)+' à payer')+'.')
    if(ok){setGuest({name:'',email:'',group:'guest',amount:euros(activeEvent.nonmember_meal_cents)});setPanel('')}
  }

  const saveParticipantEdit=async(item)=>{
    const amount=parseMoney(editDraft.amount)
    if(!Number.isSafeInteger(amount)||amount<0){setError('Montant invalide.');return}
    const ok=await run(async()=>{
      const {error:e}=await supabase.rpc('treasury_event_set_participant_finance',{
        p_event_id:activeId,p_person_type:item.person.type,p_person_id:item.person.id,
        p_pricing_group:editDraft.group,p_price_cents:amount,p_label:'Participation · '+activeEvent.title,
      })
      if(e)throw e
    },'Participation mise à jour.')
    if(ok)setEditing(null)
  }

  const collect=async(item,method)=>{
    if(!item.charge || item.due<=0)return
    const destination=method==='cash'?'la caisse':'Revolut'
    if(!window.confirm('Confirmer '+formatMoney(item.due)+' reçus de '+item.person.name+' sur '+destination+' ?'))return
    await run(async()=>{
      const {error:e}=await supabase.rpc('treasury_collect_event',{
        p_event_id:activeId,p_household_id:item.charge.household_id,p_charge_ids:[item.charge.id],p_method:method,
      })
      if(e)throw e
    },'Paiement confirmé : la dette et le solde '+destination+' sont mis à jour.')
  }

  const saveExpense=async(event)=>{
    event.preventDefault()
    const amount=parseMoney(expense.amount)
    if(!activeEvent || !expense.label.trim() || !Number.isSafeInteger(amount)||amount<=0){setError('Indiquez le motif et le montant de la dépense.');return}
    if(expense.method==='personal_advance' && !expense.advancedBy){setError('Choisissez qui a avancé l’argent.');return}
    const ok=await run(async()=>{
      if(expense.method==='personal_advance'){
        const offline=expense.advancedBy.startsWith('offline:')
        const id=expense.advancedBy.split(':')[1]
        const {error:e}=await supabase.from('treasury_entries').insert({
          kind:'expense',amount_cents:amount,label:expense.label.trim(),category:'courses',
          payment_method:'personal_advance',advanced_by:offline?null:id,advanced_by_offline:offline?id:null,
          event_id:activeId,note:expense.note.trim()||null,status:'pending',
          occurred_at:new Date(expense.date+'T12:00:00').toISOString(),created_by:user.id,
        })
        if(e)throw e
      }else{
        const {error:e}=await supabase.rpc('treasury_event_record_entry',{
          p_event_id:activeId,p_kind:'expense',p_amount_cents:amount,p_label:expense.label.trim(),
          p_method:expense.method,p_occurred_on:expense.date,p_note:expense.note.trim()||null,
        })
        if(e)throw e
      }
    },expense.method==='personal_advance'?'Dépense rattachée à l’événement et remboursement à faire créé.':'Dépense rattachée à l’événement et compte débité.')
    if(ok){setExpense({label:'Courses',amount:'',method:'bank_transfer',advancedBy:'',date:day(),note:''});setPanel('')}
  }

  if(!events.length)return <section className="evt-workspace">
    <div className="evt-empty-start"><span>Trésorerie événementielle</span><h2>Créez votre premier événement financier</h2><p>Définissez les tarifs une fois, puis ajoutez les participants et les courses.</p><button className="primary-button" onClick={()=>setPanel('new-event')}>Créer un événement</button></div>
    {panel==='new-event'&&<NewEventForm value={newEvent} setValue={setNewEvent} onSubmit={createEvent} busy={busy}/>}
  </section>

  return <div className="evt-workspace">
    <header className="evt-command">
      <div><span className="evt-kicker">Gestion par événement</span><h2>{activeEvent?.title}</h2><p>{eventDate(activeEvent?.starts_at)} · toutes les dépenses, participants et paiements au même endroit.</p></div>
      <div className="evt-command-picker"><select value={activeId} onChange={(e)=>setEventId(e.target.value)}>{events.map((event)=><option key={event.id} value={event.id}>{event.title} · {eventDate(event.starts_at)}</option>)}</select><button type="button" className="ghost-button" onClick={()=>setPanel(panel==='new-event'?'':'new-event')}>＋ Événement</button></div>
    </header>

    {error&&<div className="alert error" role="alert">{error}</div>}
    {notice&&<div className="alert success" role="status">{notice}</div>}
    {panel==='new-event'&&<NewEventForm value={newEvent} setValue={setNewEvent} onSubmit={createEvent} busy={busy}/>}

    <section className="evt-cash-strip">
      <article><small>Revolut</small><strong>{formatMoney(balances.bank || 0)}</strong><span>solde réel</span></article>
      <article><small>Caisse liquide</small><strong>{formatMoney(balances.cash || 0)}</strong><span>solde réel</span></article>
      <article><small>À recevoir sur cet événement</small><strong>{formatMoney(economics?.due || 0)}</strong><span>{rows.filter((item)=>item.due>0).length} paiement(s)</span></article>
      <article><small>Avances à rembourser</small><strong>{formatMoney(pendingAdvances.reduce((sum,item)=>sum+Number(item.amount_cents||0),0))}</strong><span>{pendingAdvances.length} avance(s)</span></article>
    </section>

    <section className="evt-profit-card">
      <div className="evt-profit-main">
        <span>Balance de l’événement</span>
        <strong className={(economics?.projected || 0)>=0?'positive':'negative'}>{(economics?.projected || 0)>=0?'+':''}{formatMoney(economics?.projected || 0)}</strong>
        <small>projection si toutes les participations dues sont payées</small>
      </div>
      <div className="evt-profit-grid">
        <div><small>Courses / dépenses</small><b>{formatMoney(economics?.cost || 0)}</b></div>
        <div><small>Déjà encaissé</small><b>{formatMoney(economics?.directReceived || 0)}</b></div>
        <div><small>Reste à recevoir</small><b>{formatMoney(economics?.due || 0)}</b></div>
        <div><small>Part cotisations</small><b>{formatMoney(economics?.membershipAllocation || 0)}</b></div>
        <div><small>Coût financé par l’Amicale</small><b>{formatMoney(economics?.projectedAssociationCost || 0)}</b></div>
      </div>
    </section>

    <section className="evt-primary-actions">
      <button type="button" onClick={()=>setPanel(panel==='participant'?'':'participant')}><span>＋</span><strong>Ajouter une personne</strong><small>Le tarif et la dette sont créés ensemble</small></button>
      <button type="button" onClick={()=>setPanel(panel==='expense'?'':'expense')}><span>−</span><strong>Ajouter une course / dépense</strong><small>Revolut, liquide ou avance personnelle</small></button>
    </section>

    {panel==='participant'&&<section className="evt-action-panel">
      <div className="evt-action-tabs"><button type="button" className={!guest.name?'active':''}>Personne connue</button><span>ou</span><strong>personne sans compte</strong></div>
      <div className="evt-two-forms">
        <form onSubmit={addParticipant}>
          <h3>Ajouter depuis la liste</h3>
          <label>Qui ?<select required value={participant.personKey} onChange={(e)=>choosePerson(e.target.value)}><option value="">Choisir…</option>{availablePeople.map((person)=><option key={person.key} value={person.key}>{person.name}{person.type==='child'?' · enfant':isMemberAtEvent(person)?' · amicaliste':''}</option>)}</select></label>
          <div className="evt-inline-fields"><label>Statut<select value={participant.group} onChange={(e)=>changeParticipantGroup(e.target.value)} disabled={byKey[participant.personKey]?.type==='child'}><option value="member">Amicaliste</option><option value="nonmember">Non-amicaliste</option><option value="child">Enfant</option><option value="guest">Extérieur</option></select></label><label>À payer (€)<input required inputMode="decimal" value={participant.amount} onChange={(e)=>setParticipant({...participant,amount:e.target.value})}/></label></div>
          <button className="primary-button" disabled={busy||!participant.personKey}>{parseMoney(participant.amount)===0?'Ajouter gratuitement':'Ajouter et créer la dette'}</button>
        </form>
        <form onSubmit={addGuest}>
          <h3>Ajouter sans compte</h3>
          <label>Nom<input required value={guest.name} onChange={(e)=>setGuest({...guest,name:e.target.value})} placeholder="Nom et prénom"/></label>
          <label>Email facultatif<input type="email" value={guest.email} onChange={(e)=>setGuest({...guest,email:e.target.value})} placeholder="facultatif"/></label>
          <div className="evt-inline-fields"><label>Statut<select value={guest.group} onChange={(e)=>changeGuestGroup(e.target.value)}><option value="guest">Extérieur</option><option value="nonmember">Non-amicaliste</option><option value="member">Amicaliste</option></select></label><label>À payer (€)<input required inputMode="decimal" value={guest.amount} onChange={(e)=>setGuest({...guest,amount:e.target.value})}/></label></div>
          <button className="primary-button" disabled={busy}>{parseMoney(guest.amount)===0?'Créer gratuitement':'Créer + dette'}</button>
        </form>
      </div>
    </section>}

    {panel==='expense'&&<section className="evt-action-panel">
      <form className="evt-expense-form" onSubmit={saveExpense}>
        <div><h3>Course / dépense de l’événement</h3><p>Une seule saisie : elle alimente le journal, le bon compte et la balance de l’événement.</p></div>
        <label>Pourquoi ?<input required value={expense.label} onChange={(e)=>setExpense({...expense,label:e.target.value})} placeholder="Courses Carrefour, boissons, location…"/></label>
        <label>Combien ? (€)<input required inputMode="decimal" value={expense.amount} onChange={(e)=>setExpense({...expense,amount:e.target.value})}/></label>
        <label>Qui a payé ?<select value={expense.method} onChange={(e)=>setExpense({...expense,method:e.target.value,advancedBy:''})}><option value="bank_transfer">Revolut</option><option value="cash">Caisse liquide</option><option value="personal_advance">Une personne a avancé</option></select></label>
        {expense.method==='personal_advance'&&<label>À rembourser à<select required value={expense.advancedBy} onChange={(e)=>setExpense({...expense,advancedBy:e.target.value})}><option value="">Choisir…</option>{payers.map((person)=><option key={person.key} value={person.type+':'+person.id}>{person.name}</option>)}</select></label>}
        <label>Date<input type="date" max={day()} required value={expense.date} onChange={(e)=>setExpense({...expense,date:e.target.value})}/></label>
        <label className="evt-wide">Note facultative<input value={expense.note} onChange={(e)=>setExpense({...expense,note:e.target.value})}/></label>
        <button className="primary-button" disabled={busy}>Enregistrer la dépense</button>
      </form>
    </section>}

    <section className="evt-participants-card">
      <div className="evt-section-title"><div><span>Participants</span><h3>{rows.length} personne{rows.length>1?'s':''}</h3></div><div className="evt-mini-stats"><span>{economics?.memberCount || 0} amicaliste(s)</span><span>{economics?.nonmemberCount || 0} extérieur(s)</span><span>{economics?.childCount || 0} enfant(s)</span></div></div>
      <div className="evt-participant-list">
        {rows.map((item)=>{
          const group=item.row.pricing_group || suggestedGroup(item.person)
          const price=Number(item.row.price_cents ?? item.charge?.amount_cents ?? 0)
          const paid=item.paid
          const settled=price===0 || item.due===0
          return <div className={'evt-participant-row '+(item.due>0?'due':'settled')} key={item.row.id}>
            <div className="evt-person"><strong>{item.person.name}</strong><span>{groupLabel(group)} · {price===0?'gratuit':formatMoney(price)}</span></div>
            <div className="evt-payment-state"><small>{price===0?'Gratuit':settled?'Payé':'À recevoir'}</small><b>{price===0?'—':item.due>0?formatMoney(item.due):formatMoney(paid)}</b></div>
            {item.due>0&&<div className="evt-pay-buttons"><button type="button" disabled={busy} onClick={()=>collect(item,'cash')}>Payé liquide</button><button type="button" disabled={busy} onClick={()=>collect(item,'bank_transfer')}>Payé Revolut</button></div>}
            <button type="button" className="evt-edit-link" onClick={()=>{setEditing(editing===item.row.id?null:item.row.id);setEditDraft({group,amount:euros(price)})}}>Modifier</button>
            {editing===item.row.id&&<div className="evt-participant-edit"><label>Statut<select value={editDraft.group} onChange={(e)=>setEditDraft({...editDraft,group:e.target.value})} disabled={item.person.type==='child'}><option value="member">Amicaliste</option><option value="nonmember">Non-amicaliste</option><option value="child">Enfant</option><option value="guest">Extérieur</option></select></label><label>Prix (€)<input inputMode="decimal" value={editDraft.amount} onChange={(e)=>setEditDraft({...editDraft,amount:e.target.value})}/></label><button type="button" className="primary-button" disabled={busy} onClick={()=>saveParticipantEdit(item)}>Enregistrer</button></div>}
          </div>
        })}
        {!rows.length&&<p className="evt-empty">Ajoutez les personnes présentes. Les personnes sans compte peuvent être créées ici en quelques secondes.</p>}
      </div>
    </section>

    <section className="evt-bottom-grid">
      <div className="evt-panel">
        <div className="evt-section-title"><div><span>Tarifs</span><h3>Règle de cet événement</h3></div></div>
        <form className="evt-rules-form" onSubmit={saveRules}>
          <label>Amicaliste (€)<input inputMode="decimal" value={rules.member} onChange={(e)=>setRules({...rules,member:e.target.value})}/><small>0 = gratuit</small></label>
          <label>Non-amicaliste (€)<input inputMode="decimal" value={rules.nonmember} onChange={(e)=>setRules({...rules,nonmember:e.target.value})}/></label>
          <label>Enfant (€)<input inputMode="decimal" value={rules.child} onChange={(e)=>setRules({...rules,child:e.target.value})}/></label>
          <button className="ghost-button" disabled={busy}>Enregistrer les tarifs</button>
        </form>
        <p className="evt-help">Ces tarifs servent de proposition automatique. Vous pouvez toujours modifier le prix d’une personne individuellement.</p>
      </div>
      <div className="evt-panel">
        <div className="evt-section-title"><div><span>Dépenses</span><h3>{settledExpenses.length} dépense(s) rattachée(s)</h3></div><b>{formatMoney(economics?.cost || 0)}</b></div>
        <div className="evt-expense-list">{eventEntries.filter((entry)=>entry.kind==='expense').slice(0,8).map((entry)=><div key={entry.id}><span><strong>{entry.label}</strong><small>{accountLabel(entry.payment_method)} · {eventDate(entry.occurred_at || entry.created_at)}{entry.status==='pending'?' · à rembourser':''}</small></span><b>{formatMoney(entry.amount_cents)}</b></div>)}</div>
        {!eventEntries.some((entry)=>entry.kind==='expense')&&<p className="evt-empty">Aucune course ou dépense enregistrée.</p>}
      </div>
    </section>
  </div>
}

function NewEventForm({value,setValue,onSubmit,busy}){
  return <section className="evt-action-panel evt-new-event-panel"><form className="evt-new-event-form" onSubmit={onSubmit}>
    <div><h3>Nouvel événement financier</h3><p>Les tarifs peuvent être changés ensuite pour chaque personne.</p></div>
    <label>Nom<input required value={value.title} onChange={(e)=>setValue({...value,title:e.target.value})} placeholder="Repas octobre, sortie bateau…"/></label>
    <label>Date<input required type="date" value={value.date} onChange={(e)=>setValue({...value,date:e.target.value})}/></label>
    <label>Amicaliste (€)<input required inputMode="decimal" value={value.member} onChange={(e)=>setValue({...value,member:e.target.value})}/><small>0 = gratuit</small></label>
    <label>Non-amicaliste (€)<input required inputMode="decimal" value={value.nonmember} onChange={(e)=>setValue({...value,nonmember:e.target.value})}/></label>
    <label>Enfant (€)<input required inputMode="decimal" value={value.child} onChange={(e)=>setValue({...value,child:e.target.value})}/></label>
    <button className="primary-button" disabled={busy}>Créer et commencer</button>
  </form></section>
}
