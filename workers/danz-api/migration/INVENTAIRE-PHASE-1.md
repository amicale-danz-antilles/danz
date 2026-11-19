# DANZ Antilles — inventaire et suivi de la phase 1

Inventaire établi à partir des métadonnées et du code versionnés dans le brouillon [#52](https://github.com/amicale-danz-antilles/danz/pull/52). Les vérifications de cette phase portent sur le contrat, le SQL suivi par Git et les appels visibles dans l’application. L’état des services distants reste à confirmer avec les responsables habilités.

## Tables et clés primaires

- [source-contract.json](source-contract.json) et [source-counts.sql](source-counts.sql) couvrent les mêmes **36 tables publiques**. Le SQL de comptage a été inspecté localement.
- L’[inventaire de l’export historique](legacy-export-coverage.json) répartit ces tables en **16 exportées et 20 omises** par l’Edge Function. Les écritures, soldes, transferts, foyers et allocations font partie des omissions. L’export historique n’inclut aucun octet des objets R2 et Supabase Storage.
- Le [schéma initial](../../../supabase/schema.sql) et les [migrations PostgreSQL](../../../supabase/migrations) contiennent les déclarations de **24 des 36 tables**. Les clés primaires déclarées pour ces 24 tables correspondent au contrat. **12 déclarations** restent à obtenir sous forme de DDL autorisé sans données : `admin_audit_log`, `bureau_members`, `content_attachments`, `event_albums`, `good_deal_submissions`, `good_deals`, `membership_requests`, `notification_preferences`, `poll_options`, `poll_votes`, `polls`, `push_subscriptions`.
- `membership_dues` figure dans le [SQL historique](../../../supabase/migrations/20260909_membership_dues_and_situation.sql), avec une clé `id` et une contrainte unique `(user_id, year)`. Le [frontend administratif](../../../src/pages/AdminBackup.jsx) tente de l’ajouter à l’export par une lecture distincte sans `id` et poursuit si la lecture échoue. La table est absente du contrat et aucune suppression n’apparaît dans les migrations suivies. Confirmer son statut et le sort de son historique avant de figer le périmètre. Le [script de retrait de l’assistant](../../../supabase/migrations/20260925170000_remove_danz_assistant.sql) prévoit les suppressions de `danz_assistant_actions`, `danz_assistant_technical_requests`, `danz_assistant_usage`, `site_preferences` et `private.danz_assistant_owner`.
- Le contrat public inventorie les noms et les clés. Le DDL de référence complet doit aussi recenser colonnes, types, contraintes, clés étrangères et actions associées, vues, index, séquences, RPC, déclencheurs, politiques RLS, rôles et droits. Les schémas gérés Auth et Storage, les tâches planifiées et les objets binaires demandent leurs propres preuves de couverture et de restauration.

| Table | Clé composée, dans l’ordre du contrat | Constat dans le dépôt |
| --- | --- | --- |
| `household_payment_allocations` | `payment_id`, `charge_id` | DDL PostgreSQL et pilote D1 |
| `poll_household_attendance` | `poll_id`, `household_member_id` | DDL PostgreSQL |
| `poll_question_answers` | `question_id`, `user_id` | DDL PostgreSQL |
| `poll_votes` | `poll_id`, `user_id` | Contrat et usages applicatifs, DDL absent |
| `treasury_import_archive_lines` | `batch_id`, `source_row` | DDL PostgreSQL |

### Écarts du pilote D1

Le [schéma financier pilote](../migrations/0001_staging_finance_pilot.sql) a huit correspondances de noms avec le contrat, après retrait du préfixe `stg_` : `events`, `households`, `household_charges`, `household_payments`, `household_payment_allocations`, `treasury_entries`, `treasury_opening` et `treasury_transfers`. Les 28 autres tables n’ont pas de correspondance de nom. Le [pilote d’identité](../migrations/0002_staging_identity_pilot.sql) ajoute trois structures dédiées aux comptes, sessions et audits artificiels.

Les huit correspondances sont des prototypes. La divergence porte, entre autres, sur les points suivants.

- Les clés d’allocation correspondent, mais PostgreSQL déclare `ON DELETE CASCADE` pour les deux références et le pilote utilise `RESTRICT`. Les déclencheurs pilotes protègent les montants et le foyer des allocations. L’équivalence des écritures et des contraintes métier reste à démontrer. [DDL des foyers](../../../supabase/migrations/20260917_households_treasury_membership.sql)
- Les foyers et événements pilotes exigent un `code`. Le `name` du foyer et le `title` de l’événement, ainsi que les données de publication et d’audience, demandent un modèle complet. [Schéma initial](../../../supabase/schema.sql) · [Publication et notifications](../../../supabase/migrations/20260911_content_workflow_notifications.sql)
- Le journal et les transferts pilotes omettent des données métier telles que les références de justificatifs, les bénéficiaires, la provenance des imports, les acteurs et les notes. Les RPC de correction, d’annulation et de reprise, les règles d’accès et la piste d’audit demandent une recette dédiée. [SQL de trésorerie](../../../supabase/migrations/20260924_treasury_bank_cash_v2.sql) · [SQL d’import](../../../supabase/migrations/20260924170000_excel_source_of_truth_ledger.sql)
- Les tables pilotes ne contiennent ni équivalent complet de `profiles` ni mécanisme validé de reprise des identités, des mots de passe ou de la récupération de compte.

## Fonctions Edge

Les **neuf entrées uniques** du contrat sont suivies ci-dessous. Aucun code d’implémentation Supabase Edge n’est suivi dans le dépôt. Cinq entrées ont des appels directs dans le frontend versionné. Aucun équivalent fonctionnel de ces neuf entrées n’est validé dans le Worker.

| Fonction | Trace dans le dépôt | Preuve ou décision à obtenir |
| --- | --- | --- |
| `admin-data-export` | Appel par `AdminBackup.jsx`. Couverture Edge de 16/36. | Vérifier les droits, l’audit et le périmètre d’export. La restauration indépendante couvre également les données et binaires omis. |
| `admin-system-status` | Appel par `AdminSystemStatus.jsx`. | Tester le diagnostic administratif, les pannes de dépendance et la visibilité des informations selon le rôle. |
| `admin-user-management` | Appels par `AdminUsers.jsx` pour les accès, le remplacement de mot de passe et la suppression. | Tester les permissions, la révocation, le changement d’accès, les conséquences de la suppression et l’audit. |
| `approve-membership-request` | Appel par `AdminDirectory.jsx` pour la décision. | Tester approbation, refus, répétition d’une décision, activation, rattachement et autorisation. |
| `danz-assistant` | Le retrait SQL indique une neutralisation de l’Edge Function. L’entrée figure encore au contrat. | Confirmer le statut côté source et approuver formellement le retrait ou un remplacement, y compris le sort des éventuelles archives. |
| `push-notifications` | Abonnements côté navigateur et références à `private.send_push_event` côté SQL. Le lien exact entre la RPC privée et l’Edge reste à établir. | Recenser déclencheurs et destinataires. Tester l’audience, les préférences, la livraison et la déduplication. |
| `r2-media` | Appels par `mediaStorage.js`, avec recours également à Supabase Storage pour les objets historiques. | Tester les droits, les liens signés, les métadonnées, l’accès aux octets et les erreurs sur les deux stockages. |
| `request-membership` | Le formulaire courant utilise `supabase.auth.signUp` dans `AuthContext.jsx`. Aucun appel direct de l’Edge repéré. | Confirmer les autres appelants et la chaîne d’inscription avec ses déclencheurs. Tester la création en attente, les doublons et le contrôle d’accès. |
| `send-member-login-link` | Aucun appel direct repéré. | Confirmer l’usage et les appelants éventuels. Tester le parcours de récupération applicable et la durée de validité des liens, ou faire approuver le retrait. |

## Suivi de la recette fonctionnelle

Les références couvrent l’ensemble des 36 tables du contrat. Chaque domaine exige une recette des parcours et des droits avant bascule.

| Domaine | Périmètre source | État à l’issue de la phase 1 et preuve à obtenir |
| --- | --- | --- |
| Authentification et sessions | `profiles`, Supabase Auth, identités, sessions et rôles | Pilote de sessions sur identités fictives. Vérifier bcrypt et son coût CPU sur Workers Free avec des hachages synthétiques, reprise des identités, révocation, récupération, CSRF, accès par foyer et isolement membre, admin, trésorier. Tester la navigation privée et la PWA sur les appareils réellement utilisés. |
| Trésorerie | `treasury_entries`, `treasury_opening`, `treasury_transfers`, `treasury_event_batches`, `treasury_event_participants`, `treasury_import_batches`, `treasury_import_archive_lines` | Pilote de soldes fictifs. Rapprocher ligne par ligne et en centimes les soldes de banque, caisse et non affecté, les transferts, remboursements, annulations et archives. Prouver atomicité, piste d’audit et accès exclusif au trésorier habilité. |
| Adhésions et foyers | `association_settings`, `membership_requests`, `membership_subscriptions`, `households`, `household_members`, `household_charges`, `household_payments`, `household_payment_allocations`. Statut de `membership_dues` à réconcilier. | Schéma financier partiel. Tester inscription, décisions, adultes et enfants, fusion, cotisations, règlements, imputations et affectation au bon foyer. |
| Événements | `events`, relations avec albums, sondages, foyers et trésorerie | Structure pilote limitée. Tester brouillons, publication programmée, audience, participants, invités, charges, encaissements et rapprochement des événements. |
| Sondages | `polls`, `poll_options`, `poll_votes`, `poll_questions`, `poll_question_answers`, `poll_household_attendance` | Équivalence à développer et à tester. Couvrir vote, changement et retrait, questionnaires conditionnels, sélection des membres du foyer, clôture et réponse différée hors ligne. |
| Médias, documentation et publications | `content_attachments`, `documents`, `event_albums`, `gallery`, `good_deals`, `good_deal_submissions`, `news`, objets R2 et Supabase Storage | Inventaires et empreintes contrôlés sur fichiers fictifs. Vérifier la couverture des objets à la source, la restauration par taille et SHA-256, les autorisations et les téléchargements des documents privés, justificatifs, galeries et albums. Tester publication et modération. |
| Notifications push | `notification_preferences`, `notification_settings`, `push_subscriptions`, planification serveur et service worker | Équivalence à développer et à tester. Contrôler les abonnements, la révocation, les préférences, les audiences, l’envoi unique et l’ouverture des liens sur les appareils cibles. |
| Mode hors ligne | Cache par utilisateur, service worker, médias privés et file de mutations | Équivalence à développer et à tester. Tester installation, mise à jour, déconnexion et purge du cache privé, bascule réseau, reprise des mutations et conflits sans doublons. |
| Services administratifs | `admin_audit_log`, `bureau_members`, `offline_people`, annuaire, demandes, accès, export et diagnostic | Équivalence à développer et à tester. Vérifier les droits, l’audit, le rattachement des personnes sans compte, les diagnostics et la récupération. Traiter les fonctions au statut incertain avec les responsables. |

Avant tout import réel, le trésorier doit valider la réconciliation comptable, le traitement de l’historique des cotisations et le retour arrière. La confirmation du schéma de référence, des fonctions effectivement actives et des exigences informatiques doit être réalisée par les responsables habilités à partir de métadonnées et de preuves approuvées.
