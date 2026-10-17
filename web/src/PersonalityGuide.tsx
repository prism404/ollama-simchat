import { useState } from "react";
import { PERSONALITY_AXES, composePersonality } from "./personality-guide";
export function PersonalityGuide({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (text: string) => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({}),
    [proposal, setProposal] = useState("");
  return (
    <details className="personality-guide">
      <summary>Construire une personnalité guidée</summary>
      <p>
        Choisis une seule tendance par dimension. Les réactions sont décrites
        selon la situation : réserve et chaleur peuvent coexister à des moments
        différents. Ce guide local ne nécessite pas d’IA ; il ne vérifie pas
        automatiquement toutes les contradictions d’un texte libre.
      </p>
      <div className="guide-grid">
        {Object.entries(PERSONALITY_AXES).map(([key, axis]) => (
          <label className="character-field" key={key}>
            {axis.label}
            <select
              aria-label={axis.label}
              value={choices[key] ?? ""}
              disabled={disabled}
              onChange={(e) => {
                setChoices({ ...choices, [key]: e.target.value });
                setProposal("");
              }}
            >
              <option value="">Choisir une tendance…</option>
              {Object.entries(axis.options).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        disabled={disabled || Object.values(choices).filter(Boolean).length < 2}
        onClick={() => setProposal(composePersonality(choices))}
      >
        Préparer une proposition
      </button>
      {proposal && (
        <>
          <label className="character-field">
            Proposition de personnalité
            <textarea
              rows={7}
              maxLength={8000}
              disabled={disabled}
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={disabled || !proposal.trim()}
            onClick={() => onApply(proposal.trim())}
          >
            Remplacer les traits du brouillon
          </button>
        </>
      )}
      <p className="muted">
        Pour les valeurs : choisis deux ou trois principes, puis précise ce
        qu’ils coûtent au personnage quand ils sont mis à l’épreuve. Pour les
        motivations : indique un objectif concret, sa raison et un obstacle.
        Relis l’ensemble avec sa biographie avant d’enregistrer.
      </p>
    </details>
  );
}
