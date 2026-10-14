// Keep the extraction read-only; persistence is explicitly requested by the API.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  MEMORY_STATUSES,
  MemoryWorkflowError,
  parseMemoryProposalResult,
  parseMemoryReview,
  parseMemoryStatus,
  parsePositiveId,
  type MemoryProposalResult,
  type MemoryStatus,
} from "./memory-types.ts";

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

type MemoryRow = {
  id: number;
  title: string;
  content: string;
  review_status: string;
  lifecycle_status: string;
  memory_type: string;
  scope: string;
  keywords: string;
  event_datetime: string | null;
  importance: number;
  emotional_weight: number;
  confidence: number;
  source_conversation_id: number | null;
};

function requireConversation(db: DatabaseSync, conversationId: number) {
  parsePositiveId(String(conversationId));
  const row = db
    .prepare("SELECT story_id FROM conversations WHERE id = ?")
    .get(conversationId);
  if (!row) throw new MemoryWorkflowError(404, "Conversation introuvable.");
  return row;
}

function readStoredMemory(db: DatabaseSync, memory: MemoryRow) {
  return {
    id: memory.id,
    conversationId: memory.source_conversation_id,
    title: memory.title,
    content: memory.content,
    status: Object.entries(MEMORY_STATUSES).find(
      ([, value]) => value === memory.review_status,
    )?.[0],
    lifecycleStatus: memory.lifecycle_status,
    memoryType: memory.memory_type,
    scope: memory.scope,
    keywords: memory.keywords,
    eventDatetime: memory.event_datetime,
    importance: memory.importance,
    emotionalWeight: memory.emotional_weight,
    confidence: memory.confidence,
    eligibleForContext:
      ["approved", "corrected"].includes(memory.review_status) &&
      memory.lifecycle_status === "active",
    sources: db
      .prepare(
        `SELECT m.id AS messageId, m.conversation_id AS conversationId,
      m.content, m.sender_type AS senderType, m.sent_at AS sentAt,
      s.source_excerpt AS sourceExcerpt FROM memory_sources s
      JOIN messages m ON m.id = s.message_id WHERE s.memory_id = ? ORDER BY m.id`,
      )
      .all(memory.id),
    reviews: db
      .prepare(
        `SELECT id, decision, previous_title AS previousTitle,
      resulting_title AS resultingTitle, previous_content AS previousContent,
      resulting_content AS resultingContent, note AS reason, reviewed_at AS reviewedAt
      FROM memory_reviews WHERE memory_id = ? ORDER BY id`,
      )
      .all(memory.id),
  };
}

