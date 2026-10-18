import {
  readPersonaProfile,
  personaProfileText,
} from "../persona/persona-profile.ts";
import { openDatabase } from "./connection.ts";

type ConversationRow = {
  conversation_id: number;
  conversation_title: string;
  story_id: number;
  story_title: string;
  story_description: string;
  world_rules_json: string;
  tone_json: string;

  persona_id: number;
  persona_name: string;
  persona_description: string;
  persona_pronouns: string | null;
  preferences_json: string;

  character_id: number;
  character_name: string;
  character_label: string;
  identity_json: string;
  appearance_json: string;
  biography_json: string;
  personality_json: string;
  values_json: string;
  motivations_json: string;
  fears_json: string;
  flaws_json: string;
  boundaries_json: string;
  speech_style_json: string;
  behavior_rules_json: string;
  immutable_facts_json: string;

  core_version_id: number;
  core_version_number: number;
  relationship_id: number | null;
  relationship_label: string | null;
  relationship_context: string | null;

  scene_location: string | null;
  story_datetime: string | null;
  current_action: string | null;
  atmosphere: string | null;
};

type DialogueExampleRow = {
  situation_description: string;
  user_message: string | null;
  ideal_response: string;
  response_strategy: string;
  anti_pattern: string;
};

type StoredMessageRow = {
  sequence_number: number;
  sender_type: "persona" | "character" | "narrator" | "system";
  content: string;
  sent_at: string;
};

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function loadConversationContext(
  conversationId: number,
  messageLimit = 12,
) {
  const db = openDatabase();

  try {
    const conversation = db
      .prepare(
        `
      SELECT
        conv.id AS conversation_id,
        conv.title AS conversation_title,

        story.id AS story_id,
        story.title AS story_title,
        story.description AS story_description,
        story.world_rules_json,
        story.tone_json,

        persona.id AS persona_id,
        persona.name AS persona_name,
        persona.description AS persona_description,
        persona.pronouns AS persona_pronouns,
        persona.preferences_json,

        character.id AS character_id,
        character.name AS character_name,
        character.short_label AS character_label,

        core.id AS core_version_id,
        core.version_number AS core_version_number,
        core.identity_json,
        core.appearance_json,
        core.biography_json,
        core.personality_json,
        core.values_json,
        core.motivations_json,
        core.fears_json,
        core.flaws_json,
        core.boundaries_json,
        core.speech_style_json,
        core.behavior_rules_json,
        core.immutable_facts_json,

        relationship.id AS relationship_id,
        relationship.current_label AS relationship_label,
        relationship.initial_context AS relationship_context,

        scene.location AS scene_location,
        scene.story_datetime,
        scene.current_action,
        scene.atmosphere

      FROM conversations AS conv

      JOIN stories AS story
        ON story.id = conv.story_id

      JOIN story_cast AS story_character
      ON story_character.story_id = story.id

      JOIN characters AS character
      ON character.id = story_character.character_id

      JOIN current_character_core AS core
        ON core.character_id = character.id

      JOIN story_personas AS story_persona
        ON story_persona.story_id = story.id

      JOIN personas AS persona
        ON persona.id = story_persona.persona_id

      LEFT JOIN relationships AS relationship
        ON relationship.story_id = story.id
        AND relationship.character_id = character.id
        AND relationship.persona_id = persona.id

      LEFT JOIN current_scene_state AS scene
        ON scene.story_id = story.id

      WHERE conv.id = ?
        AND conv.status = 'active'

      ORDER BY
        CASE
        WHEN story_character.role = 'main' THEN 0
        ELSE 1
        END,
        persona.is_default DESC,
        character.id ASC,
        persona.id ASC

      LIMIT 1
    `,
      )
      .get(conversationId) as ConversationRow | undefined;

    if (!conversation) {
      throw new Error(
        `Conversation ${conversationId} introuvable ou incomplète.`,
      );
    }

    const dialogueExamples = db
      .prepare(
        `
      SELECT
        situation_description,
        user_message,
        ideal_response,
        response_strategy,
        anti_pattern

      FROM character_dialogue_examples

      WHERE character_id = ?
        AND (core_version_id = ? OR (core_version_id IS NULL AND ? = 1))

      ORDER BY
        priority DESC,
        id ASC

      LIMIT 3
    `,
      )
      .all(
        conversation.character_id,
        conversation.core_version_id,
        conversation.core_version_number,
      ) as DialogueExampleRow[];

    const recentMessages = db
      .prepare(
        `
      SELECT
        sequence_number,
        sender_type,
        content,
        sent_at

      FROM (
        SELECT
          sequence_number,
          sender_type,
          content,
          sent_at

        FROM messages

        WHERE conversation_id = ?

        ORDER BY sequence_number DESC

        LIMIT ?
      )

      ORDER BY sequence_number ASC
    `,
      )
      .all(conversationId, messageLimit) as StoredMessageRow[];

    const evolution = db
      .prepare(
        `SELECT version_number, development_summary, mood_json, current_goals_json,
      relationship_state_json, learned_lessons_json FROM character_state_versions
      WHERE story_id = ? AND character_id = ? AND relationship_id IS ? AND review_status IN ('approved','corrected')
      ORDER BY version_number DESC LIMIT 1`,
      )
      .get(
        conversation.story_id,
        conversation.character_id,
        conversation.relationship_id,
      );
    const personaPreferences = parseJson(conversation.preferences_json);
    const preferenceRecord =
      personaPreferences &&
      typeof personaPreferences === "object" &&
      !Array.isArray(personaPreferences)
        ? (personaPreferences as Record<string, unknown>)
        : {};
    const { profile: personaProfile, ...otherPreferences } = preferenceRecord;
    return {
      evolution: evolution
        ? {
            version: Number(evolution.version_number),
            summary: String(evolution.development_summary),
            mood: parseJson(String(evolution.mood_json)),
            goals: parseJson(String(evolution.current_goals_json)),
            relationship: parseJson(String(evolution.relationship_state_json)),
            lessons: parseJson(String(evolution.learned_lessons_json)),
          }
        : null,
      conversation: {
        id: conversation.conversation_id,
        title: conversation.conversation_title,
      },

      story: {
        id: conversation.story_id,
        title: conversation.story_title,
        description: conversation.story_description,
        worldRules: parseJson(conversation.world_rules_json),
        tone: parseJson(conversation.tone_json),
      },

      persona: {
        id: conversation.persona_id,
        name: conversation.persona_name,
        pronouns: conversation.persona_pronouns ?? "",
        description: conversation.persona_description,
        preferences: otherPreferences,
        profile: personaProfileText(readPersonaProfile(personaProfile)),
      },

      character: {
        id: conversation.character_id,
        name: conversation.character_name,
        label: conversation.character_label,

        core: {
          identity: parseJson(conversation.identity_json),
          appearance: parseJson(conversation.appearance_json),
          biography: parseJson(conversation.biography_json),
          personality: parseJson(conversation.personality_json),
          values: parseJson(conversation.values_json),
          motivations: parseJson(conversation.motivations_json),
          fears: parseJson(conversation.fears_json),
          flaws: parseJson(conversation.flaws_json),
          boundaries: parseJson(conversation.boundaries_json),
          speechStyle: parseJson(conversation.speech_style_json),
          behaviorRules: parseJson(conversation.behavior_rules_json),
          immutableFacts: parseJson(conversation.immutable_facts_json),
        },
      },

      relationship: {
        id: conversation.relationship_id,
        label: conversation.relationship_label ?? "",
        initialContext: conversation.relationship_context ?? "",
      },

      scene: {
        location: conversation.scene_location ?? "",
        storyDatetime: conversation.story_datetime ?? "",
        currentAction: conversation.current_action ?? "",
        atmosphere: conversation.atmosphere ?? "",
      },

      dialogueExamples,

      recentMessages,
    };
  } finally {
    db.close();
  }
}

