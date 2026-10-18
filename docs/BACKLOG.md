# Backlog — Ollama SimChat

Mis à jour le 18 octobre 2026 à partir du dépôt et des résultats partagés dans le chat.

**Statuts :** livré = implémenté ; à vérifier = validation complémentaire ;
proposé = idée non encore engagée. Les priorités proposées restent à arbitrer.

## Livré

- F27 : confirmation d’enregistrement près du bouton, analyse visuelle appliquée directement au brouillon, consultation des anciennes fiches et restauration par nouvel enregistrement ; avatar et galerie restent séparés.

- F26 : liste de chats avec avatar agrandi et dernier message effectif ; évolution par histoire, activité, souvenirs validés et bilans manuels versionnés. Dernier bilan validé utilisé dans le contexte, sans modifier le socle initial.

| ID | Tâche | Preuve / référence |
| --- | --- | --- |
| F01 | Serveur TypeScript et API de conversation en streaming | Socle `702a5da` ; réponse réelle observée avec Ollama |
| F02 | Base SQLite, initialisation et inspection | Schéma v2, intégrité correcte et zéro erreur de clé étrangère |
| F03 | Extraction de souvenirs en preview | Script `memory:propose`, exécuté avec Mistral 24B |
| F04 | Empêcher les dates d'événement sans preuve dans les sources | `aea5af9` ; six tests automatisés dédiés |
| F05 | Enregistrer les propositions et leurs messages sources | `cd99f52` ; endpoint testé avec Ollama sur Windows |
| F06 | Lister les souvenirs avec filtre de statut | `cd99f52` ; consultation du souvenir accepté 1 confirmée |
| F07 | Accepter, corriger, refuser et historiser les décisions | `cd99f52` ; automatisé pour les trois décisions, acceptation réelle confirmée |
| F08 | Déduplication exacte, y compris après validation | `cd99f52` ; réextraction réelle : zéro création, un doublon |
| F09 | Migration non destructive v1 → v2 | `cd99f52` ; tests de conservation et migration locale réussie |
| F10 | Recherche FTS `OR`, fallback importance ≥ 3, classement et limites | `e4a39ba` ; tests et aperçu local du souvenir 1 |
| F11 | Isolation stricte et exclusion des souvenirs non validés/inactifs | `e4a39ba` ; tests par scope et rattachement |
| F12 | Injecter les souvenirs sélectionnés dans le prompt de conversation | `e4a39ba` ; aperçu local et test HTTP avec transport simulé |
| F13 | Afficher les identifiants dans `chat:prompt`, sans Ollama | `e4a39ba` ; sortie locale `[1]` confirmée |
| F14 | Compatibilité du formatage Windows/Linux | `e306d49` ; `format:check` confirmé sur Windows après correction |
| F15 | Fiche projet, backlog et journal de tests | Documents du dossier `docs/` |
| F16 | Web app React/Vite locale : chat, historique, souvenirs, connexion | Compilation, tests API et parcours Chromium avec génération simulée |
| F17 | Création/édition manuelle de personnage et départ d’une histoire depuis la web app | Fiches versionnées, exemples de style, persona existant ou nouveau, histoire/relations/scène transactionnelles ; P02 livré pour ce périmètre |
| F18 | Navigation par personnage, histoires regroupées et habillage allégé | Suppression du slogan et du pictogramme ; historique chargé uniquement pour le personnage sélectionné |
| F19 | Fiche pleine largeur, choix homme/femme, modèle de description et exemples multiples | Données versionnées ; compatibilité avec les fiches existantes |
| F20 | Avatar et galerie de références locales | Migration v3 non destructive ; import et avatar vérifiés dans Chromium |
| F21 | Choix du modèle de dialogue et retour de streaming plus précoce | Modèles installés ; délai affiché ; effet réel sur la vitesse à mesurer sur Windows |
| F22 | Images préparées dans la fiche avant création et choix d’avatar à l’enregistrement | Dix références vérifiées dans Chromium ; reprise des ajouts après erreur partielle |
| F23 | Description physique proposée depuis les références | Détection des capacités vision, analyse explicite et application manuelle ; vrai Ollama à vérifier localement |
| F24 | Guide de personnalité contextualisé | Quatre dimensions, proposition éditable et application explicite, sans appel IA |
| F25 | Apparence détaillée en rubriques et suppression de l’affichage en doublon | Nouveau prompt vision ; descriptions actuelles conservées, qualité à vérifier sur les images réelles |

## À vérifier

| ID | Priorité proposée | Tâche | Critère de réussite |
| --- | --- | --- | --- |
| V01 | Haute | Isoler l'effet de la mémoire hors des messages récents | Deux tests automatisés réussis le 17 octobre : rappel hors fenêtre et correction ; essai réel Ollama hors fenêtre encore à faire |
| V02 | Haute | Diagnostiquer les caractères `�` dans les sources | Distinguer saisie, encodage HTTP, stockage et affichage ; nouvel échange accentué intact, sans réécrire les anciens messages |
| V03 | Moyenne | Tester correction et refus manuellement sur Windows | Propositions de test dédiées : historique avant/après correct et souvenir refusé exclu du prompt |
| V04 | Moyenne | Vérifier le style réel des réponses | Réponse naturelle respectant les consignes de longueur et d'actions ; l'essai actuel contient plusieurs actions |

## Proposé — pas encore implémenté

| ID | Priorité proposée | Tâche | Critère à préciser avant développement |
| --- | --- | --- | --- |
| P03 | Moyenne | Déduplication des reformulations | Détecter les propositions équivalentes sans fusionner des faits distincts |
| P04 | Moyenne | Sauvegarde et restauration de la base | Procédure documentée et restauration testée sur une copie |
| P05 | À définir | Statistiques de rappel | Définir quand comptabiliser une utilisation avant d'écrire `recall_count`/`last_recalled_at` |
| P10 | À définir | Génération d’images fidèle au personnage | Choisir le moteur, ses références d’identité et le passage conversation → scène visuelle ; aucune intégration IA image actuellement |
| P06 | À définir | Embeddings et recherche hybride | Comparer la qualité à FTS + fallback sur des scénarios reproductibles |
| P07 | À définir | Synthèses et contradictions | Propositions révisables et historique conservé |
| P08 | À définir | Propositions automatiques d’évolution | V1 manuelle livrée ; définir les preuves, contradictions et validation avant toute synthèse IA |
| P09 | À définir | Souvenirs persona transversaux | Réévaluer explicitement les règles d'isolation avant tout assouplissement |

## Prochaine étape suggérée

V01 et V02 permettent de consolider le socle avant d'élargir les fonctionnalités.
Ce sont des propositions de travail, pas des changements autorisés par ce document.
