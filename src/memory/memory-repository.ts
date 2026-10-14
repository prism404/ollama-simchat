import { openDatabase } from "../db/connection.ts";

export type MemorySourceMessage = {
  id: number;
  sequenceNumber: number;
  senderType: "persona" | "character" | "narrator" | "system";
  content: string;
  sentAt: string;
};

type ConversationScopeRow = {
  conversation_id: number;
  conversation_title: string;
  story_id: number;
  story_title: string;
  character_id: number;
  character_name: string;
  persona_id: number;
  persona_name: string;
  relationship_id: number | null;
};

type MessageRow = {
  id: number;
  sequence_number: number;
  sender_type: MemorySourceMessage["senderType"];
  content: string;
  sent_at: string;
};

export function loadMemoryExtractionContext(
  conversationId: number,
  messageLimit = 40,
) {
  const db = openDatabase();

  try {
    const scope = db
      .prepare(
        `
          SELECT
            conv.id AS conversation_id,
            conv.title AS conversation_title,
            story.id AS story_id,
            story.title AS story_title,
            character.id AS character_id,
            character.name AS character_name,
            persona.id AS persona_id,
            persona.name AS persona_name,
            relationship.id AS relationship_id

          FROM conversations AS conv

          JOIN stories AS story
            ON story.id = conv.story_id

          JOIN story_cast AS story_character
            ON story_character.story_id = story.id

          JOIN characters AS character
            ON character.id = story_character.character_id

          JOIN story_personas AS story_persona
            ON story_persona.story_id = story.id

          JOIN personas AS persona
            ON persona.id = story_persona.persona_id

          LEFT JOIN relationships AS relationship
            ON relationship.story_id = story.id
            AND relationship.character_id = character.id
            AND relationship.persona_id = persona.id

          WHERE conv.id = ?

          ORDER BY
            CASE
            WHEN story_character.role = 'main' THEN 0
            ELSE 1
            END,
            persona.is_default DESC

          LIMIT 1
        `,
      )
      .get(conversationId) as ConversationScopeRow | undefined;

    if (!scope) {
      throw new Error(`Conversation ${conversationId} introuvable.`);
    }

    const rows = db
      .prepare(
        `
          SELECT
            id,
            sequence_number,
            sender_type,
            content,
            sent_at

          FROM (
            SELECT
              message.id,
              message.sequence_number,
              message.sender_type,
              message.content,
              message.sent_at

            FROM messages AS message

            WHERE message.conversation_id = ?
              AND NOT EXISTS (
                SELECT 1
                FROM messages AS correction
                WHERE correction.supersedes_message_id = message.id
              )

            ORDER BY message.sequence_number DESC
            LIMIT ?
          )

          ORDER BY sequence_number ASC
        `,
      )
      .all(conversationId, messageLimit) as MessageRow[];

    return {
      conversation: {
        id: scope.conversation_id,
        title: scope.conversation_title,
      },
      story: {
        id: scope.story_id,
        title: scope.story_title,
      },
      character: {
        id: scope.character_id,
        name: scope.character_name,
      },
      persona: {
        id: scope.persona_id,
        name: scope.persona_name,
      },
      relationshipId: scope.relationship_id,
      messages: rows.map((row): MemorySourceMessage => ({
        id: row.id,
        sequenceNumber: row.sequence_number,
        senderType: row.sender_type,
        content: row.content,
        sentAt: row.sent_at,
      })),
    };
  } finally {
    db.close();
  }
}

export type MemoryExtractionContext = ReturnType<
  typeof loadMemoryExtractionContext
>;
