# DANZ Antilles — Sauvegarde complète et privée (avant migration)

**Statut au 19 novembre 2026 : procédure préparée, AUCUNE sauvegarde réelle exécutée ou vérifiée par ChatGPT.**

**Interdiction de procéder à la migration réelle** tant que la base, les fichiers et le retour arrière ne sont pas sauvegardés et restaurables.

## Correction de sécurité — CLI Supabase v3 (19 novembre 2026)

**ATTENTION : les trois commandes `supabase db dump` ci-dessous ne constituent PAS une sauvegarde complète de l'application.** La documentation CLI v3 indique que les schémas gérés par Supabase, notamment `auth` et `storage`, sont exclus du dump standard. Leurs données requièrent une extraction distincte autorisée et une restauration dans une pile Supabase compatible.

Le code de vérification `verify-local-backup.mjs` cherche désormais les blocs `COPY` requis dans `data.sql` **ou** dans un fichier supplémentaire privé `managed-data.sql`. L'absence de `auth.users`, `auth.identities`, `storage.objects` ou `storage.buckets` reste BLOQUANTE. Le fichier additionnel peut être produit uniquement dans un environnement local sûr après validation de la méthode d'extraction des schémas gérés. Ne jamais déposer ce fichier dans GitHub ou ChatGPT : il peut contenir des empreintes de mots de passe, jetons et données sensibles.

Pour préparer un export privé des schémas gérés, le mécanisme PostgreSQL natif `pg_dump --data-only --schema=auth --schema=storage` doit être examiné et exécuté **sur la machine autorisée**, avec un utilisateur disposant des permissions requises, une version PostgreSQL compatible et une destination chiffrée. **Cette commande n'est pas exécutée par ChatGPT et n'est pas, à elle seule, une sauvegarde restaurable** : certains objets gérés nécessitent des précautions de restauration, une configuration Supabase identique, et les octets Storage doivent être copiés séparément. Ne pas déployer une restauration sur le projet source.

Documentation officielle mise à jour :
- <https://supabase.com/docs/reference/cli/supabase-db-dump>
- <https://supabase.com/changelog/supabase-cli-v3>
- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>

**Supabase CLI v3 :** depuis le 4 novembre 2026, `db dump` vise la pile locale par défaut. Employer explicitement `--remote` pour cibler la source distante et vérifier la ligne `Target:` en sortie d'erreur. Les commandes de sauvegarde ci-dessous sont documentées pour v3, mais leur disponibilité et les paramètres doivent être revérifiés sur l'installation locale avec `supabase db dump --help`.

**Bilan requis :** pour chaque sauvegarde, établir dans un environnement privé quatre couvertures distinctes : (1) 36 tables métier et structures, (2) identités et métadonnées gérées auth/storage, (3) fichiers binaires R2/Storage, (4) code/configurations métier des neuf fonctions Edge et des 25 RPC. Les validateurs actuels contrôlent surtout la présence et certaines structures ; ni la restauration, ni les droits, ni les écritures et les fichiers réellement distants ne sont vérifiés par une simple réponse `ok: true`.



## 0. Protections indispensables

- Effectuer le travail uniquement sur un appareil **autorisé** par l'association et sa politique informatique, protégé et chiffré au repos (par ex. BitLocker). Ne pas contourner les contrôles du poste militaire ; si son réseau bloque Supabase, employer une machine autorisée et un accès permis.
- Ne jamais copier dans ChatGPT, GitHub, Cloudflare Workers, issues, logs ou captures : mot de passe de base, URL complète contenant le mot de passe, service_role, clé R2/S3, archive SQL, liste d'adhérents, hachage de mot de passe ou documents privés.
- Ne créer **aucune** action GitHub qui télécharge les données dans un dépôt public. Ne pas dépendre des GitHub Actions pour conserver les sauvegardes.
- La commande Supabase officielle `db dump` produit des fichiers SQL **en clair**. Pour les préserver, créer immédiatement les fichiers sur un disque autorisé et chiffré, puis en faire une copie chiffrée indépendante. Ne pas supposer qu'un dump n'inclut pas les secrets ou les hachages.
- L'offre gratuite Supabase ne fournit pas de sauvegarde automatique accessible comme remplacement de ce plan.
- Les commandes ci-dessous sont en lecture sur la base source. Elles ne sont pas des commandes de migration Cloudflare.

