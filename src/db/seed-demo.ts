import { openDatabase } from "./connection.ts";

const db = openDatabase();

try {
  db.exec("BEGIN IMMEDIATE");

  const persona = db
    .prepare(
      `
    INSERT INTO personas(name, pronouns, description, is_default)
    VALUES (?, ?, ?, 1)
  `,
    )
    .run("Mon persona", "elle", "Persona de démonstration à remplacer.");

  const character = db
    .prepare(
      `
    INSERT INTO characters(name, short_label, default_language, status)
    VALUES (?, ?, 'fr', 'draft')
  `,
    )
    .run("Personnage démo", "Démo");

  db.prepare(
    `
    INSERT INTO character_core_versions(
      character_id, version_number, personality_json, speech_style_json,
      immutable_facts_json, change_reason, review_status, reviewed_at
    ) VALUES (?, 1, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
  `,
  ).run(
    character.lastInsertRowid,
    JSON.stringify({ traits: ["réservée", "observatrice"], nuances: [] }),
    JSON.stringify({ register: "naturel", languages: ["fr", "en"] }),
    JSON.stringify([]),
    "Création initiale",
  );

  const story = db
    .prepare(
      `
    INSERT INTO stories(title, description, default_language)
    VALUES (?, ?, 'fr')
  `,
    )
    .run("Histoire démo", "Données de démonstration supprimables.");

  db.prepare(
    "INSERT INTO story_cast(story_id, character_id) VALUES (?, ?)",
  ).run(story.lastInsertRowid, character.lastInsertRowid);
  db.prepare(
    "INSERT INTO story_personas(story_id, persona_id) VALUES (?, ?)",
  ).run(story.lastInsertRowid, persona.lastInsertRowid);
  db.prepare(
    `
    INSERT INTO relationships(story_id, character_id, persona_id, current_label)
    VALUES (?, ?, ?, ?)
  `,
  ).run(
    story.lastInsertRowid,
    character.lastInsertRowid,
    persona.lastInsertRowid,
    "Première rencontre",
  );

  const conversation = db
    .prepare(
      `
    INSERT INTO conversations(story_id, title, status)
    VALUES (?, ?, 'active')
  `,
    )
    .run(story.lastInsertRowid, "Première conversation");

  db.prepare(
    `
    INSERT INTO scene_state_versions(
      story_id,
      version_number,
      source_conversation_id,
      location,
      present_character_ids_json,
      current_action,
      atmosphere,
      created_by
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, 'user')
  `,
  ).run(
    story.lastInsertRowid,
    conversation.lastInsertRowid,
    "Un café calme en début de soirée",
    JSON.stringify([Number(character.lastInsertRowid)]),
    "Les deux protagonistes viennent de s’installer à une table.",
    "Calme, légèrement complice",
  );

  db.prepare(
    `
    INSERT INTO character_dialogue_examples(
      character_id,
      core_version_id,
      situation_key,
      situation_description,
      user_message,
      ideal_response,
      response_strategy,
      anti_pattern,
      language,
      priority
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fr', 5)
  `,
  ).run(
    character.lastInsertRowid,
    null,
    "retard_sans_prevenir",
    "La personne arrive avec trente minutes de retard sans avoir prévenu.",
    "*J’arrive enfin et pose mon sac près de la table.* Désolée, je n’ai pas vu l’heure passer.",
    "*Je referme tranquillement mon carnet.* Trente minutes. J’espère au moins que tu as une histoire convaincante. Assieds-toi, je suis toujours là.",
    "Exprimer la contrariété avec retenue, puis montrer indirectement que sa présence compte.",
    "Ne pas employer un français théâtral, ne pas inventer un événement passé et ne pas déclarer directement ses sentiments.",
  );

  db.exec("COMMIT");
  console.log(` Données de démonstration créées.

  Persona ID      : ${persona.lastInsertRowid}
  Personnage ID   : ${character.lastInsertRowid}
  Histoire ID     : ${story.lastInsertRowid}
  Conversation ID : ${conversation.lastInsertRowid}`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
