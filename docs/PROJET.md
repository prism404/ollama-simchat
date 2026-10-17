# Fiche projet — Ollama SimChat

État de référence : 17 octobre 2026. Projet personnel de prism404.

## Objectif

Créer une application privée de conversation avec des personnages IA personnalisés,
exécutée localement avec Ollama. Le personnage doit conserver une identité stable,
suivre une histoire et une relation, et utiliser des souvenirs durables dont
l'utilisatrice contrôle la validation.

Le socle mémoire est accompagné d’une première interface web locale pour le chat
et la revue. La priorité reste la fiabilité ; embeddings et synthèses avancées
viendront ensuite.

## Socle technique

| Composant | Choix actuel |
| --- | --- |
| Exécution | Node.js ≥ 24, TypeScript exécuté directement |
| API | Serveur HTTP Node.js, réponses en streaming |
| Stockage | SQLite intégré à Node.js, schéma version 2 |
| Recherche | FTS5 local : titre, contenu et mots-clés |
| Interface | React, Vite, TypeScript ; navigateur local |
| Génération | Ollama ; modèle testé localement : `mistral-small3.2:24b` |
| Contrôles | Tests Node.js, TypeScript, Prettier, intégrité SQLite |
| Développement | VS Code sur Windows et environnement Codex séparé |
| Livraison | Commits et push directement sur `main`, selon le choix de l'utilisatrice |

## Fonctionnement livré

1. Charger le personnage, le persona, l'histoire, la relation, la scène et les messages récents.
2. Récupérer localement les souvenirs validés pertinents et construire le prompt.
3. Générer une réponse avec Ollama en streaming et enregistrer les messages.
4. Sur demande explicite, extraire des propositions de souvenirs avec leurs messages sources.
5. Accepter, corriger ou refuser chaque proposition ; conserver un historique des décisions.

L'extraction n'est pas automatique après chaque message. Le script
`memory:propose` reste en preview ; l'endpoint de proposition enregistre les résultats.

### Mémoire : garanties actuelles

- API `pending` → SQLite `proposed` ; API `accepted` → SQLite `approved`.
- Seuls `approved` ou `corrected`, avec cycle `active`, sont récupérables.
- Les corrections conservent le titre et le contenu avant/après dans les reviews.
- Souvenirs, sources et décisions sont écrits dans des transactions.
- Une empreinte immuable évite les doublons identiques, même après une décision.
- Le filtre des dates exige des éléments temporels explicites dans les sources référencées.
- FTS utilise des termes nettoyés reliés par `OR` ; fallback de deux souvenirs
  relation/persona d'importance ≥ 3.
- Maximum par défaut : huit souvenirs et 3 000 caractères pour la section mémoire.
- Chaque rattachement non nul doit correspondre au contexte courant, en plus du scope.
- La récupération est en lecture seule : aucune mise à jour des statistiques de rappel.

## Périmètre restant

Les tables préparent déjà plusieurs usages futurs, mais leur présence ne signifie
pas que les workflows correspondants sont implémentés : embeddings, synthèses,
contradictions et évolution du personnage restent à définir ou à développer.
L’interface permet désormais de créer et modifier les personnages, puis de
commencer une histoire avec un persona existant ou nouveau. L’édition d’une
histoire déjà commencée reste hors de ce premier parcours. Voir le [backlog](BACKLOG.md).

## Règles de travail

- Inspecter le code avant une évolution ; présenter le plan quand demandé.
- Conserver les données ; utiliser des migrations non destructives si nécessaire.
- Tester sur des bases temporaires ; distinguer simulations et essais avec Ollama.
- Ne pas confondre le système de fichiers Codex avec la base locale de l'utilisatrice.
- Récupérer les commits avec `git pull origin main` dans VS Code.
- Publier un environnement Codex ne déploie pas l'application et ne remplace pas un push Git.

## Documents de suivi

- [Backlog et tâches](BACKLOG.md) : livré, à vérifier, proposé.
- [Journal des validations](TESTS.md) : preuves, commandes et limites.

À chaque évolution : mettre à jour le backlog et ajouter une validation au journal,
avec son contexte d'exécution. Les dates exactes inconnues ne doivent pas être inventées.
