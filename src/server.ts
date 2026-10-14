import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  checkOllama,
  generateMessagesStream,
  generateReply,
  generateReplyStream,
} from "./ollama/client.ts";

import {
  loadConversationContext,
  saveCharacterMessage,
  savePersonaMessage,
} from "./db/chat-repository.ts";

import { buildModelMessages } from "./chat/prompt-builder.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);

type ChatRequestBody = {
  message?: unknown;
  systemPrompt?: unknown;
};

type OllamaStreamChunk = {
  message?: {
    content?: string;
  };
  done?: boolean;
  error?: string;
};

async function streamOllamaResponse(
  stream: Awaited<ReturnType<typeof generateReplyStream>>,
  response: ServerResponse,
) {
  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "http://localhost:5173",
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let completeResponse = "";

  function processLine(line: string) {
    if (!line.trim()) {
      return;
    }

    const chunk = JSON.parse(line) as OllamaStreamChunk;

    if (chunk.error) {
      throw new Error(chunk.error);
    }

    const text = chunk.message?.content;

    if (text) {
      completeResponse += text;
      response.write(text);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, {
        stream: true,
      });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      processLine(buffer);
    }

    response.end();

    return completeResponse.trim();
  } finally {
    reader.releaseLock();
  }
}

const DEFAULT_SYSTEM_PROMPT = `
Tu incarnes une femme réservée, observatrice et subtilement sarcastique.
Elle tient profondément à la personne en face d'elle, mais le montre surtout
par ses gestes, ses silences et son attention.

Réponds en français contemporain, naturel et fluide.

Règles de style :
- 2 à 5 phrases maximum ;
- une seule indication d'action courte, si elle est utile ;
- pas de monologue intérieur ;
- pas de métaphore compliquée ;
- pas de tournure littéraire artificielle ;
- ne récite pas les traits de personnalité ;
- le sarcasme doit rester léger ;
- laisse transparaître son affection sans la déclarer directement ;
- n'invente pas un souvenir ou un événement passé absent du contexte ;
- ne mentionne jamais être une IA.
`.trim();

function sendJson(response: ServerResponse, statusCode: number, data: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });

  if (statusCode === 204) {
    response.end();
    return;
  }

  response.end(JSON.stringify(data, null, 2));
}

function readJsonBody(request: IncomingMessage): Promise<ChatRequestBody> {
  return new Promise<ChatRequestBody>((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");

    request.on("data", (chunk: string) => {
      body += chunk;
    });

    request.on("end", () => {
      try {
        const parsed: unknown = body ? JSON.parse(body) : {};

        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          reject(new Error("Le corps de la requête doit être un objet JSON."));

          return;
        }

        resolve(parsed as ChatRequestBody);
      } catch {
        reject(new Error("Le JSON envoyé est invalide."));
      }
    });

    request.on("error", reject);
  });
}

const server = createServer(
  async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? `${HOST}:${PORT}`}`,
    );

    if (request.method === "GET" && url.pathname === "/api/health") {
      const ollama = await checkOllama();

      sendJson(response, 200, {
        application: "ok",
        ollama,
      });

      return;
    }

    const conversationMessagesMatch = url.pathname.match(
      /^\/api\/conversations\/(\d+)\/messages$/,
    );

    if (request.method === "POST" && conversationMessagesMatch) {
      try {
        const conversationId = Number(conversationMessagesMatch[1]);

        const body = await readJsonBody(request);

        if (
          typeof body.message !== "string" ||
          body.message.trim().length === 0
        ) {
          sendJson(response, 400, {
            error: 'Le champ "message" est obligatoire.',
          });

          return;
        }

        const userMessage = body.message.trim();

        const context = loadConversationContext(conversationId);

        const modelMessages = buildModelMessages(context, userMessage);

        const stream = await generateMessagesStream(modelMessages);

        savePersonaMessage(conversationId, context.persona.id, userMessage);

        const characterResponse = await streamOllamaResponse(stream, response);

        if (characterResponse) {
          saveCharacterMessage(
            conversationId,
            context.character.id,
            characterResponse,
          );
        }
      } catch (error) {
        console.error(error);

        if (!response.headersSent) {
          sendJson(response, 502, {
            error: error instanceof Error ? error.message : "Erreur inconnue.",
          });
        } else if (!response.writableEnded) {
          response.end("\n[La génération a été interrompue.]");
        }
      }

      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat/stream") {
      try {
        const body = await readJsonBody(request);

        if (
          typeof body.message !== "string" ||
          body.message.trim().length === 0
        ) {
          sendJson(response, 400, {
            error: 'Le champ "message" est obligatoire.',
          });

          return;
        }

        const stream = await generateReplyStream({
          message: body.message.trim(),

          systemPrompt:
            typeof body.systemPrompt === "string"
              ? body.systemPrompt
              : DEFAULT_SYSTEM_PROMPT,
        });

        await streamOllamaResponse(stream, response);
      } catch (error) {
        console.error(error);

        if (!response.headersSent) {
          sendJson(response, 502, {
            error: error instanceof Error ? error.message : "Erreur inconnue.",
          });
        } else {
          response.end("\n[La génération a été interrompue.]");
        }
      }

      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await readJsonBody(request);

        if (
          typeof body.message !== "string" ||
          body.message.trim().length === 0
        ) {
          sendJson(response, 400, {
            error: 'Le champ "message" est obligatoire.',
          });

          return;
        }

        const result = await generateReply({
          message: body.message.trim(),

          systemPrompt:
            typeof body.systemPrompt === "string"
              ? body.systemPrompt
              : DEFAULT_SYSTEM_PROMPT,
        });

        sendJson(response, 200, result);
      } catch (error) {
        console.error(error);

        sendJson(response, 502, {
          error: error instanceof Error ? error.message : "Erreur inconnue.",
        });
      }

      return;
    }

    sendJson(response, 404, {
      error: "Endpoint introuvable.",
    });
  },
);

server.listen(PORT, HOST, () => {
  console.log(`API disponible sur http://${HOST}:${PORT}`);
  console.log(`Test : http://${HOST}:${PORT}/api/health`);
});
