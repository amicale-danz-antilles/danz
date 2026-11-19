# Migration à blanc locale — données artificielles uniquement

Exécuter depuis `workers/danz-api/` avec Node.js 22 :

```text
node migration/synthetic-dry-run.mjs
node --test test/synthetic-dry-run.test.mjs
```

La commande ne prend aucun fichier, secret ou connexion. Elle génère un jeu fictif de 70 lignes, produit des blocs au format PostgreSQL `COPY ... FROM stdin`, les analyse sans exécuter le SQL source, puis les importe sous transaction dans une base SQLite en mémoire. Les requêtes d'insertion utilisent des paramètres liés. Les 36 noms de tables et les cinq clés primaires composées viennent du contrat du dépôt. Des clés étrangères représentatives et un manifeste d'identités distinct sont vérifiés. Une comparaison relit les lignes réellement stockées ; les fichiers fictifs copiés sont relus et leurs tailles et SHA-256 recalculés.

Le contrôle financier indépendant attend **18 500 centimes en banque**, **3 500 centimes en caisse**, **22 000 centimes au total** après le virement fictif ; les affectations ne doivent dépasser ni paiements ni charges et doivent rester dans leur foyer. Les tests injectent une ligne manquante, une modification d'un centime, un doublon de clé composée, une clé étrangère cassée, un bloc COPY manquant ou tronqué, des colonnes incorrectes, un entier non représentable, un droit modifié et un fichier tronqué. Un import refusé revient intégralement à zéro ligne.

**Limites :** le schéma est délibérément synthétique. Il ne reproduit pas toutes les colonnes, contraintes, règles RLS, déclencheurs, fonctions SQL ou transformations du schéma Supabase. Ce parseur reconnaît seulement le sous-ensemble COPY généré par les fixtures ; ce n'est pas un outil pour importer des sauvegardes réelles. Les neuf fonctions Edge sont inventoriées, pas portées ni exécutées. Aucun hachage de mot de passe, benchmark bcrypt, connexion adhérent, envoi de notification, restauration PostgreSQL ou import D1 distant n'est testé par cette commande. Le chiffrement et la sauvegarde complète réelle restent à établir séparément. Un résultat `ok=true` valide seulement cette démonstration synthétique et conserve `productionReadiness=NO-GO`.
