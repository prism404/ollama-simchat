import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
const directory = mkdtempSync(join(tmpdir(), "story-workflow-"));
process.env.CHARACTER_CHAT_DB = join(directory, "stories.db");
execFileSync(process.execPath, ["src/db/init.ts"], { env: process.env });
const { openDatabase } = await import("../db/connection.ts");
const { saveCharacter, startStory } =
  await import("../db/character-repository.ts");
const { loadConversationContext } = await import("../db/chat-repository.ts");
const { buildModelMessages } = await import("../chat/prompt-builder.ts");
const { getStory } = await import("../db/story-repository.ts");
const { createAppServer } = await import("../server.ts");
const db = openDatabase(),
  server = createAppServer();
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function request(path: string, body?: unknown) {
  const response = await fetch(
    base + path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  return { status: response.status, body: await response.json() };
}
function fixture() {
  const character = saveCharacter({ name: "Heeju" });
  const story = startStory(character.id, {
    title: "Un passé qui revient",
    personaName: "Rina",
    relationship: "Anciens partenaires",
    initialContext: "Ils se retrouvent après dix ans.",
    location: "Bureau à Seongsu",
    scene: "Présentation de Heeju",
  });
  return { ...story, characterId: character.id };
}
function message(conversationId: number, n: number, content = `Message ${n}`) {
  return Number(
    db
      .prepare(
        "INSERT INTO messages(conversation_id,sequence_number,sender_type,content) VALUES(?,?,'narrator',?)",
      )
      .run(conversationId, n, content).lastInsertRowid,
  );
}
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test("histoire : lecture, correction, restauration et messages conservés", async () => {
  const a = fixture(),
    other = fixture();
  message(a.conversationId, 1, "Déjà joué");
  const before = db
    .prepare("SELECT * FROM messages WHERE conversation_id=?")
    .all(a.conversationId);
  const initial = await request(`/api/conversations/${a.conversationId}/story`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.initial.version, 1);
  assert.equal(initial.body.personaName, "Rina");
  const corrected = {
    ...initial.body.initial.form,
    title: "Titre corrigé",
    initialContext: "Passé corrigé",
    location: "Salle corrigée",
  };
  assert.equal(
    (
      await request(`/api/conversations/${a.conversationId}/story`, {
        section: "setup",
        expectedVersion: 1,
        ...corrected,
      })
    ).status,
    200,
  );
  let data = getStory(a.conversationId);
  assert.equal(data.initial?.version, 2);
  assert.equal(data.initial?.form.title, "Titre corrigé");
  assert.equal(data.current?.form.location, "Bureau à Seongsu");
  assert.equal(
    (
      await request(`/api/conversations/${a.conversationId}/story`, {
        section: "setup",
        expectedVersion: 2,
        ...initial.body.initial.form,
      })
    ).status,
    200,
  );
  data = getStory(a.conversationId);
  assert.equal(data.initial?.version, 3);
  assert.equal(data.initialVersions[1].form.title, "Titre corrigé");
  assert.equal(data.initialVersions[2].form.title, "Un passé qui revient");
  assert.deepEqual(
    db
      .prepare("SELECT * FROM messages WHERE conversation_id=?")
      .all(a.conversationId),
    before,
  );
  assert.equal(getStory(other.conversationId).initial?.version, 1);
});

test("continuité : récapitulatif au-delà de la fenêtre récente, scène versionnée et isolation", async () => {
  const a = fixture(),
    other = fixture();
  const before = getStory(a.conversationId);
  for (let n = 1; n <= 100; n++)
    message(
      a.conversationId,
      n,
      n === 1
        ? "Ils ont convenu d’un rendez-vous au parc."
        : `Échange récent ${n}`,
    );
  const summary =
    "Rendez-vous au parc convenu ; la réunion du lendemain reste à préparer.";
  const updated = {
    location: "Voiture à Yeoksam",
    scene: "Ils rentrent du bureau",
    atmosphere: "Un silence apaisé",
    summary,
  };
  assert.equal(
    (
      await request(`/api/conversations/${a.conversationId}/story`, {
        section: "current",
        expectedVersion: 1,
        ...updated,
      })
    ).status,
    200,
  );
  let data = getStory(a.conversationId);
  assert.equal(data.current?.version, 2);
  assert.equal(data.currentVersions[1].form.location, "Bureau à Seongsu");
  assert.deepEqual(data.initial, before.initial);
  const context = loadConversationContext(a.conversationId);
  assert.equal(context.recentMessages.length, 12);
  assert.ok(
    !context.recentMessages.some((m) =>
      m.content.includes("rendez-vous au parc"),
    ),
  );
  const prompt = buildModelMessages(context, "On fait quoi demain ?")[0]
    .content;
  assert.ok(prompt.includes(summary));
  assert.ok(prompt.includes("Voiture à Yeoksam"));
  assert.ok(prompt.includes("sans relancer la scène"));
  assert.ok(
    !buildModelMessages(
      loadConversationContext(other.conversationId),
      "Bonjour",
    )[0].content.includes(summary),
  );
  await request(`/api/conversations/${a.conversationId}/story`, {
    section: "current",
    expectedVersion: 2,
    ...data.current!.form,
    summary: "Récapitulatif corrigé",
  });
  data = getStory(a.conversationId);
  assert.equal(data.currentVersions[1].form.summary, summary);
  assert.equal(data.current?.form.summary, "Récapitulatif corrigé");
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?")
      .get(a.conversationId)?.n,
    100,
  );
});

