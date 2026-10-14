import assert from "node:assert/strict";
import { test } from "node:test";
import { validateMemoryEventDatetimes } from "./memory-extractor.ts";
import type { MemoryProposal } from "./memory-types.ts";

function validate(
  content: string,
  eventDatetime: string | null,
  memoryType: MemoryProposal["memoryType"] = "event",
) {
  const memory: MemoryProposal = {
    memoryType,
    scope: "persona",
    title: "Souvenir",
    content,
    keywords: [],
    eventDatetime,
    importance: 3,
    emotionalWeight: 0,
    confidence: 1,
    sourceMessageIds: [1],
  };
  const proposals = { memories: [memory] };
  const result = validateMemoryEventDatetimes(proposals, [
    { id: 1, content },
    { id: 2, content: "Nous sommes le 2026-10-14 à 14:30." },
  ]);
  assert.equal(proposals.memories[0].eventDatetime, eventDatetime);
  return result.memories[0].eventDatetime;
}

test("une préférence sans date perd la date inventée, même si un autre message est daté", () => {
  assert.equal(
    validate("Je déteste les endroits bruyants.", "2026-10-14", "preference"),
    null,
  );
});

test("une date explicitement écrite est conservée", () => {
  for (const date of ["2026-10-20", "20/10/2026", "20 octobre 2026"]) {
    assert.equal(
      validate(`Le rendez-vous est le ${date}.`, "2026-10-20"),
      "2026-10-20",
    );
  }
});

test("une date différente de celle des sources est refusée", () => {
  assert.equal(validate("Rendez-vous le 20 octobre 2026.", "2026-10-21"), null);
});

test("une expression vague ou relative ne devient pas une date ISO", () => {
  for (const expression of [
    "un jour",
    "plus tard",
    "la prochaine fois",
    "demain",
  ]) {
    assert.equal(validate(`On se reverra ${expression}.`, "2026-10-15"), null);
  }
});

test("une heure explicite ne permet pas d'inventer un jour, des secondes ou un fuseau", () => {
  assert.equal(validate("Rendez-vous à 14 h 30.", "14:30"), "14:30");
  assert.equal(validate("Rendez-vous à 14:30.", "2026-10-20T14:30"), null);
  assert.equal(
    validate("Rendez-vous le 2026-10-20.", "2026-10-20T14:30"),
    null,
  );
  assert.equal(
    validate("Le 2026-10-20 à 14:30.", "2026-10-20T14:30:00Z"),
    null,
  );
  assert.equal(
    validate("Le 2026-10-20 à 14:30.", "2026-10-20T14:30"),
    "2026-10-20T14:30",
  );
});

test("un timestamp explicitement écrit et null sont préservés", () => {
  const timestamp = "2026-10-20T14:30:00Z";
  assert.equal(validate(`Départ : ${timestamp}.`, timestamp), timestamp);
  assert.equal(validate("Rendez-vous le 2026-10-20.", null), null);
});
