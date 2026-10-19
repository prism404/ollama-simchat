import { useEffect, useState } from "react";
import { Avatar, type AvatarCrop } from "./Avatar";
type Setup = {
  title: string;
  relationship: string;
  initialContext: string;
  location: string;
  scene: string;
};
type Current = {
  location: string;
  scene: string;
  atmosphere: string;
  summary: string;
};
type Version<T> = {
  version: number;
  createdAt: string;
  form: T;
  reason?: string;
};
type Data = {
  storyId: number;
  characterName: string;
  personaName: string;
  personaAvatarUrl: string | null;
  personaAvatarCrop: AvatarCrop;
  initial: Version<Setup> | null;
  current: Version<Current> | null;
  initialVersions: Version<Setup>[];
  currentVersions: Version<Current>[];
};
const emptySetup: Setup = {
  title: "",
  relationship: "",
  initialContext: "",
  location: "",
  scene: "",
};
const emptyCurrent: Current = {
  location: "",
  scene: "",
  atmosphere: "",
  summary: "",
};
async function request(path: string, body?: unknown) {
  const response = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
export function StoryEditor({
  conversationId,
  onBack,
  onChanged,
}: {
  conversationId: number;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [setup, setSetup] = useState<Setup>(emptySetup),
    [current, setCurrent] = useState<Current>(emptyCurrent),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const path = `/api/conversations/${conversationId}/story`;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setData(null);
    void request(path)
      .then((next) => {
        if (active) {
          setData(next);
          setSetup(next.initial?.form ?? emptySetup);
          setCurrent(next.current?.form ?? emptyCurrent);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path]);
  const dirty =
    !!data &&
    (JSON.stringify(setup) !==
      JSON.stringify(data.initial?.form ?? emptySetup) ||
      JSON.stringify(current) !==
        JSON.stringify(data.current?.form ?? emptyCurrent));
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(section: "setup" | "current") {
    if (busy || !data) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(path, {
        section,
        expectedVersion:
          (section === "setup" ? data.initial : data.current)?.version ?? 0,
        ...(section === "setup" ? setup : current),
      });
      const next = await request(path);
      setData(next);
      if (section === "setup") setSetup(next.initial.form);
      else setCurrent(next.current.form);
      await onChanged();
      setNotice(
        section === "setup"
          ? "Point de départ enregistré. Les anciens messages et le suivi actuel restent conservés."
          : "Suivi actuel enregistré. Le récapitulatif accompagnera les prochaines réponses.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function leave() {
    if (
      !dirty ||
      window.confirm(
        "Quitter cette histoire sans enregistrer les modifications ?",
      )
    )
      onBack();
  }
  return (
    <section>
      <button className="text-button" disabled={busy} onClick={leave}>
        ← Revenir à la conversation
      </button>
      <h2>Histoire et continuité</h2>
      <p>
        Tu peux poursuivre cette même histoire aussi longtemps que tu le
        souhaites. Le point de départ reste distinct de ce qui se passe
        maintenant.
      </p>
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
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          if (
            dirty &&
            !window.confirm(
              "Actualiser et abandonner les modifications non enregistrées ?",
            )
          )
            return;
          setBusy(true);
          setError("");
          try {
            const next = await request(path);
            setData(next);
            setSetup(next.initial?.form ?? emptySetup);
            setCurrent(next.current?.form ?? emptyCurrent);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Actualiser l’histoire
      </button>
      {data && (
        <>
          <div className="story-participants">
            <Avatar
              src={data.personaAvatarUrl}
              name={data.personaName}
              crop={data.personaAvatarCrop}
              className="persona-list-avatar"
            />
            <span>
              {data.characterName} · {data.personaName}
            </span>
          </div>
          <form
            className="character-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save("setup");
            }}
          >
            <fieldset disabled={busy}>
              <legend>Point de départ</legend>
              <p className="muted">
                Corrige le contexte initial sans recommencer la conversation. Le
                persona associé reste le même. Une nouvelle version est
                conservée à chaque enregistrement.
              </p>
              {(
                [
                  ["title", "Titre de l’histoire"],
                  ["relationship", "Relation initiale"],
                  ["initialContext", "Leur histoire avant cette rencontre"],
                  ["location", "Lieu de départ"],
                  ["scene", "Première scène"],
                ] as const
              ).map(([key, label]) => (
                <label className="character-field" key={key}>
                  {label}
                  {key === "title" ? (
                    <input
                      aria-label={label}
                      required
                      maxLength={200}
                      value={setup[key]}
                      onChange={(e) =>
                        setSetup({ ...setup, [key]: e.target.value })
                      }
                    />
                  ) : (
                    <textarea
                      aria-label={label}
                      rows={key === "initialContext" ? 8 : 4}
                      maxLength={8000}
                      value={setup[key]}
                      onChange={(e) =>
                        setSetup({ ...setup, [key]: e.target.value })
                      }
                    />
                  )}
                </label>
              ))}
              <button disabled={busy || !setup.title.trim()}>
                Enregistrer le point de départ
              </button>
            </fieldset>
          </form>
          <details>
            <summary>
              Historique du point de départ ({data.initialVersions.length})
            </summary>
            {data.initialVersions.map((item) => (
              <details className="memory-card" key={item.version}>
                <summary>
                  Version {item.version} · {item.createdAt}
                </summary>
                {Object.entries(item.form).map(([key, value]) => (
                  <p className="preserve" key={key}>
                    <strong>
                      {
                        (
                          {
                            title: "Titre",
                            relationship: "Relation initiale",
                            initialContext: "Passé commun",
                            location: "Lieu de départ",
                            scene: "Première scène",
                          } as Record<string, string>
                        )[key]
                      }
                    </strong>
                    <br />
                    {value || "Non renseigné"}
                  </p>
                ))}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setSetup(item.form);
                    setNotice(
                      `Version ${item.version} chargée dans le brouillon du point de départ. Enregistre pour confirmer la restauration.`,
                    );
                  }}
                >
                  Recharger le point de départ version {item.version}
                </button>
              </details>
            ))}
          </details>
          <form
            className="character-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save("current");
            }}
          >
            <fieldset disabled={busy}>
              <legend>Où en est l’histoire maintenant ?</legend>
              <p className="muted">
                À mettre à jour aux moments importants, pas après chaque
                message. Ce suivi concerne cette histoire ; les bilans de
                personnalité restent dans Évolution.
              </p>
              {(
                [
                  ["location", "Lieu actuel"],
                  ["scene", "Situation en cours"],
                  ["atmosphere", "Atmosphère"],
                  ["summary", "Récapitulatif de continuité"],
                ] as const
              ).map(([key, label]) => (
                <label className="character-field" key={key}>
                  {label}
                  <textarea
                    aria-label={label}
                    rows={key === "summary" ? 10 : 4}
                    maxLength={8000}
                    value={current[key]}
                    placeholder={
                      key === "summary"
                        ? "Faits importants déjà joués, décisions, promesses, changements de relation et questions encore ouvertes. Ne transforme pas une supposition en fait."
                        : undefined
                    }
                    onChange={(e) =>
                      setCurrent({ ...current, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <p className="muted">
                Le modèle reçoit les 12 derniers messages, une sélection de
                souvenirs validés et ce récapitulatif enregistré. L’archive
                complète reste consultable, mais n’est pas envoyée à chaque
                réponse. Le récapitulatif est rédigé et validé par toi ; aucune
                synthèse automatique n’est lancée ici.
              </p>
              <button disabled={busy}>Enregistrer le suivi actuel</button>
            </fieldset>
          </form>
          <details>
            <summary>
              Historique du suivi ({data.currentVersions.length})
            </summary>
            {data.currentVersions.map((item) => (
              <details className="memory-card" key={item.version}>
                <summary>
                  Version {item.version} · {item.createdAt}
                </summary>
                {Object.entries(item.form).map(([key, value]) => (
                  <p className="preserve" key={key}>
                    <strong>
                      {
                        (
                          {
                            location: "Lieu actuel",
                            scene: "Situation",
                            atmosphere: "Atmosphère",
                            summary: "Récapitulatif",
                          } as Record<string, string>
                        )[key]
                      }
                    </strong>
                    <br />
                    {value || "Non renseigné"}
                  </p>
                ))}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setCurrent(item.form);
                    setNotice(
                      `Version ${item.version} chargée dans le brouillon du suivi. Enregistre pour confirmer.`,
                    );
                  }}
                >
                  Recharger le suivi version {item.version}
                </button>
              </details>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
export function CharacterStories({
  characterId,
  onOpen,
  disabled = false,
}: {
  disabled?: boolean;
  characterId: number;
  onOpen: (id: number) => void;
}) {
  const [items, setItems] = useState<
      { id: number; characterId: number; storyTitle: string }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void request("/api/conversations")
      .then((data) => {
        if (active)
          setItems(
            data.conversations.filter(
              (item: { characterId: number }) =>
                item.characterId === characterId,
            ),
          );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [characterId]);
  return (
    <section className="memory-card">
      <h3>Histoires de ce personnage</h3>
      {error && <p role="alert">{error}</p>}
      {items.length ? (
        items.map((item) => (
          <p key={item.id}>
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => onOpen(item.id)}
            >
              Histoire : {item.storyTitle}
            </button>
          </p>
        ))
      ) : (
        <p className="muted">
          Aucune histoire pour ce personnage. Le bouton « Commencer une histoire
          » crée un nouvel échange ; il ne modifie pas une histoire existante.
        </p>
      )}
    </section>
  );
}
