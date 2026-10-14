export const MEMORY_TYPES = [
  "fact",
  "event",
  "preference",
  "promise",
  "relationship",
  "lesson",
  "secret",
  "observation",
] as const;

export const AUTOMATIC_MEMORY_SCOPES = [
  "story",
  "relationship",
  "persona",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type AutomaticMemoryScope = (typeof AUTOMATIC_MEMORY_SCOPES)[number];

export type MemoryProposal = {
  memoryType: MemoryType;
  scope: AutomaticMemoryScope;
  title: string;
  content: string;
  keywords: string[];
  eventDatetime: string | null;
  importance: number;
  emotionalWeight: number;
  confidence: number;
  sourceMessageIds: number[];
};

export type MemoryProposalResult = {
  memories: MemoryProposal[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMemoryType(value: unknown): value is MemoryType {
  return (
    typeof value === "string" &&
    (MEMORY_TYPES as readonly string[]).includes(value)
  );
}

function isAutomaticMemoryScope(value: unknown): value is AutomaticMemoryScope {
  return (
    typeof value === "string" &&
    (AUTOMATIC_MEMORY_SCOPES as readonly string[]).includes(value)
  );
}

function readString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Souvenir ${index + 1}: le champ "${field}" doit être une chaîne non vide.`,
    );
  }

  return value.trim();
}

function readIntegerInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  index: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `Souvenir ${index + 1}: "${field}" doit être un entier entre ${minimum} et ${maximum}.`,
    );
  }

  return value;
}

function readConfidence(value: unknown, index: number): number {
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw new Error(
      `Souvenir ${index + 1}: "confidence" doit être compris entre 0 et 1.`,
    );
  }

  return value;
}

export function parseMemoryProposalResult(
  rawContent: string,
  allowedMessageIds: ReadonlySet<number>,
): MemoryProposalResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(
      `Ollama n'a pas renvoyé un JSON valide. Réponse reçue :\n${rawContent}`,
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.memories)) {
    throw new Error(
      'La réponse JSON doit contenir une propriété "memories" sous forme de tableau.',
    );
  }

  if (parsed.memories.length > 8) {
    throw new Error(
      "L’extracteur a proposé plus de 8 souvenirs pour un seul lot de messages.",
    );
  }

  const memories = parsed.memories.map((item, index): MemoryProposal => {
    if (!isRecord(item)) {
      throw new Error(`Souvenir ${index + 1}: objet JSON attendu.`);
    }

    if (!isMemoryType(item.memoryType)) {
      throw new Error(`Souvenir ${index + 1}: memoryType invalide.`);
    }

    if (!isAutomaticMemoryScope(item.scope)) {
      throw new Error(`Souvenir ${index + 1}: scope invalide.`);
    }

    if (
      !Array.isArray(item.keywords) ||
      !item.keywords.every(
        (keyword) => typeof keyword === "string" && keyword.trim().length > 0,
      )
    ) {
      throw new Error(
        `Souvenir ${index + 1}: "keywords" doit être un tableau de chaînes non vides.`,
      );
    }

    const keywords = item.keywords as string[];

    if (
      !Array.isArray(item.sourceMessageIds) ||
      item.sourceMessageIds.length === 0 ||
      !item.sourceMessageIds.every(
        (messageId) =>
          Number.isInteger(messageId) && allowedMessageIds.has(messageId),
      )
    ) {
      throw new Error(
        `Souvenir ${index + 1}: chaque sourceMessageId doit désigner un message du lot analysé.`,
      );
    }

    if (item.eventDatetime !== null && typeof item.eventDatetime !== "string") {
      throw new Error(
        `Souvenir ${index + 1}: "eventDatetime" doit être une chaîne ou null.`,
      );
    }

    return {
      memoryType: item.memoryType,
      scope: item.scope,
      title: readString(item.title, "title", index),
      content: readString(item.content, "content", index),
      keywords: [
        ...new Set(keywords.map((keyword) => keyword.trim().toLowerCase())),
      ].slice(0, 8),
      eventDatetime:
        typeof item.eventDatetime === "string"
          ? item.eventDatetime.trim() || null
          : null,
      importance: readIntegerInRange(
        item.importance,
        "importance",
        1,
        5,
        index,
      ),
      emotionalWeight: readIntegerInRange(
        item.emotionalWeight,
        "emotionalWeight",
        -5,
        5,
        index,
      ),
      confidence: readConfidence(item.confidence, index),
      sourceMessageIds: [...new Set(item.sourceMessageIds as number[])],
    };
  });

  return { memories };
}
