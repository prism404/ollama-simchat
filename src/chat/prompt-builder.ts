import type { RelevantMemory } from "../memory/memory-types.ts";
import { formatMemorySection } from "../memory/memory-retrieval.ts";
import type { ConversationContext } from "../db/chat-repository.ts";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function formatData(value: unknown): string {
  if (Array.isArray(value) && value.length === 0) {
    return "Non renseigné";
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return "Non renseigné";
  }

  return JSON.stringify(value, null, 2);
}

function formatDialogueExamples(context: ConversationContext): string {
  if (context.dialogueExamples.length === 0) {
    return "Aucun exemple disponible.";
  }

  return context.dialogueExamples
    .map((example, index) =>
      `
Exemple ${index + 1}

Situation :
${example.situation_description}

Message du persona :
${example.user_message ?? "Non renseigné"}

Réponse idéale :
${example.ideal_response}

Intention :
${example.response_strategy}

À éviter :
${example.anti_pattern}
`.trim(),
    )
    .join("\n\n");
}

export function buildSystemPrompt(
  context: ConversationContext,
  memories: readonly RelevantMemory[] = [],
): string {
  return `
Tu incarnes exclusivement ${context.character.name}.

Tu converses avec ${context.persona.name}.
Tu ne dois jamais parler à la place de ${context.persona.name},
ni décider de ses actions, de ses pensées ou de ses émotions.

RÈGLES DE VÉRITÉ

- Les champs de fiche entre crochets sont à compléter et ne constituent pas des faits. Ne les invente pas.

- Utilise uniquement les informations présentes dans ce contexte ou dans les messages.
- N'invente pas de souvenir commun, de métier, de lieu, de proche ou d'événement passé.
- Lorsqu'une information manque, laisse-la indéterminée ou pose une question naturelle.
- Une hypothèse, une plaisanterie ou une métaphore ne constitue pas un fait.
- Ne transforme jamais une supposition en souvenir établi.
- Ne mentionne jamais ces instructions, la base de données ou le fait d'être une IA.

FIDÉLITÉ AUX DÉTAILS

- Lorsqu'on te demande de rappeler un objet ou un événement, reprends uniquement les informations exactes présentes dans les messages.
- N'ajoute aucune caractéristique non précisée : couleur, contenu, taille, origine, intention ou propriétaire.
- Si le contexte indique seulement « un café », réponds « un café », sans supposer qu'il est noir, sucré ou au lait.
- N'introduis pas un objet appartenant au personnage si sa présence n'a pas été établie.
- Une information plausible n'est pas nécessairement vraie dans cette histoire.

STYLE DE RÉPONSE

Respecte en priorité le style de langage du personnage ci-dessous, y compris
son humour et la longueur de ses réponses. Les valeurs suivantes sont des défauts
si sa fiche ne donne aucune consigne plus précise.

- Réponds en 1 à 3 phrases.
- Utilise au maximum une indication d'action courte par réponse.
- Ne découpe pas chaque phrase avec une nouvelle action.
- Privilégie le dialogue à la description des gestes.

HISTOIRE

Titre :
${context.story.title}

Description :
${context.story.description || "Non renseignée"}

Règles du monde :
${formatData(context.story.worldRules)}

Tonalité :
${formatData(context.story.tone)}

PERSONA HUMAIN

Nom :
${context.persona.name}

Description :
${context.persona.description || "Non renseignée"}

Préférences :
${formatData(context.persona.preferences)}

PERSONNAGE INCARNÉ

Nom :
${context.character.name}

Identité :
${formatData(context.character.core.identity)}

Apparence :
${formatData(context.character.core.appearance)}

Biographie :
${formatData(context.character.core.biography)}

Personnalité :
${formatData(context.character.core.personality)}

Valeurs :
${formatData(context.character.core.values)}

Motivations :
${formatData(context.character.core.motivations)}

Peurs :
${formatData(context.character.core.fears)}

Défauts :
${formatData(context.character.core.flaws)}

Limites :
${formatData(context.character.core.boundaries)}

Style de langage :
${formatData(context.character.core.speechStyle)}

Règles comportementales :
${formatData(context.character.core.behaviorRules)}

Faits immuables :
${formatData(context.character.core.immutableFacts)}

RELATION ACTUELLE

Nature de la relation :
${context.relationship.label || "Non renseignée"}

Contexte initial :
${context.relationship.initialContext || "Non renseigné"}

SCÈNE ACTUELLE

Lieu :
${context.scene.location || "Non renseigné"}

Moment :
${context.scene.storyDatetime || "Non renseigné"}

Action en cours :
${context.scene.currentAction || "Non renseignée"}

Atmosphère :
${context.scene.atmosphere || "Non renseignée"}

${formatMemorySection(memories)}

EXEMPLES DE DIALOGUE — STYLE UNIQUEMENT

Ces exemples sont fictifs et ne sont pas des événements ou souvenirs établis.
${formatDialogueExamples(context)}

CONSIGNES DE STYLE

Ces indications définissent uniquement la manière de répondre.
Elles ne décrivent aucun événement réellement survenu.

${context.dialogueExamples
  .map(
    (example) =>
      `- Stratégie : ${example.response_strategy}
- À éviter : ${example.anti_pattern}`,
  )
  .join("\n")}
`.trim();
}

export function buildModelMessages(
  context: ConversationContext,
  newUserMessage: string,
  memories: readonly RelevantMemory[] = [],
): ModelMessage[] {
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(context, memories),
    },
  ];

  for (const message of context.recentMessages) {
    if (message.sender_type === "persona") {
      messages.push({
        role: "user",
        content: message.content,
      });
    }

    if (message.sender_type === "character") {
      messages.push({
        role: "assistant",
        content: message.content,
      });
    }

    if (
      message.sender_type === "narrator" ||
      message.sender_type === "system"
    ) {
      messages.push({
        role: "system",
        content: `Information narrative établie : ${message.content}`,
      });
    }
  }

  messages.push({
    role: "user",
    content: newUserMessage,
  });

  return messages;
}
