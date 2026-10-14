import {
  generateStructuredReply,
  type OllamaMessage,
} from "../ollama/client.ts";
import { loadMemoryExtractionContext } from "./memory-repository.ts";
import {
  parseMemoryProposalResult,
  type MemoryProposalResult,
} from "./memory-types.ts";

const MEMORY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["memories"],
  properties: {
    memories: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "memoryType",
          "scope",
          "title",
          "content",
          "keywords",
          "eventDatetime",
          "importance",
          "emotionalWeight",
          "confidence",
          "sourceMessageIds",
        ],
        properties: {
          memoryType: {
            type: "string",
            enum: [
              "fact",
              "event",
              "preference",
              "promise",
              "relationship",
              "lesson",
              "secret",
              "observation",
            ],
          },
          scope: {
            type: "string",
            enum: ["story", "relationship", "persona"],
          },
          title: { type: "string", minLength: 1 },
          content: { type: "string", minLength: 1 },
          keywords: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1 },
          },
          eventDatetime: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          importance: {
            type: "integer",
            minimum: 1,
            maximum: 5,
          },
          emotionalWeight: {
            type: "integer",
            minimum: -5,
            maximum: 5,
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          sourceMessageIds: {
            type: "array",
            minItems: 1,
            items: { type: "integer" },
          },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

const EXTRACTION_SYSTEM_PROMPT = `
Tu es un extracteur de souvenirs pour une histoire interactive.
Tu ne joues aucun personnage et tu ne poursuis pas la conversation.

OBJECTIF

Identifie uniquement les informations qui seront réellement utiles lors de
conversations futures. Retourne au maximum 8 souvenirs atomiques.

À CONSERVER

- un fait personnel explicitement déclaré ;
- une préférence ou une aversion durable ;
- un événement important réellement survenu ;
- une promesse, un projet annoncé ou une décision ;
- une évolution significative de la relation ;
- un secret explicitement révélé ;
- une leçon ou observation importante clairement établie.

À IGNORER

- les salutations et banalités ;
- les gestes sans conséquence durable ;
- les objets temporaires, repas ou boissons sans importance narrative ;
- les détails de décor déjà présents uniquement pour l'ambiance ;
- les suppositions, métaphores, plaisanteries et formulations hypothétiques ;
- les informations inventées par le personnage sur le persona ;
- une préférence déduite d'une seule action ;
- les répétitions d'un même fait ;
- tout fait absent des messages fournis.

TEST DE DURABILITÉ

Avant de proposer un souvenir, demande-toi s'il sera encore utile dans plusieurs
jours ou dans une future scène.

Ne propose pas de souvenir pour :

- une réaction valable uniquement pendant la scène actuelle ;
- un refus ponctuel de répondre à une question ;
- une humeur ou une gêne momentanée ;
- une impression du personnage sur l'état du persona ;
- un commentaire esthétique ou émotionnel sur un objet temporaire ;
- une préférence déduite d'une seule réaction ;
- une information d'importance 1 ou 2.

Ne conserve que les informations d'importance 3 à 5.
En cas de doute, omets l'information.
Il est préférable de ne proposer aucun souvenir plutôt qu'un souvenir inutile.

RÈGLES DE VÉRITÉ

- Chaque souvenir doit être soutenu par au moins un identifiant de message.
- Utilise uniquement les identifiants présents dans le lot.
- N'ajoute aucun détail, aucune cause et aucune intention implicite.
- Une affirmation du persona peut établir un fait sur le persona.
- Une supposition du personnage ne peut pas établir un fait sur le persona.
- Les paroles et décisions du personnage peuvent établir ses propres actions,
  promesses ou intentions dans cette histoire.
- Si rien ne mérite une mémoire durable, retourne {"memories":[]}.

AUTORITÉ DES SOURCES

- Un message du persona fait autorité sur ses propres paroles, actions et préférences explicites.
- Un message du narrateur fait autorité sur les événements décrits.
- Un message du personnage fait autorité uniquement sur ses propres paroles, actions, décisions, promesses et secrets.
- Une observation du personnage sur le persona n'est pas un fait confirmé.
- Une supposition du personnage ne doit jamais devenir un souvenir sur le persona.
- Une réponse improvisée du personnage ne définit pas automatiquement une préférence durable.

EXEMPLES À NE PAS CONSERVER

- « Je préfère ne pas trop en parler aujourd'hui. » : réaction ponctuelle.
- « Tu sembles plus à l'aise. » : impression non confirmée.
- « Ce café est réconfortant. » : commentaire temporaire.
- Une tasse, un repas ou un vêtement présent dans une scène ordinaire.

EXEMPLES À CONSERVER

- « Je déteste les endroits très bruyants. » : préférence explicite du persona.
- « Je te promets que je viendrai demain. » : promesse du personnage.
- « Ma sœur s'appelle Alice. » : fait personnel explicite.
- Le narrateur annonce qu'un événement important a réellement eu lieu.

PORTÉE

- persona : information durable concernant le persona humain ;
- relationship : souvenir partagé, promesse ou évolution de la relation ;
- story : événement ou fait limité à cette histoire.

ÉCHELLES

- importance : 1 anecdotique, 3 utile, 5 indispensable à la continuité ;
- emotionalWeight : de -5 très négatif à 5 très positif ;
- confidence : de 0 à 1 selon le caractère explicite des sources.

Réponds uniquement avec l'objet JSON demandé.
`.trim();

function formatMessages(
  context: ReturnType<typeof loadMemoryExtractionContext>,
) {
  return context.messages
    .map(
      (message) =>
        `[messageId=${message.id}; sequence=${message.sequenceNumber}; sender=${message.senderType}]\n${message.content}`,
    )
    .join("\n\n");
}

export async function proposeMemories(
  conversationId: number,
  messageLimit = 40,
): Promise<{
  context: ReturnType<typeof loadMemoryExtractionContext>;
  proposals: MemoryProposalResult;
  model: string;
  totalDurationMs: number | null;
}> {
  const context = loadMemoryExtractionContext(conversationId, messageLimit);

  if (context.messages.length === 0) {
    return {
      context,
      proposals: { memories: [] },
      model: "aucun appel nécessaire",
      totalDurationMs: 0,
    };
  }

  const messages: OllamaMessage[] = [
    {
      role: "system",
      content: EXTRACTION_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: `
Histoire : ${context.story.title}
Persona humain : ${context.persona.name}
Personnage : ${context.character.name}

MESSAGES À ANALYSER

${formatMessages(context)}
      `.trim(),
    },
  ];

  const result = await generateStructuredReply({
    messages,
    jsonSchema: MEMORY_OUTPUT_SCHEMA,
  });

  const allowedMessageIds = new Set(
    context.messages.map((message) => message.id),
  );

  return {
    context,
    proposals: parseMemoryProposalResult(result.content, allowedMessageIds),
    model: result.model,
    totalDurationMs: result.totalDurationMs,
  };
}
