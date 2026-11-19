# DANZ — couverture fonctionnelle du pilote Cloudflare

Audit de code au **19 novembre 2026**, à partir de la branche de préparation. Aucune interrogation des données réelles, aucun import et aucune modification de production pendant cet audit.

**Décision de couverture : NO-GO pour une migration réelle ou une bascule.** Le pilote contient des diagnostics et des composants synthétiques. Il ne remplace pas encore l'application Supabase.

## Portée des preuves

- `source-contract.json` recense **36 tables publiques**, dont **5 clés primaires composées**, et **9 fonctions Edge**. Ce fichier décrit des noms et des clés, pas les colonnes, types, index, vues, RLS, déclencheurs ou procédures complets de la source.
- Les deux migrations D1 existantes décrivent **8 tables financières `stg_*`** et **3 tables d'identité/session/audit**. Ce sont des modèles partiels, pas une correspondance de 11 tables métier sur 36.
- Les tests du répertoire `test/` couvrent des scénarios fictifs de calcul, contraintes, autorisation et sessions. Leur existence n'atteste pas une recette sur Cloudflare, un navigateur professionnel ou les données de l'association. Les résultats d'exécution sont à joindre au rapport principal.
- Les outils de comparaison et de sauvegarde vérifient leurs entrées locales. Ils ne démontrent ni la complétude d'un export distant, ni une restauration PostgreSQL, ni la migration des fonctions métier.
- Le frontend reste raccordé à Supabase. Le contexte d'authentification, les accès aux tables, les RPC et le stockage n'ont pas de branchement vers une application Cloudflare équivalente.

Dans les tableaux, **partiel synthétique** signifie uniquement qu'un composant ou une contrainte est présent dans le prototype. **Non migré** signifie qu'aucun équivalent fonctionnel complet n'est livré par le Worker de préparation. Aucune ligne ci-dessous ne vaut validation des données réelles.

## Matrice des domaines

| Domaine | Migré vers une application Cloudflare | Testé ou préparé dans le pilote | Manque avant validation |
|---|---|---|---|
| Connexion et identités | Non | Schéma fictif de comptes et sessions ; jetons aléatoires, expiration, révocation, CSRF | Import privé restauré des identités ; compatibilité des mots de passe ; vérification bcrypt et CPU sur le forfait autorisé ; récupération de compte ; anti-abus ; connexion réelle de chaque rôle |
| Autorisations | Non | Matrice membre/admin/trésorier ; refus par défaut ; isolation des foyers sur identités fictives | Application à chaque route et chaque accès ; traduction contrôlée des RLS ; tests d'accès directs et de changement de droits ; aucune confiance dans un rôle client |
| Adhésions, foyers et personnes | Non | Tables partielles de foyer, charges, paiements et allocations | Demandes et approbation, cotisations, rattachement/fusion, adultes/enfants, personnes hors ligne, historique et invariants de chaque opération |
| Trésorerie | Non | Montants entiers ; contraintes d'allocation ; unicité du paiement ; calcul banque/caisse/non affecté sur valeurs fictives | Toutes les mutations atomiques ; audit ; imports et exports ; événements ; remboursements ; annulation/restauration ; réconciliation privée au centime |
| Événements | Non | Table minimale `stg_events` | Agenda, inscriptions, invités, participations, finances associées, justificatifs et accès |
| Sondages et questionnaires | Non | Clés composées présentes dans l'inventaire | Questions conditionnelles, votes, réponses par foyer, clôture et synchronisation hors ligne |
| Publications, bureau, bons plans | Non | Inventaire des tables | Lecture/édition/modération, préférences, droits et rendu mobile |
| Documents, galerie et albums | Non | Outils locaux d'inventaire et de SHA-256 | Copie de tous les octets R2 **et** Storage ; inventaire source indépendant ; autorisations de consultation, envoi et suppression ; liens signés |
| Notifications push | Non | Tables et fonction repérées dans le contrat | Abonnements, préférences, clés de livraison gérées en privé, envoi et réception sur appareils cibles |
| Services administratifs | Non | Diagnostics publics sans données personnelles | Sauvegarde complète, gestion des comptes, statut métier, journaux d'audit et restrictions équivalentes |
| Assistant DANZ | Non | Nom recensé dans le contrat | État réel à confirmer ; dépendances, coûts et contrôle d'accès ; remplacement ou retrait explicitement approuvé |
| PWA, cache et hors ligne | Non | Code existant du site Supabase examiné | Nouvelle origine/scope, mise à jour de l'application installée, séparation des caches, files d'attente, rejouabilité/idempotence et absence de perte |
| Retour arrière | Non | Source conservée et interdiction de bascule documentée | Répétition isolée d'un rollback conservant les écritures postérieures au point de bascule |

