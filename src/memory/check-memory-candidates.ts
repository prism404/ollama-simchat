import { proposeMemories } from "./memory-extractor.ts";

const conversationId = Number(process.argv[2]);

if (!Number.isInteger(conversationId) || conversationId <= 0) {
  console.error("Usage : npm run memory:propose -- <conversationId>");
  process.exitCode = 1;
} else {
  try {
    const result = await proposeMemories(conversationId);

    console.log(
      JSON.stringify(
        {
          mode: "preview",
          savedToDatabase: false,
          conversation: result.context.conversation,
          analyzedMessageIds: result.context.messages.map(
            (message) => message.id,
          ),
          model: result.model,
          totalDurationMs: result.totalDurationMs,
          proposedMemoryCount: result.proposals.memories.length,
          memories: result.proposals.memories,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
