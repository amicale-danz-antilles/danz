# DANZ Antilles — poursuivre sans Codex et sans frais d'abonnement

Mise à jour : 19 novembre 2026. Ce guide concerne le **poste personnel macOS**. Le site des adhérents, `main` et Supabase de production restent inchangés.

## Ce que ChatGPT a fait à distance

- Inventaire **strictement structurel** des 36 tables Supabase, 406 colonnes, 89 relations, 10 contraintes d'unicité, 73 contraintes CHECK et 36 tables protégées par RLS. Aucune fiche, mot de passe, pièce jointe ni écriture réelle n'a été copiée dans GitHub.
- Générateur de schéma D1 **local** à 36 tables préfixées `mig_`, avec conservation des 10 contraintes UNIQUE et des clés étrangères internes modélisables. Le résultat comporte des BLOQUEURS identifiés (RLS/autorisation côté Worker, CHECK, valeurs par défaut, index/trigger/vues, fonctions SQL, auth et Storage).
- Contrôles automatiques négatifs sur données fictives, dont les clés composées et les montants au centime.
- Vérificateur hors ligne d'archive `pg_dump` qui signale l'absence de `TABLE` ou `TABLE DATA` pour les 36 tables métier et 4 tables gérées fondamentales (`auth.users`, `auth.identities`, `storage.objects`, `storage.buckets`).
- Script macOS local `backup-postgres-private-macos.sh` qui lit le projet existant (sans le modifier), vérifie la présence des objets dans le catalogue, et s'arrête en cas de sauvegarde incomplète.

**Ces préparations ne sont pas une migration réelle.** Le pipeline local ne transporte aucune donnée nominative via GitHub. La simple réussite d'un catalogue `pg_restore --list` ne prouve pas qu'une restauration réussira.

## Étape A — poste personnel, sans Codex

1. Ouvrir la branche GitHub `codex/danz-pilot-synthetic`. Utiliser `Code → Download ZIP` ou un clone Git local pour disposer des derniers scripts.
2. Ouvrir Terminal dans le dossier décompressé/cloné. Aucune connexion Codex n'est nécessaire.
3. Vérifier les outils sans données sensibles :

   ```sh
   node workers/danz-api/migration/preflight-backup.mjs
   ```

4. Pour créer l'archive PostgreSQL, seuls `node`, `pg_dump` et `pg_restore` sont nécessaires au départ. Si Homebrew est autorisé sur ce Mac, leurs outils peuvent être installés gratuitement via `brew install node libpq`, puis rendre PostgreSQL accessible dans cette session de Terminal avec `export PATH="$(brew --prefix libpq)/bin:$PATH"`. Ne pas installer un nouveau service payant. La restauration nécessitera un environnement PostgreSQL/Supabase isolé ; ne pas la faire sur le serveur de production.

## Étape B — préparer un disque de sauvegarde **chiffré**

- Utiliser un volume personnel/associatif autorisé, chiffré et dont l'accès est limité (par exemple APFS chiffré sur macOS). Contrôler l'état réel du chiffrement dans **Utilitaire de disque**. Ne pas employer un dossier GitHub, iCloud Drive, Dropbox ou un dossier partagé pour accueillir les fichiers de données en clair.
- Prévoir une copie chiffrée distincte, hors du serveur Supabase et hors de Cloudflare, et conserver le secret de récupération en lieu séparé.
- Le script demande une confirmation humaine : il **ne peut pas lui-même prouver** que le volume est chiffré.

## Étape C — sauvegarder **seulement la base PostgreSQL** en lecture

Sur le poste autorisé, avec le volume chiffré monté et les outils installés :

```sh
bash workers/danz-api/migration/backup-postgres-private-macos.sh "/Volumes/VOTRE-VOLUME-CHIFFRE"
```

Utiliser dans Terminal les paramètres `Host`, `Port`, `User`, `Database` indiqués dans **Supabase → Projet DANZ → Connect**, pour le projet **axewfeanyfxkzercafen**. Le mot de passe est saisi de manière masquée par le Terminal.

**Ne jamais envoyer ces paramètres de connexion avec mot de passe, le contenu des fichiers de sauvegarde, des jetons ou des captures de secrets dans une conversation.** Si l'accès échoue, communiquer uniquement le code et le message d'erreur après masquage des identifiants.

La sauvegarde au format `pg_dump -Fc` est une photographie PostgreSQL cohérente des objets pour lesquels le compte dispose de droits. Le contrôle parcourt la liste de l'archive pour détecter les tables gérées absentes. Il n'a pas besoin de modifier le serveur.

**STOP** si le script échoue. Une archive créée partiellement ne doit jamais servir à une migration.

## Étape D — copies binaires et restauration (encore nécessaires)

- Copier TOUS les objets du ou des buckets Cloudflare R2 ET Supabase Storage vers le support chiffré. Ne pas compter uniquement les références SQL. Utiliser `rclone copy` avec une configuration locale et des accès en lecture seule, ou l'interface du fournisseur si compatible. Éviter `sync` qui peut supprimer des fichiers sur la cible.
- Générer un manifeste privé de tailles et empreintes SHA-256 avec `create-assets-manifest.mjs` ; comparer le nombre d'objets du fournisseur avec la copie locale, pas seulement le contenu local.
- Récupérer séparément les ressources de configuration/roles globaux et les neuf fonctions Edge indispensables ; un `pg_dump` n'exporte pas les déclarations des rôles PostgreSQL globaux, ni les objets binaires du stockage.
- Restaurer la base sur une pile PostgreSQL/Supabase isolée, jamais sur la source. Vérifier la restauration des schémas gérés, les permissions, fonctions et données. Une simple liste `pg_restore --list` ne suffit pas.
- Refaire une photographie synchronisée source/cible au moment du transfert, comparer les données des 36 tables, identités, droits, soldes, justificatifs et objets, et tester réellement l'application sur les deux PC. Tant que l'application source reçoit des écritures, les sauvegardes se périment.

## Éléments toujours BLOQUANTS pour la bascule

1. Aucune restauration réelle indépendante n'est attestée.
2. Les neuf Edge Functions et au moins 25 RPC doivent être remplacées et testées.
3. RLS, 73 contraintes CHECK, valeurs par défaut et index spécifiques ne sont pas entièrement traduits vers D1.
4. Authentification réelle, mots de passe, sessions, droits trésorier et comptes orphelins restent à vérifier.
5. Fichiers et notifications, application hors ligne, cotisations et écritures comptables restent à migrer intégralement.
6. Aucun plan de retour arrière avec conservation des nouvelles écritures n'est validé.

**La décision reste NO-GO pour toute bascule réelle.** La validation finale est distincte de la recette du pilote réseau et nécessite ton accord explicite après preuve de restauration et d'équivalence.

## Ce que tu peux communiquer ici

Pour continuer ensemble sans aucune donnée privée, il suffit de fournir la sortie du précontrôle (`checks`, `toolsReady`) puis, après sauvegarde éventuelle, seulement :

```text
Outils sauvegarde PostgreSQL : présents / manquants
Archive PostgreSQL : OK / en erreur
Vérification du catalogue : OK / en erreur
Volume chiffré : confirmé / à faire
Copie R2 : à faire / faite
Copie Supabase Storage : à faire / faite
Restauration isolée : à faire / faite
```
