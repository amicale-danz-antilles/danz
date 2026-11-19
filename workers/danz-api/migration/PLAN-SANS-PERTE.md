# Amicale DANZ Antilles — protocole de migration sans perte

**Environnement de preparation** : branche GitHub `cloudflare/danz-api-preparation`, Worker `danz-api`, D1 `danz-staging`.

**Interdits avant recette finale** : aucune migration reelle de donnees, aucun changement du site public `https://amicale-danz-antilles.github.io/danz/`, aucune fusion du PR #52 dans `main`, aucun effacement ou changement de Supabase, aucun secret ni donnee d'adherent dans GitHub ou les logs.

La [répétition synthétique et le rapport GO/NO-GO](GO-NO-GO-PHASE-1.md) décrivent les commandes locales, leurs preuves et les portes à franchir. Le [suivi de l’inventaire et de la recette](INVENTAIRE-PHASE-1.md) consigne les écarts du SQL versionné et les fonctions à valider.

## Inventaire de couverture obligatoire

Le contrat machine `source-contract.json` repertorie, sans aucune donnee d'adherent :
- Les **36 tables metier Supabase** et leurs cles primaires (dont 5 cles composees). Chaque table doit avoir un equivalent fonctionnel en D1.
- Les **9 fonctions Supabase Edge** qui doivent avoir un remplacement teste ou une justification approuvee ; aucune fonction ne peut disparaitre en silence.
- L'identite Supabase, les sessions, les roles, la distinction administrateur / tresorier.
- Le stockage des fichiers dans Cloudflare **R2 et Supabase Storage** (ne pas supposer que tous les fichiers sont deja dans R2).
- Les notifications push, le service worker, les pieces jointes, l'utilisation hors-ligne et l'application installee des utilisateurs.

Les 11 tables `stg_*` de D1 sont un prototype, **pas** la migration complete. Les diagnostics publics provisoires doivent etre supprimes/proteges avant le passage en production.

## Portes de validation (toutes obligatoires)

### 1. Sauvegarde et procedure de restauration

- Realiser avec une methode autorisee un **export complet et coherent** de la base Supabase, avec structure, procedures SQL, contraintes, fonctions, triggers, RLS, historiques et donnees metier ; couvrir aussi les schemas sensibles avec une procedure specifique.
- Exporter separement les utilisateurs et autorisations depuis le service d'identite selon une methode approuvee : ne **jamais** demander ni reveler un mot de passe, ne jamais ajouter les empreintes de mot de passe dans GitHub.
- Sauvegarder les objets binaires de **Supabase Storage et Cloudflare R2**, pas seulement leurs chemins dans la base.
- Chiffrer les sauvegardes, les conserver **hors des deux plateformes**, appliquer des controles d'acces et tester une restauration dans un environnement isole.
- Conserver le service source intact tant que le retour arriere n'est pas valide.
- Ne pas utiliser D1 Time Travel comme unique sauvegarde : sur Workers Free, la retention est de **sept jours**, la restauration est destructive et s'effectue en place.
- Confirmer les exigences de traitement des informations des personnels militaires avec l'autorite competente avant toute copie ou export inter-services.


### Avertissement sur le bouton d'export administratif existant

Le code de la fonction Supabase Edge `admin-data-export` en production, inspecte en lecture seule le 19 novembre 2026, exporte **16 des 36 tables publiques**. La liste et les 20 tables non couvertes figurent dans `legacy-export-coverage.json`. Parmi les oublis figurent `treasury_entries`, `treasury_opening`, `households`, `household_payments`, `household_payment_allocations` et `membership_subscriptions`.

Cet export ne contient aucun objet binaire R2 ou Supabase Storage, ne conserve pas les empreintes de mots de passe ni les secrets du serveur, et ne peut **en aucun cas** valoir sauvegarde integrale ou etre la source unique d'une migration. Ne pas le declencher automatiquement, car il contient des informations privees et ajoute lui-meme une ligne au journal d'audit. Une sauvegarde plus large doit etre construite et testee dans un environnement chiffre, selon une procedure autorisee.

### 2. Completude des donnees (zero difference inexpliquee)

