import { Characters } from "./Characters";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Conversation = {
  id: number;
  title: string;
  storyTitle: string;
  characterId: number | null;
  characterName: string | null;
  status: string;
};
type Message = { id: number; senderType: string; content: string };
type Memory = {
  id: number;
  title: string;
  content: string;
  status: string;
  importance: number;
  sources: { messageId: number; content: string }[];
  reviews: {
    id: number;
    decision: string;
    previousTitle: string;
    previousContent: string;
    resultingContent: string;
    reason: string;
  }[];
};
type Health = { ollama: { connected: boolean; models: string[] } };
const statusLabel: Record<string, string> = {
  pending: "À valider",
  accepted: "Accepté",
  corrected: "Corrigé",
  rejected: "Refusé",
  superseded: "Remplacé",
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "La requête a échoué.");
  return data;
}
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

function ArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M6 18 18 6M6 6h12v12" />
    </svg>
  );
}

function MemoryCard({
  memory,
  disabled,
  onReview,
}: {
  memory: Memory;
  disabled: boolean;
  onReview: (id: number, body: unknown) => Promise<void>;
}) {
  const [mode, setMode] = useState<"correct" | "reject" | null>(null);
  const [title, setTitle] = useState(memory.title);
  const [content, setContent] = useState(memory.content);
  const [reason, setReason] = useState("");
  return (
    <article className="memory-card">
      <div className="memory-top">
        <span className={`badge ${memory.status}`}>
          {statusLabel[memory.status] ?? memory.status}
        </span>
        <span className="muted">Importance {memory.importance}/5</span>
      </div>
      <h3>{memory.title}</h3>
      <p className="preserve">{memory.content}</p>
      <details>
        <summary>{memory.sources.length} message(s) source(s)</summary>
        {memory.sources.map((source) => (
          <blockquote key={source.messageId}>
            <small>Message {source.messageId}</small>
            <p className="preserve">{source.content}</p>
          </blockquote>
        ))}
      </details>
      {memory.reviews.length > 0 && (
        <details>
          <summary>Historique des décisions</summary>
          {memory.reviews.map((review) => (
            <blockquote key={review.id}>
              <strong>
                {review.decision === "accepted"
                  ? "Accepté"
                  : review.decision === "corrected"
                    ? "Corrigé"
                    : "Refusé"}
              </strong>
              <p className="preserve">
                Texte original : {review.previousContent}
              </p>
              {review.decision === "corrected" && (
                <p className="preserve">
                  Texte corrigé : {review.resultingContent}
                </p>
              )}
              {review.reason && <p>Motif : {review.reason}</p>}
            </blockquote>
          ))}
        </details>
      )}
      {memory.status === "pending" && !mode && (
        <div className="actions">
          <button
            disabled={disabled}
            onClick={() => void onReview(memory.id, { decision: "accept" })}
          >
            Accepter
          </button>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => setMode("correct")}
          >
            Corriger
          </button>
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => setMode("reject")}
          >
            Refuser
          </button>
        </div>
      )}
      {mode && (
        <form
          className="review-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await onReview(
              memory.id,
              mode === "correct"
                ? { decision: mode, title, content, reason }
                : { decision: mode, reason },
            );
          }}
        >
          {mode === "correct" && (
            <>
              <label>
                Titre
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={disabled}
                />
              </label>
              <label>
                Souvenir corrigé
                <textarea
                  required
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  disabled={disabled}
                />
              </label>
            </>
          )}
          <label>
            Motif
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={disabled}
            />
          </label>
          <div className="actions">
            <button
              disabled={
                disabled ||
                !reason.trim() ||
                (mode === "correct" && (!title.trim() || !content.trim()))
              }
            >
              {mode === "correct"
                ? "Valider la correction"
                : "Confirmer le refus"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => setMode(null)}
            >
              Annuler
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [characters, setCharacters] = useState<{ id: number; name: string }[]>(
    [],
  );
  const [selectedCharacter, setSelectedCharacter] = useState<number | null>(
    null,
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"chat" | "memories" | "characters">(
    "characters",
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState("pending");
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const current = conversations.find((c) => c.id === selected);
  const characterStories = conversations.filter(
    (c) => c.characterId === selectedCharacter,
  );
  const characterName =
    characters.find((c) => c.id === selectedCharacter)?.name ??
    current?.characterName;
  function chooseCharacter(id: number) {
    const stories = conversations.filter((c) => c.characterId === id);
    setSelectedCharacter(id);
    const next =
      stories.find((c) => c.status === "active")?.id ?? stories[0]?.id ?? null;
    if (next !== selected) {
      setMessages([]);
      setMemories([]);
      setDraft("");
      setLoading(next !== null);
    }
    setSelected(next);
    setTab(stories.length ? "chat" : "characters");
    setError("");
    setNotice("");
  }
  async function refreshCharacters() {
    const data = await api<{ characters: { id: number; name: string }[] }>(
      "/api/characters",
    );
    setCharacters(data.characters);
  }
  const pending = memories.filter((m) => m.status === "pending").length;
  const locked = !!busy || loading;
  async function checkHealth() {
    try {
      setHealth(await api<Health>("/api/health"));
    } catch {
      setHealth(null);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api<{ conversations: Conversation[] }>("/api/conversations", {
        signal: controller.signal,
      }),
      api<{ characters: { id: number; name: string }[] }>("/api/characters", {
        signal: controller.signal,
      }),
    ])
      .then(([data, people]) => {
        if (controller.signal.aborted) return;
        setConversations(data.conversations);
        setCharacters(people.characters);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            `API inaccessible. Vérifie que npm start est lancé. ${e.message}`,
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void checkHealth();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (selected === null) {
      setMessages([]);
      setMemories([]);
      setDraft("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNotice("");
    setDraft("");
    setMessages([]);
    setMemories([]);
    void Promise.all([
      api<{ messages: Message[] }>(`/api/conversations/${selected}/messages`, {
        signal: controller.signal,
      }),
      api<{ memories: Memory[] }>(`/api/conversations/${selected}/memories`, {
        signal: controller.signal,
      }),
    ])
      .then(([history, stored]) => {
        if (controller.signal.aborted) return;
        setMessages(history.messages);
        setMemories(stored.memories);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected]);
  useEffect(() => {
    end.current?.scrollIntoView({
      block: "end",
      behavior: busy ? "instant" : "smooth",
    });
  }, [messages, tab]);
  async function refreshMemories() {
    const data = await api<{ memories: Memory[] }>(
      `/api/conversations/${selected}/memories`,
    );
    setMemories(data.memories);
  }
  async function send() {
    if (locked || !draft.trim() || selected === null) return;
    const text = draft.trim();
    setDraft("");
    setError("");
    setNotice("");
    setBusy("Le personnage réfléchit…");
    const replyId = -Date.now();
    setMessages((previous) => [
      ...previous,
      { id: replyId - 1, senderType: "persona", content: text },
      { id: replyId, senderType: "character", content: "" },
    ]);
    try {
      const response = await fetch(
        `/api/conversations/${selected}/messages`,
        post({ message: text }),
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Génération impossible.");
      }
      if (!response.body) throw new Error("Réponse vide du serveur.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setBusy("Réponse en cours…");
          setMessages((previous) =>
            previous.map((m) =>
              m.id === replyId ? { ...m, content: m.content + chunk } : m,
            ),
          );
        }
        const tail = decoder.decode();
        if (tail)
          setMessages((previous) =>
            previous.map((m) =>
              m.id === replyId ? { ...m, content: m.content + tail } : m,
            ),
          );
      } finally {
        reader.releaseLock();
      }
      const history = await api<{ messages: Message[] }>(
        `/api/conversations/${selected}/messages`,
      );
      setMessages(history.messages);
    } catch (e) {
      setError(
        `${(e as Error).message} Vérifie Ollama avant de réessayer. Le message peut déjà avoir été enregistré.`,
      );
      setDraft(text);
      try {
        const history = await api<{ messages: Message[] }>(
          `/api/conversations/${selected}/messages`,
        );
        setMessages(history.messages);
      } catch {
        setNotice(
          "Historique indisponible. Actualise la page avant de renvoyer le message.",
        );
      }
    } finally {
      setBusy("");
    }
  }
  async function propose() {
    if (locked || selected === null) return;
    setBusy("Recherche de souvenirs… Cela peut prendre plusieurs minutes.");
    setError("");
    setNotice("");
    try {
      const result = await api<{
        createdCount: number;
        duplicateCount: number;
      }>(`/api/conversations/${selected}/memories/propose`, post({}));
      await refreshMemories();
      setFilter("pending");
      setNotice(
        `${result.createdCount} proposition(s) créée(s) · ${result.duplicateCount} déjà connue(s).`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function review(id: number, body: unknown) {
    if (locked) return;
    setBusy("Enregistrement de la décision…");
    setError("");
    setNotice("");
    try {
      await api(`/api/memories/${id}/review`, post(body));
      await refreshMemories();
      setNotice("Décision enregistrée. L’historique est conservé.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand wordmark" href="/" aria-label="SimChat, accueil">
          simchat
        </a>
        <nav aria-label="Personnages" className="character-navigation">
          <button
            className={
              tab === "characters" && selectedCharacter === null
                ? "nav-item active"
                : "nav-item"
            }
            disabled={!!busy}
            onClick={() => {
              setSelectedCharacter(null);
              setTab("characters");
              setError("");
              setNotice("");
            }}
          >
            Tous les personnages
          </button>
          <div className="sidebar-heading">MES PERSONNAGES</div>
          {characters.map((character) => (
            <button
              key={character.id}
              className={
                selectedCharacter === character.id
                  ? "person-link selected"
                  : "person-link"
              }
              disabled={locked}
              onClick={() => chooseCharacter(character.id)}
            >
              <span className="person-initial" aria-hidden="true">
                {character.name.slice(0, 1).toLocaleUpperCase("fr")}
              </span>
              <span>{character.name}</span>
            </button>
          ))}
          {!characters.length && !loading && (
            <p className="sidebar-empty">
              Crée ton premier personnage pour commencer.
            </p>
          )}
        </nav>
        {selectedCharacter !== null && characterStories.length > 0 && (
          <div className="character-tools">
            {characterStories.length > 1 && (
              <label className="conversation-picker">
                HISTOIRE
                <select
                  aria-label="Histoire de ce personnage"
                  value={selected ?? ""}
                  disabled={locked}
                  onChange={(e) => {
                    setMessages([]);
                    setMemories([]);
                    setDraft("");
                    setLoading(true);
                    setSelected(Number(e.target.value));
                    setTab("chat");
                  }}
                >
                  {characterStories.map((story) => (
                    <option key={story.id} value={story.id}>
                      {story.storyTitle}
                      {story.status !== "active" ? " · archivée" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="text-button"
              disabled={locked}
              onClick={() => setTab(tab === "memories" ? "chat" : "memories")}
            >
              {tab === "memories"
                ? "← Revenir aux échanges"
                : `Souvenirs à valider (${pending})`}
            </button>
            <button
              className="text-button"
              disabled={locked}
              onClick={() => setTab("characters")}
            >
              Fiche du personnage / Nouvelle histoire
            </button>
          </div>
        )}
        <div className="connection">
          <div>
            <span
              className={`dot ${health?.ollama.connected ? "online" : ""}`}
            />
            {health?.ollama.connected
              ? "Ollama connecté"
              : health
                ? "Ollama déconnecté"
                : "API à vérifier"}
          </div>
          <p>
            {health?.ollama.connected
              ? `${health.ollama.models.length} modèle(s) disponible(s)`
              : "Démarre l’API et Ollama pour discuter."}
          </p>
          <button className="text-button" onClick={() => void checkHealth()}>
            Vérifier la connexion ↻
          </button>
        </div>
        <div className="local-note">
          LOCAL & PERSONNEL
          <br />
          <span>Tes histoires, sur ton ordinateur.</span>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">
              {tab === "characters"
                ? "PERSONNAGES"
                : current?.storyTitle || "TON ESPACE"}
            </span>
            <h1>
              {tab === "chat"
                ? characterName || "Choisis un personnage"
                : tab === "characters"
                  ? "Les personnages"
                  : "Les souvenirs"}
            </h1>
          </div>
        </header>
        <div className="feedback" aria-live="polite">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && <div className="notice">{notice}</div>}
          {busy && (
            <div className="working">
              <span className="pulse" />
              {busy}
            </div>
          )}
        </div>
        {tab === "characters" ? (
          <Characters
            key={selectedCharacter ?? "directory"}
            initialCharacterId={selectedCharacter}
            onChanged={refreshCharacters}
            onStarted={async (id) => {
              const data = await api<{ conversations: Conversation[] }>(
                "/api/conversations",
              );
              setConversations(data.conversations);
              setSelected(id);
              setSelectedCharacter(
                data.conversations.find((c) => c.id === id)?.characterId ??
                  null,
              );
              await refreshCharacters();
              setTab("chat");
            }}
          />
        ) : !selected ? (
          <section className="empty">
            <span className="empty-symbol">◇</span>
            <h2>
              {loading
                ? "Ouverture de ton espace…"
                : "Tout commence par une histoire"}
            </h2>
            <p>
              {error
                ? "Relance l’API puis actualise cette page."
                : "Aucune conversation pour le moment. Choisis un personnage à gauche pour retrouver ses échanges ou créer une histoire."}
            </p>
          </section>
        ) : tab === "chat" ? (
          <>
            <section
              className="messages"
              aria-label="Historique de conversation"
              aria-busy={!!busy}
            >
              {!messages.length && (
                <div className="empty">
                  <span className="empty-symbol">↗</span>
                  <h2>
                    {loading ? "Chargement…" : "Le premier mot est à toi"}
                  </h2>
                  <p>Un bonjour, une question, le début d’une scène.</p>
                </div>
              )}
              {messages.map((m) => (
                <article key={m.id} className={`message ${m.senderType}`}>
                  <div className="sender">
                    {m.senderType === "persona"
                      ? "TOI"
                      : m.senderType === "character"
                        ? "PERSONNAGE"
                        : "NARRATION"}
                  </div>
                  <div className="bubble">{m.content || "…"}</div>
                </article>
              ))}
              <div ref={end} />
            </section>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="message">
                Ton message
              </label>
              <textarea
                id="message"
                placeholder="Écris ton message…"
                value={draft}
                rows={3}
                disabled={locked || current?.status !== "active"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bottom">
                <small>
                  {current?.status !== "active"
                    ? "Cette conversation est en lecture seule."
                    : "Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne"}
                </small>
                <button
                  disabled={
                    locked || !draft.trim() || current?.status !== "active"
                  }
                >
                  Envoyer{" "}
                  <span aria-hidden="true">
                    <ArrowIcon />
                  </span>
                </button>
              </div>
            </form>
            <p className="footer-note">
              Les souvenirs proposés ne deviennent fiables qu’après ta
              validation.
            </p>
          </>
        ) : (
          <section className="memory-panel">
            <div className="memory-heading">
              <p>
                Relis ce que le personnage pourrait retenir.
                <br />
                Accepte, affine ou laisse de côté.
              </p>
              <button disabled={locked} onClick={() => void propose()}>
                + Chercher des souvenirs
              </button>
            </div>
            <label className="filter-label">
              Afficher
              <select
                value={filter}
                disabled={locked}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="pending">À valider ({pending})</option>
                <option value="all">Tous les souvenirs</option>
                <option value="accepted">Acceptés</option>
                <option value="corrected">Corrigés</option>
                <option value="rejected">Refusés</option>
              </select>
            </label>
            {memories
              .filter((m) => filter === "all" || m.status === filter)
              .map((m) => (
                <MemoryCard
                  key={`${m.id}-${m.status}`}
                  memory={m}
                  disabled={locked}
                  onReview={review}
                />
              ))}
            {!loading &&
              !memories.some(
                (m) => filter === "all" || m.status === filter,
              ) && (
                <div className="empty">
                  <span className="empty-symbol">◇</span>
                  <h2>Rien à relire pour l’instant</h2>
                  <p>
                    Lance une recherche après quelques échanges. Il est aussi
                    normal qu’aucun souvenir durable ne soit proposé.
                  </p>
                </div>
              )}
          </section>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
