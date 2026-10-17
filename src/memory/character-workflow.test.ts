import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
const directory = mkdtempSync(join(tmpdir(), "character-workflow-"));
const previousPath = process.env.CHARACTER_CHAT_DB;
process.env.CHARACTER_CHAT_DB = join(directory, "test.db");
execFileSync(process.execPath, ["src/db/init.ts"], { env: process.env });
const { openDatabase } = await import("../db/connection.ts");
const { saveCharacter, getCharacter, startStory } =
  await import("../db/character-repository.ts");
const { loadConversationContext } = await import("../db/chat-repository.ts");
const { buildModelMessages } = await import("../chat/prompt-builder.ts");
const { createAppServer } = await import("../server.ts");
const form = {
  name: "Élise",
  pronouns: "elle",
  description: "Une libraire curieuse.",
  personality: "observatrice\nréservée",
  values: "loyauté",
  motivations: "Découvrir de nouveaux auteurs",
  tone: "naturel",
  humor: "sarcasme léger",
  responseLength: "2 phrases",
  boundaries: "Ne jamais humilier",
  exampleSituation: "Un retard",
  exampleUser: "Me voilà !",
  exampleReply:
    "Ton sens de la ponctualité est fascinant. Entre, le thé est chaud.",
};
const db = openDatabase();
const server = createAppServer();
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  if (previousPath === undefined) delete process.env.CHARACTER_CHAT_DB;
  else process.env.CHARACTER_CHAT_DB = previousPath;
  rmSync(directory, { recursive: true, force: true });
});

test("création HTTP UTF-8 : première fiche validée et exemple lié à sa version", async () => {
  const result = await request("/api/characters", form);
  assert.equal(result.status, 201);
  const detail = await request(`/api/characters/${result.body.id}`);
  assert.equal(detail.body.version, 1);
  assert.deepEqual(detail.body.form, form);
  assert.equal(detail.body.versions.length, 1);
  assert.ok(
    (await request("/api/characters")).body.characters.some(
      (c: { name: string }) => c.name === "Élise",
    ),
  );
});

test("modifier une fiche conserve la version originale et remplace les exemples dans le prompt", () => {
  const created = saveCharacter(form);
  const original = db
    .prepare("SELECT * FROM character_core_versions WHERE character_id = ?")
    .get(created.id);
  const revised = {
    ...form,
    name: "Élise Martin",
    exampleReply: "Deuxième voix, plus douce.",
  };
  assert.equal(saveCharacter(revised, created.id).version, 2);
  assert.deepEqual(
    db
      .prepare(
        "SELECT * FROM character_core_versions WHERE character_id = ? AND version_number = 1",
      )
      .get(created.id),
    original,
  );
  assert.equal(getCharacter(created.id).versions.length, 2);
  const story = startStory(created.id, {
    title: "Les retrouvailles",
    personaName: "Aki",
    relationship: "Amies",
    location: "Librairie",
    scene: "Une porte s’ouvre.",
  });
  const context = loadConversationContext(story.conversationId);
  const prompt = buildModelMessages(context, "Bonjour")[0].content;
  for (const value of [
    "Élise Martin",
    "sarcasme léger",
    "loyauté",
    "Ne jamais humilier",
    "Deuxième voix, plus douce.",
    "Librairie",
    "Une porte s’ouvre.",
  ])
    assert.ok(prompt.includes(value), value);
  assert.ok(!prompt.includes(form.exampleReply));
  assert.equal(context.character.id, created.id);
  const cleared = {
    ...revised,
    exampleSituation: "",
    exampleUser: "",
    exampleReply: "",
  };
  saveCharacter(cleared, created.id);
  assert.equal(
    loadConversationContext(story.conversationId).dialogueExamples.length,
    0,
  );
});

test("une nouvelle histoire utilise le persona choisi et isole relation et scène", async () => {
  const character = saveCharacter(form);
  const first = startStory(character.id, {
    title: "Histoire A",
    personaName: "Persona distinct",
    relationship: "Collègues",
    scene: "Au travail",
  });
  const persona = loadConversationContext(first.conversationId).persona.id;
  const second = await request(`/api/characters/${character.id}/stories`, {
    title: "Histoire B",
    personaId: persona,
    relationship: "Inconnus",
    initialContext: "Première rencontre",
    location: "Un parc",
    scene: "Une rencontre inattendue",
  });
  assert.equal(second.status, 201);
  const a = loadConversationContext(first.conversationId),
    b = loadConversationContext(second.body.conversationId);
  assert.equal(b.persona.id, persona);
  assert.notEqual(a.story.id, b.story.id);
  assert.notEqual(a.relationship.id, b.relationship.id);
  assert.equal(a.scene.currentAction, "Au travail");
  assert.equal(b.relationship.label, "Inconnus");
});

test("validation : champs, exemples incomplets, identifiants et existence", async () => {
  for (const body of [
    {},
    { name: " " },
    { name: 42 },
    { ...form, exampleReply: "" },
    { ...form, inconnu: "x" },
    { ...form, name: "x".repeat(101) },
  ])
    assert.equal((await request("/api/characters", body)).status, 400);
  assert.equal((await request("/api/characters/abc")).status, 400);
  assert.equal((await request("/api/characters/99999")).status, 404);
  assert.equal((await request("/api/characters/99999", form)).status, 404);
  const c = saveCharacter(form);
  for (const body of [
    { title: "A" },
    { title: "A", personaId: 0 },
    { title: "A", personaId: "1" },
    { title: "A", personaId: 1, personaName: "Double" },
  ])
    assert.equal(
      (await request(`/api/characters/${c.id}/stories`, body)).status,
      400,
    );
  assert.equal(
    (
      await request(`/api/characters/${c.id}/stories`, {
        title: "A",
        personaId: 99999,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/api/characters/99999/stories", {
        title: "A",
        personaName: "Moi",
      })
    ).status,
    404,
  );
});

test("échec d'enregistrement : ni nouveau nom ni version partielle", () => {
  const c = saveCharacter(form),
    before = getCharacter(c.id);
  db.exec(
    "CREATE TRIGGER test_character_example_failure BEFORE INSERT ON character_dialogue_examples BEGIN SELECT RAISE(ABORT, 'exemple échoué'); END",
  );
  try {
    assert.throws(
      () => saveCharacter({ ...form, name: "Nom annulé" }, c.id),
      /exemple échoué/,
    );
  } finally {
    db.exec("DROP TRIGGER test_character_example_failure");
  }
  assert.deepEqual(getCharacter(c.id), before);
});

test("échec de scène : toute l'histoire, y compris le nouveau persona, est annulée", () => {
  const c = saveCharacter(form);
  const counts = () =>
    [
      "stories",
      "personas",
      "relationships",
      "conversations",
      "story_cast",
      "story_personas",
    ].map((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
  const before = counts();
  db.exec(
    "CREATE TRIGGER test_scene_failure BEFORE INSERT ON scene_state_versions BEGIN SELECT RAISE(ABORT, 'scène échouée'); END",
  );
  try {
    assert.throws(
      () =>
        startStory(c.id, {
          title: "Histoire annulée",
          personaName: "Persona annulé",
        }),
      /scène échouée/,
    );
  } finally {
    db.exec("DROP TRIGGER test_scene_failure");
  }
  assert.deepEqual(counts(), before);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
