import { loadConversationContext } from "./chat-repository.ts";

const conversationId = Number(process.argv[2] ?? 1);

if (!Number.isInteger(conversationId) || conversationId <= 0) {
  throw new Error("L’identifiant de conversation doit être un entier positif.");
}

const context = loadConversationContext(conversationId);

console.log(JSON.stringify(context, null, 2));
