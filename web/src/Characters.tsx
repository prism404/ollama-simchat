import { Avatar, type AvatarCrop } from "./Avatar";
import { CharacterEvolution } from "./CharacterEvolution";
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
  avatarCrop?: AvatarCrop;
  version: number;
  lastMessage: string | null;
  lastSenderType: string | null;
  lastMessageAt: string | null;
  lastConversationId: number | null;
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
  const [mode, setMode] = useState<"list" | "edit" | "story" | "evolution">(
    "list",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Character | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [archives, setArchives] = useState<Character[] | null>(null);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Detail | null>(null);
  const gallery = useRef<GalleryHandle>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaDirty, setMediaDirty] = useState(false);
  const [personas, setPersonas] = useState<{ id: number; name: string }[]>([]);
  const [persona, setPersona] = useState("new");
  const [story, setStory] = useState({
    title: "",
    personaName: "",
    personaDescription: "",
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
    setPreview(null);
    try {
      const result = await request<Detail>(`/api/characters/${id}`);
      setDetail(result);
      setForm(result.form);
      setMode("edit");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
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
        personaDescription: "",
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
          <div className="character-chat-list">
            {characters.map((character) => (
              <article key={character.id} className="character-chat-row">
                <button
                  className="character-chat-open"
                  disabled={busy}
                  onClick={() =>
                    character.lastConversationId
                      ? void onStarted(character.lastConversationId).catch(
                          (e) => setError(e.message),
                        )
                      : void open(character.id)
                  }
                >
                  <Avatar
                    src={character.avatarUrl}
                    name={character.name}
                    crop={character.avatarCrop}
                    className="chat-list-avatar"
                  />
                  <span className="chat-list-text">
                    <span className="chat-list-name">{character.name}</span>
                    <span className="chat-list-preview">
                      {character.lastMessage
                        ? `${character.lastSenderType === "persona" ? "Toi : " : ""}${character.lastMessage}`
                        : character.lastConversationId
                          ? "Aucun message · Commencer à discuter"
                          : "Commencer sa première histoire"}
                    </span>
                  </span>
                </button>
                <div className="chat-list-actions">
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() => {
                      setRemoving(character);
                      setConfirmation("");
                    }}
                  >
                    Supprimer
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void open(character.id)}
                  >
                    Modifier la fiche
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      if (await open(character.id)) setMode("evolution");
                    }}
                  >
                    Évolution
                  </button>
                </div>
              </article>
            ))}
          </div>
          {removing && (
            <section
              className="memory-card"
              role="region"
              aria-label="Confirmer la suppression"
            >
              <h3>Supprimer {removing.name} de mes personnages ?</h3>
              <p>
                Le personnage sera archivé et retiré de la liste. Ses fiches,
                images, histoires et souvenirs seront conservés. Tu pourras le
                restaurer depuis les archives.
              </p>
              <label className="character-field">
                Recopie son nom pour confirmer : {removing.name}
                <input
                  autoFocus
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  disabled={busy}
                />
              </label>
              <div className="actions">
                <button
                  disabled={busy || confirmation !== removing.name}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await request(`/api/characters/${removing.id}/archive`, {
                        confirmation,
                      });
                      setRemoving(null);
                      setArchives(null);
                      await load();
                      await onChanged?.();
                      setNotice(
                        "Personnage archivé. Ses données sont conservées.",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirmer la suppression
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setRemoving(null)}
                >
                  Annuler
                </button>
              </div>
            </section>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setArchives(
                  (
                    await request<{ characters: Character[] }>(
                      "/api/archived-characters",
                    )
                  ).characters,
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Voir les personnages archivés
          </button>
          {archives && (
            <section className="memory-card">
              <h3>Personnages archivés</h3>
              {!archives.length && <p>Aucun personnage archivé.</p>}
              {archives.map((item) => (
                <p key={item.id}>
                  {item.name}{" "}
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await request(`/api/characters/${item.id}/restore`, {
                          confirmation: item.name,
                        });
                        setArchives(archives.filter((a) => a.id !== item.id));
                        await load();
                        await onChanged?.();
                        setNotice("Personnage restauré.");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Restaurer {item.name}
                  </button>
                </p>
              ))}
            </section>
          )}
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
      ) : mode === "evolution" && detail ? (
        <CharacterEvolution
          id={detail.id}
          name={detail.form.name}
          onBack={() => {
            setMode("list");
            void load().catch((e) => setError(e.message));
          }}
        />
      ) : mode === "edit" ? (
        <>
          <button
            className="text-button"
            disabled={busy || mediaBusy}
            onClick={() => {
              setMode("list");
              void load().catch((e) => setError(e.message));
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
          {detail && (
            <button
              className="secondary"
              disabled={
                busy ||
                mediaBusy ||
                mediaDirty ||
                JSON.stringify(form) !== JSON.stringify(detail.form)
              }
              onClick={() => setMode("evolution")}
            >
              Voir son évolution
            </button>
          )}
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
            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}
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
                  {version.createdAt}{" "}
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || mediaBusy || mediaDirty}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        setPreview(
                          await request<Detail>(
                            `/api/characters/${detail.id}/versions/${version.version}`,
                          ),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Consulter la version {version.version}
                  </button>
                </p>
              ))}
            </details>
          )}
          {preview && detail && (
            <section className="memory-card" aria-label="Ancienne version">
              <h3>
                Version {preview.version} — {preview.form.name}
              </h3>
              <p>
                La restauration chargera cette version dans le formulaire.
                Enregistre ensuite la fiche pour créer une nouvelle version. Les
                images, l’avatar, les conversations et les bilans d’évolution
                restent séparés.
              </p>
              <dl>
                {Object.entries(preview.form)
                  .filter(
                    ([key]) =>
                      ![
                        "exampleSituation",
                        "exampleUser",
                        "exampleReply",
                      ].includes(key),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {
                          (
                            {
                              name: "Nom",
                              gender: "Genre",
                              pronouns: "Pronoms",
                              description: "Présentation",
                              appearance: "Apparence physique",
                              personality: "Personnalité",
                              values: "Valeurs",
                              motivations: "Motivations",
                              tone: "Ton",
                              humor: "Humour",
                              responseLength: "Longueur des réponses",
                              boundaries: "Limites",
                              examples: "Exemples de dialogue",
                            } as Record<string, string>
                          )[key]
                        }
                      </dt>
                      <dd className="preserve">
                        {Array.isArray(value)
                          ? value
                              .map(
                                (item, index) =>
                                  `Exemple ${index + 1}\nSituation : ${item.situation}\nPersona : ${item.user}\nPersonnage : ${item.reply}`,
                              )
                              .join("\n\n")
                          : value || "Non renseigné"}
                      </dd>
                    </div>
                  ))}
              </dl>
              <button
                type="button"
                disabled={busy || mediaBusy || mediaDirty}
                onClick={() => {
                  setForm(preview.form);
                  setNotice(
                    `Version ${preview.version} chargée dans le formulaire. Enregistre la fiche pour confirmer la restauration.`,
                  );
                  setPreview(null);
                }}
              >
                Restaurer cette version dans le formulaire
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setPreview(null)}
              >
                Fermer
              </button>
            </section>
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
                const { personaName, personaDescription, ...rest } = story;
                const result = await request<{ conversationId: number }>(
                  `/api/characters/${detail.id}/stories`,
                  {
                    ...rest,
                    ...(persona === "new"
                      ? { personaName, personaDescription }
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
              {persona === "new" && (
                <label className="character-field">
                  Description de ton persona
                  <textarea
                    rows={8}
                    maxLength={8000}
                    value={story.personaDescription}
                    placeholder="Identité, apparence, personnalité et passé connu de la personne que tu incarnes."
                    onChange={(e) =>
                      setStory({ ...story, personaDescription: e.target.value })
                    }
                  />
                </label>
              )}
              <p className="muted">
                Retrouve et complète tes fiches dans « Mes personas ». Les
                changements d’un persona s’appliqueront à ses prochaines
                conversations.
              </p>
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
