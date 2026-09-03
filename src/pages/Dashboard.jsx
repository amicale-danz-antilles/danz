import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import '../extra.css'

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const [latestNews, setLatestNews] = useState(null)
  const [nextEvent, setNextEvent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase
        .from('news')
        .select('id,title,summary,publish_at,published_at')
        .eq('published', true)
        .order('publish_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('events')
        .select('id,title,description,starts_at,ends_at,location')
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]).then(([newsResult, eventResult]) => {
      setLatestNews(newsResult.data || null)
      setNextEvent(eventResult.data || null)
      setLoading(false)
    })
  }, [])

  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0] || ''

  return <div className="home-dashboard">
    <section className="home-welcome">
      <div className="home-welcome-copy">
        <span className="eyebrow">Amicale DANZ Antilles</span>
        <h1>{firstName ? `Bonjour ${firstName} !` : 'Bienvenue !'}</h1>
        <p>Votre espace rassemble les informations utiles de la DANZ et de l’Amicale. Retrouvez directement les prochains rendez-vous, les dernières informations, les documents et les photos partagées.</p>
      </div>
      <img className="home-welcome-logo" src="/danz/amicale-danz-icon.png" alt="Insigne DANZ Antilles" />
    </section>

    {isAdmin && <section className="home-admin-banner">
      <div><strong>Vous êtes connecté en administrateur</strong><span>Publiez une information, programmez-la ou gérez les contenus existants.</span></div>
      <Link to="/administration/contenus">Publier / gérer</Link>
    </section>}

    <section>
      <div className="home-section-title">
        <div><span className="eyebrow">À voir maintenant</span><h2>L’essentiel en un coup d’œil</h2></div>
        <p>Les informations les plus récentes pour votre profil</p>
      </div>

      <div className="home-priority-grid" style={{marginTop:'16px'}}>
        <article className="home-priority event">
          <span className="eyebrow" style={{color:'#efd59d'}}>Prochain événement</span>
          {loading ? <div className="skeleton-card" style={{marginTop:'16px'}} /> : nextEvent ? <>
            <div className="home-priority-top" style={{marginTop:'12px'}}>
              <div>
                <h3>{nextEvent.title}</h3>
                {nextEvent.location && <p>📍 {nextEvent.location}</p>}
                <small>{new Date(nextEvent.starts_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}{nextEvent.ends_at ? ` — ${new Date(nextEvent.ends_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}` : ''}</small>
              </div>
              <div className="home-big-date"><strong>{new Date(nextEvent.starts_at).getDate()}</strong><span>{new Date(nextEvent.starts_at).toLocaleDateString('fr-FR',{month:'short'})}</span></div>
            </div>
            <Link className="home-more" to="/agenda">Voir l’événement dans l’agenda →</Link>
          </> : <><h3 style={{marginTop:'16px'}}>Aucun événement à venir</h3><p>Les prochains rendez-vous apparaîtront ici dès leur publication.</p><Link className="home-more" to="/agenda">Ouvrir l’agenda →</Link></>}
        </article>

        <article className="home-priority">
          <span className="eyebrow">Dernière information</span>
          {loading ? <div className="skeleton-card" style={{marginTop:'16px'}} /> : latestNews ? <>
            <small style={{color:'var(--coral)',fontWeight:700,marginTop:'13px'}}>{formatDate(latestNews.publish_at || latestNews.published_at)}</small>
            <h3>{latestNews.title}</h3>
            <p>{latestNews.summary || 'Une nouvelle information est disponible dans les actualités.'}</p>
            <Link className="home-more" to="/actualites">Lire les actualités →</Link>
          </> : <><h3 style={{marginTop:'16px'}}>Pas encore d’actualité</h3><p>Les informations publiées par le bureau apparaîtront ici.</p><Link className="home-more" to="/actualites">Voir les actualités →</Link></>}
        </article>
      </div>
    </section>

    <section>
      <div className="home-section-title">
        <div><span className="eyebrow">Accès rapide</span><h2>Que cherchez-vous ?</h2></div>
      </div>
      <div className="home-shortcuts" style={{marginTop:'16px'}}>
        <Link className="home-shortcut" to="/agenda"><span className="home-shortcut-icon">📅</span><strong>Agenda</strong><span>Événements, horaires et ajout au calendrier personnel.</span></Link>
        <Link className="home-shortcut" to="/actualites"><span className="home-shortcut-icon">📣</span><strong>Actualités</strong><span>Informations et messages publiés pour votre profil.</span></Link>
        <Link className="home-shortcut" to="/documents"><span className="home-shortcut-icon">📄</span><strong>Documents</strong><span>Notes, fichiers et ressources internes à consulter.</span></Link>
        <Link className="home-shortcut" to="/galerie"><span className="home-shortcut-icon">📷</span><strong>Photos</strong><span>Galerie et souvenirs partagés par l’Amicale.</span></Link>
      </div>
    </section>
  </div>
}

function formatDate(value){
  return new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})
}
