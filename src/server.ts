import { listVisionModels, describeAppearance } from "./ollama/vision.ts";
import {
  listCharacterImages,
  saveCharacterImage,
  setCharacterAvatar,
  getCharacterImage,
} from "./db/character-images.ts";
import {
  listCharacters,
  getCharacter,
  saveCharacter,
  listPersonas,
  startStory,
} from "./db/character-repository.ts";
import {
  listConversations,
  listConversationMessages,
} from "./db/web-repository.ts";
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

import { loadRelevantMemories } from "./memory/memory-retrieval.ts";
import { proposeMemories } from "./memory/memory-extractor.ts";
import {
  listConversationMemories,
  saveMemoryProposals,
  reviewMemory,
} from "./memory/memory-repository.ts";
import {
  MemoryWorkflowError,
  parsePositiveId,
  parseMemoryStatus,
} from "./memory/memory-types.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);

type ChatRequestBody = {
  message?: unknown;
  systemPrompt?: unknown;
  model?: unknown;
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

  response.flushHeaders();
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
      if (body.length > 7_500_000) {
        reject(new MemoryWorkflowError(413, "Requête trop volumineuse."));
        request.removeAllListeners("data");
        request.resume();
      }
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

export function createAppServer(
  extractMemories: typeof proposeMemories = proposeMemories,
  streamMessages: typeof generateMessagesStream = generateMessagesStream,
) {
  return createServer(
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

      if (request.method === "GET" && url.pathname === "/api/conversations") {
        try {
          sendJson(response, 200, { conversations: listConversations() });
        } catch (error) {
          console.error(error);
          sendJson(response, 500, {
            error: "Impossible de charger les conversations.",
          });
        }
        return;
      }
      const historyRoute = url.pathname.match(
        /^\/api\/conversations\/([^/]+)\/messages$/,
      );
      if (request.method === "GET" && historyRoute) {
        try {
          sendJson(response, 200, {
            messages: listConversationMessages(
              parsePositiveId(historyRoute[1]),
            ),
          });
        } catch (error) {
          sendJson(
            response,
            error instanceof MemoryWorkflowError ? error.status : 500,
            {
              error:
                error instanceof MemoryWorkflowError
                  ? error.message
                  : "Impossible de charger les messages.",
            },
          );
        }
        return;
      }

      if (
        url.pathname === "/api/vision/models" ||
        url.pathname === "/api/vision/appearance"
      ) {
        try {
          if (url.pathname === "/api/vision/models" && request.method === "GET")
            sendJson(response, 200, await listVisionModels());
          else if (
            url.pathname === "/api/vision/appearance" &&
            request.method === "POST"
          ) {
            let body: unknown;
            try {
              body = await readJsonBody(request);
            } catch (error) {
              if (error instanceof MemoryWorkflowError) throw error;
              throw new MemoryWorkflowError(400, "Objet JSON invalide.");
            }
            sendJson(response, 200, await describeAppearance(body));
          } else sendJson(response, 405, { error: "Méthode non autorisée." });
        } catch (error) {
          sendJson(
            response,
            error instanceof MemoryWorkflowError ? error.status : 500,
            {
              error:
                error instanceof MemoryWorkflowError
                  ? error.message
                  : "Analyse visuelle indisponible.",
            },
          );
        }
        return;
      }

      const imageRoute = url.pathname.match(
        /^\/api\/character-images\/([^/]+)$/,
      );
      const mediaRoute = url.pathname.match(
        /^\/api\/characters\/([^/]+)\/(images|avatar)$/,
      );
      if (imageRoute || mediaRoute) {
        try {
          const id = parsePositiveId((imageRoute ?? mediaRoute)![1]);
          if (imageRoute && request.method === "GET") {
            const row = getCharacterImage(id);
            response.writeHead(200, {
              "Content-Type": String(row.mime_type),
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=3600",
            });
            response.end(row.image_data);
            return;
          }
          if (mediaRoute?.[2] === "images" && request.method === "GET")
            sendJson(response, 200, { images: listCharacterImages(id) });
          else if (mediaRoute && request.method === "POST") {
            let body: unknown;
            try {
              body = await readJsonBody(request);
            } catch (error) {
              if (error instanceof MemoryWorkflowError) throw error;
              throw new MemoryWorkflowError(400, "Objet JSON invalide.");
            }
            if (mediaRoute[2] === "images")
              sendJson(response, 201, saveCharacterImage(id, body));
            else {
              const imageId = (body as { imageId?: unknown }).imageId;
              if (
                typeof imageId !== "number" ||
                !Number.isSafeInteger(imageId) ||
                imageId <= 0
              )
                throw new MemoryWorkflowError(
                  400,
                  "Identifiant d’image invalide.",
                );
              sendJson(response, 200, setCharacterAvatar(id, imageId));
            }
          } else sendJson(response, 405, { error: "Méthode non autorisée." });
        } catch (error) {
          sendJson(
            response,
            error instanceof MemoryWorkflowError ? error.status : 500,
            {
              error:
                error instanceof MemoryWorkflowError
                  ? error.message
                  : "Erreur de galerie. Exécute npm run db:init après la mise à jour.",
            },
          );
        }
        return;
      }

      const characterRoute = url.pathname.match(
        /^\/api\/characters\/([^/]+)(\/stories)?$/,
      );
      if (
        url.pathname === "/api/characters" ||
        url.pathname === "/api/personas" ||
        characterRoute
      ) {
        try {
          const id = characterRoute
            ? parsePositiveId(characterRoute[1])
            : undefined;
          if (url.pathname === "/api/personas" && request.method === "GET")
            sendJson(response, 200, { personas: listPersonas() });
          else if (
            url.pathname === "/api/characters" &&
            request.method === "GET"
          )
            sendJson(response, 200, { characters: listCharacters() });
          else if (
            characterRoute &&
            !characterRoute[2] &&
            request.method === "GET"
          )
            sendJson(response, 200, getCharacter(id!));
          else if (
            request.method === "POST" &&
            url.pathname !== "/api/personas"
          ) {
            let body: unknown;
            try {
              body = await readJsonBody(request);
            } catch {
              throw new MemoryWorkflowError(400, "Objet JSON invalide.");
            }
            sendJson(
              response,
              characterRoute && !characterRoute[2] ? 200 : 201,
              characterRoute?.[2]
                ? startStory(id!, body)
                : saveCharacter(body, id),
            );
          } else sendJson(response, 405, { error: "Méthode non autorisée." });
        } catch (error) {
          if (!(error instanceof MemoryWorkflowError)) console.error(error);
          sendJson(
            response,
            error instanceof MemoryWorkflowError ? error.status : 500,
            {
              error:
                error instanceof MemoryWorkflowError
                  ? error.message
                  : "Impossible d’enregistrer la fiche ou l’histoire.",
            },
          );
        }
        return;
      }

      const memoriesRoute = url.pathname.match(
        /^\/api\/conversations\/([^/]+)\/memories(\/propose)?$/,
      );
      const reviewRoute = url.pathname.match(
        /^\/api\/memories\/([^/]+)\/review$/,
      );
      if (memoriesRoute || reviewRoute) {
        try {
          if (reviewRoute && request.method === "POST") {
            const id = parsePositiveId(reviewRoute[1]);
            let body: unknown;
            try {
              body = await readJsonBody(request);
            } catch {
              throw new MemoryWorkflowError(400, "Objet JSON invalide.");
            }
            sendJson(response, 200, reviewMemory(id, body));
          } else if (memoriesRoute) {
            const id = parsePositiveId(memoriesRoute[1]);
            if (!memoriesRoute[2] && request.method === "GET") {
              if (
                url.searchParams.getAll("status").length > 1 ||
                [...url.searchParams.keys()].some((key) => key !== "status")
              ) {
                throw new MemoryWorkflowError(
                  400,
                  "Paramètres de filtre invalides.",
                );
              }
              sendJson(response, 200, {
                memories: listConversationMemories(
                  id,
                  parseMemoryStatus(url.searchParams.get("status")),
                ),
              });
            } else if (memoriesRoute[2] && request.method === "POST") {
              // Establish existence before the potentially slow model request.
              listConversationMemories(id);
              let result: Awaited<ReturnType<typeof proposeMemories>>;
              try {
                result = await extractMemories(id);
              } catch (error) {
                throw new MemoryWorkflowError(
                  502,
                  error instanceof Error
                    ? error.message
                    : "Échec de l'extraction.",
                );
              }
              const saved = saveMemoryProposals(
                result.context,
                result.proposals,
              );
              sendJson(response, saved.created.length ? 201 : 200, {
                memories: saved.created,
                existing: saved.existing,
                createdCount: saved.created.length,
                duplicateCount: saved.existing.length,
                model: result.model,
                totalDurationMs: result.totalDurationMs,
              });
            } else {
              sendJson(response, 405, { error: "Méthode non autorisée." });
            }
          } else {
            sendJson(response, 405, { error: "Méthode non autorisée." });
          }
        } catch (error) {
          if (!(error instanceof MemoryWorkflowError)) console.error(error);
          sendJson(
            response,
            error instanceof MemoryWorkflowError ? error.status : 500,
            {
              error:
                error instanceof MemoryWorkflowError
                  ? error.message
                  : "Erreur interne du workflow mémoire.",
            },
          );
        }
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
          if (
            body.model !== undefined &&
            (typeof body.model !== "string" ||
              !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/.test(body.model))
          ) {
            sendJson(response, 400, { error: "Nom de modèle invalide." });
            return;
          }

          const context = loadConversationContext(conversationId);

          const memories = loadRelevantMemories(context, userMessage);
          const modelMessages = buildModelMessages(
            context,
            userMessage,
            memories,
          );

          const stream = await streamMessages(
            modelMessages,
            typeof body.model === "string" ? body.model : undefined,
          );

          savePersonaMessage(conversationId, context.persona.id, userMessage);

          const characterResponse = await streamOllamaResponse(
            stream,
            response,
          );

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
              error:
                error instanceof Error ? error.message : "Erreur inconnue.",
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
              error:
                error instanceof Error ? error.message : "Erreur inconnue.",
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
}

if (import.meta.main) {
  const server = createAppServer();
  server.listen(PORT, HOST, () => {
    console.log(`API disponible sur http://${HOST}:${PORT}`);
    console.log(`Test : http://${HOST}:${PORT}/api/health`);
  });
}
