# Nhost Storage : essai contrôlé depuis le poste professionnel

## But et périmètre

Tester **uniquement des fichiers texte fictifs** sur le projet Nhost de développement en `us-east-1`. Ne pas y importer de médias, justificatifs, fichiers, noms ou données réelles des membres DANZ. Le site principal et la base Supabase restent inchangés.

Page de test : `https://amicale-danz-antilles.github.io/danz/nhost-storage-test.html`

## Configuration Nhost à réaliser manuellement

1. Dans **Storage**, créer un bucket nommé exactement `danz-test-private`. Ne jamais le rendre public.
2. Dans **Storage → Permissions**, régler uniquement le rôle `user` :
   - **Upload** : condition `bucket_id` = `danz-test-private` et activer la définition automatique de `uploaded_by_user_id` depuis l'identité du compte (option **Uploader identity**).
   - **Download** : conditions `bucket_id` = `danz-test-private` **ET** `uploaded_by_user_id` = variable de session `X-Hasura-User-Id`.
   - **Delete** : mêmes conditions que Download.
   - `public` et `anonymous` : aucune permission.
   - Ne jamais utiliser d'admin secret ou de rôle admin dans les tests côté navigateur.
3. Utiliser les **deux comptes fictifs** créés lors des tests GraphQL.

## Ordre de recette

1. Se connecter avec le **deuxième compte fictif** et créer un fichier témoin. Conserver uniquement son identifiant de fichier (pas un URL signé).
2. Effacer la session locale de la page de test, se connecter avec le **premier compte fictif**, lancer le test **Envoyer → lire → supprimer** avec son propre petit fichier texte.
3. Depuis le premier compte, essayer de lire le fichier témoin du second : accès refusé attendu. Faire ensuite une tentative anonyme de téléchargement du témoin : accès refusé attendu.
4. Se reconnecter avec le deuxième compte et supprimer le témoin.
5. Copier le **rapport anonymisé**. Il ne contient ni email, ni mot de passe, ni JWT ni ID de fichier.

Ne pas conclure que l'isolation est valide si le second compte n'a pas préalablement créé un fichier témoin. Le refus de téléchargement anonyme ne suffit pas à valider l'accès authentifié.

Une fois cette étape réussie, préparer sur branche séparée les adaptateurs d'authentification, GraphQL, stockage et fonctions serveur Nhost, ainsi que la migration du schéma **sans aucune vraie donnée tant que la région définitive n'est pas approuvée**.

Documentation fournisseur :
- https://docs.nhost.io/getting-started/tutorials/react/5-file-uploads
- https://docs.nhost.io/reference/javascript/nhost-js/storage