export type ConversationContext = ReturnType<typeof loadConversationContext>;

type MessageSenderType = "persona" | "character";

function saveMessage({
  conversationId,
  senderType,
  personaId,
  characterId,
  content,
}: {
  conversationId: number;
  senderType: MessageSenderType;
  personaId: number | null;
  characterId: number | null;
  content: string;
}) {
  const db = openDatabase();

  try {
    db.exec("BEGIN IMMEDIATE");

    const sequence = db
      .prepare(
        `
      SELECT
        COALESCE(MAX(sequence_number), 0) + 1
          AS next_sequence

      FROM messages

      WHERE conversation_id = ?
    `,
      )
      .get(conversationId) as {
      next_sequence: number;
    };

    const result = db
      .prepare(
        `
      INSERT INTO messages(
        conversation_id,
        sequence_number,
        sender_type,
        persona_id,
        character_id,
        content,
        language,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, 'fr', '{}')
    `,
      )
      .run(
        conversationId,
        sequence.next_sequence,
        senderType,
        personaId,
        characterId,
        content,
      );

    db.exec("COMMIT");

    return {
      id: Number(result.lastInsertRowid),
      sequenceNumber: sequence.next_sequence,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export function savePersonaMessage(
  conversationId: number,
  personaId: number,
  content: string,
) {
  return saveMessage({
    conversationId,
    senderType: "persona",
    personaId,
    characterId: null,
    content,
  });
}

export function saveCharacterMessage(
  conversationId: number,
  characterId: number,
  content: string,
) {
  return saveMessage({
    conversationId,
    senderType: "character",
    personaId: null,
    characterId,
    content,
  });
}
