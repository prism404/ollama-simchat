import { Avatar, type AvatarCrop } from "./Avatar";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
type Image = {
  avatarCrop: string;
  id: number;
  name: string;
  url: string;
  isAvatar: number;
};
type Pending = { key: string; name: string; dataUrl: string };
export type GalleryHandle = { flush: (profileId: number) => Promise<void> };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Action impossible.");
  return result;
}
async function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture de l’image impossible."));
    reader.readAsDataURL(file);
  });
}
async function visionImage(url: string): Promise<string> {
  const image = new window.Image();
  image.src = url;
  await image.decode();
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Préparation de l’image impossible.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
export const CharacterGallery = forwardRef<
  GalleryHandle,
  {
    id?: number;
    entity?: "character" | "persona";
    disabled?: boolean;
    onChanged?: () => Promise<void>;
    onWorking?: (value: boolean) => void;
    onPendingChange?: (value: boolean) => void;
    onAppearance: (text: string) => void;
  }
>(function CharacterGallery(
  {
    id,
    entity = "character",
    disabled = false,
    onChanged,
    onWorking,
    onPendingChange,
    onAppearance,
  },
  ref,
) {
  const collection = entity === "persona" ? "personas" : "characters";
  const label = entity === "persona" ? "persona" : "personnage";
  const [images, setImages] = useState<Image[]>([]),
    [pending, setPending] = useState<Pending[]>([]),
    [choice, setChoice] = useState("");
  const [crop, setCrop] = useState<AvatarCrop>({ x: 50, y: 50, zoom: 1 });
  const cropRef = useRef<AvatarCrop>({ x: 50, y: 50, zoom: 1 });
  function changeCrop(next: AvatarCrop, key: string) {
    cropRef.current = next;
    setCrop(next);
    updateChoice(key);
  }
  const pendingRef = useRef<Pending[]>([]),
    choiceRef = useRef("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [models, setModels] = useState<string[]>([]),
    [model, setModel] = useState(""),
    [visionError, setVisionError] = useState("");
  const locked = disabled || busy;
  function working(value: boolean) {
    setBusy(value);
    onWorking?.(value);
  }
  function updatePending(value: Pending[]) {
    pendingRef.current = value;
    setPending(value);
    onPendingChange?.(value.length > 0 || !!choiceRef.current);
  }
  function updateChoice(value: string) {
    choiceRef.current = value;
    setChoice(value);
    onPendingChange?.(pendingRef.current.length > 0 || !!value);
  }
  async function load(characterId: number) {
    const data = await api<{ images: Image[] }>(
      `/api/${collection}/${characterId}/images`,
    );
    setImages(data.images);
    if (!choiceRef.current) {
      const current = data.images.find((image) => image.isAvatar);
      const next = current?.avatarCrop
        ? JSON.parse(current.avatarCrop)
        : { x: 50, y: 50, zoom: 1 };
      cropRef.current = next;
      setCrop(next);
    }
    setSelected((previous) =>
      previous.length
        ? previous
        : [...data.images.slice(0, 10).map((image) => `stored:${image.id}`)],
    );
  }
  async function detect() {
    setVisionError("");
    try {
      const data = await api<{ models: string[]; unchecked: string[] }>(
        "/api/vision/models",
      );
      setModels(data.models);
      setModel((previous) =>
        data.models.includes(previous) ? previous : (data.models[0] ?? ""),
      );
      if (!data.models.length)
        setVisionError(
          data.unchecked.length
            ? "Certaines capacités n’ont pas pu être vérifiées. Réessaie avec Ollama à jour."
            : "Aucun modèle vision détecté. Installe un modèle compatible avec les images dans Ollama puis actualise la liste.",
        );
    } catch (e) {
      setVisionError((e as Error).message);
    }
  }
  useEffect(() => {
    if (id !== undefined) void load(id).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    void detect();
  }, []);
  async function add(files: FileList | null) {
    if (!files) return;
    working(true);
    setError("");
    setNotice("");
    try {
      const batch = Array.from(files);
      if (images.length + pendingRef.current.length + batch.length > 20)
        throw new Error(
          `Maximum 20 références par ${label} ; tu peux en ajouter une dizaine à la fois.`,
        );
      const next: Pending[] = [];
      for (const file of batch) {
        if (
          file.size > 5 * 1024 * 1024 ||
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.name.length > 150
        )
          throw new Error(
            "PNG, JPEG ou WebP uniquement, 5 Mo par image et nom de 150 caractères maximum.",
          );
        next.push({
          key: crypto.randomUUID(),
          name: file.name,
          dataUrl: await readFile(file),
        });
      }
      updatePending([...pendingRef.current, ...next]);
      setSelected((previous) =>
        [...previous, ...next.map((image) => `pending:${image.key}`)].slice(
          0,
          10,
        ),
      );
      setNotice("Images prêtes. Enregistre la fiche pour les conserver.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      working(false);
    }
  }
  async function flush(characterId: number) {
    working(true);
    setError("");
    try {
      for (const entry of [...pendingRef.current]) {
        const result = await api<{ id: number; url: string }>(
          `/api/${collection}/${characterId}/images`,
          { name: entry.name, dataUrl: entry.dataUrl },
        );
        if (choiceRef.current === `pending:${entry.key}`)
          updateChoice(`stored:${result.id}`);
        setSelected((previous) =>
          previous.map((key) =>
            key === `pending:${entry.key}` ? `stored:${result.id}` : key,
          ),
        );
        updatePending(
          pendingRef.current.filter((image) => image.key !== entry.key),
        );
      }
      if (choiceRef.current.startsWith("stored:"))
        await api(`/api/${collection}/${characterId}/avatar`, {
          imageId: Number(choiceRef.current.slice(7)),
          crop: cropRef.current,
        });
      updateChoice("");
      await load(characterId);
      await onChanged?.();
      setNotice("Images et avatar enregistrés.");
    } catch (e) {
      await load(characterId).catch(() => {});
      setError((e as Error).message);
      throw e;
    } finally {
      working(false);
    }
  }
  useImperativeHandle(ref, () => ({ flush }));
  const entries = [
    ...images.map((image) => ({
      key: `stored:${image.id}`,
      name: image.name,
      url: image.url,
      isAvatar: !!image.isAvatar,
    })),
    ...pending.map((image) => ({
      key: `pending:${image.key}`,
      name: image.name,
      url: image.dataUrl,
      isAvatar: false,
    })),
  ];
  async function analyze() {
    working(true);
    setError("");
    setNotice(
      "Analyse visuelle en cours ; cela peut prendre plusieurs minutes.",
    );
    try {
      const references = entries.filter((image) =>
        selected.includes(image.key),
      );
      if (!references.length || references.length > 10)
        throw new Error("Sélectionne entre 1 et 10 références.");
      const prepared = [];
      for (const image of references)
        prepared.push(await visionImage(image.url));
      const data = await api<{ description: string }>(
        "/api/vision/appearance",
        { model, images: prepared },
      );
      onAppearance(data.description);
      setNotice(
        "Apparence physique remplie. Relis-la dans Présentation, puis enregistre la fiche pour la conserver.",
      );
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
    } finally {
      working(false);
    }
  }
  return (
    <section className="gallery integrated-gallery">
      <h3>Images du {label} et avatar</h3>
      <p className="muted">
        Ajoute une dizaine d’images dès maintenant, même avant le premier
        enregistrement. Jusqu’à 20 références conservées, 5 Mo par image. Coche
        jusqu’à 10 vues cohérentes pour décrire l’apparence.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <label className="character-field">
        Ajouter des images
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          disabled={locked}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <div className="reference-grid">
        {entries.map((image) => (
          <figure key={image.key}>
            <img src={image.url} alt={image.name} loading="lazy" />
            <figcaption>
              {image.name}
              {image.key.startsWith("pending:") && " · à enregistrer"}
            </figcaption>
            <label className="reference-choice">
              <input
                type="checkbox"
                checked={selected.includes(image.key)}
                disabled={
                  locked ||
                  (!selected.includes(image.key) && selected.length >= 10)
                }
                onChange={(e) =>
                  setSelected((previous) =>
                    e.target.checked
                      ? [...previous, image.key]
                      : previous.filter((key) => key !== image.key),
                  )
                }
              />
              Pour l’apparence
            </label>
            <button
              type="button"
              className="secondary"
              disabled={locked}
              onClick={() =>
                changeCrop(
                  image.isAvatar ? crop : { x: 50, y: 50, zoom: 1 },
                  image.key,
                )
              }
            >
              {choice === image.key
                ? "Avatar choisi · à enregistrer"
                : !choice && image.isAvatar
                  ? "Avatar actuel"
                  : "Choisir comme avatar"}
            </button>
            {image.key.startsWith("pending:") && (
              <button
                type="button"
                className="text-button"
                disabled={locked}
                onClick={() => {
                  updatePending(
                    pendingRef.current.filter(
                      (entry) => `pending:${entry.key}` !== image.key,
                    ),
                  );
                  setSelected((previous) =>
                    previous.filter((key) => key !== image.key),
                  );
                  if (choiceRef.current === image.key) updateChoice("");
                }}
              >
                Retirer cet ajout
              </button>
            )}
          </figure>
        ))}
      </div>
      {(() => {
        const chosen = entries.find((image) =>
          choice ? image.key === choice : image.isAvatar,
        );
        return chosen ? (
          <section className="avatar-editor">
            <h3>Cadrer l’avatar</h3>
            <p>
              Place le visage dans le cadre. Ces réglages seront conservés avec
              la fiche ; l’image originale reste intacte.
            </p>
            <Avatar
              src={chosen.url}
              name="l’aperçu"
              crop={crop}
              className="avatar-preview"
            />
            {(
              [
                ["x", "Position horizontale", 0, 100, 1],
                ["y", "Position verticale", 0, 100, 1],
                ["zoom", "Zoom", 1, 3, 0.05],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label className="character-field" key={key}>
                {label}
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={crop[key]}
                  disabled={locked}
                  onChange={(e) =>
                    changeCrop(
                      { ...crop, [key]: Number(e.target.value) },
                      chosen.key,
                    )
                  }
                />
              </label>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={locked}
              onClick={() => changeCrop({ x: 50, y: 50, zoom: 1 }, chosen.key)}
            >
              Réinitialiser le cadrage
            </button>
          </section>
        ) : null;
      })()}
      <div className="vision-tools">
        <h3>Décrire l’apparence depuis les images</h3>
        <p className="muted">
          L’analyse utilise ton serveur Ollama configuré (local par défaut). La
          description reste à valider ; elle ne déduit pas la personnalité
          depuis le visage. L’image avatar est un choix séparé.
        </p>
        <label className="character-field">
          Modèle vision
          <select
            aria-label="Modèle vision"
            value={model}
            disabled={locked || !models.length}
            onChange={(e) => setModel(e.target.value)}
          >
            {!models.length && (
              <option value="">Aucun modèle disponible</option>
            )}
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {visionError && <p className="muted">{visionError}</p>}
        <div className="actions">
          <button
            type="button"
            disabled={locked || !model || !selected.length}
            onClick={() => void analyze()}
          >
            Proposer une description ({selected.length} image(s))
          </button>
          <button
            type="button"
            className="text-button"
            disabled={locked}
            onClick={() => void detect()}
          >
            Actualiser les modèles
          </button>
        </div>
      </div>
    </section>
  );
});
