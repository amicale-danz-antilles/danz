# Base documentaire IA — Amicale DANZ Antilles

Cette documentation est structurée pour être indexée dans Open WebUI / RAG.

## Source de vérité

- Dépôt : `amicale-danz-antilles/danz`
- Branche analysée : `main`
- Date de synthèse : 2026-10-01
- En cas de contradiction, le code et les migrations Supabase les plus récentes priment sur cette documentation.

## Documents

1. `00-projet.md` — objectif, périmètre et repères généraux.
2. `01-architecture.md` — architecture technique et composants.
3. `02-fonctionnalites.md` — fonctionnalités membres et administration.
4. `03-donnees-auth-securite.md` — Supabase, authentification, données et sécurité.
5. `04-deploiement-exploitation.md` — build, CI/CD, GitHub Pages et exploitation.
6. `05-openwebui-rag.md` — mode d'emploi pour l'IA locale.

## Règles pour l'IA

- Ne jamais inventer une configuration, une table, une route, une clé ou une décision absente des sources.
- Distinguer clairement les faits présents dans le dépôt des déductions.
- Ne jamais recopier de secrets, mots de passe, jetons privés ou fichiers `.env`.
- Pour une question sur la base de données, vérifier aussi les migrations récentes : `supabase/migrations/`.
- Pour une question sur les routes ou les droits, vérifier `src/App.jsx` et `src/context/AuthContext.jsx`.
