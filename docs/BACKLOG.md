# Backlog — Ollama SimChat

Mis à jour le 16 octobre 2026 à partir du dépôt et des résultats partagés dans le chat.

**Statuts :** livré = implémenté ; à vérifier = validation complémentaire ;
proposé = idée non encore engagée. Les priorités proposées restent à arbitrer.

## Livré

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

## À vérifier

| ID | Priorité proposée | Tâche | Critère de réussite |
| --- | --- | --- | --- |
| V01 | Haute | Isoler l'effet de la mémoire hors des messages récents | Sur une base de test séparée, la préférence n'est plus dans les messages récents, mais reste sélectionnée et utilisable |
| V02 | Haute | Diagnostiquer les caractères `�` dans les sources | Distinguer saisie, encodage HTTP, stockage et affichage ; nouvel échange accentué intact, sans réécrire les anciens messages |
| V03 | Moyenne | Tester correction et refus manuellement sur Windows | Propositions de test dédiées : historique avant/après correct et souvenir refusé exclu du prompt |
| V04 | Moyenne | Vérifier le style réel des réponses | Réponse naturelle respectant les consignes de longueur et d'actions ; l'essai actuel contient plusieurs actions |

## Proposé — pas encore implémenté

| ID | Priorité proposée | Tâche | Critère à préciser avant développement |
| --- | --- | --- | --- |
| P01 | Haute | Interface de revue des souvenirs | Consulter les sources et accepter/corriger/refuser sans commandes curl |
| P02 | Moyenne | Création et édition des personnages, personas et histoires | Remplacer les données de démonstration via une interface adaptée |
| P03 | Moyenne | Déduplication des reformulations | Détecter les propositions équivalentes sans fusionner des faits distincts |
| P04 | Moyenne | Sauvegarde et restauration de la base | Procédure documentée et restauration testée sur une copie |
| P05 | À définir | Statistiques de rappel | Définir quand comptabiliser une utilisation avant d'écrire `recall_count`/`last_recalled_at` |
| P06 | À définir | Embeddings et recherche hybride | Comparer la qualité à FTS + fallback sur des scénarios reproductibles |
| P07 | À définir | Synthèses et contradictions | Propositions révisables et historique conservé |
| P08 | À définir | Évolution du personnage | Respect du socle permanent et validation des changements |
| P09 | À définir | Souvenirs persona transversaux | Réévaluer explicitement les règles d'isolation avant tout assouplissement |

## Prochaine étape suggérée

V01 et V02 permettent de consolider le socle avant d'élargir les fonctionnalités.
Ce sont des propositions de travail, pas des changements autorisés par ce document.