## Inventaire des 36 tables métier

La colonne « équivalent pilote » n'atteste aucune égalité de schéma ou de données. Toutes les tables restent à comparer champ par champ sur une copie privée restaurée, y compris celles sans ligne.

| Table source | Clé primaire | Équivalent pilote | État fonctionnel |
|---|---|---|---|
| `admin_audit_log` | `id` | Aucun ; `stg_auth_audit` couvre seulement quelques événements d'identité | Non migré |
| `association_settings` | `id` | Aucun | Non migré |
| `bureau_members` | `role_key` | Aucun | Non migré |
| `content_attachments` | `id` | Aucun | Non migré |
| `documents` | `id` | Aucun | Non migré |
| `event_albums` | `id` | Aucun | Non migré |
| `events` | `id` | `stg_events`, table minimale | Partiel synthétique |
| `gallery` | `id` | Aucun | Non migré |
| `good_deal_submissions` | `id` | Aucun | Non migré |
| `good_deals` | `id` | Aucun | Non migré |
| `household_charges` | `id` | `stg_household_charges` | Partiel synthétique |
| `household_members` | `id` | Aucun | Non migré |
| `household_payment_allocations` | `payment_id`, `charge_id` | `stg_household_payment_allocations` | Partiel synthétique ; clé composée |
| `household_payments` | `id` | `stg_household_payments` | Partiel synthétique |
| `households` | `id` | `stg_households`, table minimale | Partiel synthétique |
| `membership_requests` | `id` | Aucun | Non migré |
| `membership_subscriptions` | `id` | Aucun | Non migré |
| `news` | `id` | Aucun | Non migré |
| `notification_preferences` | `user_id` | Aucun | Non migré |
| `notification_settings` | `id` | Aucun | Non migré |
| `offline_people` | `id` | Aucun | Non migré |
| `poll_household_attendance` | `poll_id`, `household_member_id` | Aucun | Non migré ; clé composée |
| `poll_options` | `id` | Aucun | Non migré |
| `poll_question_answers` | `question_id`, `user_id` | Aucun | Non migré ; clé composée |
| `poll_questions` | `id` | Aucun | Non migré |
| `poll_votes` | `poll_id`, `user_id` | Aucun | Non migré ; clé composée |
| `polls` | `id` | Aucun | Non migré |
| `profiles` | `id` | `stg_auth_accounts` regroupe quelques attributs ; pas un schéma équivalent | Partiel synthétique |
| `push_subscriptions` | `id` | Aucun | Non migré |
| `treasury_entries` | `id` | `stg_treasury_entries` | Partiel synthétique |
| `treasury_event_batches` | `id` | Aucun | Non migré |
| `treasury_event_participants` | `id` | Aucun | Non migré |
| `treasury_import_archive_lines` | `batch_id`, `source_row` | Aucun | Non migré ; clé composée |
| `treasury_import_batches` | `id` | Aucun | Non migré |
| `treasury_opening` | `id` | `stg_treasury_opening` | Partiel synthétique |
| `treasury_transfers` | `id` | `stg_treasury_transfers` | Partiel synthétique |

