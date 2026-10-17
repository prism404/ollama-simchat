import { useEffect, useState } from "react";
type Image = { id: number; name: string; url: string; isAvatar: number };
export function CharacterGallery({
  id,
  onChanged,
  referencePrompt,
}: {
  id: number;
  onChanged?: () => Promise<void>;
  referencePrompt: string;
}) {
  const [images, setImages] = useState<Image[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    const r = await fetch(`/api/characters/${id}/images`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    setImages(data.images);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id]);
  async function upload(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const file of Array.from(files)) {
        if (
          file.size > 5 * 1024 * 1024 ||
          !["image/png", "image/jpeg", "image/webp"].includes(file.type)
        )
          throw new Error(
            "PNG, JPEG ou WebP uniquement, 5 Mo maximum par image.",
          );
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () =>
            reject(new Error("Lecture de l’image impossible."));
          reader.readAsDataURL(file);
        });
        const r = await fetch(`/api/characters/${id}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, dataUrl }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
      }
      await load();
      setNotice("Images enregistrées.");
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function avatar(imageId: number) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/characters/${id}/avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await load();
      await onChanged?.();
      setNotice("Avatar mis à jour.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="gallery">
      <h3>Avatar et références visuelles</h3>
      <p className="muted">
        Jusqu’à 20 images locales. PNG, JPEG ou WebP, 5 Mo par image. Choisis un
        portrait comme avatar ; garde les autres comme références.
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
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <div className="reference-grid">
        {images.map((image) => (
          <figure key={image.id}>
            <a href={image.url} target="_blank" rel="noreferrer">
              <img src={image.url} alt={image.name} loading="lazy" />
            </a>
            <figcaption>{image.name}</figcaption>
            <button
              type="button"
              className="secondary"
              disabled={busy || !!image.isAvatar}
              onClick={() => void avatar(image.id)}
            >
              {image.isAvatar ? "Avatar actuel" : "Utiliser comme avatar"}
            </button>
          </figure>
        ))}
      </div>
      <details>
        <summary>Préparer une génération fidèle au personnage</summary>
        <p>
          Utilise un portrait de face et plusieurs vues cohérentes du même
          personnage comme références. Décris les traits stables dans «
          Apparence physique ». Selon le générateur, une référence d’identité ou
          un modèle personnalisé améliore la fidélité ; une graine identique ne
          garantit pas le même visage.
        </p>
        <p>
          La génération d’images n’est pas encore connectée ici. Les images ne
          sont pas envoyées automatiquement à Ollama ni à un service externe.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(referencePrompt);
              setNotice("Description visuelle copiée.");
            } catch {
              setError("Copie impossible ; sélectionne le texte ci-dessous.");
            }
          }}
        >
          Copier la description visuelle
        </button>
        <pre className="reference-prompt">{referencePrompt}</pre>
      </details>
    </section>
  );
}
