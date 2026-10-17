import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SQLInputValue } from "node:sqlite";
import type { AddressInfo } from "node:net";

const directory = mkdtempSync(join(tmpdir(), "memory-retrieval-"));
const previousPath = process.env.CHARACTER_CHAT_DB;
process.env.CHARACTER_CHAT_DB = join(directory, "test.db");
for (const script of ["init", "seed-demo", "seed-demo"]) {
  execFileSync(process.execPath, [`src/db/${script}.ts`], { env: process.env });
}
const { openDatabase } = await import("../db/connection.ts");
const { loadConversationContext } = await import("../db/chat-repository.ts");
const { loadRelevantMemories, formatMemorySection, buildMemoryFtsQuery } =
  await import("./memory-retrieval.ts");
const { buildModelMessages } = await import("../chat/prompt-builder.ts");
const { reviewMemory } = await import("./memory-repository.ts");
const { createAppServer } = await import("../server.ts");
const db = openDatabase();
const context = loadConversationContext(1);
function add(overrides: Record<string, SQLInputValue> = {}) {
  const fields = {
    story_id: context.story.id,
    character_id: context.character.id,
    persona_id: context.persona.id,
    relationship_id: context.relationship.id,
    scope: "relationship",
    memory_type: "preference",
    title: "Lieux calmes",
    content: "Le persona préfère les endroits paisibles.",
    keywords: "tranquillité",
    importance: 3,
    emotional_weight: 0,
    review_status: "approved",
    lifecycle_status: "active",
    ...overrides,
  };
  return Number(
    db
      .prepare(
        `INSERT INTO memory_items(${Object.keys(fields).join(",")})
    VALUES (${Object.keys(fields)
      .map(() => "?")
      .join(",")})`,
      )
      .run(...Object.values(fields)).lastInsertRowid,
  );
}
const ids = (message = "zebrafantastique", options = {}) =>
  loadRelevantMemories(context, message, options).map((m) => m.id);
beforeEach(() => {
  db.exec("DELETE FROM memory_reviews; DELETE FROM memory_items;");
});
after(() => {
  db.close();
  if (previousPath === undefined) delete process.env.CHARACTER_CHAT_DB;
  else process.env.CHARACTER_CHAT_DB = previousPath;
  rmSync(directory, { recursive: true, force: true });
});

test("accepted et corrected injectés ; l'original corrigé et les données internes restent hors du prompt", () => {
  const accepted = add();
  const corrected = add({
    review_status: "proposed",
    title: "Ancienne proposition",
    content: "Texte original erroné",
  });
  reviewMemory(corrected, {
    decision: "correct",
    title: "Titre corrigé",
    content: "Contenu corrigé fidèle",
    reason: "Motif technique secret",
  });
  const memories = loadRelevantMemories(context, "calmes corrigé");
  assert.deepEqual(
    new Set(memories.map((m) => m.id)),
    new Set([accepted, corrected]),
  );
  const prompt = buildModelMessages(context, "Bonjour", memories)[0].content;
  assert.match(prompt, /SOUVENIRS VALIDÉS PERTINENTS/);
  assert.match(prompt, /Contenu corrigé fidèle/);
  assert.doesNotMatch(
    prompt,
    /Texte original erroné|Motif technique secret|proposal_key|review_status|confidence|sourceExcerpt/,
  );
});

test("tous les statuts non validés et les cycles inactifs sont exclus de FTS et du fallback", () => {
  const valid = add();
  for (const review_status of ["proposed", "rejected", "superseded"])
    add({ review_status });
  for (const lifecycle_status of ["expired", "resolved", "invalidated"])
    add({ lifecycle_status });
  assert.deepEqual(ids("calmes"), [valid]);
  assert.deepEqual(ids(), [valid]);
});

test("chaque rattachement étranger est exclu pour tous les scopes", () => {
  for (const scope of [
    "global_character",
    "story",
    "relationship",
    "persona",
  ]) {
    const valid = add({ scope });
    for (const key of [
      "story_id",
      "character_id",
      "persona_id",
      "relationship_id",
    ])
      add({ scope, [key]: 2 });
    assert.ok(ids("calmes").includes(valid));
  }
  const selected = loadRelevantMemories(context, "calmes");
  assert.equal(selected.length, 4);
  assert.deepEqual(
    loadRelevantMemories(loadConversationContext(2), "calmes"),
    [],
  );
});

test("le rattachement requis par le scope ne peut pas être nul ; relation absente exclut ses souvenirs", () => {
  for (const [scope, key] of [
    ["global_character", "character_id"],
    ["story", "story_id"],
    ["relationship", "relationship_id"],
    ["persona", "persona_id"],
  ]) {
    add({ scope, [key]: null });
  }
  assert.deepEqual(ids("calmes"), []);
  add();
  assert.deepEqual(
    loadRelevantMemories(
      { ...context, relationship: { ...context.relationship, id: null } },
      "calmes",
    ),
    [],
  );
});