test("histoire : validation, conflit de version et rollback du contexte et du suivi", async () => {
  const a = fixture(),
    path = `/api/conversations/${a.conversationId}/story`,
    data = getStory(a.conversationId),
    form = data.initial!.form;
  for (const body of [
    null,
    [],
    {},
    { section: "nope" },
    { section: "setup", expectedVersion: 1, ...form, storyId: 999 },
    { section: "setup", expectedVersion: 1, ...form, title: "" },
    { section: "setup", expectedVersion: "1", ...form },
    {
      section: "current",
      expectedVersion: 1,
      location: 12,
      scene: "",
      summary: "",
      atmosphere: "",
    },
  ])
    assert.equal((await request(path, body)).status, 400);
  assert.equal((await request("/api/conversations/0/story")).status, 400);
  assert.equal((await request("/api/conversations/999999/story")).status, 404);
  assert.equal(
    (await request(path, { section: "setup", expectedVersion: 999, ...form }))
      .status,
    409,
  );
  db.exec(
    "CREATE TRIGGER fail_story_setup BEFORE INSERT ON story_setup_versions BEGIN SELECT RAISE(ABORT,'story failure'); END;",
  );
  try {
    assert.equal(
      (
        await request(path, {
          section: "setup",
          expectedVersion: 1,
          ...form,
          title: "À annuler",
          initialContext: "À annuler",
        })
      ).status,
      500,
    );
  } finally {
    db.exec("DROP TRIGGER fail_story_setup");
  }
  assert.deepEqual(getStory(a.conversationId), data);
  assert.equal(
    db.prepare("SELECT title FROM stories WHERE id=?").get(a.storyId)?.title,
    form.title,
  );
  assert.equal(
    db
      .prepare("SELECT initial_context FROM relationships WHERE id=?")
      .get(a.relationshipId)?.initial_context,
    form.initialContext,
  );
  db.exec(
    "CREATE TRIGGER fail_story_scene BEFORE INSERT ON scene_state_versions BEGIN SELECT RAISE(ABORT,'scene failure'); END;",
  );
  try {
    assert.equal(
      (
        await request(path, {
          section: "current",
          expectedVersion: 1,
          location: "À annuler",
          scene: "",
          summary: "",
          atmosphere: "",
        })
      ).status,
      500,
    );
  } finally {
    db.exec("DROP TRIGGER fail_story_scene");
  }
  assert.deepEqual(getStory(a.conversationId), data);
});

