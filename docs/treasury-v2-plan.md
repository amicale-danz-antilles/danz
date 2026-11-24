# DANZ — Refonte comptable V2 (prototype, non déployé)
Ce document ne contient aucune donnée réelle. Le dépôt est public. Les exports, pièces, identifiants privés et secrets restent hors Git.
## Architecture proposée
- Conserver le site et les identités existantes. Un seul moteur financier cible, côté serveur, avec journal en partie double.
- Tables candidates : comptes, exercices, opérations (brouillon/validée), lignes, rapprochements, justificatifs privés, correspondance des sources, budgets, affectations analytiques.
- Montants en centimes entiers. Une opération validée est immuable; toute correction passe par contrepassation et nouvelle écriture. Identifiant source unique et transactions atomiques. Verrouillage des exercices et contrôle du total débit/crédit au moment de la validation.
- Séparer banque/caisse, fonds prestataire en transit, créances, avances à rembourser et fonds à localiser. Pas de moyen de paiement inconnu assimilé automatiquement à la banque. Aucune création de produit par transfert.
- Dates comptables civiles America/Martinique, horodatages techniques UTC. Cotisations : formules explicites, échéances et ventilation analytique distincte des encaissements.
- Event : budget, charges, recettes, financement interne; pas de modification rétroactive du financement approuvé. Les remboursements partiels sont liés à leur dette d'origine.
- Rôles et contrôles côté serveur : trésorier, validation bureau, lecture limitée, adhérent (son périmètre seulement). RLS et autorisations à tester avec chaque rôle. Jamais de secret côté navigateur.
## Migration
1. Confirmer l'infrastructure cible et réaliser une sauvegarde privée complète et restaurable, sans données personnelles dans Git.
2. Cartographier anciennes tables et clés : treasury_opening, treasury_entries, treasury_transfers, household_charges, household_payments, household_payment_allocations, membership_subscriptions, événements, imports et archives.
3. Choisir une date de reprise et vérifier banque, caisse, fonds non ventilés et dettes sur preuves. Ne jamais inventer une ventilation ou compter à la fois l'ouverture et les mouvements qui y sont déjà inclus.
4. Construire une reprise idempotente avec correspondance source->opération et liste des exceptions. Les paiements reliés au journal constituent un seul fait financier, les affectations ne créent pas un second encaissement.
5. Tester exclusivement avec données synthétiques dans une base isolée. Comparer à l'ancien calcul, expliquer chaque écart, tester une restauration et obtenir la validation du trésorier.
6. Basculer seulement après validation explicite; geler les écritures pendant la reprise finale, garder les archives consultables et préparer un retour arrière.
## Etat
Prototype JS purement local, sans persistance ni autorisation, non relié à l'interface. Plan comptable indicatif à valider. Les tests synthétiques se lancent avec `node --test scripts/treasury-v2-prototype.test.mjs`. Aucune migration SQL ni mise en production à ce stade. Le prototype ne remplace pas les contrôles transactionnels, les droits, les plafonds de remboursements ou le rapprochement bancaire.
