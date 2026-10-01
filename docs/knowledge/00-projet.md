# Projet — Amicale DANZ Antilles

## Finalité

Application web privée destinée aux membres de l'Amicale DANZ Antilles.

Le dépôt décrit une application front-end React déployée sur GitHub Pages et connectée à Supabase pour l'authentification, les profils et les données applicatives.

## Production

- Dépôt : `amicale-danz-antilles/danz`
- Branche principale : `main`
- URL de publication indiquée dans le README :
  `https://amicale-danz-antilles.github.io/danz/`
- Déploiement automatique : GitHub Actions vers GitHub Pages.

## Utilisateurs

L'application distingue au minimum :

- membres authentifiés et actifs ;
- administrateurs ;
- administrateurs ayant le rôle fonctionnel de trésorier.

L'accès aux pages protégées nécessite une session Supabase et un profil actif.

## Périmètre fonctionnel observé

### Espace membre

- tableau de bord ;
- agenda ;
- galerie ;
- bons plans ;
- notifications ;
- profil ;
- foyer / ménage ;
- fonctionnement hors ligne partiel.

### Espace administration

- demandes et gestion des utilisateurs ;
- annuaire ;
- gestion des contenus ;
- trésorerie ;
- sauvegardes ;
- état du système ;
- sondages / questionnaires ;
- bureau de l'amicale ;
- administration des bons plans.

## Fonctionnement hors ligne

Le code prévoit des variantes hors ligne pour :

- tableau de bord ;
- agenda ;
- galerie ;
- bons plans.

Les opérations financières et d'administration sont explicitement limitées au mode en ligne afin d'éviter les divergences de données.

## Point d'attention documentaire

Le README historique mentionne une connexion membre par lien sécurisé, alors que le code actuel de `AuthContext.jsx` utilise `signInWithPassword`.

Pour toute décision technique, considérer le code actuel comme source de vérité et traiter le README comme une description générale pouvant nécessiter une mise à jour.