- Capturer une photographie de reference a une date precise avec les ecritures suspendues ou une reprise incrementalement prouvee.
- Migrer toutes les tables, y compris celles qui sont **actuellement vides**, avec leurs relations, identifiants historiques, dates, montants en **centimes entiers**, annulations, documents et archives.
- Verifier **100 % des cles** : aucune ligne manquante, doublonnee ou ecrasee, y compris sur les cles primaires composees.
- Comparer les valeurs **champ par champ** dans des exports prives, par empreintes canoniques ; toute transformation doit etre documentee et reversible.
- Verifier chaque fichier binaire par taille et **SHA-256**, et effectuer un test de telechargement avec les droits corrects.
- Reconciliation comptable : soldes initiaux, banque, caisse, non affecte, transferts, recettes, depenses, remboursements, paiements, imputations, cotisations, archives et justificatifs.
- Aucune suppression silencieuse de ligne « ancienne », « inactive », annulee ou « a revoir ».

`compare-snapshots.mjs` permet une comparaison stricte **hors-ligne** de 36 ensembles de lignes et des inventaires de fichiers et d'identites ; il ne journalise aucune donnee personnelle ni les valeurs modifiees. Les deux snapshots doivent rester prives et chiffres, jamais commits. Il refuse les differences ; si des changements de representation Postgres vers SQLite sont necessaires, ajouter une normalisation explicitement testee plutot que masquer les differences.

### 3. Comptes, authentification et permissions

- Garder l'identifiant de chaque compte, le statut actif ou desactive, les roles, la qualite de tresorier et l'appartenance au foyer.
- Examiner les comptes sans profil et les profils orphelins sans supprimer ni approuver par defaut.
- Prouver que **chaque adhérent peut se connecter** sur le nouveau systeme sans devoir divulguer son mot de passe ; aucune supposition sur la portabilite des empreintes bcrypt ni sur les limites CPU du forfait gratuit.
- Prouver la reinitialisation, la revocation, les sessions partitionnees et le controle CSRF sur les navigateurs réellement utilises.
- Controle cote Worker, pas seulement dans React : un membre ne lit pas les donnees d'un autre foyer, un admin non tresorier ne lit pas les ecritures comptables, un compte inactif n'a aucun acces.
- Toute operation financiere utilise des transactions atomiques, une piste d'audit et des verrous ou controles anti-doublons.

### 4. Fonctionnalites (recette sans suppression)

Eprouver le fonctionnement de toutes les zones : demande et validation d'adhesion, gestion des foyers et membres, cotisations, paiements et allocations, caisse et banque, événements et participation, sondages et votes, news/bonnes affaires, galerie et albums, documents et justificatifs, import/export administratif, notifications push, preferences, assistant DANZ, mode hors ligne et comptes/desactivations.

Les **9 fonctions Edge** existantes constituent une liste de controle obligatoire, mais repliquer leurs noms ne suffit pas ; tester les resultats et les restrictions de chaque fonction.

### 5. Bascule et retour arriere

- D'abord faire une migration a blanc dans un **environnement de test isole** avec sauvegarde chiffree et autorisation des donnees personnelles.
- Soumettre un rapport de comparaison avec **zero ecart non documente** et une validation humaine de tresorerie.
- Identifier le dernier instant d'ecriture Supabase ; pendant la bascule, suspendre les ecritures ou reprendre et verifier chaque modification intervenue depuis la photographie.
- Tester la connexion et les fonctions en mode pilote, sans toucher a l'URL de production ni aux raccourcis installes des membres.
- Ne basculer le site que **sur approbation explicite**, apres un scenario de retour arriere teste qui **ne perd pas les écritures recues apres la bascule**.
- Maintenir l'ancien service et les sauvegardes jusqu'a expiration d'une periode d'observation approuvee ; ne pas effacer le projet Supabase automatiquement.

## Invariants de securite

- Zero donnees personnelles dans les commits, issues, tests GitHub Actions, Worker public, captures partagees et journal des differences.
- Zero dependance aux cookies tiers non testes sur les navigateurs cibles.
- Zero depense ou abonnement active automatiquement.
- Zero nouvelle route publique modifiant D1 sans authentification serveur.
- **STOP** si une comparaison, une sauvegarde, la comptabilite, la protection des comptes ou la restauration echoue.

## Validations deja obtenues (tests fictifs uniquement)

- Worker atteignable et CORS compatible depuis le site DANZ.
- D1 connectee, 8 tables de finance pilote + 4 triggers et 3 tables de session + 1 trigger ; tables vides.
- Calcul financier fictif confirme : banque 17000 c, caisse 2000 c, non affecte 400 c.
- Cookie partitionne accepte et renvoye sur Firefox professionnel.
- Tests d'autorisation/session executés seulement sur des identites artificielles.

Ces tests ne prouvent **pas** que la migration des donnees reelles est finie.
