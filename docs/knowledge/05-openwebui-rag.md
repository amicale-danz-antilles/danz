# Utilisation avec Open WebUI / RAG

## Objectif

Donner à l'IA locale une connaissance fiable du projet sans charger tout le dépôt dans la fenêtre de contexte.

## Base de connaissances conseillée

Nom :

`DANZ - Documentation projet`

Importer en priorité les fichiers de ce dossier :

- `README.md`
- `00-projet.md`
- `01-architecture.md`
- `02-fonctionnalites.md`
- `03-donnees-auth-securite.md`
- `04-deploiement-exploitation.md`

## Réglages recommandés pour le Mac M3 16 Go

Modèle principal :

`qwen3.5:9b`

Réglages :

- contexte : 8192 ;
- thinking : désactivé par défaut ;
- streaming : activé ;
- keep_alive : 15 minutes ;
- récupération RAG ciblée / Focused Retrieval.

## Règles de réponse recommandées

Prompt système suggéré :

```text
Tu es l'assistant technique local du projet Amicale DANZ Antilles.

Utilise en priorité la documentation du projet et cite la source quand elle est disponible.

Distingue toujours :
1. les faits explicitement présents dans la documentation ou le code ;
2. tes déductions ;
3. ce qui reste inconnu.

N'invente jamais une table, une route, une variable, une configuration ou une décision technique.

Pour les questions sur les données, indique si l'information vient du schéma initial ou d'une migration plus récente.

Pour toute opération sensible, proposer d'abord une méthode vérifiable et réversible.
```

## Ce qu'il ne faut pas indexer automatiquement

Ne pas importer :

- `.env` ;
- clés privées ;
- mots de passe ;
- tokens GitHub / Supabase / Cloudflare ;
- dumps de données personnelles ;
- secrets de CI/CD.

## Quand utiliser directement le dépôt GitHub

Le RAG fournit une synthèse stable.

Pour une question dépendant du code le plus récent, des commits ou d'un fichier précis, consulter le dépôt GitHub directement avant de conclure.

La bonne séparation est :

```text
Documentation RAG
= contexte stable, architecture, procédures

GitHub
= état actuel du code, historique, changements précis
```
