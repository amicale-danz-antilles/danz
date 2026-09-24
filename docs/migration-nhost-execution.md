# Plan d'exécution vérifiable — Supabase → Nhost

Mis à jour le 24 septembre 2026. **Production : Supabase. Nhost us-east-1 : données fictives uniquement.**
Cette procédure ne constitue pas une autorisation de copier les données personnelles ou bancaires aux États-Unis.

## Ce qui est déjà vérifié

- Le poste professionnel atteint les endpoints Nhost Auth, GraphQL (requête POST et CORS) et Storage (réponse 403 sans autorisation).
- Deux comptes fictifs ont permis à l'administrateur de confirmer les permissions de la table de test : connexion, INSERT/SELECT/DELETE, isolation.
- L'inventaire source réalisé avec l'accès Supabase disponible recense 29 tables publiques, 25 comptes Auth, 24 profils dont 1 compte Auth sans profil, 24 foyers et 8 fonctions Edge. Ces chiffres évolueront jusqu'au gel des écritures.
- Le suivi dans DANZ et sa version statique proviennent de \`public/migration-status.json\`. La publication GitHub Pages est nécessaire pour chaque mise à jour ; ce n'est ni de la télémétrie automatique ni une preuve de migration des données.

## Phase 1 : données fictives uniquement (projet américain)

1. Le script \`docs/nhost-sandbox/01_table_fictive.sql\` est installé sur le projet de test et les permissions de la table de notes ont été vérifiées avec deux identités fictives.
2. Exécuter \`docs/nhost-sandbox/02_relations_foyer_paiement_fictives.sql\` sur le projet de test, suivre les tables dans Hasura, puis vérifier les contraintes (montants strictement positifs, références valides, impossibilité d'allouer le paiement d'un foyer à la charge d'un autre). **Ne pas accorder d'écriture sur ces nouvelles tables aux rôles user/public avant un audit.**
3. Configurer un bucket Nhost privé \`danz-fictif\`, tester l'upload puis la lecture authentifiée depuis le poste professionnel, et confirmer qu'un autre compte fictif obtient un refus. Vérifier séparément Cloudflare R2 si les photos réelles doivent y rester.
4. Tester une première fonction Nhost, sans données réelles, et contrôler l'accès depuis le réseau professionnel.
5. Tester l'import d'un seul **compte entièrement fictif** avec le même UUID et sa vraie empreinte bcrypt créée pour ce test ; vérifier qu'il peut s'authentifier avec son ancien mot de passe et que les rôles Hasura ne donnent pas un accès supplémentaire.

## Phase 2 : préparation du schéma cible en région autorisée

- Choisir une région européenne disponible et approuvée, en tenant compte du contrat de traitement, des contraintes de l'organisation et du trajet des données R2, des photos et des journaux.
- Retester Auth, GraphQL, Storage et Functions depuis le poste professionnel sur les **nouveaux endpoints** : les résultats \`us-east-1\` ne sont pas transposables par hypothèse.
- Initialiser le dépôt Nhost avec la CLI (\`nhost init --remote\` ou le flux de développement cloud décrit dans la documentation actuelle), versionner réellement les migrations PostgreSQL et les métadonnées Hasura. La connexion du dépôt GitHub au tableau de bord ne reprend pas automatiquement les modifications effectuées dans la console.
- Recréer toutes les 29 tables utiles, leurs contraintes, leurs clés UUID et les fonctions PostgreSQL adaptées. Ne pas importer directement les schémas internes \`auth\` et \`storage\` de Supabase dans ceux de Nhost.
- Porter les contrôles de \`auth.uid()\`/RLS et les RPC Supabase vers les permissions Hasura et des opérations transactionnelles sûres côté serveur. Audit systématique des accès membres, foyer, administrateur, trésorerie, compte suspendu et visiteur.
- Porter les huit fonctions Edge actives, les e-mails et les notifications push, ainsi que les URLs signées et le stockage R2/Supabase. Reconfigurer les clés uniquement dans des variables/secrets serveur.

## Phase 3 : copie privée, sans toucher à la production

- Faire une sauvegarde chiffrée hors Git des données et des médias, et **prouver qu'elle se restaure** dans un environnement isolé.
- Tester l'import des comptes Nhost (UUID, e-mail, empreinte bcrypt compatible, rôles, approbation), puis les clés étrangères des foyers, recensements et données financières. Les sessions Supabase ne se transfèrent pas : préparer une reconnexion unique pour les membres.
- Importer une copie de recette dans la région approuvée, sans modifier le site officiel. Adapter le frontend sur une branche séparée et effectuer la recette complète avec les utilisateurs volontaires.
- Ne jamais configurer un secret d'administration Nhost dans une variable \`VITE_*\`, une page publique, un ticket ou une réponse du chat.

## Phase 4 : rapprochement « zéro perte »

Les chiffres d'un audit ponctuel ne sont **pas** les compteurs finaux. Après le gel des écritures, générer pour **toutes les tables et tous les comptes** deux inventaires privés \`source-prive.json\` et \`cible-prive.json\`, avec la même convention de normalisation de colonnes et de tri des clés primaires.

Exemple de structure (valeurs fictives) :

\`\`\`json
{
  "tables": {
    "public.profiles": {
      "row_count": 2,
      "keys_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "rows_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "public.treasury_entries": {
      "row_count": 1,
      "keys_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "rows_sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "amount_cents_sum": 6000
    }
  },
  "auth": {
    "row_count": 2,
    "keys_sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "rows_sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  },
  "files": {
    "r2": {
      "file_count": 1,
      "total_bytes": 123,
      "content_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  }
}
\`\`\`

- \`keys_sha256\` : empreinte SHA-256 des clés primaires **y compris composites**, sérialisées selon une convention identique et triées des deux côtés.
- \`rows_sha256\` : empreinte SHA-256 d'une forme canonique, triée, de toutes les lignes, avec correspondance documentée entre les noms de colonnes Supabase et Nhost. Pour \`auth\`, comparer explicitement les champs mappés et les empreintes bcrypt, sans publier ces dernières.
- \`amount_cents_sum\` : somme des montants des cinq tables suivies par le script, y compris quand elles sont vides (0). Compléter par rapprochement du solde des charges, allocations et seules transactions confirmées pour exclure une duplication de paiement.
- \`content_sha256\` : empreinte déterministe du manifeste privé des médias (identifiant logique, chemin, taille, SHA-256 de chaque fichier). Les albums et pièces justificatives doivent être testés à l'ouverture, pas seulement comptés.
- Vérifier indépendamment les contraintes et les liens référentiels après restauration, ainsi que les accès selon les rôles. **Un rapprochement réussi n'est pas une preuve à lui seul de sécurité ou d'absence de perte.**

Commande locale sur un ordinateur maîtrisé, sans déposer les fichiers dans Git :

\`\`\`sh
node scripts/compare-migration-inventories.mjs \
  /chemin-prive/source-prive.json /chemin-prive/cible-prive.json
\`\`\`

Le script sort avec code 1 à la première incohérence et ne doit pas donner feu vert au basculement tant que toutes les tables et fichiers attendus ne figurent pas dans les inventaires. Les fichiers d'inventaire privés doivent être conservés conformément aux obligations de l'association.

## Phase 5 : basculement maîtrisé et retour arrière

1. Obtenir une validation de l'administrateur sur le rapport de recette et les conditions d'hébergement.
2. Annoncer un créneau de maintenance, empêcher les **nouvelles écritures** sur Supabase (incluant déclarations de paiement, dépôts de photos et soumissions de recensements), exporter le delta final et restaurer les données dans Nhost.
3. Rapprocher tous les inventaires, relations, totaux financiers et objets médias. Aucun routage vers Nhost si une divergence subsiste.
4. Modifier le backend du frontend officiel en une seule publication GitHub Pages contrôlée ; invalider le cache PWA ; tester connexion réelle, administration, trésorerie, fichiers, PWA et réseau professionnel.
5. Garder Supabase en lecture seule avec un plan de retour arrière testé. Si une écriture a eu lieu sur Nhost après ouverture, définir une procédure explicite de retour et de synchronisation inverse avant de revenir sur Supabase : aucun simple changement d'URL ne suffit.

Références :
- https://docs.nhost.io/products/auth/users
- https://docs.nhost.io/products/graphql/permissions
- https://docs.nhost.io/platform/cli/cloud-development
