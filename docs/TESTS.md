# Journal des validations

Mis à jour le 19 octobre 2026. Les résultats ci-dessous proviennent des exécutions
Codex et des sorties locales partagées par l'utilisatrice. Les dates précises ne
sont pas attribuées lorsque seul l'ordre des échanges est connu.

## Contrôles de référence

| Commande | Dernier résultat observé | Contexte |
| --- | --- | --- |
| `npm run test:memory` | 57 réussis dans Codex ; dernière exécution Windows partagée : 31 réussis | Bases temporaires, sans Ollama |
| `npm run format:check` | Réussi après correctif des fins de ligne | Codex et Windows |
| `npm run typecheck` | Réussi | Codex et Windows |
| `npm run db:check` | Codex : version 3, intégrité `ok`, zéro erreur, 39 tables/vues ; dernière preuve Windows : version 2 | Bases distinctes |
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


## 17 octobre 2026 — première web app

React/Vite ajouté avec deux routes de lecture pour lister les conversations et
leurs messages courants (corrections de messages respectées). La suite compte
32 tests ; le nouveau test HTTP vérifie aussi les accents, une apostrophe,
les caractères japonais et un emoji. Le contrôle TypeScript couvre l'interface.

Parcours Chromium sur base temporaire et transport de génération simulé :
chargement d'une conversation, envoi UTF-8, réponse en streaming, extraction,
correction avec motif, acceptation, refus avec motif, filtres, récupération après
une erreur de génération simulée, consultation de l'historique et affichage mobile sans
débordement horizontal. Aucune erreur JavaScript observée. Compilation web réussie.
Ces essais ne remplacent pas la vérification locale avec le vrai Ollama.

Aucune migration de schéma, aucun seed dans la base personnelle, aucune réécriture
des messages existants. L'encodage des anciennes sources affichées avec `�`
reste à diagnostiquer séparément (V02).


## 17 octobre 2026 — fiches personnage et nouvelles histoires

Six tests supplémentaires, sans Ollama : création HTTP avec accents, restitution
de la fiche et de l'exemple ; versions originales inchangées ; sélection du seul
exemple courant dans le prompt ; persona existant et relations/scènes séparées ;
validation des entrées et existence ; rollback d'une modification de fiche ou de
la création d'histoire après erreur. Total : 38 tests réussis.

Les réponses idéales sont maintenant fournies au modèle comme exemples de style
explicitement fictifs. Les modifications du socle s'appliquent aux prochaines
réponses sans réécrire les messages déjà enregistrés. Aucun changement de schéma.

Parcours Chromium sur base temporaire : création d’Élise avec exemple de dialogue,
modification en version 2, départ d'histoire bloqué avant enregistrement des
modifications, création d'un nouveau persona, relation et scène, ouverture du chat,
envoi et réponse simulée, rechargement et persistance de la fiche. Vue mobile sans
débordement et aucune erreur JavaScript observée. La fidélité de la personnalité
avec le vrai Ollama reste une vérification locale à effectuer.


## 17 octobre 2026 — navigation centrée sur les personnages

Un test HTTP supplémentaire vérifie que chaque échange est associé au personnage
chargé dans le contexte, avec plusieurs histoires pour un même personnage et un
second personnage distinct. Total : 39 tests.

Parcours Chromium sur base temporaire : sélection d'un personnage, choix entre
ses deux histoires, absence des histoires d'un autre personnage, streaming simulé,
souvenirs et retour aux échanges, fiche d'un personnage sans histoire, renommage
répercuté dans la navigation, affichage mobile sans débordement. Au changement de
personnage, les anciens messages/souvenirs sont masqués immédiatement ; les réponses
de chargement annulées ne peuvent pas repeupler le nouvel espace. Aucune erreur
JavaScript observée. Le slogan et le pictogramme de marque ont été retirés.
Aucune migration ni suppression ou réécriture des données existantes.


## 17 octobre 2026 — fiche étendue, galerie et réactivité

Quatre nouveaux tests : genre et apparence avec exemples multiples versionnés,
limite de trois exemples injectés et validation stricte ; images binaires et avatar
isolé par personnage, faux formats/SVG refusés ; modèle transmis à Ollama simulé et
en-têtes reçus avant le premier texte ; migration v2 → v3 répétable préservant les
données et anciens chemins d'avatar. La migration directe v1 → v3 est aussi testée.
Total : 43 tests réussis.

Parcours Chromium : canevas de création présent, sélection Homme, deux exemples,
fiche dépassant 1 000 px de large sur une fenêtre de 1 500 px, import de deux PNG,
choix d'avatar visible dans la navigation, rechargement conservant genre, exemples
et images, absence de débordement mobile et d'erreur JavaScript. Base temporaire.
Aucune génération d'image ni mesure de vitesse réelle sur Ollama effectuée.


## 17 octobre 2026 — création guidée et analyse visuelle

Cinq tests supplémentaires : détection de la vision par capacités avec erreurs
partielles ; envoi multi-images et description proposée ; refus des modèles texte,
entrées invalides et réponses vides ; indisponibilité d'Ollama sans invention de
résultat ; composition contextualisée de la personnalité. Modèle et transport
simulés pour les essais vision. Total : 48 tests réussis.