## 1. Sauvegarder les données PostgreSQL

Installer sur le poste autorisé : Docker, Supabase CLI à jour, et ultérieurement PostgreSQL/psql pour vérifier une restauration. Les étapes officielles sont dans :
<https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>

Dans Supabase : projet DANZ → **Connect** → choisir la connexion directe si IPv6 accessible, sinon **Session pooler**, puis utiliser le mot de passe de base. Ne pas réinitialiser ce mot de passe simplement pour cette sauvegarde si le mot de passe en vigueur est connu.

Sous Windows **PowerShell**, utiliser un dossier sur un disque préalablement chiffré, par exemple :
```powershell
New-Item -ItemType Directory -Force "D:\DANZ-SAUVEGARDE-PRIVEE" | Out-Null
Set-Location "D:\DANZ-SAUVEGARDE-PRIVEE"

# Saisie protegee contre l'affichage et l'historique des commandes
$secure = Read-Host "URL PostgreSQL COMPLETE depuis Supabase Connect" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:SUPABASE_DB_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

supabase db dump --remote="$env:SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --remote="$env:SUPABASE_DB_URL" -f schema.sql
supabase db dump --remote="$env:SUPABASE_DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"

Remove-Item Env:SUPABASE_DB_URL
```

**Important** : une base contenant des données personnelles et d'authentification est incluse dans le SQL. Garder cet export privé. Les trois fichiers sont complémentaires ; si une commande échoue, arrêter et enregistrer **uniquement le code d'erreur**, jamais l'URL, le mot de passe ou des extraits des données SQL. Les fichiers peuvent ne pas suffire si des changements particuliers ont été apportés aux schemas gérés, aux clés Vault ou à des extensions : ils doivent être examinés et la restauration testée.


### Point de contrôle obligatoire des exports (avant la copie des fichiers)

Après la sauvegarde des données métier, vérifier dans un espace local privé l'existence d'un export des schémas gérés `auth` et `storage`. En l'absence d'un export privé validé, **ne pas continuer vers une migration de comptes**. La présence de 27 tables `auth` et huit tables `storage` a été constatée en lecture seule sur le schéma source ; les quatre blocs `COPY` exigés par le validateur ne suffisent pas à garantir le rétablissement de toutes les fonctions de ces schémas.

## 2. Sauvegarder séparément les objets R2 ET Supabase Storage

La base Postgres ne sauvegarde que les **métadonnées** des objets. Copier les **octets** des documents, pièces jointes, justificatifs, photos et albums.

Organisation recommandée sous le dossier privé :
```text
DANZ-SAUVEGARDE-PRIVEE/
  roles.sql
  schema.sql
  data.sql
  r2/
    NOM-DU-BUCKET-R2/
      ... copie de TOUS les objets ...
  supabase-storage/
    NOM-DU-BUCKET-STORAGE/
      ... copie de TOUS les objets ...
  assets-manifest.json        (creé à l'étape 3)
```

- Pour **R2**, créer dans Cloudflare une clé S3 avec permissions limitées à la **lecture des objets du bucket source** ; la stocker exclusivement dans la configuration locale de rclone. Vérifier le bon compte Cloudflare et le bucket d'origine. Documentation : <https://developers.cloudflare.com/r2/examples/rclone/>
- Avec une configuration rclone `r2:` déjà autorisée, recopier vers le disque chiffré avec `rclone copy` (jamais `sync`, qui peut effacer une cible). Exemple à adapter avec le vrai nom du bucket :
```text
rclone copy r2:NOM-DU-BUCKET-R2 D:\DANZ-SAUVEGARDE-PRIVEE\r2\NOM-DU-BUCKET-R2
```
- Pour **Supabase Storage**, il est possible de télécharger les fichiers un par un via Dashboard → Storage → Files. Une copie complète est aussi possible avec son interface S3, via rclone / Cyberduck. Préserver le nom du bucket et le chemin de chaque objet. Documentation : <https://supabase.com/docs/guides/storage/management/download-objects>
- Même si les références actuelles sont peu nombreuses, **tous les objets** de chaque bucket employé doivent être inventoriés. Certains objets peuvent ne pas être référencés par une table, et des liens externes peuvent être temporaires : toute différence doit être identifiée.

