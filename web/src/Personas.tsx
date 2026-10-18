import { useEffect, useState } from "react";
import { PersonalityGuide } from "./PersonalityGuide";
import {
  PERSONA_FIELDS,
  PERSONA_PROFILE_LIMIT,
  emptyPersonaProfile,
  readPersonaProfile,
  type PersonaProfile,
} from "../../src/persona/persona-profile";
type Persona = {
  id: number;
  name: string;
  pronouns: string | null;
  description: string;
  isDefault: number;
  profile?: PersonaProfile;
};
type Form = {
  name: string;
  pronouns: string;
  description: string;
  isDefault: boolean;
  profile: PersonaProfile;
};
const blank = (): Form => ({
  name: "",
  pronouns: "",
  description: "",
  isDefault: false,
  profile: emptyPersonaProfile(),
});
const sections = [
  {
    id: "identity",
    title: "01 · Présentation",
    help: "Le socle de ton persona. Conserve ici les faits stables ; laisse vide ce que tu n’as pas encore défini.",
  },
  {
    id: "timeline",
    title: "02 · Passé et présent",
    help: "Sépare ce qui l’a construit de sa situation actuelle. Cette fiche accompagne toutes ses histoires : leurs relations et scènes particulières se définissent au début de chaque histoire.",
  },
  {
    id: "personality",
    title: "03 · Personnalité et vie intérieure",
    help: "Décris des comportements selon la situation plutôt qu’une liste d’adjectifs. Tes réactions pendant le jeu restent libres.",
  },
  {
    id: "relationships",
    title: "04 · Relations et limites",
    help: "Ces repères aident le personnage à adapter son comportement sans présumer d’une intimité ni de ton accord.",
  },
  {
    id: "details",
    title: "05 · Voix et détails vivants",
    help: "Quelques détails concrets suffisent pour donner de la présence à ton persona.",
  },
  {
    id: "knowledge",
    title: "06 · Ce que les autres peuvent savoir",
    help: "Le dossier sert de repère de cohérence au modèle. Il ne signifie pas que le personnage sait déjà tout de ton persona.",
  },
] as const;
export function Personas() {
  const [items, setItems] = useState<Persona[]>([]),
    [id, setId] = useState<number | null>(null),
    [form, setForm] = useState<Form>(blank),
    [baseline, setBaseline] = useState(() => JSON.stringify(blank())),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const dirty = JSON.stringify(form) !== baseline;
  const profileLength = Object.values(form.profile).join("").length;
  async function load() {
    const response = await fetch("/api/personas");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setItems(data.personas);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function choose(item?: Persona) {
    if (
      dirty &&
      !window.confirm(
        "Abandonner les modifications non enregistrées de ce persona ?",
      )
    )
      return;
    const next = item
      ? {
          name: item.name,
          pronouns: item.pronouns ?? "",
          description: item.description,
          isDefault: !!item.isDefault,
          profile: readPersonaProfile(item.profile),
        }
      : blank();
    setId(item?.id ?? null);
    setForm(next);
    setBaseline(JSON.stringify(next));
    setNotice("");
    setError("");
  }
  function profileField(key: keyof PersonaProfile, value: string) {
    setForm((previous) => ({
      ...previous,
      profile: { ...previous.profile, [key]: value },
    }));
  }
  return (
    <section>
      <h2>La personne que tu incarnes</h2>
      <p>
        Une fiche aussi nuancée que celle du personnage : son passé, sa vie
        actuelle et sa manière d’être. L’IA s’appuie sur ces repères pour
        s’adapter ; elle ne joue pas ton rôle à ta place. Seul le nom est
        obligatoire.
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
        <button disabled={busy} onClick={() => choose()}>
          Créer un persona
        </button>
      </div>
      <div className="persona-list">
        {items.map((item) => (
          <button
            className={id === item.id ? "persona-selected" : "secondary"}
            aria-pressed={id === item.id}
            disabled={busy}
            key={item.id}
            onClick={() => choose(item)}
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
          if (busy) return;
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
            const saved = {
              ...form,
              name: form.name.trim(),
              pronouns: form.pronouns.trim(),
              description: form.description.trim(),
              profile: Object.fromEntries(
                Object.entries(form.profile).map(([key, value]) => [
                  key,
                  value.trim(),
                ]),
              ) as PersonaProfile,
            };
            setId(result.id);
            setForm(saved);
            setBaseline(JSON.stringify(saved));
            setNotice(
              "Persona enregistré. Sa fiche détaillée accompagnera les prochains échanges des histoires qui l’utilisent.",
            );
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {sections.map((section) => (
          <fieldset disabled={busy} key={section.id}>
            <legend>{section.title}</legend>
            <p className="muted">{section.help}</p>
            {section.id === "identity" && (
              <>
                <div className="guide-grid">
                  <label className="character-field">
                    Nom du persona *
                    <input
                      required
                      maxLength={100}
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </label>
                  <label className="character-field">
                    Genre
                    <select
                      aria-label="Genre"
                      value={form.profile.gender}
                      onChange={(e) => {
                        const gender = e.target.value;
                        setForm((previous) => ({
                          ...previous,
                          pronouns:
                            gender === "homme"
                              ? "il"
                              : gender === "femme"
                                ? "elle"
                                : previous.pronouns,
                          profile: { ...previous.profile, gender },
                        }));
                      }}
                    >
                      <option value="">Non précisé</option>
                      <option value="homme">Homme</option>
                      <option value="femme">Femme</option>
                    </select>
                  </label>
                </div>
                <label className="character-field">
                  Présentation générale
                  <textarea
                    aria-label="Présentation générale"
                    rows={5}
                    maxLength={8000}
                    value={form.description}
                    placeholder="L’essentiel de son identité en quelques phrases. Les détails ont leurs champs ci-dessous ; ton ancienne description est conservée ici."
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </label>
                <label className="character-field">
                  Pronoms (facultatif)
                  <input
                    maxLength={100}
                    value={form.pronouns}
                    onChange={(e) =>
                      setForm({ ...form, pronouns: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            {section.id === "personality" && (
              <PersonalityGuide
                key={id ?? "new"}
                disabled={busy}
                onApply={(text) => profileField("personality", text)}
              />
            )}
            {PERSONA_FIELDS.filter((field) => field.section === section.id).map(
              (field) => (
                <label className="character-field" key={field.key}>
                  {field.label}
                  <span className="muted field-guidance">{field.hint}</span>
                  <textarea
                    aria-label={field.label}
                    rows={
                      field.key === "past" || field.key === "present" ? 7 : 5
                    }
                    maxLength={8000}
                    value={form.profile[field.key]}
                    onChange={(e) => profileField(field.key, e.target.value)}
                  />
                </label>
              ),
            )}
          </fieldset>
        ))}
        <fieldset disabled={busy}>
          <legend>Enregistrer mon persona</legend>
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
            Fiche détaillée : {profileLength.toLocaleString("fr-FR")} /{" "}
            {PERSONA_PROFILE_LIMIT.toLocaleString("fr-FR")} caractères. Évite
            les répétitions : la fiche est envoyée au modèle avec celle du
            personnage et les échanges récents.
          </p>
          <p className="muted">
            Modifier ce persona concerne les prochains échanges de toutes ses
            histoires. Les messages déjà envoyés et le persona associé à chaque
            histoire restent conservés. Les données privées ne doivent pas être
            traitées comme connues du personnage.
          </p>
          <button
            disabled={
              busy || !form.name.trim() || profileLength > PERSONA_PROFILE_LIMIT
            }
          >
            {busy ? "Enregistrement…" : "Enregistrer mon persona"}
          </button>
          {dirty && <p className="muted">Modifications non enregistrées.</p>}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
        </fieldset>
      </form>
    </section>
  );
}
