import { loadConversationContext } from "../db/chat-repository.ts";

import { buildModelMessages } from "./prompt-builder.ts";

const conversationId = Number(process.argv[2] ?? 1);

const context = loadConversationContext(conversationId);

const messages = buildModelMessages(
  context,
  "*Je m’installe en face de toi avec un café.* Tu as passé une bonne journée ?",
);

console.log(JSON.stringify(messages, null, 2));
