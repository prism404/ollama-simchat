import { useEffect, useState } from "react";
type Persona = {
  id: number;
  name: string;
  pronouns: string | null;
  description: string;
  isDefault: number;
};
const empty = { name: "", pronouns: "", description: "", isDefault: false };
export function Personas() {
  const [items, setItems] = useState<Persona[]>([]),
    [id, setId] = useState<number | null>(null),
    [form, setForm] = useState(empty),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/personas");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setItems(data.personas);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section>
      <h2>Mes personas</h2>
      <p>
        Ton persona est le personnage que tu incarnes. Sa description accompagne
        les conversations des histoires auxquelles tu l’associes. Le personnage
        IA ne décide pas de ses actes ou de ses pensées à ta place.
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
      <div className="actions">
        <button
          disabled={busy}
          onClick={() => {
            setId(null);
            setForm(empty);
            setNotice("");
          }}
        >
          Créer un persona
        </button>
      </div>
      <div className="persona-list">
        {items.map((item) => (
          <button
            className="secondary"
            disabled={busy}
            key={item.id}
            onClick={() => {
              setId(item.id);
              setForm({
                name: item.name,
                pronouns: item.pronouns ?? "",
                description: item.description,
                isDefault: !!item.isDefault,
              });
              setNotice("");
            }}
          >
            {item.name}
            {item.isDefault ? " · par défaut" : ""}
          </button>
        ))}
      </div>
      <form
        className="character-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const response = await fetch(
              id ? `/api/personas/${id}` : "/api/personas",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
              },
            );
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setId(result.id);
            await load();
            setNotice(
              "Persona enregistré. Tu peux le choisir en commençant une histoire. Les modifications s’appliquent aussi aux prochaines réponses de ses histoires existantes.",
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>{id ? "Modifier mon persona" : "Nouveau persona"}</legend>
          <label className="character-field">
            Nom du persona *
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="character-field">
            Pronoms (facultatif)
            <input
              maxLength={100}
              value={form.pronouns}
              onChange={(e) => setForm({ ...form, pronouns: e.target.value })}
            />
          </label>
          <label className="character-field">
            Qui incarnes-tu ?
            <textarea
              rows={12}
              maxLength={8000}
              placeholder="Identité et quotidien, apparence, personnalité, passé établi. Décris les faits connus ; les réactions et décisions pendant le jeu restent les tiennes."
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) =>
                setForm({ ...form, isDefault: e.target.checked })
              }
            />{" "}
            Utiliser ce persona par défaut pour les nouvelles histoires
          </label>
          <p className="muted">
            Modifier ce persona ne réécrit pas les messages déjà échangés. Son
            choix reste inchangé dans les histoires existantes.
          </p>
          <button disabled={!form.name.trim()}>
            {busy ? "Enregistrement…" : "Enregistrer mon persona"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
