import { useEffect, useState } from "react";
type Snapshot = {
  id: number;
  version: number;
  summary: string;
  mood: { description?: string };
  goals: string[];
  relationship: { description?: string };
  lessons: string[];
  createdAt: string;
  reason: string;
};
type Data = {
  stories: { id: number; title: string }[];
  initial: { version: number; createdAt: string; identity: string } | null;
  selectedStoryId: number | null;
  current: Snapshot | null;
  states: Snapshot[];
  memories: {
    id: number;
    title: string;
    content: string;
    status: string;
    reviewedAt: string | null;
    createdAt: string;
    sourceCount: number;
  }[];
  activity: {
    messageCount: number;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
  } | null;
};
const date = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      });
};
export function CharacterEvolution({
  id,
  name,
  onBack,
}: {
  id: number;
  name: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [story, setStory] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    summary: "",
    mood: "",
    goals: "",
    relationship: "",
    lessons: "",
  });
  async function load(storyId: number, signal?: AbortSignal) {
    const response = await fetch(
      `/api/characters/${id}/evolution${storyId ? `?storyId=${storyId}` : ""}`,
      { signal },
    );
    const next = await response.json();
    if (!response.ok) throw new Error(next.error);
    if (signal?.aborted) return;
    setData(next);
    if (!storyId && next.stories.length) setStory(next.stories[0].id);
  }
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    setEditing(false);
    void load(story, controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [id, story]);
  function begin() {
    const current = data?.current;
    setForm({
      summary: current?.summary ?? "",
      mood: current?.mood.description ?? "",
      goals: current?.goals.join("\n") ?? "",
      relationship: current?.relationship.description ?? "",
      lessons: current?.lessons.join("\n") ?? "",
    });
    setEditing(true);
  }
  return (
    <section className="evolution-panel">
      <button className="text-button" disabled={busy} onClick={onBack}>
        ← Tous les personnages
      </button>
      <h2>L’évolution de {name}</h2>
      <p>
        Le socle reste conservé. Les échanges et souvenirs validés alimentent ce
        suivi à chaque actualisation ; un bilan décrit son état présent sans
        effacer ses versions précédentes.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {data?.stories.length ? (
        <>
          <label className="character-field">
            Histoire suivie
            <select
              aria-label="Histoire suivie"
              value={story}
              disabled={busy}
              onChange={(e) => setStory(Number(e.target.value))}
            >
              {data.stories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <div className="evolution-toolbar">
            <span>
              {data.activity?.messageCount ?? 0} messages · Dernier échange :{" "}
              {date(data.activity?.lastMessageAt)}
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await load(story);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Actualiser le suivi
            </button>
          </div>
          <article className="memory-card">
            <div className="memory-top">
              <h3>État présent validé</h3>
              <button className="secondary" disabled={busy} onClick={begin}>
                Décrire son évolution
              </button>
            </div>
            {data.current ? (
              <>
                <p className="preserve">{data.current.summary}</p>
                <dl>
                  <dt>Humeur</dt>
                  <dd>{data.current.mood.description || "Non définie"}</dd>
                  <dt>Objectifs</dt>
                  <dd>{data.current.goals.join(" · ") || "Non définis"}</dd>
                  <dt>Relation</dt>
                  <dd>
                    {data.current.relationship.description || "Non définie"}
                  </dd>
                  <dt>Leçons retenues</dt>
                  <dd>{data.current.lessons.join(" · ") || "Non définies"}</dd>
                </dl>
                <small>
                  Version {data.current.version} ·{" "}
                  {date(data.current.createdAt)}
                </small>
              </>
            ) : (
              <p>
                Aucun bilan enregistré pour cette histoire. Les souvenirs
                ci-dessous restent disponibles sans inventer de changement de
                personnalité.
              </p>
            )}
          </article>
          {editing && (
            <form
              className="character-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const response = await fetch(
                    `/api/characters/${id}/evolution`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ storyId: story, ...form }),
                    },
                  );
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  await load(story);
                  setEditing(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                <legend>Nouveau bilan validé</legend>
                <p className="muted">
                  Décris uniquement ce que les scènes établissent. Cet
                  enregistrement valide une nouvelle version utilisée dans les
                  prochaines réponses de cette histoire. Il ne modifie pas la
                  fiche de départ.
                </p>
                {(
                  [
                    ["summary", "Bilan de son évolution"],
                    ["mood", "Humeur actuelle"],
                    ["goals", "Objectifs actuels (un par ligne)"],
                    ["relationship", "État de la relation"],
                    ["lessons", "Leçons retenues (une par ligne)"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="character-field" key={key}>
                    {label}
                    <textarea
                      required={key === "summary"}
                      maxLength={key === "summary" ? 3000 : 2000}
                      rows={3}
                      value={form[key]}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <div className="actions">
                  <button disabled={busy || !form.summary.trim()}>
                    Valider ce bilan
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditing(false)}
                  >
                    Annuler
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          <h3>Ce qui a été retenu</h3>
          <p className="muted">
            Souvenirs acceptés ou corrigés, actifs et compatibles avec cette
            histoire. Un souvenir décrit un fait ; il ne prouve pas à lui seul
            une transformation du caractère.
          </p>
          {!data.memories.length && (
            <p className="muted">Aucun souvenir validé pour l’instant.</p>
          )}
          <div className="evolution-timeline">
            {data.memories.map((memory) => (
              <article key={memory.id}>
                <time>{date(memory.reviewedAt ?? memory.createdAt)}</time>
                <h3>{memory.title}</h3>
                <p className="preserve">{memory.content}</p>
                <small>
                  {memory.status === "corrected"
                    ? "Corrigé et validé"
                    : "Accepté"}{" "}
                  · {memory.sourceCount} source(s)
                </small>
              </article>
            ))}
          </div>
          <h3>Historique des bilans</h3>
          {!data.states.length && (
            <p className="muted">
              Les bilans que tu valideras apparaîtront ici.
            </p>
          )}
          {data.states.map((snapshot) => (
            <details key={snapshot.id}>
              <summary>
                Version {snapshot.version} · {date(snapshot.createdAt)}
              </summary>
              <p className="preserve">{snapshot.summary}</p>
              <p>Humeur : {snapshot.mood.description || "Non définie"}</p>
              <p>
                Relation : {snapshot.relationship.description || "Non définie"}
              </p>
              <p>Objectifs : {snapshot.goals.join(" · ") || "Non définis"}</p>
              <p>Leçons : {snapshot.lessons.join(" · ") || "Non définies"}</p>
            </details>
          ))}
        </>
      ) : (
        !busy && (
          <div className="empty">
            <h3>Son histoire reste à écrire</h3>
            <p>
              Commence une histoire depuis sa fiche pour suivre son évolution.
            </p>
          </div>
        )
      )}
      {data?.initial && (
        <p className="muted">
          Fiche initiale conservée : version {data.initial.version}, enregistrée
          le {date(data.initial.createdAt)}.
        </p>
      )}
      <p className="muted">
        Les dates sont celles des enregistrements. Le temps réel écoulé ne
        change pas automatiquement son âge ni le temps de l’histoire. Aucun
        second appel IA n’est ajouté après les messages.
      </p>
    </section>
  );
}
