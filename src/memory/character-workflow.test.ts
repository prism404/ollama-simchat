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
  assert.deepEqual(detail.body.form, {
    ...form,
    gender: "femme",
    appearance: "",
    examples: [
      {
        situation: form.exampleSituation,
        user: form.exampleUser,
        reply: form.exampleReply,
      },
    ],
  });
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

test("la liste des échanges associe chaque histoire au personnage réellement chargé dans le contexte", async () => {
  const first = saveCharacter({ ...form, name: "Personnage A" });
  const second = saveCharacter({ ...form, name: "Personnage B" });
  const stories = [
    startStory(first.id, { title: "A1", personaName: "Moi A" }),
    startStory(first.id, { title: "A2", personaName: "Moi A2" }),
    startStory(second.id, { title: "B1", personaName: "Moi B" }),
  ];
  const result = await request("/api/conversations");
  assert.equal(result.status, 200);
  for (const story of stories) {
    const row = result.body.conversations.find(
      (c: { id: number }) => c.id === story.conversationId,
    );
    const context = loadConversationContext(story.conversationId);
    assert.equal(row.characterId, context.character.id);
    assert.equal(row.characterName, context.character.name);
  }
});

test("genre, apparence et exemples multiples sont versionnés sans perdre les anciens", () => {
  const examples = Array.from({ length: 4 }, (_, i) => ({
    situation: `Situation ${i + 1}`,
    user: `Message ${i + 1}`,
    reply: `Réplique ${i + 1}`,
  }));
  const c = saveCharacter({
    ...form,
    gender: "homme",
    appearance: "Cheveux noirs, yeux bruns, cicatrice au sourcil.",
    examples,
  });
  const current = getCharacter(c.id);
  assert.equal(current.form.pronouns, "il");
  assert.equal(current.form.gender, "homme");
  assert.deepEqual(current.form.examples, examples);
  const story = startStory(c.id, {
    title: "Une rencontre",
    personaName: "Aki",
  });
  const context = loadConversationContext(story.conversationId);
  assert.equal(context.dialogueExamples.length, 3);
  assert.deepEqual(
    context.dialogueExamples.map((e) => e.ideal_response),
    examples.slice(0, 3).map((e) => e.reply),
  );
  assert.ok(
    buildModelMessages(context, "Bonjour")[0].content.includes(
      "cicatrice au sourcil",
    ),
  );
  saveCharacter(
    { ...form, gender: "homme", examples: examples.slice(0, 1) },
    c.id,
  );
  assert.equal(getCharacter(c.id).form.examples?.length, 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM character_dialogue_examples WHERE character_id = ?",
      )
      .get(c.id)?.n,
    5,
  );
  assert.throws(() => saveCharacter({ ...form, gender: "autre" }));
  assert.throws(() =>
    saveCharacter({
      ...form,
      examples: [{ situation: "x", user: "", reply: "x" }],
    }),
  );
  assert.throws(() =>
    saveCharacter({ ...form, examples: Array(13).fill(examples[0]) }),
  );
});

