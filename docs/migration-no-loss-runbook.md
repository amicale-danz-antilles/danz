# DANZ — protocole de transition sans perte (ébauche, 24 septembre 2026)

**Aucune donnée réelle n'a été importée dans Nhost.** Le projet américain sert uniquement aux essais fictifs. Le schéma et les autorisations complets n'y sont pas encore déployés.

## Livrables

- Suivi dans l'application : **Administration → Migration Nhost** ; états publiés dans `public/migration-status.json` lors d'un déploiement. Il s'agit d'un journal d'étapes validées, pas d'une synchronisation temps réel avec Nhost.
- SQL fictif et répétition anti-surallocation : `docs/nhost-sandbox/02_finance_fictive.sql` et `03_repetition_fictive.sql`. **Exécution manuelle et en bac à sable uniquement**.
- Contrôle de parité : `node scripts/verify-migration-parity.mjs migration-private/source.json migration-private/target.json`. Le script compare les 29 tables minimales, l'ensemble des tables supplémentaires, les nombres de lignes, empreintes d'identifiants, empreintes normalisées du contenu, comptes, médias et agrégats financiers. Il échoue fermement si un élément diffère.
- Test logiciel automatique : `npm run test:migration`, uniquement avec des données synthétiques. Un test réussi du script ne certifie pas la migration réelle.

## Avant l'export réel

1. Choisir une région Nhost validée pour les données personnelles, et répéter les tests complets de connexion et de stockage sur le réseau professionnel dans **cette** région.
2. Porter le schéma complet des 29 tables, les fonctions SQL, les huit fonctions serveur et les permissions Hasura/Nhost. Ne pas exposer de rôle administrateur au navigateur.
3. Tester l'import de comptes **fictifs** conservant UUID et empreintes bcrypt, la réinitialisation des mots de passe de secours, les e-mails et les permissions de chaque rôle. Les sessions Supabase existantes ne sont pas transférables : prévoir une reconnexion.
4. Tester l'application complète, la trésorerie, les avances, les dettes, les albums privés, les notifications, les écritures simultanées et la sauvegarde/restauration.

## Journée du basculement — exécution manuelle et explicite

1. Prévenir les utilisateurs d'une courte fenêtre de maintenance ; fermer toutes les écritures et arrêter les opérations financières jusqu'à la validation.
2. Réaliser une sauvegarde PostgreSQL **restaurable**, un export privé des objets R2 / Supabase Storage, et un inventaire des comptes. Tester au préalable une restauration complète en environnement isolé.
3. Extraire un lot immuable `batch_id` depuis Supabase, avec des manifestes **privés** contenant les nombres de lignes, une empreinte SHA-256 des UUID triés et une empreinte SHA-256 des enregistrements normalisés de chaque table. Pour les comptes, comparer les identifiants ; pour les médias, comparer les empreintes des octets, pas seulement les URL (qui peuvent changer).
4. Importer dans la région Nhost approuvée via une procédure privée et rejouable ; conserver les mêmes UUID et les liens foyer/charge/paiement. Ne pas écrire des données de membres dans GitHub ni dans des journaux accessibles publiquement.
5. Produire un manifeste cible avec **le même** `batch_id` et le même algorithme canonique ; exécuter le contrôle de parité. Toute différence doit bloquer le basculement jusqu'à explication et correction.
6. Effectuer la recette de connexion sur le réseau professionnel et mobile, vérifier les fonctions d'administration, les notifications et la trésorerie sur une copie privée. Seul un administrateur autorisé confirme manuellement la mise en production.
7. Basculer GitHub Pages après validation, incrémenter le cache PWA et surveiller les erreurs. Conserver Supabase en lecture seule pendant la période de retour arrière et ne pas le supprimer tant que les opérations ne sont pas stables.

Les manifestes JSON réels doivent rester exclusivement dans `migration-private/` (exclu de Git). Ce protocole définit la validation ; **les exporteurs/importeurs de production ne sont pas encore écrits ni exécutés**. Aucun taux de réussite de transfert ne peut être annoncé avant leur exécution et la parité effective.
