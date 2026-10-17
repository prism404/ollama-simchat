import assert from "node:assert/strict";
import { test } from "node:test";
import { listVisionModels, describeAppearance } from "../ollama/vision.ts";
import { composePersonality } from "../../web/src/personality-guide.ts";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

test("la détection vision repose sur les capacités et signale les vérifications impossibles", async () => {
  const fake: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/api/tags"))
      return Response.json({
        models: [
          { name: "text:4b" },
          { name: "vision:4b" },
          { name: "unknown:4b" },
        ],
      });
    const { model } = JSON.parse(String(init?.body));
    if (model === "unknown:4b") return new Response("", { status: 500 });
    return Response.json({
      capabilities:
        model === "vision:4b" ? ["completion", "vision"] : ["completion"],
    });
  };
  assert.deepEqual(await listVisionModels(fake), {
    models: ["vision:4b"],
    unchecked: ["unknown:4b"],
  });
});
test("description locale multi-images : modèle et références transmis sans sauvegarde automatique", async () => {
  let chats = 0;
  const fake: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/api/show"))
      return Response.json({ capabilities: ["vision"] });
    chats++;
    assert.ok(String(input).endsWith("/api/chat"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "vision:4b");
    assert.equal(body.messages[1].images.length, 2);
    assert.equal(body.messages[1].images[0], image.split(",")[1]);
    assert.match(body.messages[0].content, /ne déduis ni personnalité/i);
    return Response.json({
      message: {
        content: "Visage ovale et cheveux noirs ; couleur des yeux incertaine.",
      },
    });
  };
  assert.deepEqual(
    await describeAppearance(
      { model: "vision:4b", images: [image, image] },
      fake,
    ),
    {
      description:
        "Visage ovale et cheveux noirs ; couleur des yeux incertaine.",
      model: "vision:4b",
      imageCount: 2,
    },
  );
  assert.equal(chats, 1);
});
test("vision : modèle texte, entrées invalides, image contrefaite et réponse vide refusés", async () => {
  let called = 0;
  const never: typeof fetch = async () => {
    called++;
    throw new Error("Ne doit pas être appelé");
  };
  for (const body of [
    null,
    {},
    { model: "vision:4b", images: [] },
    { model: "vision:4b", images: Array(11).fill(image) },
    { model: "vision:4b", images: ["data:image/png;base64,ZmFrZQ=="] },
    { model: 42, images: [image] },
  ])
    await assert.rejects(() => describeAppearance(body, never));
  assert.equal(called, 0);
  const textOnly: typeof fetch = async () =>
    Response.json({ capabilities: ["completion"] });
  await assert.rejects(
    () => describeAppearance({ model: "text:4b", images: [image] }, textOnly),
    /capacité vision/,
  );
  const empty: typeof fetch = async (input) =>
    Response.json(
      String(input).endsWith("/api/show")
        ? { capabilities: ["vision"] }
        : { message: { content: " " } },
    );
  await assert.rejects(
    () => describeAppearance({ model: "vision:4b", images: [image] }, empty),
    /exploitable/,
  );
});
test("vision indisponible : erreur explicite sans inventer de description", async () => {
  const failing: typeof fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(() => listVisionModels(failing), /inaccessible/);
  await assert.rejects(
    () => describeAppearance({ model: "vision:4b", images: [image] }, failing),
    /indisponible/,
  );
});
test("personnalité guidée : propositions contextualisées et choix mutuellement exclusifs", () => {
  const result = composePersonality({
    social: "reserved",
    trust: "progressive",
    affection: "gestures",
    conflict: "pause",
  });
  assert.match(result, /inconnus/);
  assert.match(result, /devient plus chaleureux en confiance/);
  assert.match(result, /puis revient parler/);
  assert.ok(!result.includes("Engage facilement la conversation"));
  assert.equal(
    composePersonality({ social: "reserved", trust: "progressive" }),
    composePersonality({ social: "reserved", trust: "progressive" }),
  );
  assert.throws(
    () => composePersonality({ social: "reserved" }),
    /au moins deux/,
  );
  assert.throws(
    () => composePersonality({ social: "invalide", trust: "progressive" }),
    /invalide/,
  );
});