test("galerie locale : images binaires, avatar isolé et formats dangereux refusés", async () => {
  const a = saveCharacter(form),
    b = saveCharacter({ ...form, name: "Autre personnage" });
  const dataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  const image = await request(`/api/characters/${a.id}/images`, {
    name: "portrait.png",
    dataUrl,
  });
  assert.equal(image.status, 201);
  const binary = await fetch(root + image.body.url);
  assert.equal(binary.headers.get("content-type"), "image/png");
  assert.equal(
    Buffer.from(await binary.arrayBuffer()).toString("base64"),
    dataUrl.split(",")[1],
  );
  assert.equal(
    (
      await request(`/api/characters/${b.id}/avatar`, {
        imageId: image.body.id,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/characters/${a.id}/avatar`, {
        imageId: image.body.id,
      })
    ).status,
    200,
  );
  const list = await request(`/api/characters/${a.id}/images`);
  assert.equal(list.body.images[0].isAvatar, 1);
  assert.equal(
    (await request(`/api/characters/${b.id}/images`)).body.images.length,
    0,
  );
  for (const value of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,ZmFrZQ==",
  ])
    assert.equal(
      (
        await request(`/api/characters/${a.id}/images`, {
          name: "faux",
          dataUrl: value,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request(`/api/characters/99999/images`, {
        name: "portrait.png",
        dataUrl,
      })
    ).status,
    404,
  );
  assert.equal((await fetch(root + "/api/character-images/99999")).status, 404);
});

test("le choix de modèle est transmis et les en-têtes du stream arrivent avant le premier texte", async () => {
  const c = saveCharacter(form),
    story = startStory(c.id, { title: "Réactivité", personaName: "Moi" });
  let receivedModel: string | undefined;
  let controller!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  const streaming = createAppServer(undefined, async (_messages, model) => {
    receivedModel = model;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(value) {
        controller = value;
      },
    });
  });
  await new Promise<void>((resolve) =>
    streaming.listen(0, "127.0.0.1", resolve),
  );
  try {
    const url = `http://127.0.0.1:${(streaming.address() as AddressInfo).port}/api/conversations/${story.conversationId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Bonjour", model: "qwen3:4b" }),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    assert.equal(receivedModel, "qwen3:4b");
    controller.enqueue(
      new TextEncoder().encode(
        JSON.stringify({ message: { content: "Bonjour !" }, done: true }) +
          "\n",
      ),
    );
    controller.close();
    assert.equal(await response.text(), "Bonjour !");
    const invalid = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Bonjour", model: 42 }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise<void>((resolve) => streaming.close(() => resolve()));
  }
});

test("migration v2 → v4 répétable : avatar et anciennes données conservés", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { migrateDatabase } = await import("../db/migrations.ts");
  const legacy = new DatabaseSync(join(directory, "legacy-v2.db"));
  try {
    legacy.exec(
      readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
    legacy.exec(
      readFileSync(
        new URL("../db/migrations/002-memory-review.sql", import.meta.url),
        "utf8",
      ),
    );
    legacy.exec(
      "UPDATE app_meta SET value = '2' WHERE key = 'schema_version'; INSERT INTO characters(id,name,avatar_path) VALUES(1,'Ancien','portrait-local.png');",
    );
    const before = legacy.prepare("SELECT * FROM characters").all();
    legacy.exec("BEGIN");
    migrateDatabase(legacy);
    legacy.exec("COMMIT");
    migrateDatabase(legacy);
    assert.deepEqual(
      legacy
        .prepare("SELECT * FROM characters")
        .all()
        .map((row) => ({ ...row })),
      before.map((row) => ({
        ...row,
        avatar_crop_json: '{"x":50,"y":50,"zoom":1}',
      })),
    );
    assert.equal(
      legacy
        .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
        .get()?.value,
      "4",
    );
    assert.equal(
      legacy.prepare("SELECT COUNT(*) AS n FROM character_images").get()?.n,
      0,
    );
  } finally {
    legacy.close();
  }
});

test("liste de chats : dernier message effectif du bon personnage, correction et absence de message", async () => {
  const a = saveCharacter({ ...form, name: "Chat A" }),
    b = saveCharacter({ ...form, name: "Chat B" });
  const older = startStory(a.id, {
    title: "Ancienne histoire active",
    personaName: "A",
  });
  const newer = startStory(a.id, {
    title: "Nouvelle histoire vide",
    personaName: "A2",
  });
  const other = startStory(b.id, { title: "B", personaName: "B" });
  const original = db
    .prepare(
      `INSERT INTO messages(conversation_id,sequence_number,sender_type,content,sent_at) VALUES(?,1,'narrator','Ancien texte','2026-01-01 10:00:00')`,
    )
    .run(older.conversationId).lastInsertRowid;
  db.prepare(
    `INSERT INTO messages(conversation_id,sequence_number,sender_type,content,sent_at,supersedes_message_id) VALUES(?,2,'narrator','Dernier texte corrigé','2026-01-02 10:00:00',?)`,
  ).run(older.conversationId, original);
  db.prepare(
    `INSERT INTO messages(conversation_id,sequence_number,sender_type,content,sent_at) VALUES(?,1,'narrator','Texte de B','2030-01-01 10:00:00')`,
  ).run(other.conversationId);
  const empty = saveCharacter({ ...form, name: "Sans histoire" });
  const list = (await request("/api/characters")).body.characters;
  const card = list.find((c: { id: number }) => c.id === a.id);
  assert.equal(card.lastMessage, "Dernier texte corrigé");
  assert.equal(card.lastConversationId, older.conversationId);
  assert.notEqual(card.lastConversationId, newer.conversationId);
  assert.equal(
    list.find((c: { id: number }) => c.id === b.id).lastMessage,
    "Texte de B",
  );
  assert.equal(
    list.find((c: { id: number }) => c.id === empty.id).lastMessage,
    null,
  );
  assert.equal(
    list.find((c: { id: number }) => c.id === empty.id).lastConversationId,
    null,
  );
});

test("évolution : bilans successifs conservés et dernier état validé injecté seulement dans son histoire", async () => {
  const c = saveCharacter(form),
    a = startStory(c.id, { title: "Évolution A", personaName: "Moi A" }),
    b = startStory(c.id, { title: "Évolution B", personaName: "Moi B" });
  const coreBefore = db
    .prepare("SELECT * FROM character_core_versions WHERE character_id = ?")
    .all(c.id);
  const summary = {
    storyId: a.storyId,
    summary: "Il exprime plus clairement ses intentions.",
    mood: "Apaisé",
    goals: "Être fiable\nÉcouter",
    relationship: "Confiance en construction",
    lessons: "Respecter le rythme de chacun",
  };
  assert.equal(
    (await request(`/api/characters/${c.id}/evolution`, summary)).status,
    201,
  );
  const stateBefore = db
    .prepare(
      "SELECT * FROM character_state_versions WHERE character_id = ? AND story_id = ?",
    )
    .get(c.id, a.storyId);
  assert.equal(
    (
      await request(`/api/characters/${c.id}/evolution`, {
        ...summary,
        summary: "Il reconnaît une erreur sans se défendre.",
      })
    ).body.version,
    2,
  );
  const history = await request(
    `/api/characters/${c.id}/evolution?storyId=${a.storyId}`,
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.states.length, 2);
  assert.equal(history.body.current.version, 2);
  assert.deepEqual(
    db
      .prepare(
        "SELECT * FROM character_state_versions WHERE character_id = ? AND story_id = ? AND version_number = 1",
      )
      .get(c.id, a.storyId),
    stateBefore,
  );
  assert.deepEqual(
    db
      .prepare("SELECT * FROM character_core_versions WHERE character_id = ?")
      .all(c.id),
    coreBefore,
  );
  const prompt = buildModelMessages(
    loadConversationContext(a.conversationId),
    "Bonjour",
  )[0].content;
  assert.ok(prompt.includes("Il reconnaît une erreur sans se défendre."));
  assert.ok(!prompt.includes(summary.summary));
  assert.equal(loadConversationContext(b.conversationId).evolution, null);
  db.prepare(
    `INSERT INTO character_state_versions(story_id,character_id,relationship_id,version_number,development_summary,change_reason,review_status)
    VALUES(?,?,?,3,'Proposition NON VALIDÉE','Test','proposed')`,
  ).run(a.storyId, c.id, a.relationshipId);
  assert.ok(
    !buildModelMessages(
      loadConversationContext(a.conversationId),
      "Bonjour",
    )[0].content.includes("Proposition NON VALIDÉE"),
  );
});

test("suivi dynamique : activité et nouveaux souvenirs validés ; isolation des scopes et états non approuvés", async () => {
  const c = saveCharacter(form),
    a = startStory(c.id, { title: "Suivi A", personaName: "A" }),
    b = startStory(c.id, { title: "Suivi B", personaName: "B" });
  const context = loadConversationContext(a.conversationId);
  const add = (status: string, life: string, storyId = a.storyId) =>
    Number(
      db
        .prepare(
          `INSERT INTO memory_items(story_id,character_id,persona_id,relationship_id,memory_type,scope,title,content,review_status,lifecycle_status)
    VALUES(?,?,?,?, 'relationship','relationship','Évolution retenue','Un fait établi',?,?)`,
        )
        .run(storyId, c.id, context.persona.id, a.relationshipId, status, life)
        .lastInsertRowid,
    );
  const valid = add("approved", "active");
  add("proposed", "active");
  add("rejected", "active");
  add("superseded", "active");
  add("approved", "expired");
  add("approved", "active", b.storyId);
  const first = (
    await request(`/api/characters/${c.id}/evolution?storyId=${a.storyId}`)
  ).body;
  assert.deepEqual(
    first.memories.map((m: { id: number }) => m.id),
    [valid],
  );
  assert.equal(first.activity.messageCount, 0);
  db.prepare(
    "INSERT INTO messages(conversation_id,sequence_number,sender_type,content) VALUES(?,1,'narrator','Un événement')",
  ).run(a.conversationId);
  const corrected = add("corrected", "active");
  const next = (
    await request(`/api/characters/${c.id}/evolution?storyId=${a.storyId}`)
  ).body;
  assert.equal(next.activity.messageCount, 1);
  assert.equal(next.memories.length, 2);
  assert.ok(next.memories.some((m: { id: number }) => m.id === corrected));
  assert.equal(
    (await request(`/api/characters/${c.id}/evolution?storyId=${b.storyId}`))
      .body.memories.length,
    0,
  );
});

test("évolution : entrées invalides, histoires étrangères et rollback du bilan", async () => {
  const a = saveCharacter(form),
    b = saveCharacter(form),
    story = startStory(a.id, { title: "Évolution", personaName: "A" });
  assert.equal(
    (
      await request(
        `/api/characters/${b.id}/evolution?storyId=${story.storyId}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/characters/${b.id}/evolution`, {
        storyId: story.storyId,
        summary: "Interdit",
      })
    ).status,
    404,
  );
  for (const body of [
    null,
    {},
    { storyId: 0, summary: "x" },
    { storyId: story.storyId, summary: " " },
    { storyId: story.storyId, summary: "x", extra: "x" },
  ])
    assert.equal(
      (await request(`/api/characters/${a.id}/evolution`, body)).status,
      400,
    );
  assert.equal(
    (await request(`/api/characters/${a.id}/evolution?storyId=abc`)).status,
    400,
  );
  db.exec(
    "CREATE TRIGGER test_evolution_failure BEFORE INSERT ON character_state_versions BEGIN SELECT RAISE(ABORT,'Bilan échoué'); END",
  );
  try {
    assert.equal(
      (
        await request(`/api/characters/${a.id}/evolution`, {
          storyId: story.storyId,
          summary: "Bilan annulé",
        })
      ).status,
      500,
    );
  } finally {
    db.exec("DROP TRIGGER test_evolution_failure");
  }
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM character_state_versions WHERE character_id = ?",
      )
      .get(a.id)?.n,
    0,
  );
});

test("historique consultable : restauration du formulaire sans écraser les versions ni mélanger les exemples", async () => {
  const first = saveCharacter({
    ...form,
    name: "Ancien nom",
    appearance: "Cheveux noirs",
  });
  saveCharacter(
    {
      ...form,
      name: "Nouveau nom",
      appearance: "Cheveux gris",
      exampleReply: "Une autre réponse.",
    },
    first.id,
  );
  const snapshot = await request(`/api/characters/${first.id}/versions/1`);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.form.name, "Ancien nom");
  assert.equal(snapshot.body.form.appearance, "Cheveux noirs");
  assert.equal(snapshot.body.form.examples[0].reply, form.exampleReply);
  assert.equal(getCharacter(first.id).version, 2);
  const restored = await request(
    `/api/characters/${first.id}`,
    snapshot.body.form,
  );
  assert.equal(restored.status, 200);
  const current = getCharacter(first.id);
  assert.equal(current.version, 3);
  assert.equal(current.form.name, "Ancien nom");
  assert.equal(current.form.appearance, "Cheveux noirs");
  assert.equal(current.versions.length, 3);
  assert.equal(
    (await request(`/api/characters/${first.id}/versions/2`)).body.form
      .appearance,
    "Cheveux gris",
  );
  assert.equal(
    (await request(`/api/characters/${first.id}/versions/9999`)).status,
    404,
  );
  assert.equal(
    (await request(`/api/characters/${first.id}/versions/0`)).status,
    400,
  );
  assert.equal(
    (await request(`/api/characters/${first.id}/versions/1`, {})).status,
    405,
  );
});