## 3. Vérifier les fichiers téléchargés (aucune transmission à ChatGPT)

Sur le poste local disposant de Node.js 22+ (ou version récente compatible) et du dépôt DANZ de préparation :
```text
node workers/danz-api/migration/create-assets-manifest.mjs "D:\DANZ-SAUVEGARDE-PRIVEE"
node workers/danz-api/migration/verify-local-backup.mjs "D:\DANZ-SAUVEGARDE-PRIVEE"
```

`create-assets-manifest.mjs` calcule le SHA-256 de chaque fichier présent dans `r2/` et `supabase-storage/`. `verify-local-backup.mjs` :
- vérifie la présence des fichiers rôles, schéma, données ;
- cherche les déclarations de **36 tables** dans le schéma ;
- cherche les commandes COPY des **36 tables** métier dans `data.sql`, puis les données gérées `auth.users`, `auth.identities`, `storage.objects`, `storage.buckets` dans `data.sql` ou `managed-data.sql` ;
- revérifie que les fichiers correspondent aux empreintes du manifeste privé.

**Limite majeure** : ce sont des vérifications préliminaires, pas une preuve que les 36 tables ont le bon nombre de lignes ou que les 9 fonctions Edge, déclencheurs/stratégies RLS, les comptes et les fichiers sont restaurables. Ce script n'interroge pas Supabase/R2 et ne sait donc pas détecter un objet distant jamais téléchargé. Il peut signaler un faux négatif si la CLI produit une forme SQL différente ; dans ce cas, conserver la sauvegarde et adapter le parseur avec des tests.

Ne jamais publier le manifeste de vrais fichiers : ses noms et ses empreintes peuvent être sensibles.

## 4. Faire une copie chiffrée indépendante

- Sur un disque déjà chiffré, créer une archive 7z avec chiffrement AES-256 et chiffrement des noms de fichiers, ou employer une méthode de sauvegarde chiffrée approuvée.
- Garder la phrase de récupération **hors de ChatGPT et de GitHub**, dans un endroit distinct sécurisé.
- Conserver une deuxième copie sur un support distinct qui n'est pas dans Supabase ni Cloudflare.
- Vérifier l'ouverture de l'archive et les empreintes, sans copier les fichiers extraits dans un emplacement public.
- Vérifier que les éventuels coûts associés aux accès réseau, au stockage local ou à l'extraction restent dans les quotas gratuits. N'activer aucun service payant sans accord.

## 5. Restaurer pour prouver la sauvegarde

Selon la documentation officielle, le bon contrôle est une restauration de `roles.sql`, `schema.sql` et `data.sql` dans une **nouvelle base PostgreSQL locale de test**, jamais sur la base Supabase de production. La restauration doit être effectuée avec `ON_ERROR_STOP`, sous transaction lorsque supporté, puis vérifier les compteurs, les fonctions, les droits, les comptes et le fonctionnement des fichiers.

Voir le guide officiel :
<https://supabase.com/docs/guides/deployment/ci/backups#check-that-the-backup-restores>

**La validation finale de migration exigera également :**
- une photographie des nombres de lignes et valeurs juste avant bascule ;
- comparaison intégrale des 36 tables et des identités, sans aucune différence non approuvée ;
- lecture SHA-256 de TOUS les objets R2/Storage effectivement présents des deux côtés ;
- réconciliation des soldes de trésorerie en centimes et justification de chaque anomalie ;
- test de chaque fonction et des appareils ;
- plan de retour arrière préservant les écritures apparues depuis la bascule.

## 6. Que communiquer dans la conversation

Seulement ces informations non sensibles :
```text
roles.sql : présent / erreur
schema.sql : présent / erreur
data.sql : présent / erreur
R2 : fichiers copiés / à faire
Supabase Storage : fichiers copiés / à faire
Vérificateur local : ok=true / ok=false
Restauration locale : réussie / à faire
```

Ne joindre aucune sauvegarde SQL, aucun chemin nominatif, aucun fichier adhérent ni aucune capture de clé API.
