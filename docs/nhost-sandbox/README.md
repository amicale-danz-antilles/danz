# Bac à sable Nhost — foyer et trésorerie fictifs

État : fichiers préparés, **pas encore exécutés sur Nhost**. Aucune donnée de membre ne figure ici.

Dans le projet Nhost de test américain `us-east-1`, ouvrir la console Hasura → Data → SQL, puis exécuter `02_finance_fictive.sql` et `03_repetition_fictive.sql` séparément. Le second fichier doit afficher trois messages « OK » et termine par `ROLLBACK` : aucune donnée fictive ne doit subsister.

Les tables fictives ne reçoivent pas de permission de mutation publique ou `user`. Les permissions devront être conçues séparément avec des fonctions côté serveur. **Ne jamais exécuter ces scripts sur Supabase de production ni sur un futur Nhost contenant des données réelles.**

Avant de considérer cette étape comme validée, vérifier : présence de cinq tables fictives, déclencheur anti-surallocation, rejet des répartitions entre foyers, rejet de la surallocation, et absence de lignes après rollback. Ne pas cocher la validation sur le tableau de bord avant ces résultats.