export function listConversationMemories(
  conversationId: number,
  status?: MemoryStatus,
) {
  parseMemoryStatus(status ?? null);
  const db = openDatabase();
  try {
    db.exec("BEGIN");
    requireConversation(db, conversationId);
    // Include historical rows whose origin can only be established through sources.
    const rows = db
      .prepare(
        `SELECT m.* FROM memory_items m
      WHERE (m.source_conversation_id = ? OR (m.source_conversation_id IS NULL AND EXISTS (
        SELECT 1 FROM memory_sources s JOIN messages msg ON msg.id = s.message_id
        WHERE s.memory_id = m.id AND msg.conversation_id = ?)))
      AND (? IS NULL OR m.review_status = ?) ORDER BY m.id`,
      )
      .all(
        conversationId,
        conversationId,
        status ? MEMORY_STATUSES[status] : null,
        status ? MEMORY_STATUSES[status] : null,
      ) as MemoryRow[];
    const result = rows.map((row) => readStoredMemory(db, row));
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export function saveMemoryProposals(
  context: MemoryExtractionContext,
  proposals: MemoryProposalResult,
) {
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const conversation = requireConversation(db, context.conversation.id);
    if (conversation.story_id !== context.story.id) {
      throw new MemoryWorkflowError(
        409,
        "Le contexte de la conversation a changé.",
      );
    }
    const validated = parseMemoryProposalResult(
      JSON.stringify(proposals),
      new Set(context.messages.map((m) => m.id)),
    );
    const created: ReturnType<typeof readStoredMemory>[] = [];
    const existing: ReturnType<typeof readStoredMemory>[] = [];
    for (const proposal of validated.memories) {
      const sourceIds = [...proposal.sourceMessageIds].sort((a, b) => a - b);
      const sources = sourceIds.map((id) => {
        const row = db
          .prepare(
            "SELECT content FROM messages WHERE id = ? AND conversation_id = ?",
          )
          .get(id, context.conversation.id);
        if (
          !row ||
          row.content !== context.messages.find((m) => m.id === id)?.content
        ) {
          throw new MemoryWorkflowError(
            409,
            "Message source absent ou modifié.",
          );
        }
        return { id, content: String(row.content) };
      });
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            context.conversation.id,
            context.story.id,
            context.character.id,
            context.persona.id,
            context.relationshipId,
            proposal.memoryType,
            proposal.scope,
            proposal.title,
            proposal.content,
            proposal.eventDatetime,
            sourceIds,
          ]),
        )
        .digest("hex");
      const duplicate = db
        .prepare("SELECT * FROM memory_items WHERE proposal_key = ?")
        .get(key) as MemoryRow | undefined;
      if (duplicate) {
        existing.push(readStoredMemory(db, duplicate));
        continue;
      }
      if (
        proposal.scope === "relationship" &&
        context.relationshipId === null
      ) {
        throw new MemoryWorkflowError(
          409,
          "Aucune relation ne correspond à cette proposition.",
        );
      }
      const inserted = db
        .prepare(
          `INSERT INTO memory_items(
        story_id, character_id, persona_id, relationship_id, memory_type, scope,
        title, content, keywords, event_datetime, importance, emotional_weight, confidence,
        source_conversation_id, proposal_key, review_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed')`,
        )
        .run(
          context.story.id,
          context.character.id,
          context.persona.id,
          context.relationshipId,
          proposal.memoryType,
          proposal.scope,
          proposal.title,
          proposal.content,
          proposal.keywords.join(" "),
          proposal.eventDatetime,
          proposal.importance,
          proposal.emotionalWeight,
          proposal.confidence,
          context.conversation.id,
          key,
        );
      const id = Number(inserted.lastInsertRowid);
      for (const source of sources) {
        db.prepare(
          "INSERT INTO memory_sources(memory_id, message_id, source_excerpt) VALUES (?, ?, ?)",
        ).run(id, source.id, source.content);
      }
      created.push(
        readStoredMemory(
          db,
          db
            .prepare("SELECT * FROM memory_items WHERE id = ?")
            .get(id) as MemoryRow,
        ),
      );
    }
    db.exec("COMMIT");
    return { created, existing };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export function reviewMemory(memoryId: number, body: unknown) {
  parsePositiveId(String(memoryId));
  const review = parseMemoryReview(body);
  const db = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const memory = db
      .prepare("SELECT * FROM memory_items WHERE id = ?")
      .get(memoryId) as MemoryRow | undefined;
    if (!memory) throw new MemoryWorkflowError(404, "Souvenir introuvable.");
    if (
      memory.review_status !== "proposed" ||
      memory.lifecycle_status !== "active"
    ) {
      throw new MemoryWorkflowError(
        409,
        "Ce souvenir n'est plus en attente de validation.",
      );
    }
    const title = review.decision === "correct" ? review.title : memory.title;
    const content =
      review.decision === "correct" ? review.content : memory.content;
    const status =
      review.decision === "accept"
        ? "approved"
        : review.decision === "correct"
          ? "corrected"
          : "rejected";
    db.prepare(
      `INSERT INTO memory_reviews(memory_id, decision, previous_content,
      resulting_content, note, previous_title, resulting_title) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      memoryId,
      review.decision === "accept"
        ? "accepted"
        : review.decision === "reject"
          ? "rejected"
          : "corrected",
      memory.content,
      content,
      review.decision === "accept" ? "" : review.reason,
      memory.title,
      title,
    );
    db.prepare(
      `UPDATE memory_items SET title = ?, content = ?, review_status = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    ).run(title, content, status, memoryId);
    const result = readStoredMemory(
      db,
      db
        .prepare("SELECT * FROM memory_items WHERE id = ?")
        .get(memoryId) as MemoryRow,
    );
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
