# Journal des validations

Mis à jour le 17 octobre 2026. Les résultats ci-dessous proviennent des exécutions
Codex et des sorties locales partagées par l'utilisatrice. Les dates précises ne
sont pas attribuées lorsque seul l'ordre des échanges est connu.

## Contrôles de référence

| Commande | Dernier résultat observé | Contexte |
| --- | --- | --- |
| `npm run test:memory` | 31 réussis dans Codex ; dernière exécution Windows partagée : 29 réussis | Bases temporaires, sans Ollama |
| `npm run format:check` | Réussi après correctif des fins de ligne | Codex et Windows |
| `npm run typecheck` | Réussi | Codex et Windows |
| `npm run db:check` | Version 2, intégrité `ok`, zéro erreur de clé étrangère, 38 tables/vues | Codex et Windows |
| `npm run chat:prompt -- 1` | Identifiants `[1]`, souvenir présent dans le system prompt | Base Windows de l'utilisatrice |

Ces résultats décrivent les versions testées, pas une garantie automatique sur les
modifications futures. Les bases locales et cloud sont différentes.

## Historique des étapes

### 1. Mise en place du socle cloud

- Node.js 24, dépendances verrouillées, types et SQLite vérifiés.
- Initialisation répétable testée sur une base de démonstration séparée.
- Routes HTTP et validation des entrées vérifiées.
- Ollama absent dans l'environnement cloud ; les téléchargements initialement
  tentés ont rencontré des refus réseau HTTP 403.
- Cela ne décrit pas la machine Windows, où Ollama a ensuite fonctionné.

### 2. Protection des dates — `aea5af9`

Six tests : préférence sans date, date explicite, date différente des sources,
expressions vagues, heure sans invention de jour/secondes/fuseau, timestamp explicite
et valeur null. Formatage et types réussis. Preview conservé.

### 3. Workflow de review — `cd99f52`

La suite passe à 14 tests : migration préservant les anciennes lignes, propositions,
sources, acceptation/correction/refus, historique, déduplication, rollback,
isolation des sources, entrées invalides, lot vide et panne de génération simulée.

Essais réels sur la base Windows, avec `mistral-small3.2:24b` :

| Étape | Observation |
| --- | --- |
| Première proposition | Un souvenir créé, ID 1, pending, source message 5, date null, importance 3 |
| Contenu | Préférence pour les lieux calmes lors de prochains rendez-vous |
| Acceptation | Statut accepted ; décision et textes avant/après conservés |
| Consultation | Souvenir accepté, source et historique retrouvés |
| Nouvelle extraction | `createdCount: 0`, `duplicateCount: 1` ; souvenir accepté conservé |

La première extraction a pris environ 139 secondes et la réextraction environ
123 secondes. Ce sont deux observations locales, pas un benchmark.

**Limite :** correction et refus ont été testés automatiquement, mais aucun essai
manuel correspondant sur la vraie base n'a été partagé.

### 4. Récupération mémoire v1 — `e4a39ba`

La suite passe à 29 tests. Les 15 nouveaux cas couvrent :

- acceptés et corrigés dans le prompt, sans texte original erroné ni métadonnées internes ;
- exclusion de chaque statut non validé et de chaque cycle inactif ;
- isolation de tous les rattachements pour tous les scopes ;
- rattachement obligatoire, relation absente et scopes sans restrictions supplémentaires ;
- accents, apostrophes et recherche titre/contenu/mots-clés ;
- FTS `OR` lorsqu'un seul terme correspond ;
- fallback d'importance 3 sans mot significatif partagé et requêtes vides/inexploitables ;
- déduplication FTS/fallback, classement stable et limites de nombre/caractères ;
- absence de section sans souvenir pertinent ;
- récupération en lecture seule ;
- prompt sortant de l'endpoint streaming avec transport Ollama simulé ;
- identifiants affichés avant le prompt par le script sans Ollama ;
- date et messages récents préservés.

Sur Windows, `chat:prompt -- 1` sélectionne réellement le souvenir 1 et l'inclut
sous `SOUVENIRS VALIDÉS PERTINENTS`.

### 5. Formatage Windows/Linux — `e306d49`

Le premier `format:check` local signalait 13 fichiers, malgré les contrôles réussis
sous Linux. Le problème a été reproduit avec des fins de ligne CRLF. La configuration
Prettier `endOfLine: auto` a été ajoutée ; contrôle réussi ensuite sur Windows.
Aucun changement de base nécessaire.

### 6. Réponse réelle du personnage avec mémoire

Message envoyé à l'endpoint de conversation :

> Tu proposerais quel genre de lieu pour notre prochaine sortie ?

Le modèle a proposé une librairie tranquille avec coin café ou un parc paisible,
sans mentionner le mécanisme mémoire. Le streaming a fonctionné.

**Portée de la preuve :** la réponse est cohérente avec le souvenir validé, mais la
préférence figurait aussi dans les messages récents. Cet essai ne démontre pas à
lui seul un rappel reposant exclusivement sur la mémoire récupérée. Voir V01.

## 17 octobre 2026 — V01 : mémoire hors des messages récents

Deux tests supplémentaires utilisent une base temporaire et une vraie fenêtre de
12 messages : le message source est suivi de 14 messages neutres et n'est donc
plus chargé dans les messages récents.

- Sans récupération, le fait ancien est absent du prompt ; avec récupération,
  le souvenir accepté d'importance 3 revient par fallback.
- Une proposition en attente reste exclue ; après correction explicite, seul le
  contenu corrigé est injecté. Source et review conservent le texte original.

Résultat : 31 tests réussis, formatage et types réussis ; `db:check` confirme la
version 2, l'intégrité correcte et aucune erreur de clé étrangère. Aucun changement
du code applicatif, du schéma ou des données personnelles.

Cela démontre la construction du contexte sans l'appui des messages récents,
mais pas encore l'exploitation du souvenir par un vrai Ollama dans ce scénario.
L'essai local correspondant reste à effectuer ; V01 n'est pas clos entièrement.

## Rejouer les contrôles

Depuis la racine du dépôt :

```sh
npm run test:memory
npm run format:check
npm run typecheck
npm run db:check
npm run chat:prompt -- 1 "Où souhaiterais-tu passer la soirée ?"
```

Les tests automatisés créent leurs propres bases temporaires et ne nécessitent
pas Ollama. `db:check` et `chat:prompt` utilisent la base sélectionnée par
`CHARACTER_CHAT_DB`, ou la base locale par défaut ; la conversation 1 doit exister
pour l'aperçu. Pour les requêtes HTTP réelles, démarrer l'API et Ollama.

Les appels de proposition/review/conversation écrivent dans la base : utiliser une
base de test séparée pour les scénarios expérimentaux. Ne pas supprimer la base
personnelle ni répéter le seed sur celle-ci pour préparer un test.

## Modèle d'entrée pour une prochaine validation

- Date et commit :
- Tâche du backlog :
- Environnement : Codex / Windows / autre ; vraie base ou base temporaire.
- Dépendances : vrai Ollama ou transport simulé ; modèle si applicable.
- Commande ou scénario :
- Attendu :
- Observé :
- Verdict : réussi / échoué / ignoré / non exécuté.
- Limites et action suivante :
