import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { OllamaMessage } from "../ollama/client.ts";
const directory = mkdtempSync(join(tmpdir(), "opening-"));
process.env.CHARACTER_CHAT_DB = join(directory, "test.db");
execFileSync(process.execPath, ["src/db/init.ts"], { env: process.env });
const { openDatabase } = await import("../db/connection.ts");
const { saveCharacter, startStory } =
  await import("../db/character-repository.ts");
const { savePersonaMessage } = await import("../db/chat-repository.ts");
const { createAppServer } = await import("../server.ts");
const db = openDatabase();
const servers: ReturnType<typeof createAppServer>[] = [];
after(async () => {
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const character = saveCharacter({
    name: "Heeju",
    description: "Chef d’équipe réservé.",
    tone: "naturel",
  });
  return {
    ...startStory(character.id, {
      title: "Retrouvailles",
      personaName: "Rina",
      location: "Salle de réunion à Seongsu",
      scene: "Le collègue présente Heeju comme nouveau chef d’équipe.",
      initialContext: "Dix ans depuis leurs études.",
    }),
    characterId: character.id,
  };
}
function stream(chunks: unknown[]) {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify(chunk) + "\n"),
        );
      controller.close();
    },
  });
}
async function app(generate: Parameters<typeof createAppServer>[1]) {
  const server = createAppServer(undefined, generate);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const count = (id: number) =>
  Number(
    db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?")
      .get(id)?.n,
  );
function post(
  root: string,
  id: number,
  body: unknown = {},
  endpoint = "opening",
) {
  return fetch(`${root}/api/conversations/${id}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("ouverture : contexte et modèle transmis, un message du personnage sans fausse parole du persona", async () => {
  const a = fixture();
  let calls = 0;
  let captured: OllamaMessage[] = [];
  let model: string | undefined;
  const root = await app(async (messages, selected) => {
    calls++;
    captured = messages;
    model = selected;
    return stream([
      { message: { content: "*Heeju entre dans la salle." } },
      {
        message: {
          content: "* « Bonjour. Je serai votre nouveau responsable. »",
        },
        done: true,
      },
    ]);
  });
  const response = await post(root, a.conversationId, { model: "test:9b" });
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes("nouveau responsable"));
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id=?")
    .all(a.conversationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sender_type, "character");
  assert.equal(rows[0].character_id, a.characterId);
  assert.equal(rows[0].persona_id, null);
  assert.equal(rows[0].sequence_number, 1);
  assert.equal(JSON.parse(String(rows[0].metadata_json)).kind, "story_opening");
  assert.equal(model, "test:9b");
  const prompt = captured.map((item) => item.content).join("\n");
  assert.ok(prompt.includes("Salle de réunion à Seongsu"));
  assert.ok(prompt.includes("Rina"));
  assert.ok(prompt.includes("N’écris aucune parole, pensée"));
  assert.ok(prompt.includes("pas une parole de Rina"));
  const again = await post(root, a.conversationId);
  assert.equal(again.status, 409);
  assert.equal(calls, 1);
  assert.equal(count(a.conversationId), 1);
});

test("ouverture : panne, flux vide/tronqué ou limite ne créent aucun message ; nouvelle tentative possible", async () => {
  const a = fixture();
  let mode = "failure";
  const root = await app(async () => {
    if (mode === "failure") throw new Error("Ollama indisponible");
    if (mode === "empty") return stream([{ done: true }]);
    if (mode === "partial")
      return stream([{ message: { content: "Texte interrompu" } }]);
    if (mode === "length")
      return stream([
        {
          message: { content: "Texte coupé" },
          done: true,
          done_reason: "length",
        },
      ]);
    return stream([
      { message: { content: "Bonjour, je suis Heeju." }, done: true },
    ]);
  });
  for (const value of ["failure", "empty", "partial", "length"]) {
    mode = value;
    const response = await post(root, a.conversationId);
    await response.text();
    assert.equal(count(a.conversationId), 0);
  }
  mode = "success";
  const retry = await post(root, a.conversationId);
  await retry.text();
  assert.equal(retry.status, 200);
  assert.equal(count(a.conversationId), 1);
});

test("ouverture : double lancement et envoi simultané refusés pendant la génération", async () => {
  const a = fixture();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const root = await app(async () => {
    calls++;
    started();
    await gate;
    return stream([{ message: { content: "Première réplique." }, done: true }]);
  });
  const first = post(root, a.conversationId);
  await ready;
  const duplicate = await post(root, a.conversationId);
  assert.equal(duplicate.status, 409);
  const human = await post(
    root,
    a.conversationId,
    { message: "Bonjour" },
    "messages",
  );
  assert.equal(human.status, 409);
  assert.equal(count(a.conversationId), 0);
  release();
  await (await first).text();
  assert.equal(count(a.conversationId), 1);
  assert.equal(calls, 1);
});

test("ouverture : une écriture concurrente ou un échec SQLite ne laisse pas de doublon", async () => {
  const a = fixture();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const root = await app(async () => {
    started();
    await gate;
    return stream([
      { message: { content: "Ouverture devenue obsolète." }, done: true },
    ]);
  });
  const first = post(root, a.conversationId);
  await ready;
  const personaId = Number(
    db
      .prepare("SELECT persona_id FROM relationships WHERE id=?")
      .get(a.relationshipId)?.persona_id,
  );
  savePersonaMessage(
    a.conversationId,
    personaId,
    "Un message envoyé par un autre processus.",
  );
  release();
  await (await first).text();
  assert.equal(count(a.conversationId), 1);
  assert.equal(
    db
      .prepare("SELECT sender_type FROM messages WHERE conversation_id=?")
      .get(a.conversationId)?.sender_type,
    "persona",
  );
  const b = fixture(),
    secondRoot = await app(async () =>
      stream([{ message: { content: "Une vraie ouverture." }, done: true }]),
    );
  db.exec(
    "CREATE TRIGGER fail_opening BEFORE INSERT ON messages WHEN json_extract(NEW.metadata_json,'$.kind')='story_opening' BEGIN SELECT RAISE(ABORT,'opening failure'); END;",
  );
  try {
    await (await post(secondRoot, b.conversationId)).text();
    assert.equal(count(b.conversationId), 0);
  } finally {
    db.exec("DROP TRIGGER fail_opening");
  }
  await (await post(secondRoot, b.conversationId)).text();
  assert.equal(count(b.conversationId), 1);
});

test("ouverture : identifiants, JSON, modèle, méthodes et lecture seule validés avant Ollama", async () => {
  const a = fixture();
  let calls = 0;
  const root = await app(async () => {
    calls++;
    return stream([{ message: { content: "Bonjour" }, done: true }]);
  });
  for (const body of [
    null,
    [],
    { message: "fausse parole" },
    { model: 3 },
    { model: "../mauvais modèle" },
  ])
    assert.equal((await post(root, a.conversationId, body)).status, 400);
  assert.equal((await post(root, 0)).status, 400);
  assert.equal((await post(root, 999999)).status, 404);
  assert.equal(
    (await fetch(`${root}/api/conversations/${a.conversationId}/opening`))
      .status,
    405,
  );
  db.prepare("UPDATE conversations SET status='closed' WHERE id=?").run(
    a.conversationId,
  );
  assert.equal((await post(root, a.conversationId)).status, 409);
  assert.equal(calls, 0);
  assert.equal(count(a.conversationId), 0);
});
