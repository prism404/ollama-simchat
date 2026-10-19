import { openDatabase } from "../db/connection.ts";
import type { ConversationContext } from "../db/chat-repository.ts";
import { buildModelMessages } from "./prompt-builder.ts";
import type { RelevantMemory } from "../memory/memory-types.ts";
import {
  MemoryWorkflowError,
  parsePositiveId,
} from "../memory/memory-types.ts";
export function assertConversationCanOpen(conversationId: number) {
  parsePositiveId(String(conversationId));
  const db = openDatabase();
  try {
    const conversation = db
      .prepare("SELECT status FROM conversations WHERE id=?")
      .get(conversationId);
    if (!conversation)
      throw new MemoryWorkflowError(404, "Conversation introuvable.");
    if (conversation.status !== "active")
      throw new MemoryWorkflowError(
        409,
        "Cette conversation est en lecture seule.",
      );
    if (
      db
        .prepare("SELECT 1 FROM messages WHERE conversation_id=? LIMIT 1")
        .get(conversationId)
    )
      throw new MemoryWorkflowError(
        409,
        "Cette histoire a déjà commencé. Recharge les messages.",
      );
  } finally {
    db.close();
  }
}
export function buildOpeningMessages(
  context: ConversationContext,
  memories: readonly RelevantMemory[] = [],
) {
  const messages = buildModelMessages(
    context,
    "Commence la scène et laisse ensuite la joueuse répondre.",
    memories,
  );
  messages.splice(messages.length - 1, 0, {
    role: "system",
    content: `OUVERTURE DE L’HISTOIRE
La joueuse n’a encore écrit aucun message. La demande suivante est une commande de l’application, pas une parole de ${context.persona.name}.
Produis le premier message de ${context.character.name}, à partir du point de départ et des fiches enregistrés. Pose brièvement la scène, puis donne une action ou une première réplique du personnage qui laisse une ouverture naturelle à la joueuse. Respecte le style et la longueur définis dans sa fiche.
N’écris aucune parole, pensée, émotion, réaction, expression ou action du persona. Ne suppose pas qu’il a déjà répondu, accepté une proposition ou fait un geste. N’invente ni passé commun ni information manquante. Les secrets ne sont pas des informations automatiquement connues des autres.
Si la scène de départ est peu renseignée, propose une prise de parole simple sans inventer de lieu précis ou d’événement passé. Retourne uniquement le message d’ouverture, sans commentaire technique ni résumé de la fiche.`,
  });
  return messages;
}
export function saveOpeningMessage(
  conversationId: number,
  characterId: number,
  content: string,
) {
  if (!content.trim())
    throw new MemoryWorkflowError(
      502,
      "Le modèle n’a pas fourni de message d’ouverture.",
    );
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const conversation = db
      .prepare("SELECT status,story_id FROM conversations WHERE id=?")
      .get(conversationId);
    if (!conversation || conversation.status !== "active")
      throw new MemoryWorkflowError(
        409,
        "Cette conversation ne peut plus être démarrée.",
      );
    if (
      !db
        .prepare("SELECT 1 FROM story_cast WHERE story_id=? AND character_id=?")
        .get(conversation.story_id, characterId)
    )
      throw new MemoryWorkflowError(
        404,
        "Personnage absent de cette histoire.",
      );
    if (
      db
        .prepare("SELECT 1 FROM messages WHERE conversation_id=? LIMIT 1")
        .get(conversationId)
    )
      throw new MemoryWorkflowError(
        409,
        "Cette histoire a déjà commencé. Recharge les messages.",
      );
    const inserted = db
      .prepare(
        "INSERT INTO messages(conversation_id,sequence_number,sender_type,character_id,content,metadata_json) VALUES(?,1,'character',?,?,?)",
      )
      .run(
        conversationId,
        characterId,
        content.trim(),
        JSON.stringify({ kind: "story_opening" }),
      );
    db.exec("COMMIT");
    return Number(inserted.lastInsertRowid);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
