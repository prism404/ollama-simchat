import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { MemoryProposal } from "./memory-types.ts";

const directory = mkdtempSync(join(tmpdir(), "memory-workflow-"));
const previousPath = process.env.CHARACTER_CHAT_DB;
process.env.CHARACTER_CHAT_DB = join(directory, "test.db");
const { openDatabase } = await import("../db/connection.ts");
const { migrateDatabase } = await import("../db/migrations.ts");
const {
  loadMemoryExtractionContext,
  saveMemoryProposals,
  listConversationMemories,
  reviewMemory,
} = await import("./memory-repository.ts");
const { createAppServer } = await import("../server.ts");
const { parseMemoryReview, parsePositiveId, parseMemoryStatus } =
  await import("./memory-types.ts");

const legacy = new DatabaseSync(process.env.CHARACTER_CHAT_DB);
legacy.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
legacy.exec(
  "INSERT INTO personas(id, name) VALUES (50, 'Préexistant'); INSERT INTO memory_items(id, persona_id, memory_type, scope, title, content) VALUES (50, 50, 'fact', 'persona', 'Original', 'Donnée conservée')",
);
const original = legacy
  .prepare("SELECT * FROM memory_items WHERE id = 50")
  .get()!;
legacy.exec("BEGIN IMMEDIATE");
migrateDatabase(legacy);
legacy.exec("COMMIT");
legacy.close();
execFileSync(process.execPath, ["src/db/init.ts"], {
  cwd: process.cwd(),
  env: process.env,
});
execFileSync(process.execPath, ["src/db/seed-demo.ts"], {
  cwd: process.cwd(),
  env: process.env,
});
const db = openDatabase();
db.exec(`INSERT INTO messages(id, conversation_id, sequence_number, sender_type, content)
 VALUES (1, 1, 1, 'narrator', 'Le persona déteste les lieux bruyants.'),
 (2, 1, 2, 'narrator', 'Le rendez-vous est le 20 octobre 2026.');
 INSERT INTO conversations(id, story_id, title) SELECT 2, story_id, 'Autre conversation' FROM conversations WHERE id = 1;
 INSERT INTO messages(id, conversation_id, sequence_number, sender_type, content) VALUES (3, 2, 1, 'narrator', 'Source étrangère');`);
const context = loadMemoryExtractionContext(1);
const proposal: MemoryProposal = {
  memoryType: "preference",
  scope: "persona",
  title: "Lieux calmes",
  content: "Le persona déteste les lieux bruyants.",
  keywords: ["calme"],
  eventDatetime: null,
  importance: 4,
  emotionalWeight: 0,
  confidence: 0.9,
  sourceMessageIds: [1, 2],
};
let failExtraction = false;
let emptyExtraction = false;
const extract = async () => {
  if (failExtraction) throw new Error("Ollama indisponible");
  return {
    context,
    proposals: { memories: emptyExtraction ? [] : [proposal] },
    model: "test-fixture",
    totalDurationMs: 0,
  };
};
const server = createAppServer(extract);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function request(path: string, body?: unknown) {
  const response = await fetch(
    root + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  return { status: response.status, body: await response.json() };
}
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  db.close();
  if (previousPath === undefined) delete process.env.CHARACTER_CHAT_DB;
  else process.env.CHARACTER_CHAT_DB = previousPath;
  rmSync(directory, { recursive: true, force: true });
});

test("migration v1 → v2 répétable sans altérer les anciennes lignes", () => {
  assert.equal(
    db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get()
      ?.value,
    "2",
  );
  const migrated = db
    .prepare("SELECT * FROM memory_items WHERE id = 50")
    .get()!;
  for (const key of Object.keys(original))
    assert.deepEqual(migrated[key], original[key]);
  assert.equal(migrated.proposal_key, null);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("HTTP : proposition pending, sources, correction historisée et déduplication après décision", async () => {
  const created = await request("/api/conversations/1/memories/propose", {});
  assert.equal(created.status, 201);
  assert.equal(created.body.createdCount, 1);
  const memory = created.body.memories[0];
  assert.equal(memory.status, "pending");
  assert.equal(memory.eligibleForContext, false);
  assert.deepEqual(
    memory.sources.map((s: { messageId: number }) => s.messageId),
    [1, 2],
  );
  assert.equal(memory.sources[0].sourceExcerpt, context.messages[0].content);
  assert.equal(
    (await request("/api/conversations/1/memories?status=pending")).body
      .memories.length,
    1,
  );
  assert.equal(
    (await request("/api/conversations/2/memories")).body.memories.length,
    0,
  );
  const correction = {
    decision: "correct",
    title: "Titre corrigé",
    content: "Texte corrigé",
    reason: "Plus fidèle",
  };
  const reviewed = await request(
    `/api/memories/${memory.id}/review`,
    correction,
  );
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.status, "corrected");
  assert.equal(reviewed.body.eligibleForContext, true);
  assert.equal(reviewed.body.reviews[0].previousTitle, proposal.title);
  assert.equal(reviewed.body.reviews[0].previousContent, proposal.content);
  assert.equal(reviewed.body.reviews[0].resultingContent, correction.content);
  assert.equal(reviewed.body.reviews[0].resultingTitle, correction.title);
  assert.equal(reviewed.body.reviews[0].reason, correction.reason);
  assert.equal(
    (await request(`/api/memories/${memory.id}/review`, { decision: "accept" }))
      .status,
    409,
  );
  const duplicate = await request("/api/conversations/1/memories/propose", {});
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.createdCount, 0);
  assert.equal(duplicate.body.duplicateCount, 1);
  assert.equal(duplicate.body.existing[0].content, correction.content);
  assert.equal(
    (await request("/api/conversations/1/memories?status=pending")).body
      .memories.length,
    0,
  );
});

