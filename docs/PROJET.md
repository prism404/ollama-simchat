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
| Stockage | SQLite intégré à Node.js, schéma version 3 |
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
contradictions et propositions automatiques d’évolution restent à définir ou à développer.
L’interface permet désormais de créer et modifier les personnages, puis de
commencer une histoire avec un persona existant ou nouveau. L’histoire déjà commencée peut être consultée et corrigée, avec versions du point de départ et du suivi actuel conservées. Voir le [backlog](BACKLOG.md).

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

## Suivi du personnage

La liste des personnages affiche leur avatar et leur dernier message, avec accès direct à cet échange. Le suivi Évolution est séparé par histoire : activité, souvenirs validés compatibles et historique des bilans. Les bilans de l’état présent (humeur, objectifs, relation, leçons) sont rédigés et validés manuellement ; le dernier est utilisé dans le contexte de cette histoire. La fiche permanente et les anciennes versions sont conservées. Le temps réel ne provoque ni vieillissement automatique ni transformation inventée. Aucun appel IA supplémentaire par message.

## Avatars et persona incarné

La galerie permet de choisir et cadrer l’avatar (position et zoom) avec aperçu, sans modifier l’image d’origine. Le cadrage est indépendant des versions de la fiche. Le schéma v4 ajoute uniquement ce réglage et conserve les anciennes données.

Mes personas regroupe les fiches des personnages incarnés par la joueuse. Un persona contient un nom, des pronoms facultatifs et une description libre ; il peut être choisi par défaut pour les nouvelles histoires. Modifier un persona met à jour les prochains contextes des histoires qui le référencent, sans réécrire les messages. Le modèle respecte les décisions de la joueuse.

La suppression d’un personnage est un archivage : confirmation par son nom exact, retrait des listes actives, restauration possible. Aucune fiche, image, histoire ou mémoire n’est supprimée physiquement.

## Fiche détaillée du persona

La fiche incarnée dispose de six sections guidées : présentation, passé et présent, personnalité et vie intérieure, relations et limites, voix et détails vivants, informations connues ou privées. Un guide local aide à construire une personnalité contextualisée. Les champs restent facultatifs, seul le nom est requis ; les indications de rédaction ne sont pas enregistrées comme des faits.

La description existante reste conservée dans Présentation générale. Le profil est enregistré dans les préférences SQLite existantes et accompagne le contexte du persona choisi pour l’histoire. Le prompt demande au personnage d’adapter son comportement sans écrire les actes ou pensées du persona ni considérer automatiquement ses informations privées comme connues. Il s’agit d’instructions au modèle, pas d’un mécanisme d’autorisation ou d’une garantie de fidélité de ses réponses. La fiche détaillée est limitée à 16 000 caractères, en plus de la présentation, pour contenir la taille du contexte.

## Images et avatar du persona

Chaque persona peut conserver jusqu’à 20 images PNG/JPEG/WebP de 5 Mo maximum chacune et choisir l’une d’elles comme avatar, avec position et zoom. La même galerie que pour les personnages est réutilisée ; l’avatar apparaît dans la sélection du persona et sur ses messages. Les médias sont séparés par type de fiche et propriétaire.

La migration v5 ajoute persona_images ainsi que les colonnes d’avatar des personas ; elle conserve les textes, préférences, histoires et images existantes. Une analyse explicite peut proposer l’apparence à partir de dix références au maximum. Le chat reçoit le texte enregistré, sans les images.

## Histoires longues et continuité

Une histoire peut porter un long échange sans être remplacée par de nouvelles histoires techniques. Le chat ouvre les 50 derniers messages et propose de charger les pages antérieures. Les sources restent en SQLite ; le curseur de pagination est la séquence du message, et non un décalage instable. Les messages chargés restent visibles après une réponse en streaming.

L’accès Histoire est disponible depuis la fiche du personnage et depuis la conversation. Il sépare le point de départ (titre, relation initiale, passé commun, lieu et scène d’ouverture) du suivi actuel (lieu, situation, atmosphère, récapitulatif manuel). Chaque section conserve ses versions ; une restauration passe par un brouillon et un nouvel enregistrement. Une version concurrente produit une erreur explicite plutôt qu’une réécriture silencieuse.

Le modèle reçoit les 12 messages récents, les souvenirs validés sélectionnés, le contexte et le récapitulatif enregistré de cette histoire. La scène initiale ne doit pas être rejouée quand le dialogue a progressé. Le récapitulatif doit être maintenu par l’utilisatrice aux moments importants ; aucune synthèse automatique n’est ajoutée. Le récit ne garantit pas un rappel parfait de tous les anciens détails.

La migration v6 conserve le contexte préexistant dans story_setup_versions. Le suivi réutilise scene_state_versions ; aucun message, souvenir ou document de personnage n’est supprimé.