Les schémas gérés `auth` et `storage` ne sont pas inclus dans ces 36 tables publiques. Leurs utilisateurs, identités, sessions, autorisations, métadonnées et objets binaires doivent être couverts séparément.

## Les neuf fonctions Edge

Le Worker observé expose des routes de diagnostic. Il n'expose aucun remplacement métier complet de ces neuf fonctions.

| Fonction du contrat | État Cloudflare | Recette requise |
|---|---|---|
| `admin-data-export` | Non migrée | Export complet privé et restaurable ; l'export historique est limité à 16/36 tables, sans fichiers binaires ni empreintes de mots de passe |
| `admin-system-status` | Non migrée | État des composants, accès admin, absence de fuite d'informations |
| `admin-user-management` | Non migrée | Statut et rôle, changements de compte, révocation et audit ; aucune opération réelle pendant le pilote |
| `approve-membership-request` | Non migrée | Approbation/refus atomiques ; profil, foyer, statut, notifications et droits cohérents |
| `danz-assistant` | Non migrée | Confirmer si la fonction est encore utilisée ; décider du devenir avec validation humaine |
| `push-notifications` | Non migrée | Autorisation d'envoi, préférences, livraison et gestion des abonnements invalides |
| `r2-media` | Non migrée | Octets identiques, autorisations, clés d'objet, liens signés et opérations sur les médias |
| `request-membership` | Non migrée | Confirmer le flux actif : le frontend observé utilise aussi `supabase.auth.signUp` ; aucune disparition silencieuse du contrat |
| `send-member-login-link` | Non migrée | Contrôle d'accès, lien et expiration, délivrabilité et retour vers la bonne origine |

## Dépendances PostgreSQL supplémentaires : 25 RPC appelées par le frontend

**Les neuf fonctions Edge ne constituent pas l'inventaire complet de la logique serveur.** Une recherche statique dans `src/` relève les 25 noms RPC littéraux ci-dessous. Aucun équivalent de ces opérations n'est exposé par le Worker de préparation. Les appels construits dynamiquement, les vues, fonctions SQL internes, triggers et politiques RLS peuvent ajouter d'autres dépendances ; cet inventaire est donc un minimum à compléter par l'export du schéma restauré.

| Groupe | RPC observées |
|---|---|
| Annuaire et foyers | `admin_create_offline_person`, `admin_link_offline_person`, `admin_merge_households`, `admin_merge_offline_people`, `admin_update_profile_name` |
| Adhésion et paiements | `admin_set_membership_status`, `request_membership_subscription`, `prepare_household_payment`, `declare_household_payment`, `confirm_household_payment`, `admin_record_household_payment` |
| Droits | `claim_treasurer_role` |
| Questionnaires | `submit_poll_household_questionnaire`, `submit_poll_questionnaire` |
| Événements et comptabilité | `treasury_collect_event`, `treasury_event_create_guest`, `treasury_event_record_entry`, `treasury_event_set_participant_finance` |
| Journal, correction et import | `treasury_cancel_entry`, `treasury_restore_entry`, `treasury_update_entry`, `treasury_manage_charge`, `treasury_manage_transfer`, `treasury_set_advance_reimbursement`, `treasury_import_edited_entries` |

À vérifier pour chaque RPC : entrées, sorties, erreurs, permissions, atomicité, effet sur toutes les tables, audit et répétition de requête. Copier uniquement les lignes ne conserve pas ce comportement.

## Risques et conditions bloquantes

