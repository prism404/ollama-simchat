const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral-small3.2:24b";

const GENERATION_OPTIONS = {
  temperature: 0.2,
  top_p: 0.75,
  top_k: 20,
  min_p: 0.05,
  repeat_penalty: 1.05,
  num_predict: 140,
  num_ctx: 8192,
};

type OllamaTagsResponse = {
  models?: Array<{
    name: string;
  }>;
};

type OllamaChatResponse = {
  model?: string;
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  total_duration?: number;
};

export async function checkOllama() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Ollama a répondu avec le statut ${response.status}`);
    }

    const data = (await response.json()) as OllamaTagsResponse;

    return {
      connected: true,
      models: data.models?.map((model) => model.name) ?? [],
    };
  } catch (error) {
    return {
      connected: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function generateReply({
  message,
  systemPrompt,
}: {
  message: string;
  systemPrompt: string;
}) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    signal: AbortSignal.timeout(180_000),

    body: JSON.stringify({
      model: OLLAMA_MODEL,
      think: false,
      stream: false,
      keep_alive: "10m",

      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: message,
        },
      ],

      options: GENERATION_OPTIONS,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Erreur Ollama ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText) as OllamaChatResponse;

  return {
    model: data.model ?? OLLAMA_MODEL,
    content: data.message?.content ?? "",
    done: data.done ?? false,

    totalDurationMs:
      typeof data.total_duration === "number"
        ? Math.round(data.total_duration / 1_000_000)
        : null,
  };
}

export async function generateReplyStream({
  message,
  systemPrompt,
}: {
  message: string;
  systemPrompt: string;
}) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    signal: AbortSignal.timeout(180_000),

    body: JSON.stringify({
      model: OLLAMA_MODEL,
      think: false,
      stream: true,
      keep_alive: "10m",

      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: message,
        },
      ],

      options: GENERATION_OPTIONS,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();

    throw new Error(`Erreur Ollama ${response.status}: ${responseText}`);
  }

  if (!response.body) {
    throw new Error("Ollama a répondu sans flux de données.");
  }

  return response.body;
}

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function generateMessagesStream(messages: OllamaMessage[]) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    signal: AbortSignal.timeout(180_000),

    body: JSON.stringify({
      model: OLLAMA_MODEL,
      think: false,
      stream: true,
      keep_alive: "10m",
      messages,

      options: GENERATION_OPTIONS,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();

    throw new Error(`Erreur Ollama ${response.status}: ${responseText}`);
  }

  if (!response.body) {
    throw new Error("Ollama a répondu sans flux de données.");
  }

  return response.body;
}

export async function generateStructuredReply({
  messages,
  jsonSchema,
}: {
  messages: OllamaMessage[];
  jsonSchema: Record<string, unknown>;
}) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    signal: AbortSignal.timeout(300_000),

    body: JSON.stringify({
      model: OLLAMA_MODEL,
      think: false,
      stream: false,
      keep_alive: "10m",
      messages,
      format: jsonSchema,

      options: {
        ...GENERATION_OPTIONS,
        temperature: 0.1,
        top_p: 0.7,
        num_predict: 1_000,
      },
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Erreur Ollama ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText) as OllamaChatResponse;
  const content = data.message?.content?.trim() ?? "";

  if (!content) {
    throw new Error("Ollama a répondu sans contenu JSON.");
  }

  return {
    model: data.model ?? OLLAMA_MODEL,
    content,
    done: data.done ?? false,
    totalDurationMs:
      typeof data.total_duration === "number"
        ? Math.round(data.total_duration / 1_000_000)
        : null,
  };
}
