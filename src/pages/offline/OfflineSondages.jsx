import { useMemo } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { readOfflineEntry } from '../../lib/offlineCache.js'
import { PageTitle } from '../Actualites.jsx'
import '../../polls-bureau.css'
import '../../offline-v2.css'

const isOpen=poll=>poll.active===true&&(!poll.closes_at||new Date(poll.closes_at).getTime()>Date.now())

export default function OfflineSondages(){
  const {user}=useAuth()
  const entry=readOfflineEntry(user?.id,'polls')
  const snapshot=entry?.data||{polls:[],options:[],votes:[]}
  const optionsByPoll=useMemo(()=>{
    const result={}
    for(const option of snapshot.options||[]){
      if(!result[option.poll_id])result[option.poll_id]=[]
      result[option.poll_id].push(option)
    }
    return result
  },[snapshot.options])
  const votes=useMemo(()=>Object.fromEntries((snapshot.votes||[]).map(vote=>[vote.poll_id,vote.option_id])),[snapshot.votes])
  const active=(snapshot.polls||[]).filter(isOpen)
  const closed=(snapshot.polls||[]).filter(poll=>!isOpen(poll))

  return <>
    <PageTitle eyebrow="Mode hors ligne" title="Sondages" text="Dernière copie disponible en lecture seule. Reconnectez-vous pour voter ou modifier votre choix."/>
    <OfflineNotice savedAt={entry?.savedAt}/>
    {!entry?<div className="empty-state">Aucune copie des sondages n’a encore été enregistrée sur cet appareil. Ouvrez le site une fois avec Internet pour préparer le mode hors ligne.</div>:<>
      <PollGroup title="Sondages ouverts" polls={active} optionsByPoll={optionsByPoll} votes={votes}/>
      {closed.length>0&&<PollGroup title="Sondages clôturés" polls={closed} optionsByPoll={optionsByPoll} votes={votes}/>} 
    </>}
  </>
}

function OfflineNotice({savedAt}){
  return <div className="offline-v2-notice"><strong>Lecture seule</strong><span>{savedAt?`Copie synchronisée le ${new Date(savedAt).toLocaleString('fr-FR')}. `:''}Les résultats peuvent avoir évolué depuis.</span></div>
}

function PollGroup({title,polls,optionsByPoll,votes}){
  return <section className="poll-section"><div className="section-heading"><div><span className="eyebrow">Copie locale</span><h2>{title}</h2></div></div><div className="poll-list">{polls.length?polls.map(poll=><OfflinePoll key={poll.id} poll={poll} options={optionsByPoll[poll.id]||[]} vote={votes[poll.id]}/>):<div className="empty-state">Aucun sondage dans cette rubrique.</div>}</div></section>
}

function OfflinePoll({poll,options,vote}){
  const open=isOpen(poll)
  const total=options.reduce((sum,option)=>sum+Number(option.vote_count||0),0)
  return <article className="poll-card offline-readonly-card"><div className="poll-card-head"><div><span className={`poll-status ${open?'open':'closed'}`}>{open?'Vote ouvert':'Vote clôturé'}</span><h3>{poll.title}</h3>{poll.description&&<p>{poll.description}</p>}<small>{poll.closes_at?`Clôture : ${new Date(poll.closes_at).toLocaleString('fr-FR')}`:'Sans date de clôture'}</small></div></div><div className="poll-options">{options.map(option=>{
    const count=Number(option.vote_count||0),percent=total?Math.round(count/total*100):0,selected=vote===option.id
    return <div className={`poll-option offline-poll-option ${selected?'selected':''}`} key={option.id}><div className="poll-option-top"><span>{selected?'✓ ':''}{option.label}</span><strong>{count} voix · {percent}%</strong></div><span className="poll-result-bar"><span style={{width:`${percent}%`}}/></span></div>
  })}</div><small className="poll-total">{total} vote{total>1?'s':''} · Reconnexion requise pour participer.</small></article>
}
