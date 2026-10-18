import { CHARACTER_TEMPLATE } from "./character-template";
import { PersonalityGuide } from "./PersonalityGuide";
import { CharacterGallery, type GalleryHandle } from "./CharacterGallery";
import { useEffect, useState, useRef } from "react";

type Form = {
  gender: string;
  appearance: string;
  examples: { situation: string; user: string; reply: string }[];
  name: string;
  pronouns: string;
  description: string;
  personality: string;
  values: string;
  motivations: string;
  tone: string;
  humor: string;
  responseLength: string;
  boundaries: string;
  exampleSituation: string;
  exampleUser: string;
  exampleReply: string;
};
type Character = {
  id: number;
  name: string;
  description: string;
  avatarUrl?: string | null;
  version: number;
};
type Detail = {
  id: number;
  version: number;
  form: Form;
  versions: { version: number; name: string; createdAt: string }[];
};
const blank: Form = {
  gender: "",
  appearance: "",
  examples: [],
  name: "",
  pronouns: "",
  description: CHARACTER_TEMPLATE,
  personality: "",
  values: "",
  motivations: "",
  tone: "Naturel et contemporain",
  humor: "Sarcasme léger",
  responseLength: "1 à 3 phrases",
  boundaries: "",
  exampleSituation: "",
  exampleUser: "",
  exampleReply: "",
};
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Action impossible.");
  return data;
}

