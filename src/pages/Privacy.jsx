import { Link } from 'react-router-dom'
import '../privacy.css'

export default function Privacy() {
  return <main className="privacy-page">
    <div className="privacy-wrap">
      <header className="privacy-header">
        <img src="/danz/Insigne%20CND%20-%20ANTILLES.png" alt="Insigne DANZ Antilles" />
        <div><span className="eyebrow">Amicale DANZ Antilles</span><h1>Politique de confidentialité</h1><p>Information relative au traitement des données personnelles de l’espace privé.</p></div>
      </header>

      <div className="privacy-version">Version du 9 septembre 2026 · Infrastructure en cours de migration vers OVHcloud France.</div>

      <section><h2>1. Responsable du traitement</h2><p>Le responsable du traitement est l’<strong>Amicale DANZ Antilles</strong>, représentée par son bureau. Les demandes relatives aux données personnelles peuvent être adressées au bureau de l’Amicale par les coordonnées habituelles de l’association.</p></section>

      <section><h2>2. Données utilisées</h2><p>Le site limite les informations personnelles à ce qui est utile pour gérer l’espace privé : nom et prénom, adresse e-mail, type d’accès, situation « militaire DANZ » ou « conjoint(e) », statut amicaliste, préférences de notification, votes aux sondages et traces techniques nécessaires au fonctionnement des notifications. Les contenus publiés par un membre peuvent également comporter son identifiant technique d’auteur.</p><p>Le site n’a pas vocation à conserver des informations opérationnelles, une affectation, un grade, un numéro professionnel ou toute donnée sans lien direct avec la vie de l’Amicale.</p></section>

      <section><h2>3. Finalités</h2><p>Ces données servent uniquement à contrôler l’accès à l’espace privé, communiquer les actualités et événements de l’Amicale, organiser les albums photos/vidéos, gérer les sondages et bons plans, envoyer les notifications choisies par l’utilisateur et assurer l’administration et la sécurité du service.</p></section>

      <section><h2>4. Accès aux données</h2><p>Les membres ne peuvent consulter que les contenus correspondant à leurs droits d’accès. Les informations de profil ne sont accessibles qu’à l’utilisateur concerné et aux administrateurs autorisés. Les règles d’accès sont appliquées côté base de données et un administrateur peut suspendre immédiatement un compte.</p></section>

      <section><h2>5. Hébergement et sous-traitants</h2><p>À ce jour, l’interface est publiée via GitHub Pages, l’authentification et la base de données utilisent Supabase et certaines miniatures ou pièces jointes utilisent Cloudflare R2. Pour éviter de stocker de très gros volumes de photos et vidéos sur l’application, le bureau peut également publier un <strong>lien de téléchargement WeTransfer</strong> pour un album événementiel. WeTransfer n’est contacté par le navigateur que lorsque le membre choisit volontairement d’ouvrir ce lien externe.</p><p>Cette architecture est <strong>transitoire</strong>. Une migration vers une infrastructure OVHcloud localisée en France est engagée afin de renforcer la maîtrise et la localisation des données. Tant que cette migration n’est pas terminée, certains traitements techniques peuvent être réalisés hors de France ou hors de l’Union européenne selon l’infrastructure et les conditions des prestataires concernés.</p></section>

      <section><h2>6. Durée de conservation</h2><p>Les données de compte sont conservées pendant la durée nécessaire à l’accès à l’espace privé. Lorsqu’un accès n’est plus justifié, il peut être suspendu immédiatement puis supprimé. Les demandes d’inscription et journaux administratifs sont conservés uniquement le temps nécessaire au suivi et à la sécurité du service. Les transferts externes d’albums possèdent leur propre durée de disponibilité définie lors de leur création et peuvent être retirés ou renouvelés par l’administrateur.</p></section>

      <section><h2>7. Vos droits</h2><p>Conformément au RGPD, chaque personne peut demander l’accès à ses données, leur rectification, leur effacement, la limitation du traitement ou exercer son droit d’opposition lorsque celui-ci s’applique. Une demande peut être adressée au bureau de l’Amicale. Une réclamation peut également être introduite auprès de la CNIL.</p></section>

      <section><h2>8. Cookies, stockage local et mode hors ligne</h2><p>Le site n’utilise pas de publicité ni de traceur publicitaire. Les éléments techniques conservés dans le navigateur servent uniquement à maintenir la connexion, les préférences du site et les fonctions nécessaires au service. Afin d’assurer une consultation limitée lorsque la connexion Internet disparaît, l’application peut conserver sur l’appareil pendant au maximum <strong>12 heures</strong> la dernière copie de l’Accueil, de l’Agenda et du profil technique validé. Ce cache est cloisonné par utilisateur, ne contient pas la base des utilisateurs ni les outils d’administration, et est supprimé lors de la déconnexion. Les médias lourds et albums externes ne sont pas conservés hors ligne.</p><p>L’ouverture d’un lien WeTransfer conduit vers un service externe soumis à sa propre politique de confidentialité et à ses propres choix de cookies.</p></section>

      <section><h2>9. Photos et vidéos</h2><p>Les miniatures d’albums sont accessibles uniquement aux membres autorisés. Les albums complets peuvent être fournis par un lien externe protégé ; le bureau est invité à utiliser les protections d’accès disponibles (mot de passe ou restriction d’e-mail) lorsque la sensibilité du contenu le justifie, sans enregistrer le mot de passe dans le site. Une demande de retrait d’une photo ou vidéo représentant une personne peut être adressée au bureau afin qu’elle soit examinée et, le cas échéant, retirée de l’album concerné.</p></section>

      <div className="privacy-actions"><Link className="primary-button" to="/connexion">Retour à la connexion</Link></div>
    </div>
  </main>
}
