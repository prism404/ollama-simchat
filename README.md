# Local Character Chat — memory core

## Suivi du projet

- [Fiche projet](docs/PROJET.md)
- [Backlog et tâches](docs/BACKLOG.md)
- [Journal des tests et validations](docs/TESTS.md)

This repository currently contains the first database foundation for a private,
local character chat application. It uses Node.js 24 and SQLite with no external
runtime dependencies.

## What is already modelled

- several personas, characters and independent stories;
- versioned permanent character profiles;
- dynamic character and relationship state per story;
- immutable messages and versioned scene state;
- events, promises, plans and hidden character intentions;
- proposed/approved/corrected/rejected memories with message sources;
- local embedding storage and French/English full-text search;
- append-only conversation, weekly and consolidated summaries;
- contradiction reports and weekly update audit runs.

The database is designed so that AI-generated proposals never become trusted
facts before review. Old summaries remain available after a new version is
created.

The permanent core and dynamic state are deliberately separate:

- `character_core_versions` contains identity, values, deep traits, voice and
  boundaries. A proposed change only becomes active after approval.
- `character_state_versions` contains mood, current goals, beliefs, relationship
  state, learned lessons and behavioural adjustments for one story.
- the `current_character_core` and `current_character_state` views expose the
  latest approved versions without deleting any prior version.

## Requirements on Windows

Install Node.js 24 or newer, then open PowerShell in this project folder.

## Initialize and inspect the database

```powershell
npm run db:init
npm run db:check
npm run db:inspect
```

The database file is created at `data/character-chat.db`.

To add disposable example data:

```powershell
npm run db:seed-demo
npm run db:inspect
```

Do not run the demo seed repeatedly; it intentionally creates a new example on
each execution.

## Open it visually

The easiest option is **DB Browser for SQLite**:

1. Install DB Browser for SQLite from its official website.
2. Choose **Open Database**.
3. Select `data/character-chat.db`.
4. Use **Database Structure** to inspect tables.
5. Use **Browse Data** to inspect rows.
6. Use **Execute SQL** for queries.

Useful queries:

```sql
-- Memories waiting for your decision
SELECT id, title, content, importance, confidence
FROM memory_items
WHERE review_status = 'proposed'
ORDER BY importance DESC, created_at DESC;

-- Current unresolved contradictions
SELECT id, category, severity, description, suggested_resolution
FROM contradiction_reports
WHERE status = 'open'
ORDER BY severity DESC, detected_at DESC;

-- Latest summary versions without deleting history
SELECT story_id, summary_type, version_number, review_status, content, created_at
FROM summary_versions
ORDER BY story_id, summary_type, version_number DESC;

-- The permanent profile currently allowed into the prompt
SELECT * FROM current_character_core;

-- Dynamic state currently allowed into the prompt
SELECT * FROM current_character_state;

-- Events and promises that still need continuity
SELECT title, thread_type, status, visibility, due_story_datetime
FROM story_threads
WHERE status IN ('open', 'announced', 'in_progress')
ORDER BY importance DESC, created_at;
```

## Planned application layers

1. Local API in TypeScript to read/write the database.
2. Ollama chat adapter using `http://localhost:11434`.
3. Memory extraction that creates reviewable proposals.
4. Hybrid retrieval: SQLite FTS plus BGE-M3 embeddings.
5. Weekly append-only synthesis and contradiction detection.
6. React web interface for character creation, chat and memory review.

For the first model benchmark, start with `qwen3.5:9b` and compare it with
`gemma4:e4b` using the same French/mixed-language scenes. BGE-M3 is reserved for
embeddings; it is not the dialogue model.

## Memory review workflow

Run `npm run db:init` once after pulling these changes, before starting the API.
It applies the version 2 migration in a transaction and preserves existing data.
Running it again is safe. Do not delete or recreate your database.

Start the API with `npm start`. Ollama must be running with the configured
`OLLAMA_MODEL` for extraction. The existing `npm run memory:propose -- 1` command
remains a read-only preview.

The API uses these statuses (with their existing SQLite equivalents): `pending`
(`proposed`), `accepted` (`approved`), `corrected`, `rejected`, `superseded`.