test("cadrage avatar : persistance sans modifier l’image et validation des coordonnées", async () => {
  const character = saveCharacter({ ...form, name: "Avatar cadré" });
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRf8AAAAASUVORK5CYII=";
  const image = await request(`/api/characters/${character.id}/images`, {
    name: "Portrait",
    dataUrl: png,
  });
  const crop = { x: 30, y: 12, zoom: 1.75 };
  assert.equal(
    (
      await request(`/api/characters/${character.id}/avatar`, {
        imageId: image.body.id,
        crop,
      })
    ).status,
    200,
  );
  const list = (await request("/api/characters")).body.characters;
  assert.deepEqual(
    list.find((c: { id: number }) => c.id === character.id).avatarCrop,
    crop,
  );
  assert.deepEqual(
    JSON.parse(
      (await request(`/api/characters/${character.id}/images`)).body.images[0]
        .avatarCrop,
    ),
    crop,
  );
  const bytes = await fetch(root + image.body.url);
  assert.deepEqual(
    Buffer.from(await bytes.arrayBuffer()),
    Buffer.from(png.split(",")[1], "base64"),
  );
  for (const invalid of [
    { x: -1, y: 50, zoom: 1 },
    { x: 50, y: 101, zoom: 1 },
    { x: 50, y: 50, zoom: 4 },
    { x: "20", y: 50, zoom: 1 },
    null,
  ]) {
    assert.equal(
      (
        await request(`/api/characters/${character.id}/avatar`, {
          imageId: image.body.id,
          crop: invalid,
        })
      ).status,
      400,
    );
  }
  assert.deepEqual(
    JSON.parse(
      String(
        db
          .prepare("SELECT avatar_crop_json FROM characters WHERE id=?")
          .get(character.id)?.avatar_crop_json,
      ),
    ),
    crop,
  );
});

