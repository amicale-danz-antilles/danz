# Fonctionnalités

## Routes membres observées dans `src/App.jsx`

| Route | Fonction |
|---|---|
| `/` | Tableau de bord |
| `/agenda` | Agenda |
| `/galerie` | Galerie |
| `/bons-plans` | Bons plans |
| `/notifications` | Notifications |
| `/profil` | Profil |
| `/foyer` | Gestion du foyer, en ligne uniquement |
| `/connexion` | Connexion / demande d'accès |
| `/confidentialite` | Confidentialité |

Certaines anciennes routes redirigent vers l'accueil, notamment `/actualites`, `/documents` et `/amicale`.

## Routes d'administration

| Route | Fonction |
|---|---|
| `/administration` | Demandes / administration principale |
| `/administration/utilisateurs` | Annuaire / utilisateurs |
| `/administration/utilisateurs/gestion` | Gestion détaillée des utilisateurs |
| `/administration/tresorerie` | Trésorerie |
| `/administration/sauvegardes` | Sauvegardes |
| `/administration/systeme` | État du système |
| `/administration/contenus` | Gestion des contenus |
| `/administration/bons-plans` | Bons plans côté administration |
| `/administration/sondages` | Sondages / questionnaires |
| `/administration/bureau` | Bureau de l'amicale |

Ces routes sont protégées par le rôle administrateur et nécessitent une connexion réseau.

## Domaines métier présents dans le code et les migrations

Les noms de pages, bibliothèques et migrations montrent notamment les domaines suivants :

- actualités / publications ;
- événements et agenda ;
- galerie ;
- documents ;
- notifications ;
- bons plans ;
- sondages et questionnaires conditionnels ;
- foyers / ménages et personnes rattachées ;
- cotisations et situation des membres ;
- trésorerie banque / caisse ;
- suivi financier des événements ;
- export et import Excel de trésorerie ;
- audit des mutations financières ;
- annuaire et personnes hors ligne ;
- sauvegardes administratives.

## Trésorerie

Le dépôt contient plusieurs modules spécialisés, notamment :

- `treasuryLedger.js`
- `treasuryExport.js`
- `treasuryPartialExport.js`
- `treasuryRoundTrip.js`
- `treasuryXlsx.js`
- logique de finance des personnes et rentabilité des adhésions.

Le script `npm run test:treasury` exécute des tests Node dédiés aux soldes, exports et finances d'événements.

## Hors ligne

Le tableau de bord, l'agenda, la galerie et les bons plans disposent de variantes hors ligne.

Les opérations d'administration et de finance ne doivent pas être réalisées hors ligne selon les protections présentes dans l'application.