test("acceptation et refus conservent texte, motif et sources ; refus non éligible", () => {
  for (const decision of ["accept", "reject"] as const) {
    const saved = saveMemoryProposals(context, {
      memories: [{ ...proposal, title: decision }],
    }).created[0];
    const result = reviewMemory(
      saved.id,
      decision === "accept"
        ? { decision }
        : { decision, reason: "Non pertinent" },
    );
    assert.equal(
      result.status,
      decision === "accept" ? "accepted" : "rejected",
    );
    assert.equal(result.eligibleForContext, decision === "accept");
    assert.equal(result.content, proposal.content);
    assert.equal(result.sources.length, 2);
    assert.equal(result.reviews.length, 1);
    assert.equal(
      saveMemoryProposals(context, {
        memories: [{ ...proposal, title: decision }],
      }).created.length,
      0,
    );
  }
});

test("sources et reviews : un échec annule toutes les écritures", () => {
  const count = () =>
    db.prepare("SELECT COUNT(*) AS n FROM memory_items").get()?.n;
  const before = count();
  db.exec(
    "CREATE TRIGGER test_source_failure BEFORE INSERT ON memory_sources WHEN NEW.message_id = 2 BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  try {
    assert.throws(
      () =>
        saveMemoryProposals(context, {
          memories: [{ ...proposal, title: "Rollback" }],
        }),
      /test failure/,
    );
  } finally {
    db.exec("DROP TRIGGER test_source_failure");
  }
  assert.equal(count(), before);
  const saved = saveMemoryProposals(context, {
    memories: [{ ...proposal, title: "Review rollback" }],
  }).created[0];
  db.exec(
    "CREATE TRIGGER test_review_failure BEFORE UPDATE ON memory_items BEGIN SELECT RAISE(ABORT, 'review failure'); END",
  );
  try {
    assert.throws(
      () => reviewMemory(saved.id, { decision: "accept" }),
      /review failure/,
    );
  } finally {
    db.exec("DROP TRIGGER test_review_failure");
  }
  const untouched = listConversationMemories(1).find((m) => m.id === saved.id)!;
  assert.equal(untouched.status, "pending");
  assert.equal(untouched.reviews.length, 0);
});

test("les sources étrangères sont refusées et un lot invalide est entièrement annulé", () => {
  assert.throws(() =>
    saveMemoryProposals(context, {
      memories: [{ ...proposal, sourceMessageIds: [3] }],
    }),
  );
  const before = listConversationMemories(1).length;
  const forged = {
    ...context,
    messages: [...context.messages, { ...context.messages[0], id: 3 }],
  };
  assert.throws(
    () =>
      saveMemoryProposals(forged, {
        memories: [
          { ...proposal, title: "Lot annulé" },
          { ...proposal, sourceMessageIds: [3] },
        ],
      }),
    /source/,
  );
  assert.equal(listConversationMemories(1).length, before);
});

test("validation HTTP stricte : identifiants, statuts, JSON, décisions et existence", async () => {
  for (const id of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
    assert.equal(
      (await request(`/api/conversations/${id}/memories`)).status,
      400,
    );
    assert.equal(
      (await request(`/api/memories/${id}/review`, { decision: "accept" }))
        .status,
      400,
    );
  }
  for (const query of [
    "status=bogus",
    "status=",
    "status=pending&status=accepted",
    "extra=1",
  ]) {
    assert.equal(
      (await request(`/api/conversations/1/memories?${query}`)).status,
      400,
    );
  }
  assert.equal((await request("/api/conversations/999/memories")).status, 404);
  assert.equal(
    (await request("/api/conversations/999/memories/propose", {})).status,
    404,
  );
  assert.equal(
    (await request("/api/memories/999/review", { decision: "accept" })).status,
    404,
  );
  for (const body of [
    null,
    [],
    {},
    { decision: "approve" },
    { decision: "reject" },
    { decision: "correct", title: " ", content: "x", reason: "x" },
    { decision: "accept", content: "silencieux" },
  ]) {
    assert.equal((await request("/api/memories/50/review", body)).status, 400);
  }
  const malformed = await fetch(root + "/api/memories/50/review", {
    method: "POST",
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.throws(() => parsePositiveId("01"));
  assert.throws(() => parseMemoryStatus("__proto__"));
  assert.throws(() =>
    parseMemoryReview({
      decision: "correct",
      title: "x",
      content: "x",
      reason: 4,
    }),
  );
});

test("un lot vide et une panne Ollama ne créent aucune ligne", async () => {
  const before = listConversationMemories(1).length;
  emptyExtraction = true;
  try {
    const empty = await request("/api/conversations/1/memories/propose", {});
    assert.equal(empty.status, 200);
    assert.equal(empty.body.createdCount, 0);
  } finally {
    emptyExtraction = false;
  }
  failExtraction = true;
  try {
    assert.equal(
      (await request("/api/conversations/1/memories/propose", {})).status,
      502,
    );
  } finally {
    failExtraction = false;
  }
  assert.equal(listConversationMemories(1).length, before);
});

test("l'ordre des sources et les scores ne changent pas l'identité d'une proposition", () => {
  const result = saveMemoryProposals(context, {
    memories: [
      {
        ...proposal,
        sourceMessageIds: [2, 1],
        confidence: 0.5,
        importance: 3,
        keywords: ["nouveau"],
      },
    ],
  });
  assert.equal(result.created.length, 0);
  assert.equal(result.existing.length, 1);
  assert.equal(result.existing[0].status, "corrected");
});