Parcours Chromium sur base temporaire : ajout de dix PNG avant création, sélection
du cinquième comme avatar, analyse simulée des dix vues, apparence initiale inchangée
avant clic d'application, guide de personnalité appliqué explicitement, sauvegarde
et rechargement des dix images et de la fiche. Aucun débordement mobile ni erreur
JavaScript observé. L'analyse réelle et la qualité de la description restent à
vérifier sur les références de l'utilisatrice et son modèle vision. Aucun changement
de schéma depuis v3. L'analyse ne constitue pas une génération d'image.


## 18 octobre 2026 — apparence détaillée et suppression du doublon

Le canevas copiable n'est plus réaffiché en doublon de l'apparence. Le prompt vision
demande sept rubriques d'observations physiques et une description développée si
les vues le permettent. Budget de sortie augmenté à 1 400 tokens, sans compléter
les détails inconnus. Nouveau test : réponse interrompue par la limite du modèle
refusée comme proposition complète. Total : 49 tests réussis ; formatage, types,
compilation et intégrité SQLite réussis. Aucun essai visuel réel supplémentaire
ni réécriture des descriptions enregistrées.

## Évolution et liste de chats — 18 octobre 2026

- Quatre tests supplémentaires : dernier message effectif du bon personnage, correction et absence de message ; bilans successifs et isolation du prompt ; activité et souvenirs validés ; validation HTTP et rollback transactionnel.
- `test:memory` : 53/53 ; `format:check`, `typecheck`, `web:build` et `db:check` réussis. Schéma inchangé v3, intégrité ok, zéro erreur de clé étrangère.
- Chromium sur base temporaire : aperçu du dernier message, ouverture du suivi, création de deux bilans, affichage de l’historique ; largeur mobile 390 px sans débordement et aucune erreur JavaScript. Aucun appel Ollama dans ce parcours.

Vérification locale : ouvrir Tous les personnages → Évolution, sélectionner une histoire, puis Décrire son évolution. Enregistrer deux bilans et consulter les versions précédentes. Changer d’histoire : son état reste séparé. Les souvenirs acceptés ou corrigés apparaissent après actualisation ; les propositions en attente sont exclues. La fiche de départ reste conservée.

## Historique de fiche et apparence automatique — 18 octobre 2026

- 54 tests passent. Le nouveau test HTTP consulte une ancienne fiche avec son ancien nom et ses exemples, la restaure en version 3 et vérifie la conservation de la version 2, ainsi que les erreurs 400/404/405.
- Formatage, TypeScript, compilation web et intégrité SQLite réussis, sans migration.
- Vérification manuelle locale : enregistrer la fiche et lire la confirmation près du bouton ; analyser une référence, relire Apparence physique puis enregistrer. Ouvrir Versions conservées → Consulter → Restaurer dans le formulaire → Enregistrer. La restauration ne concerne pas la galerie, l’avatar ou les bilans d’évolution.
- Chromium : confirmation visible, analyse simulée remplissant automatiquement le champ, consultation de la version 1 puis restauration enregistrée en version 3 ; aucune erreur JavaScript. Le vrai modèle Ollama reste à tester localement.

## Avatar, archivage et personas — 18 octobre 2026

- 57 tests automatisés réussis. Cadrage : valeurs invalides refusées, réglages conservés et octets de l’image inchangés. Archivage : nom exact requis, disparition des listes actives puis restauration, versions et conversations intactes. Personas : création/édition, défaut unique, description dans le prompt, validation et erreurs sans altération.
- Migration v1/v2 → v4 répétable, données existantes conservées et cadrage centré par défaut. `db:init`, `format:check`, `typecheck`, `web:build` et `db:check` réussis : schéma 4, intégrité ok, zéro erreur de clé étrangère.
- Chromium sur base temporaire : création d’un persona par défaut puis présélection au début d’une histoire ; avatar cadré, enregistré et retrouvé dans la liste ; confirmation de suppression inactive avant saisie du nom ; archivage puis restauration. Écran mobile 390 px sans débordement et aucune erreur JavaScript. Aucun appel Ollama nécessaire.

Parcours local : arrêter les serveurs, récupérer main et lancer `npm run db:init`. Dans la fiche choisir une image comme avatar, régler le cadrage puis enregistrer. Créer sa fiche dans Mes personas et la choisir lors d’une nouvelle histoire. Depuis Tous les personnages, Supprimer demande le nom exact ; Voir les personnages archivés permet de restaurer. L’édition d’un persona modifie ses prochaines réponses dans toutes les histoires qui l’utilisent ; les anciens messages restent inchangés.

## Menu repliable — 19 octobre 2026

- `format:check`, `typecheck` et `web:build` réussis ; changement limité à l’interface, sans écriture SQLite.
- Chromium : nouvelles entrées Personnages/Personas, pied Local & personnel absent ; masquer puis afficher le menu, largeur du contenu augmentée, préférence conservée au rechargement, navigation Personas intacte et écran mobile 390 px sans débordement. Aucune erreur JavaScript.
- Le bouton reste accessible dans l’en-tête lorsque le menu est masqué ; il expose son état via `aria-expanded`. Si le stockage local est bloqué, le bouton reste fonctionnel pendant la session.