test("souvenirs sans restrictions supplémentaires respectent leur scope principal", () => {
  const global = add({
    scope: "global_character",
    story_id: null,
    persona_id: null,
    relationship_id: null,
  });
  const persona = add({
    scope: "persona",
    story_id: null,
    character_id: null,
    relationship_id: null,
  });
  assert.deepEqual(new Set(ids("calmes")), new Set([global, persona]));
});

test("accents et apostrophes ; recherche dans titre, contenu et mots-clés", () => {
  const title = add({
    scope: "story",
    title: "Été à l’école",
    content: "Information",
    keywords: "",
  });
  const content = add({
    scope: "story",
    title: "Autre",
    content: "Un éléphant",
    keywords: "",
  });
  const keyword = add({
    scope: "story",
    title: "Autre",
    content: "Information",
    keywords: "sérénité",
  });
  assert.deepEqual(ids("l'école"), [title]);
  assert.deepEqual(ids("elephant"), [content]);
  assert.deepEqual(ids("serenite"), [keyword]);
});

test("FTS utilise OR : un seul mot correspondant suffit parmi plusieurs", () => {
  const memory = add({ scope: "story", importance: 1 });
  assert.deepEqual(ids("calmes volcaninconnu astronaute"), [memory]);
  assert.match(buildMemoryFtsQuery("calmes volcan")!, / OR /);
});

test("fallback importance 3 avec reformulation sans aucun mot significatif partagé", () => {
  const memory = add();
  add({ importance: 2 });
  assert.deepEqual(ids("Où souhaiterais-tu passer la soirée ?"), [memory]);
  for (const message of [
    "",
    "   ",
    "je le la et",
    '"*(): NOT OR AND - ^',
    "inconnu",
  ]) {
    assert.deepEqual(ids(message), [memory]);
  }
});

test("fallback plafonné à deux ; fusion sans doublons et classement stable", () => {
  const high = add({ importance: 5 });
  const emotional = add({ importance: 3, emotional_weight: -5 });
  add({ importance: 3, emotional_weight: 1 });
  assert.deepEqual(ids(), [high, emotional]);
  const result = ids("calmes");
  assert.equal(result.length, 3);
  assert.equal(new Set(result).size, 3);
  assert.deepEqual(result, ids("calmes"));
  const match = add({ scope: "story", title: "Rareuniquement", importance: 1 });
  assert.equal(ids("Rareuniquement")[0], match);
});

test("limites de nombre et budget exact incluant la section ; aucune troncature", () => {
  for (let i = 0; i < 12; i++) add({ title: `Calmes ${i}` });
  assert.equal(ids("calmes").length, 8);
  assert.equal(ids("calmes", { maxMemories: 2 }).length, 2);
  const limited = loadRelevantMemories(context, "calmes", {
    maxCharacters: 700,
  });
  assert.ok(limited.length > 0);
  assert.ok(formatMemorySection(limited).length <= 700);
  assert.deepEqual(ids("calmes", { maxCharacters: 5 }), []);
  assert.deepEqual(ids("calmes", { maxMemories: 0 }), []);
  const oversized = add({ content: "x".repeat(4000), importance: 5 });
  assert.ok(!ids("calmes").includes(oversized));
});

test("section absente sans souvenir pertinent et contexte existant conservé", () => {
  add({
    scope: "story",
    title: "Sujet étranger",
    content: "Donnée",
    keywords: "",
  });
  const memories = loadRelevantMemories(context, "zebrafantastique");
  assert.deepEqual(memories, []);
  const prompt = buildModelMessages(context, "Question", memories);
  assert.doesNotMatch(prompt[0].content, /SOUVENIRS VALIDÉS PERTINENTS/);
  for (const heading of [
    "HISTOIRE",
    "PERSONA HUMAIN",
    "PERSONNAGE INCARNÉ",
    "RELATION ACTUELLE",
    "SCÈNE ACTUELLE",
    "CONSIGNES DE STYLE",
  ])
    assert.ok(prompt[0].content.includes(heading));
  assert.equal(prompt.at(-1)?.content, "Question");
});

test("récupération en lecture seule : aucune ligne ni statistique modifiée", () => {
  add();
  const before = db.prepare("SELECT * FROM memory_items").all();
  ids("calmes");
  ids();
  assert.deepEqual(db.prepare("SELECT * FROM memory_items").all(), before);
});