1. **Sauvegarde et restauration non attestées.** La procédure préparée ne constitue pas une sauvegarde réalisée. Il faut des exports cohérents de tous les schémas et composants requis, des fichiers R2/Storage complets, un chiffrement indépendant avec récupération maîtrisée, puis une restauration isolée contrôlée.
2. **Schéma incomplet.** Le contrat des 36 noms et clés ne suffit pas pour construire la cible. Types, nullabilité, JSON, valeurs par défaut, contraintes, relations, vues, index et règles doivent être inventoriés et normalisés explicitement. Les cinq clés composées doivent résister aux doublons et ne perdre aucune ligne.
3. **Identités et droits non migrés.** Les trois tables d'identité du pilote ne stockent pas de mécanisme complet de vérification des mots de passe. Les helpers de session ne sont pas raccordés à une route de connexion. Une sonde cookie réussie prouve un transport de cookie, pas une authentification. Examiner aussi les comptes/profils orphelins sans les supprimer.
4. **Parité financière non prouvée.** Un exemple fictif de calcul ne couvre pas toutes les écritures, archives, avances, remboursements et cotisations. Exiger des comparaisons au centime, des soldes par compte et période, des relations paiement/charge/foyer cohérentes et une validation du trésorier sur les écarts expliqués.
5. **Stockage partagé entre deux fournisseurs.** `src/lib/mediaStorage.js` prévoit R2 et le secours Supabase Storage. Il faut comparer les objets réellement présents à la source, pas seulement les références en base ni les fichiers déjà téléchargés. Conserver chemins, tailles, SHA-256, métadonnées utiles et droits ; tester les refus d'accès autant que les téléchargements autorisés.
6. **Caches et écritures hors ligne.** `public/sw.js` conserve un shell et des médias privés ; `offlineCache.js` et IndexedDB conservent d'autres données. La file `offlineMutations.js` accepte votes, questionnaires et propositions de bons plans, puis les rejoue vers Supabase. Une nouvelle origine ne reprend pas automatiquement ces files et caches. Prévoir leur traitement avec consentement adapté et sans suppression silencieuse, leur isolation par utilisateur, leur invalidation sûre et un test sur PWA déjà installée.
7. **Retour arrière sans perte non démontré.** Garder Supabase intact ne suffit pas si la cible reçoit de nouvelles écritures. Il faut un point de référence cohérent, une stratégie de reprise des changements, une répétition de rollback et des contrôles après retour arrière. Aucun gel des écritures source ne doit être déclenché pendant le pilote.
8. **Recette sur les appareils et réseau autorisés.** Tester mobile, Safari/Firefox/Chrome utiles, session et POST/OPTIONS depuis le poste professionnel. Une URL accessible ou un GET réussi ne confirme ni l'autorisation du service par l'organisme ni l'ensemble des parcours.

## Pièces attendues pour revoir le NO-GO

- [ ] Sauvegarde indépendante chiffrée, complète et restaurée ; contrôles privés conservés hors GitHub et logs.
- [ ] Inventaire source actualisé des 36 tables, schémas gérés, vues, RLS, fonctions SQL/RPC, triggers et neuf fonctions Edge ; divergences documentées.
- [ ] Correspondance de schéma et transformations réversibles testées ; comparaison intégrale des clés et champs sans différence inexpliquée.
- [ ] Identités, statuts, rôles et foyers conservés ; connexion, récupération, déconnexion et révocation éprouvées sans exposition des mots de passe.
- [ ] Transactions financières, audit, répétition des demandes et réconciliation au centime validés.
- [ ] Inventaire indépendant et vérification taille/SHA-256 de tous les objets R2/Storage ; recette des accès autorisés et refusés.
- [ ] Remplacement ou décision approuvée pour chaque fonction métier, y compris les RPC ; recette de tous les domaines de la matrice.
- [ ] Migration des sessions/appareils/caches/files hors ligne conçue et répétée ; tests du poste professionnel consignés.
- [ ] Retour arrière sans perte des nouvelles écritures répété et documenté.
- [ ] Rapport GO/NO-GO signé et **validation explicite ultérieure** avant toute bascule production.

La préparation et les tests synthétiques peuvent continuer. Le site GitHub Pages, `main`, Supabase et les fichiers de production restent les références opérationnelles.