```sh
# Extract and persist proposals with their source messages.
curl -X POST http://127.0.0.1:3000/api/conversations/1/memories/propose

# List pending proposals, including scores, source excerpts and review history.
curl 'http://127.0.0.1:3000/api/conversations/1/memories?status=pending'

# Omit the filter to include reviewed proposals and their history.
curl http://127.0.0.1:3000/api/conversations/1/memories

# Replace 42 with a returned memory ID; review each pending proposal only once.
curl -X POST http://127.0.0.1:3000/api/memories/42/review \
  -H 'Content-Type: application/json' -d '{"decision":"accept"}'

curl -X POST http://127.0.0.1:3000/api/memories/43/review \
  -H 'Content-Type: application/json' \
  -d '{"decision":"reject","reason":"Souvenir non pertinent"}'

curl -X POST http://127.0.0.1:3000/api/memories/44/review \
  -H 'Content-Type: application/json' \
  -d '{"decision":"correct","title":"Préférence pour les lieux calmes","content":"Le persona déteste les lieux très bruyants et souhaite privilégier les lieux calmes.","reason":"Reformulation plus fidèle"}'
```

A correction validates the corrected text. Each decision records the original
and resulting title/content, reason and timestamp in `memory_reviews`, in the
same transaction as the memory update. Reviewed proposals return HTTP 409 if
reviewed again. Invalid input returns 400, missing resources 404, and extraction
failures 502 without persisting partial proposals.

Extraction returns `memories` (new rows), `existing` (identical proposals already
stored), `createdCount`, `duplicateCount`, `model` and `totalDurationMs`. It returns
201 when rows were created, otherwise 200. Identity includes the conversation,
character/persona/relationship, type, scope, title, content, event date and sorted
source IDs; changing confidence, importance, emotional weight or keywords alone
does not create another identical proposal. The immutable fingerprint survives
correction and rejection. This is exact deduplication, not semantic similarity.

Only active accepted/corrected memories are eligible for context use.
The conversation endpoint retrieves relevant memories locally as described below;
embeddings are not implemented.
Historical rows remain unchanged; those with message sources can be listed via
their source conversations. Historical reviews have null titles when these were
not originally recorded.

Run `npm run test:memory` for automated date and workflow checks. Workflow tests
use a disposable database and simulated extraction, exercising the actual HTTP
routes without requiring Ollama or modifying your database. Manual extraction
with the first request above verifies your real Ollama connection.


## Relevant memory retrieval v1

`POST /api/conversations/:conversationId/messages` now includes a bounded
`SOUVENIRS VALIDÉS PERTINENTS` section in the system prompt. Only SQLite statuses
`approved`/`corrected` with lifecycle `active` are eligible. Corrected memories
use the corrected title/content. No review metadata, raw sources or technical
scores are sent to the model. The stateless `/api/chat` endpoints are unchanged.

Isolation is strict: the scope's required ID must match the current character,
story, relationship or persona, and **every additional non-null attachment must
also match**. A missing current relationship cannot match relationship memories.
This v1 prioritizes avoiding leaks between stories and characters; persona
memories tied to a different story are excluded even for the same persona.
Truly unattached global/persona memories still require their principal scope ID.
Broader cross-story persona memory sharing can be reconsidered later.

SQLite FTS5 searches title/content/keywords using safely quoted Unicode terms
combined with **OR**. Common French/English words are removed; at most 24 distinct
terms are used. The existing Unicode tokenizer handles accent-insensitive
matching. Lexical matches are ordered by BM25 (title weight 3, content 1,
keywords 2), then importance descending, absolute emotional weight descending,
and ID ascending. Up to two active validated relationship/persona memories with
importance **at least 3** provide a fallback, including when the query is empty,
contains only stopwords, or matches nothing. Fallback ordering uses importance,
absolute emotional weight and ID. Both paths apply identical isolation filters.

Lexical results precede fallback additions; IDs are deduplicated. The defaults in
`src/memory/memory-retrieval.ts` limit selection to eight memories and 3,000
characters for the entire formatted memory section (including instructions and
JSON escaping). Oversized entries are skipped rather than truncated. Options can
adjust limits for development/tests. No section is emitted for an empty selection.
No second model is called. Retrieval uses a read-only SQLite connection and does
not update `recall_count` or `last_recalled_at`. No schema migration is needed.

Inspect selection without Ollama:

```sh
npm run chat:prompt -- 1
npm run chat:prompt -- 1 "Où souhaiterais-tu passer la soirée ?"
```

The command prints selected memory IDs and useful memory fields **before** the
final model messages. The conversation must exist in the selected local database;
`CHARACTER_CHAT_DB` can point to a separate database for disposable checks.
`npm run test:memory` covers the retrieval rules and outbound streaming prompt
with temporary databases and simulated model transport, without Ollama.

## Web app locale — première version

L'interface React permet de sélectionner une conversation existante, relire
l'historique, discuter en streaming et gérer les souvenirs (sources, acceptation,
correction, refus et historique). Elle affiche aussi l'état d'Ollama. Les nouvelles
saisies passent en JSON UTF-8 ; les anciens messages ne sont jamais réécrits.

Après `git pull origin main`, arrêter l'ancienne API puis lancer :

```sh
npm install
npm run db:init
npm start
```

Dans **un second terminal**, depuis le même dossier :

```sh
npm run web
```

Ouvrir `http://127.0.0.1:5173` dans le navigateur local. Garder les deux terminaux
ouverts et démarrer Ollama avec le modèle configuré pour les générations.
L'interface transmet `/api` à l'API locale sur le port 3000. Si l'API utilise un
autre port, définir `SIMCHAT_API_URL` avant `npm run web`. Le serveur web reste
lié à l'ordinateur local et n'est pas un déploiement public.

Aucune donnée de démonstration n'est créée automatiquement. Les conversations existantes restent accessibles ; l’onglet Personnages permet
désormais de créer une fiche et une nouvelle histoire avec sa conversation.
Une conversation non active reste consultable mais l'envoi est désactivé.

L'extraction mémoire peut prendre plusieurs minutes ; attendre le résultat sans
relancer la même action. Accepter/corriger/refuser modifie la vraie base, comme les
commandes curl. La correction vaut validation du nouveau texte. Les sources et
les décisions antérieures restent consultables.

Contrôles : `npm run typecheck` vérifie aussi l'interface ; `npm run web:build`
construit les fichiers dans `dist/web`. `npm run web:preview` permet de tester
cette compilation localement, avec l'API toujours démarrée séparément.

Pour un essai manuel : envoyer un message accentué, attendre la réponse en streaming,
ouvrir Souvenirs, chercher des propositions, consulter une source puis valider
une proposition. Recharger la page pour vérifier la persistance. Utiliser une base
séparée pour les scénarios expérimentaux.

## Créer un personnage et commencer une histoire

Dans l'onglet **Personnages**, choisir **Créer un personnage**. Seul le nom est
obligatoire : pronoms, description, traits, valeurs, motivations, ton, humour,
longueur des réponses et limites peuvent être précisés progressivement.
L'exemple de dialogue est facultatif ; si utilisé, remplir ses trois champs.
Le sarcasme léger est proposé comme valeur initiale, modifiable librement.

**Enregistrer la fiche** valide une version rédigée manuellement. Une modification
ajoute une nouvelle ligne dans `character_core_versions` sans réécrire l'ancienne.
Les champs avancés non exposés par ce formulaire sont conservés. La version
courante s'applique aux futures réponses de ce personnage dans toutes ses histoires ;
les anciens messages ne sont pas réécrits. Les anciens exemples restent stockés,
mais seuls ceux de la version courante sont chargés (compatibilité avec les
exemples sans version de la fiche initiale).

Après enregistrement, **Commencer une histoire** propose un persona existant ou
la création d'un persona par son nom. Renseigner le titre, la relation de départ,
le contexte partagé, le lieu et la première scène. L'histoire, ses participants,
sa relation, sa scène et sa conversation sont créés dans une seule transaction.
L'interface ouvre ensuite le chat. Chaque nouvelle histoire reste indépendante.
La création des fiches et histoires ne nécessite pas Ollama ; les réponses du chat,
si. Aucun seed ni migration supplémentaire n'est nécessaire.

Routes ajoutées : `GET/POST /api/characters`, `GET/POST /api/characters/:id`,
`GET /api/personas`, `POST /api/characters/:id/stories`. Les entrées invalides
renvoient 400 et les ressources absentes 404. L'enregistrement d'une modification
via POST crée une version ; il ne remplace jamais silencieusement la précédente.