test("endpoint streaming : le prompt transmis contient uniquement le souvenir validé", async () => {
  add({ content: "Souvenir accepté témoin" });
  add({ content: "Proposition secrète exclue", review_status: "proposed" });
  let captured: { role: string; content: string }[] = [];
  const server = createAppServer(undefined, async (messages) => {
    captured = messages;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({
              message: { content: "Réponse simulée" },
              done: true,
            }) + "\n",
          ),
        );
        controller.close();
      },
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/conversations/1/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Bonjour" }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "Réponse simulée");
    assert.match(captured[0].content, /Souvenir accepté témoin/);
    assert.doesNotMatch(captured[0].content, /Proposition secrète exclue/);
    assert.equal(captured.at(-1)?.content, "Bonjour");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("chat:prompt affiche les identifiants avant le prompt sans appel Ollama", () => {
  const memory = add();
  const output = execFileSync(
    process.execPath,
    ["src/chat/check-prompt.ts", "1"],
    { env: process.env, encoding: "utf8" },
  );
  assert.ok(
    output.indexOf(`Identifiants des souvenirs sélectionnés : [${memory}]`) <
      output.indexOf("Prompt final :"),
  );
  assert.match(output, /SOUVENIRS VALIDÉS PERTINENTS/);
});

test("la section préserve la date et tous les messages récents sans métadonnées techniques", () => {
  add({ event_datetime: "2026-10-20", content: "Rendez-vous confirmé" });
  const enriched = {
    ...context,
    recentMessages: [
      {
        sequence_number: 1,
        sender_type: "persona" as const,
        content: "Message humain",
        sent_at: "2026-10-15",
      },
      {
        sequence_number: 2,
        sender_type: "character" as const,
        content: "Réponse passée",
        sent_at: "2026-10-15",
      },
      {
        sequence_number: 3,
        sender_type: "narrator" as const,
        content: "Scène établie",
        sent_at: "2026-10-15",
      },
    ],
  };
  const messages = buildModelMessages(
    enriched,
    "Question suivante",
    loadRelevantMemories(enriched, "rendez-vous"),
  );
  assert.match(messages[0].content, /2026-10-20/);
  assert.deepEqual(
    messages.slice(1).map((message) => message.content),
    [
      "Message humain",
      "Réponse passée",
      "Information narrative établie : Scène établie",
      "Question suivante",
    ],
  );
});

function prepareOldSourceMemory(reviewStatus: "approved" | "proposed") {
  const conversationId = Number(
    db
      .prepare(
        "INSERT INTO conversations(story_id, title) VALUES (?, 'Test mémoire hors fenêtre')",
      )
      .run(context.story.id).lastInsertRowid,
  );
  const source = "Je préfère les endroits paisibles pour nos sorties.";
  const sourceId = Number(
    db
      .prepare(
        `INSERT INTO messages(
    conversation_id, sequence_number, sender_type, persona_id, content)
    VALUES (?, 1, 'persona', ?, ?)`,
      )
      .run(conversationId, context.persona.id, source).lastInsertRowid,
  );
  for (let sequence = 2; sequence <= 15; sequence++) {
    db.prepare(
      `INSERT INTO messages(conversation_id, sequence_number, sender_type, content)
      VALUES (?, ?, 'narrator', ?)`,
    ).run(
      conversationId,
      sequence,
      `Étape narrative neutre numéro ${sequence}.`,
    );
  }
  const memoryId = add({
    content: source,
    review_status: reviewStatus,
    source_conversation_id: conversationId,
  });
  db.prepare(
    "INSERT INTO memory_sources(memory_id, message_id, source_excerpt) VALUES (?, ?, ?)",
  ).run(memoryId, sourceId, source);
  const current = loadConversationContext(conversationId);
  assert.equal(current.recentMessages.length, 12);
  assert.ok(
    current.recentMessages.every((message) => message.sequence_number > 1),
  );
  assert.ok(
    current.recentMessages.every(
      (message) => !message.content.includes(source),
    ),
  );
  return { current, memoryId, source };
}

test("V01 : un souvenir accepté revient par fallback après la sortie de sa source des messages récents", () => {
  const { current, memoryId, source } = prepareOldSourceMemory("approved");
  const question = "Où souhaiterais-tu passer la soirée ?";
  const withoutMemory = JSON.stringify(buildModelMessages(current, question));
  assert.ok(!withoutMemory.includes(source));
  const memories = loadRelevantMemories(current, question);
  assert.deepEqual(
    memories.map((memory) => memory.id),
    [memoryId],
  );
  const messages = buildModelMessages(current, question, memories);
  assert.ok(messages[0].content.includes(source));
  assert.ok(
    messages.slice(1).every((message) => !message.content.includes(source)),
  );
});

test("V01 : hors des messages récents, seule la correction validée est injectée et la source reste intacte", () => {
  const { current, memoryId, source } = prepareOldSourceMemory("proposed");
  const question = "Où souhaiterais-tu passer la soirée ?";
  assert.deepEqual(loadRelevantMemories(current, question), []);
  const corrected =
    "Le persona choisit des espaces silencieux pour les sorties à deux.";
  reviewMemory(memoryId, {
    decision: "correct",
    title: "Sorties à deux",
    content: corrected,
    reason: "Précision testée",
  });
  const memories = loadRelevantMemories(current, question);
  assert.deepEqual(
    memories.map((memory) => memory.id),
    [memoryId],
  );
  const prompt = JSON.stringify(
    buildModelMessages(current, question, memories),
  );
  assert.ok(prompt.includes(corrected));
  assert.ok(!prompt.includes(source));
  assert.equal(
    db
      .prepare("SELECT source_excerpt FROM memory_sources WHERE memory_id = ?")
      .get(memoryId)?.source_excerpt,
    source,
  );
  assert.equal(
    db
      .prepare(
        "SELECT previous_content FROM memory_reviews WHERE memory_id = ?",
      )
      .get(memoryId)?.previous_content,
    source,
  );
});