export function Characters({
  onStarted,
  initialCharacterId = null,
  onChanged,
}: {
  initialCharacterId?: number | null;
  onChanged?: () => Promise<void>;
  onStarted: (id: number) => Promise<void>;
}) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [mode, setMode] = useState<"list" | "edit" | "story">("list");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const gallery = useRef<GalleryHandle>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaDirty, setMediaDirty] = useState(false);
  const [personas, setPersonas] = useState<{ id: number; name: string }[]>([]);
  const [persona, setPersona] = useState("new");
  const [story, setStory] = useState({
    title: "",
    personaName: "",
    relationship: "Première rencontre",
    initialContext: "",
    location: "",
    scene: "",
  });
  async function load() {
    const data = await request<{ characters: Character[] }>("/api/characters");
    setCharacters(data.characters);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (initialCharacterId !== null) void open(initialCharacterId);
  }, [initialCharacterId]);
  function update(key: Exclude<keyof Form, "examples">, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  async function open(id: number) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<Detail>(`/api/characters/${id}`);
      setDetail(result);
      setForm(result.form);
      setMode("edit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepareStory(character: Detail) {
    setBusy(true);
    setError("");
    try {
      const data = await request<{ personas: { id: number; name: string }[] }>(
        "/api/personas",
      );
      setPersonas(data.personas);
      setPersona(data.personas[0] ? String(data.personas[0].id) : "new");
      setStory({
        title: `Une histoire avec ${character.form.name}`,
        personaName: "",
        relationship: "Première rencontre",
        initialContext: "",
        location: "",
        scene: "",
      });
      setDetail(character);
      setMode("story");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (busy || mediaBusy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ id: number }>(
        detail ? `/api/characters/${detail.id}` : "/api/characters",
        form,
      );
      const saved = await request<Detail>(`/api/characters/${result.id}`);
      setDetail(saved);
      setForm(saved.form);
      try {
        await gallery.current?.flush(result.id);
      } catch (error) {
        setError(
          `La fiche est enregistrée. Certaines images ou l’avatar restent à enregistrer : ${(error as Error).message}`,
        );
        await load();
        await onChanged?.();
        return;
      }
      await load();
      await onChanged?.();
      setNotice(`Fiche enregistrée · version ${saved.version}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: Exclude<keyof Form, "examples">,
    label: string,
    placeholder = "",
    rows = 3,
  ) => (
    <label className="character-field">
      {label}
      <textarea
        rows={rows}
        value={form[key]}
        placeholder={placeholder}
        disabled={busy}
        maxLength={8000}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );
  return (
    <section className="character-panel">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {mode === "list" ? (
        <>
          <div className="memory-heading">
            <p>Une personnalité, une voix, une histoire à inventer.</p>
            <button
              disabled={busy}
              onClick={() => {
                setDetail(null);
                setForm({ ...blank });
                setNotice("");
                setError("");
                setMode("edit");
              }}
            >
              + Créer un personnage
            </button>
          </div>
          <div className="character-grid">
            {characters.map((character) => (
              <article key={character.id} className="memory-card">
                <span className="badge">Version {character.version}</span>
                <h2>
                  {character.avatarUrl && (
                    <img
                      className="person-avatar"
                      src={character.avatarUrl}
                      alt=""
                    />
                  )}{" "}
                  {character.name}
                </h2>
                <p className="preserve">
                  {character.description ||
                    "Une fiche à découvrir et à préciser."}
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void open(character.id)}
                >
                  Ouvrir la fiche
                </button>
              </article>
            ))}
          </div>
          {!characters.length && (
            <div className="empty">
              <span className="empty-symbol">◇</span>
              <h2>Qui aimerais-tu rencontrer ?</h2>
              <p>
                Crée ton premier personnage. Aucun modèle IA n’est nécessaire
                pour rédiger sa fiche.
              </p>
            </div>
          )}
        </>
      ) : mode === "edit" ? (
        <>
          <button
            className="text-button"
            disabled={busy || mediaBusy}
            onClick={() => {
              setMode("list");
              setError("");
              setNotice("");
            }}
          >
            ← Tous les personnages
          </button>
          <h2>
            {detail
              ? `La fiche de ${detail.form.name}`
              : "Un nouveau personnage"}
          </h2>
          <p className="muted">
            Écris simplement ce qui compte. Tu pourras affiner sa fiche plus
            tard.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="character-form"
          >
            <fieldset disabled={busy}>
              <legend>01 · Présentation</legend>
              <div className="field-row">
                <label className="character-field">
                  Nom *
                  <input
                    required
                    maxLength={100}
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="Comment s’appelle le personnage ?"
                  />
                </label>
                <label className="character-field">
                  Genre
                  <select
                    aria-label="Genre"
                    value={form.gender}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        gender: e.target.value,
                        pronouns:
                          e.target.value === "homme"
                            ? "il"
                            : e.target.value === "femme"
                              ? "elle"
                              : form.pronouns,
                      });
                    }}
                  >
                    <option value="">Choisir…</option>
                    <option value="homme">Homme</option>
                    <option value="femme">Femme</option>
                  </select>
                </label>
              </div>
              {field(
                "description",
                "En quelques mots",
                "Son identité, son quotidien, ce qui le rend unique.",
                20,
              )}
              <p className="muted">
                Remplace les indications entre crochets par des faits concrets.
                Laisse indéterminé ce que tu ne souhaites pas définir. Ce modèle
                guide la création ; il ne garantit pas à lui seul le réalisme du
                modèle IA.
              </p>
              {field(
                "appearance",
                "Apparence physique",
                "Âge apparent adulte, forme du visage, yeux, cheveux, silhouette, signes distinctifs et vêtements habituels. Sépare les traits stables de la tenue de la scène.",
                10,
              )}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Images et apparence</legend>
              <CharacterGallery
                ref={gallery}
                id={detail?.id}
                disabled={busy}
                onWorking={setMediaBusy}
                onPendingChange={setMediaDirty}
                onAppearance={(text) => update("appearance", text)}
                onChanged={onChanged}
                referencePrompt={`PERSONNAGE : ${form.name}
GENRE : ${form.gender || "non défini"}
TRAITS VISUELS STABLES : ${form.appearance || "à préciser"}
SCÈNE : [décrire le lieu, l’action, la tenue et l’éclairage]
Conserver l’identité et les traits des images de référence. Adapter la scène sans changer le visage.`}
              />
            </fieldset>
            <fieldset disabled={busy}>
              <legend>02 · Personnalité</legend>
              <PersonalityGuide
                disabled={busy || mediaBusy}
                onApply={(text) => update("personality", text)}
              />

              {field(
                "personality",
                "Traits de caractère",
                "Réservée, observatrice, attentionnée… Un trait par ligne ou séparé par une virgule.",
              )}
              {field(
                "values",
                "Valeurs",
                "Exemple : loyauté — tient ses engagements même quand cela devient inconfortable. Choisis 2 ou 3 valeurs et montre comment elles influencent ses décisions.",
              )}
              {field(
                "motivations",
                "Motivations",
                `Objectif concret : …
Pourquoi cela compte : …
Obstacle ou hésitation : …
Ce qui peut le faire évoluer : …`,
              )}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>03 · Sa façon de parler</legend>
              {field("tone", "Ton", "Naturel, direct, doux…", 2)}
              <div className="field-row">
                {field("humor", "Humour", "Sarcasme léger", 2)}
                {field(
                  "responseLength",
                  "Longueur des réponses",
                  "1 à 3 phrases",
                  2,
                )}
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>04 · Limites</legend>
              {field(
                "boundaries",
                "Ses limites et refus",
                "Ce qu’il ne ferait pas ou ne dirait pas.",
              )}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>05 · Exemples de dialogue</legend>
              <p className="muted">
                Varie les situations : humour, désaccord, affection, moment
                ordinaire. Chaque exemple reste fictif. Jusqu’à 12 exemples
                conservés ; les 3 premiers servent au prompt pour limiter son
                poids.
              </p>
              {form.examples.map((example, index) => (
                <div className="dialogue-example" key={index}>
                  <div className="memory-top">
                    <h3>Exemple {index + 1}</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setForm({
                          ...form,
                          examples: form.examples.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Retirer l’exemple {index + 1}
                    </button>
                  </div>
                  {(
                    [
                      ["situation", "Situation"],
                      ["user", "Message du persona"],
                      ["reply", "Réponse idéale du personnage"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="character-field" key={key}>
                      {label} {index + 1}
                      <textarea
                        required
                        maxLength={2000}
                        rows={3}
                        value={example[key]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            examples: form.examples.map((old, i) =>
                              i === index
                                ? { ...old, [key]: e.target.value }
                                : old,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
              <button
                type="button"
                className="secondary"
                disabled={form.examples.length >= 12}
                onClick={() =>
                  setForm({
                    ...form,
                    examples: [
                      ...form.examples,
                      { situation: "", user: "", reply: "" },
                    ],
                  })
                }
              >
                + Ajouter un exemple
              </button>
            </fieldset>
            <div className="actions">
              <button disabled={busy || mediaBusy || !form.name.trim()}>
                {busy ? "Enregistrement…" : "Enregistrer la fiche"}
              </button>
              {detail && (
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    busy ||
                    mediaBusy ||
                    mediaDirty ||
                    JSON.stringify(form) !== JSON.stringify(detail.form)
                  }
                  onClick={() => void prepareStory(detail)}
                >
                  Commencer une histoire
                </button>
              )}
            </div>
            <p className="muted">
              Chaque enregistrement valide une nouvelle version. L’ancienne
              fiche est conservée. Enregistre tes modifications avant de
              commencer l’histoire.
            </p>
          </form>
          {detail && (
            <details>
              <summary>Versions conservées ({detail.versions.length})</summary>
              {detail.versions.map((version) => (
                <p key={version.version}>
                  Version {version.version} · {version.name} ·{" "}
                  {version.createdAt}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setMode("edit")}
          >
            ← Revenir à la fiche
          </button>
          <h2>Une histoire avec {detail?.form.name}</h2>
          <p className="muted">
            La relation et la scène sont propres à cette histoire. Elles ne
            changent pas sa fiche permanente.
          </p>
          <form
            className="character-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!detail) return;
              setBusy(true);
              setError("");
              try {
                const { personaName, ...rest } = story;
                const result = await request<{ conversationId: number }>(
                  `/api/characters/${detail.id}/stories`,
                  {
                    ...rest,
                    ...(persona === "new"
                      ? { personaName }
                      : { personaId: Number(persona) }),
                  },
                );
                await onStarted(result.conversationId);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <legend>Le point de départ</legend>
              <label className="character-field">
                Titre de l’histoire *
                <input
                  required
                  maxLength={200}
                  value={story.title}
                  onChange={(e) =>
                    setStory({ ...story, title: e.target.value })
                  }
                />
              </label>
              <label className="character-field">
                Ton persona
                <select
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                >
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="new">Créer un persona</option>
                </select>
              </label>
              {persona === "new" && (
                <label className="character-field">
                  Nom de ton persona *
                  <input
                    required
                    maxLength={100}
                    value={story.personaName}
                    onChange={(e) =>
                      setStory({ ...story, personaName: e.target.value })
                    }
                  />
                </label>
              )}
              {(
                [
                  [
                    "relationship",
                    "Relation initiale",
                    "Amis, inconnus, collègues…",
                  ],
                  [
                    "initialContext",
                    "Leur histoire avant cette rencontre",
                    "Ce qu’ils savent déjà l’un de l’autre.",
                  ],
                  ["location", "Lieu de départ", "Où commence la scène ?"],
                  [
                    "scene",
                    "Première scène",
                    "Que se passe-t-il au moment où la conversation commence ?",
                  ],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label className="character-field" key={key}>
                  {label}
                  <textarea
                    rows={3}
                    maxLength={8000}
                    placeholder={placeholder}
                    value={story[key]}
                    onChange={(e) =>
                      setStory({ ...story, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </fieldset>
            <button
              disabled={
                busy ||
                !story.title.trim() ||
                (persona === "new" && !story.personaName.trim())
              }
            >
              {busy
                ? "Ouverture…"
                : "Créer l’histoire et ouvrir la conversation"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