test("suppression protégée : archivage réversible, historique et histoires conservés", async () => {
  const character = saveCharacter({ ...form, name: "À conserver" });
  const story = startStory(character.id, {
    title: "Histoire conservée",
    personaName: "Moi",
  });
  const before = Number(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM character_core_versions WHERE character_id=?",
      )
      .get(character.id)?.n,
  );
  assert.equal(
    (
      await request(`/api/characters/${character.id}/archive`, {
        confirmation: "mauvais nom",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/characters/${character.id}/archive`, {
        confirmation: "À conserver",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/characters")).body.characters.some(
      (c: { id: number }) => c.id === character.id,
    ),
    false,
  );
  assert.equal(
    (await request("/api/conversations")).body.conversations.some(
      (c: { id: number }) => c.id === story.conversationId,
    ),
    false,
  );
  assert.equal(
    (await request("/api/archived-characters")).body.characters.some(
      (c: { id: number }) => c.id === character.id,
    ),
    true,
  );
  assert.equal(
    Number(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM character_core_versions WHERE character_id=?",
        )
        .get(character.id)?.n,
    ),
    before,
  );
  assert.ok(
    db
      .prepare("SELECT id FROM conversations WHERE id=?")
      .get(story.conversationId),
  );
  assert.equal(
    (
      await request(`/api/characters/${character.id}/restore`, {
        confirmation: "À conserver",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/characters")).body.characters.some(
      (c: { id: number }) => c.id === character.id,
    ),
    true,
  );
  assert.equal(
    (await request("/api/conversations")).body.conversations.some(
      (c: { id: number }) => c.id === story.conversationId,
    ),
    true,
  );
  assert.equal(
    (
      await request("/api/characters/999999/archive", {
        confirmation: "absent",
      })
    ).status,
    404,
  );
});

test("personas : création, modification, défaut unique, contexte et erreurs sans altération", async () => {
  const created = await request("/api/personas", {
    name: "Rina",
    pronouns: "elle",
    description: "Musicienne observatrice.",
    isDefault: true,
  });
  assert.equal(created.status, 200);
  const inlineCharacter = saveCharacter(form);
  const inlineStory = startStory(inlineCharacter.id, {
    title: "Persona créé avec son histoire",
    personaName: "Persona complet",
    personaDescription: "Description dans la transaction de l’histoire.",
  });
  assert.equal(
    loadConversationContext(inlineStory.conversationId).persona.description,
    "Description dans la transaction de l’histoire.",
  );
  const character = saveCharacter(form);
  const story = startStory(character.id, {
    title: "Avec Rina",
    personaId: created.body.id,
  });
  assert.equal(
    loadConversationContext(story.conversationId).persona.description,
    "Musicienne observatrice.",
  );
  const prompt = buildModelMessages(
    loadConversationContext(story.conversationId),
    "Bonjour",
  )[0].content;
  assert.ok(prompt.includes("Musicienne observatrice."));
  await request("/api/personas", {
    name: "Autre persona",
    pronouns: "il",
    description: "",
    isDefault: true,
  });
  assert.equal(
    db.prepare("SELECT SUM(is_default) AS n FROM personas").get()?.n,
    1,
  );
  assert.equal(
    (
      await request(`/api/personas/${created.body.id}`, {
        name: "Rina",
        pronouns: "elle",
        description: "Une nouvelle description.",
        isDefault: false,
      })
    ).status,
    200,
  );
  assert.equal(
    loadConversationContext(story.conversationId).persona.description,
    "Une nouvelle description.",
  );
  assert.equal(
    (
      await request(`/api/personas/${created.body.id}`, {
        name: "",
        pronouns: "",
        description: "",
        isDefault: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/personas/999999", {
        name: "Inconnu",
        pronouns: "",
        description: "",
        isDefault: true,
      })
    ).status,
    404,
  );
  assert.equal(
    db.prepare("SELECT SUM(is_default) AS n FROM personas").get()?.n,
    1,
  );
  assert.equal(
    (
      await request("/api/personas", {
        name: "Nom",
        pronouns: "",
        description: "",
        isDefault: false,
        extra: true,
      })
    ).status,
    400,
  );
});

test("persona détaillé : aller-retour, contexte ciblé et anciennes préférences préservées", async () => {
  const { emptyPersonaProfile } = await import("../persona/persona-profile.ts");
  const profile = {
    ...emptyPersonaProfile(),
    gender: "femme",
    appearance: "Cheveux courts, yeux verts.",
    past: "Ancienne pianiste de concert.",
    present: "Elle reprend ses études.",
    personality: "Réservée en groupe, chaleureuse en confiance.",
    boundaries: "Demander avant de toucher ses affaires.",
    privateInfo: "Elle prépare une audition en secret.",
  };
  const created = await request("/api/personas", {
    name: "Persona nuancé",
    pronouns: "elle",
    description: "Description originale conservée.",
    isDefault: false,
    profile,
  });
  assert.equal(created.status, 200);
  const personaId = created.body.id;
  db.prepare(
    "UPDATE personas SET preferences_json=json_set(preferences_json,'$.existingPreference','thé vert') WHERE id=?",
  ).run(personaId);
  const reloaded = (await request("/api/personas")).body.personas.find(
    (p: { id: number }) => p.id === personaId,
  );
  assert.deepEqual(reloaded.profile, profile);
  assert.equal(reloaded.description, "Description originale conservée.");
  const character = saveCharacter(form);
  const story = startStory(character.id, { title: "Persona riche", personaId });
  const context = loadConversationContext(story.conversationId);
  assert.equal(context.persona.pronouns, "elle");
  assert.deepEqual(context.persona.preferences, {
    existingPreference: "thé vert",
  });
  const prompt = buildModelMessages(context, "Bonjour")[0].content;
  for (const value of [
    profile.appearance,
    profile.past,
    profile.present,
    profile.personality,
    profile.boundaries,
    profile.privateInfo,
  ])
    assert.ok(prompt.includes(value));
  assert.ok(prompt.includes("Ses traits et objectifs sont des tendances"));
  assert.ok(
    prompt.includes(
      "Les informations privées ne sont pas connues du personnage",
    ),
  );
  const other = startStory(character.id, {
    title: "Un autre persona",
    personaName: "Autre",
  });
  assert.ok(
    !buildModelMessages(
      loadConversationContext(other.conversationId),
      "Bonjour",
    )[0].content.includes(profile.privateInfo),
  );
  // An older client omitting profile must not erase it.
  assert.equal(
    (
      await request(`/api/personas/${personaId}`, {
        name: "Nom ajusté",
        pronouns: "elle",
        description: "Description ajustée.",
        isDefault: false,
      })
    ).status,
    200,
  );
  const stored = JSON.parse(
    String(
      db
        .prepare("SELECT preferences_json FROM personas WHERE id=?")
        .get(personaId)?.preferences_json,
    ),
  );
  assert.deepEqual(stored.profile, profile);
  assert.equal(stored.existingPreference, "thé vert");
  const adjusted = { ...profile, present: "Elle travaille à la bibliothèque." };
  await request(`/api/personas/${personaId}`, {
    name: "Nom ajusté",
    pronouns: "elle",
    description: "Description ajustée.",
    isDefault: false,
    profile: adjusted,
  });
  assert.ok(
    loadConversationContext(story.conversationId).persona.profile.includes(
      adjusted.present,
    ),
  );
  assert.equal(
    JSON.parse(
      String(
        db
          .prepare("SELECT preferences_json FROM personas WHERE id=?")
          .get(personaId)?.preferences_json,
      ),
    ).existingPreference,
    "thé vert",
  );
});

test("persona détaillé : champs invalides et échec SQL annulent toutes les écritures", async () => {
  const created = await request("/api/personas", {
    name: "Persona protégé",
    pronouns: "",
    description: "Texte conservé",
    isDefault: false,
  });
  const before = db
    .prepare("SELECT * FROM personas WHERE id=?")
    .get(created.body.id);
  for (const profile of [
    null,
    [],
    { invented: "non" },
    { past: 12 },
    { gender: "invalide" },
    { past: "x".repeat(8001) },
    { past: "a".repeat(8000), present: "b".repeat(8000), habits: "c" },
  ]) {
    assert.equal(
      (
        await request(`/api/personas/${created.body.id}`, {
          name: "À refuser",
          pronouns: "",
          description: "Modification à annuler",
          isDefault: true,
          profile,
        })
      ).status,
      400,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM personas WHERE id=?").get(created.body.id),
      before,
    );
  }
  const defaults = db
    .prepare("SELECT id,is_default FROM personas ORDER BY id")
    .all();
  db.exec(
    `CREATE TRIGGER fail_persona_profile BEFORE UPDATE OF preferences_json ON personas BEGIN SELECT RAISE(ABORT,'test profile failure'); END;`,
  );
  try {
    assert.equal(
      (
        await request(`/api/personas/${created.body.id}`, {
          name: "À annuler",
          pronouns: "elle",
          description: "Modification à annuler",
          isDefault: true,
          profile: { past: "Passé connu" },
        })
      ).status,
      500,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM personas WHERE id=?").get(created.body.id),
      before,
    );
    assert.deepEqual(
      db.prepare("SELECT id,is_default FROM personas ORDER BY id").all(),
      defaults,
    );
  } finally {
    db.exec("DROP TRIGGER fail_persona_profile");
  }
});
