import { loadConversationContext } from "../db/chat-repository.ts";
import { loadRelevantMemories } from "../memory/memory-retrieval.ts";
import { parsePositiveId } from "../memory/memory-types.ts";
import { buildModelMessages } from "./prompt-builder.ts";

const conversationId = parsePositiveId(process.argv[2] ?? "1");
const message =
  process.argv.slice(3).join(" ") ||
  "*Je m’installe en face de toi avec un café.* Tu as passé une bonne journée ?";
const context = loadConversationContext(conversationId);
const memories = loadRelevantMemories(context, message);
console.log(
  "Identifiants des souvenirs sélectionnés :",
  JSON.stringify(memories.map((m) => m.id)),
);
console.log("Souvenirs sélectionnés :", JSON.stringify(memories, null, 2));
console.log("Prompt final :");
console.log(
  JSON.stringify(buildModelMessages(context, message, memories), null, 2),
);
