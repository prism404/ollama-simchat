// Shared form metadata and validation; no database or browser dependencies.
export const PERSONA_FIELDS = [
  {
    key: "dailyLife",
    section: "identity",
    label: "Identité et quotidien",
    hint: "Âge, activité, lieu de vie, responsabilités et entourage. Décris uniquement ce qui est établi.",
  },
  {
    key: "appearance",
    section: "identity",
    label: "Apparence physique",
    hint: "Silhouette, visage, yeux, cheveux et signes distinctifs. Sépare les traits stables des vêtements et accessoires du moment.",
  },
  {
    key: "past",
    section: "timeline",
    label: "Passé établi",
    hint: "Deux ou trois expériences marquantes et leurs conséquences. Distingue les faits connus des zones encore indéterminées ; aucun passé partagé ne doit être inventé.",
  },
  {
    key: "present",
    section: "timeline",
    label: "Situation présente",
    hint: "Où en est ton persona au début de l’histoire ? Situation professionnelle, préoccupations, obligations et changements récents. Pour une scène précise, utilise le contexte de l’histoire.",
  },
  {
    key: "personality",
    section: "personality",
    label: "Personnalité en action",
    hint: "Deux ou trois traits illustrés par des comportements concrets. Précise ce qui change en confiance ou sous tension ; une contradiction doit avoir un contexte.",
  },
  {
    key: "values",
    section: "personality",
    label: "Valeurs et convictions",
    hint: "Ce qui compte vraiment, ce qui peut être négocié et ce que défendre ces principes peut lui coûter.",
  },
  {
    key: "motivations",
    section: "personality",
    label: "Motivations et objectifs",
    hint: "Un désir à court terme, un objectif à long terme, leurs raisons et leurs obstacles. Ce sont des tendances, pas des décisions imposées.",
  },
  {
    key: "fears",
    section: "personality",
    label: "Fragilités et contradictions",
    hint: "Doutes, sujets sensibles, défauts et réactions possibles selon la situation. Une peur n’autorise pas l’IA à décider de la réaction du persona.",
  },
  {
    key: "relationships",
    section: "relationships",
    label: "Rapport aux autres",
    hint: "Façon d’écouter, d’exprimer l’affection, de construire la confiance et de gérer un désaccord. Réserve les liens propres à un personnage au contexte de son histoire.",
  },
  {
    key: "boundaries",
    section: "relationships",
    label: "Limites et besoins",
    hint: "Ce que ton persona refuse, ses besoins d’autonomie, ce qui demande son accord et ce qui l’aide à se sentir respecté.",
  },
  {
    key: "speech",
    section: "details",
    label: "Voix et manière de s’exprimer",
    hint: "Vocabulaire, rythme, humour, silences et gestes occasionnels. Ce repère aide l’autre personnage à répondre ; l’IA ne doit pas écrire tes répliques.",
  },
  {
    key: "habits",
    section: "details",
    label: "Détails vivants",
    hint: "Goûts, centres d’intérêt, habitudes, petites maladresses et détails du quotidien. Évite de répéter les mêmes gestes à chaque échange.",
  },
  {
    key: "sharedKnowledge",
    section: "knowledge",
    label: "Ce qui peut être connu des autres",
    hint: "Informations publiques ou déjà révélées. Une information n’est connue du personnage que si sa présence, le contexte ou les échanges le justifient.",
  },
  {
    key: "privateInfo",
    section: "knowledge",
    label: "Ce qui reste privé ou à découvrir",
    hint: "Informations réservées à la cohérence du récit. Le personnage ne les connaît pas automatiquement et ne doit pas les deviner sans indice ni révélation de ta part.",
  },
] as const;
export type PersonaField = (typeof PERSONA_FIELDS)[number]["key"];
export type PersonaProfile = Record<PersonaField, string> & { gender: string };
export const PERSONA_PROFILE_LIMIT = 16000;
export function emptyPersonaProfile(): PersonaProfile {
  return Object.fromEntries([
    ...[...PERSONA_FIELDS].map((field) => [field.key, ""]),
    ["gender", ""],
  ]) as PersonaProfile;
}
export function readPersonaProfile(value: unknown): PersonaProfile {
  const profile = emptyPersonaProfile();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return profile;
  for (const key of Object.keys(profile) as (keyof PersonaProfile)[]) {
    const text = (value as Record<string, unknown>)[key];
    if (typeof text === "string") profile[key] = text;
  }
  return profile;
}
export function validatePersonaProfile(value: unknown): PersonaProfile {
  const allowed = Object.keys(emptyPersonaProfile());
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error("Champs de fiche persona invalides.");
  for (const text of Object.values(value))
    if (typeof text !== "string" || text.length > 8000)
      throw new Error(
        "Chaque champ du persona doit être un texte de 8 000 caractères maximum.",
      );
  const profile = readPersonaProfile(value);
  for (const key of Object.keys(profile) as (keyof PersonaProfile)[])
    profile[key] = profile[key].trim();
  if (!["", "homme", "femme"].includes(profile.gender))
    throw new Error("Genre du persona invalide.");
  if (Object.values(profile).join("").length > PERSONA_PROFILE_LIMIT)
    throw new Error("La fiche détaillée du persona dépasse 16 000 caractères.");
  return profile;
}
export function personaProfileText(profile: PersonaProfile) {
  return [
    profile.gender ? `Genre : ${profile.gender}` : "",
    ...PERSONA_FIELDS.filter((field) => profile[field.key].trim()).map(
      (field) => `${field.label} :\n${profile[field.key]}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}