Essai manuel conseillé : créer un personnage accentué, renseigner un exemple,
enregistrer, modifier un trait et vérifier les deux versions. Créer ensuite une
histoire avec un nouveau persona, envoyer un message et recharger la page.
`npm run test:memory` couvre aussi les transactions et le prompt de ce parcours.

### Navigation par personnage

L'accueil présente les personnages ; la barre latérale donne directement accès à
chacun. Cliquer sur un personnage ouvre ses échanges. S'il a plusieurs histoires,
un choix **Histoire** apparaît dans son espace, limité à ses propres histoires.
Les souvenirs et la fiche se consultent depuis ce même espace. Un personnage sans
histoire ouvre sa fiche pour en commencer une. Il n'y a plus de rubrique Conversation
ni de sélecteur global mélangeant les personnages. Les histoires existantes sont
associées au même personnage principal que celui utilisé pour construire leur prompt.
Aucune conversation n'est supprimée et aucun rattachement n'est réécrit.

## Fiche étendue, références visuelles et réactivité

Après cette mise à jour, arrêter l'API puis exécuter `npm run db:init` : la migration
v2 → v3 ajoute `character_images` sans modifier les anciennes lignes. Les images
sont conservées comme données binaires dans la même base SQLite. Sauvegarder cette
base sauvegarde aussi la galerie. Les anciennes valeurs `avatar_path` restent intactes.

- La fiche utilise toute la largeur disponible et propose Homme/Femme. Le choix
  renseigne automatiquement les pronoms ; les anciennes versions restent conservées.
- Le champ de description des **nouveaux** personnages contient un canevas à compléter :
  quotidien, expériences formatrices, qualités, défauts, motivations, émotions,
  relations et habitudes. Les anciennes descriptions ne sont jamais remplacées.
  Les crochets signalent un fait non renseigné ; le prompt interdit de l'inventer.
- Jusqu'à 12 exemples sont conservés par version. Les trois premiers sont fournis
  au chat pour limiter le contexte. Retirer un exemple de la fiche courante n'efface
  pas les versions précédentes. L'ancien format à un seul exemple reste accepté.
- Après enregistrement de la fiche, ajouter jusqu'à 20 images PNG/JPEG/WebP, de
  5 Mo maximum chacune, puis choisir l'avatar. Les SVG ne sont pas acceptés.
  Les fichiers sont servis par identifiant, sans chemin de disque fourni par le client.
- Le champ **Apparence physique** est versionné et disponible dans le contexte du chat.

### Préparer une identité visuelle cohérente

Conserver un portrait de face, un trois-quarts et éventuellement une vue de profil
du même personnage, avec des traits cohérents. Décrire les caractéristiques stables
(visage, yeux, cheveux, silhouette, signes distinctifs) séparément de la tenue et
de l'éclairage propres à une scène. La galerie permet de copier une description
visuelle pour un générateur externe, sans envoyer automatiquement les images.

Un prompt et une graine identiques ne garantissent pas le même visage. Selon le
moteur choisi, les références d'identité, les modes image-vers-image ou un modèle
personnalisé tel qu'une LoRA peuvent améliorer la cohérence. La génération d'images
n'est pas encore intégrée : choisir le moteur local ou le service et son workflow
sera une étape distincte. Le chat texte n'analyse pas automatiquement la galerie.

### Faire apparaître les réponses plus vite

Le sélecteur **Modèle de dialogue** permet d'essayer les modèles déjà installés
dans Ollama, sans changer le modèle par défaut ni celui de l'extraction mémoire.
Un modèle plus léger peut réduire le délai avec un compromis possible sur la
qualité. Le choix s'applique au prochain message ; il n'installe aucun modèle.

Les en-têtes de streaming sont envoyés dès que le flux Ollama est disponible,
sans attendre le premier fragment de texte. L'attente s'affiche en secondes.
Le modèle reste chargé pendant 30 minutes par défaut au lieu de 10 ; régler
`OLLAMA_KEEP_ALIVE` avant de démarrer l'API si besoin. Cette rétention réduit les
rechargements mais occupe la mémoire pendant cette durée. Elle n'accélère pas le
calcul des tokens. GPU/VRAM, taille du modèle et volume du contexte restent les
principaux facteurs ; aucun gain réel n'a été mesuré sur le PC de l'utilisatrice.
