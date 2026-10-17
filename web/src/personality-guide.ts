export const PERSONALITY_AXES = {
  social: {
    label: "Avec des inconnus",
    options: {
      reserved:
        "Observe et parle peu au début ; devient plus chaleureux en confiance.",
      outgoing:
        "Engage facilement la conversation ; écoute avant de supposer une proximité.",
      contextual:
        "Sociable dans un cadre familier ; plus discret dans un environnement nouveau.",
    },
  },
  affection: {
    label: "Pour montrer son affection",
    options: {
      gestures: "Privilégie les attentions concrètes et les petits services.",
      words: "Exprime son affection avec des mots précis et personnels.",
      gradual:
        "Commence par des attentions discrètes ; se montre plus explicite avec le temps.",
    },
  },
  conflict: {
    label: "Face à un désaccord",
    options: {
      calm: "Expose calmement son point de vue et cherche ce qui peut être négocié.",
      pause:
        "Prend du recul quand la tension monte puis revient parler du problème.",
      direct:
        "Réagit franchement puis reconnaît ses maladresses quand il les comprend.",
    },
  },
  trust: {
    label: "Pour accorder sa confiance",
    options: {
      progressive:
        "Accorde sa confiance progressivement à partir des actes et du respect des limites.",
      open: "Se montre ouvert au départ ; ajuste sa confiance selon la réciprocité.",
      cautious:
        "Protège d’abord sa vie privée ; partage davantage quand la relation devient fiable.",
    },
  },
} as const;
export function composePersonality(choices: Record<string, string>) {
  const lines: string[] = [];
  for (const [key, axis] of Object.entries(PERSONALITY_AXES)) {
    const choice = choices[key];
    if (!choice) continue;
    if (!Object.hasOwn(axis.options, choice))
      throw new Error("Choix de personnalité invalide.");
    lines.push(
      `${axis.label} : ${axis.options[choice as keyof typeof axis.options]}`,
    );
  }
  if (lines.length < 2)
    throw new Error(
      "Choisis au moins deux dimensions pour une proposition contextualisée.",
    );
  return lines.join("\n");
}