test("pagination : 501 messages, corrections exclues, ordre stable et archive complète", async () => {
  const a = fixture();
  let original = 0;
  for (let n = 1; n <= 500; n++) {
    const id = message(a.conversationId, n);
    if (n === 10) original = id;
  }
  const correction = message(a.conversationId, 501, "Correction du message 10");
  db.prepare("UPDATE messages SET supersedes_message_id=? WHERE id=?").run(
    original,
    correction,
  );
  let path = `/api/conversations/${a.conversationId}/messages`,
    page = (await request(path)).body;
  assert.equal(page.messages.length, 50);
  assert.equal(page.messages[0].sequenceNumber, 452);
  assert.equal(page.nextBeforeSequence, 452);
  const loaded = [...page.messages];
  // A newly appended message must not shift older pages or introduce duplicates.
  message(a.conversationId, 502, "Un nouveau message");
  while (page.hasMore) {
    page = (await request(`${path}?beforeSequence=${page.nextBeforeSequence}`))
      .body;
    loaded.unshift(...page.messages);
  }
  assert.equal(loaded.length, 500);
  assert.equal(new Set(loaded.map((m) => m.id)).size, 500);
  assert.ok(!loaded.some((m) => m.id === original));
  assert.equal(loaded.at(-1).sequenceNumber, 501);
  assert.equal(page.nextBeforeSequence, null);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?")
      .get(a.conversationId)?.n,
    502,
  );
  for (const query of [
    "?limit=101",
    "?limit=0",
    "?limit=1.5",
    "?beforeSequence=-1",
    "?limit=20&limit=30",
    "?unknown=1",
  ])
    assert.equal((await request(path + query)).status, 400);
  assert.equal(
    (await request(path + "?beforeSequence=1")).body.messages.length,
    0,
  );
});

test("migration v5 → v6 : contexte initial récupéré, dernière scène et messages intacts", async () => {
  const { migrateDatabase } = await import("../db/migrations.ts");
  const legacy = new DatabaseSync(join(directory, "v5.db"));
  try {
    for (const filename of [
      "schema.sql",
      "migrations/002-memory-review.sql",
      "migrations/003-character-images.sql",
      "migrations/004-avatar-crop.sql",
      "migrations/005-persona-images.sql",
    ])
      legacy.exec(
        readFileSync(new URL(`../db/${filename}`, import.meta.url), "utf8"),
      );
    legacy.exec(
      "UPDATE app_meta SET value='5' WHERE key='schema_version'; INSERT INTO personas(id,name) VALUES(1,'Rina'); INSERT INTO characters(id,name) VALUES(1,'Heeju'); INSERT INTO stories(id,title) VALUES(1,'Histoire existante'); INSERT INTO relationships(id,story_id,character_id,persona_id,current_label,initial_context) VALUES(1,1,1,1,'Anciens partenaires','Passé connu'); INSERT INTO conversations(id,story_id) VALUES(1,1); INSERT INTO messages(conversation_id,sequence_number,sender_type,content) VALUES(1,1,'narrator','Message conservé'); INSERT INTO scene_state_versions(story_id,version_number,location,current_action) VALUES(1,1,'Premier lieu','Début'),(1,2,'Lieu actuel','Maintenant');",
    );
    const beforeMessages = legacy.prepare("SELECT * FROM messages").all(),
      beforeScenes = legacy.prepare("SELECT * FROM scene_state_versions").all();
    legacy.exec("BEGIN");
    migrateDatabase(legacy);
    legacy.exec("COMMIT");
    migrateDatabase(legacy);
    const snapshot = JSON.parse(
      String(
        legacy.prepare("SELECT snapshot_json FROM story_setup_versions").get()
          ?.snapshot_json,
      ),
    );
    assert.equal(snapshot.location, "Premier lieu");
    assert.equal(snapshot.scene, "Début");
    assert.equal(snapshot.initialContext, "Passé connu");
    assert.deepEqual(
      legacy.prepare("SELECT * FROM messages").all(),
      beforeMessages,
    );
    assert.deepEqual(
      legacy.prepare("SELECT * FROM scene_state_versions").all(),
      beforeScenes,
    );
    assert.equal(
      legacy.prepare("SELECT COUNT(*) AS n FROM story_setup_versions").get()?.n,
      1,
    );
    assert.deepEqual(legacy.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    legacy.close();
  }
});
