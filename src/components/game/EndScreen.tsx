"use client";

// Écran de fin de partie (M3) : destination, score, historique en carrés,
// détail de l'itinéraire et texte de partage.

import { useState } from "react";
import type { PublicChallengeState, SegmentTrace } from "@/lib/game-types";
import { formatDuration } from "@/lib/format/duration";

const KIND_EMOJI: Record<string, string> = {
  rail: "🚆",
  urban: "🚇",
  air: "✈️",
  connection: "🚶",
  intercity_bus: "🚌",
};

export default function EndScreen({
  state,
  traces,
  onReplay,
  onClose,
  onReroll,
}: {
  state: PublicChallengeState;
  traces: SegmentTrace[];
  onReplay: () => void;
  /** Croix ✕ : masque l'écran pour voir l'itinéraire tracé sur la carte. */
  onClose: () => void;
  /** 🎲 Nouvel itinéraire de test (développement uniquement). */
  onReroll?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const won = state.status === "WON";
  const squares = state.guesses
    .map((g) => (g.correct ? "🟩" : "🟥"))
    .join("");
  const followsTracks = traces.some((t) => t.followsTracks);
  const shareText =
    "🧭 Destination Mystère " +
    state.date +
    " " +
    (squares || "—") +
    " " +
    state.score +
    " pts";

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // presse-papier indisponible : rien de bloquant
    }
  };

  return (
    <div className="dm-end-overlay" role="dialog" aria-modal="true">
      <div className="dm-end-card">
        <button
          className="dm-end-close"
          type="button"
          onClick={onClose}
          aria-label="Fermer l'écran de résultat et voir l'itinéraire sur la carte"
          title="Voir l'itinéraire sur la carte"
        >
          ✕
        </button>
        <h2>{won ? "🎉 Destination trouvée !" : "😵 C'était…"}</h2>
        <p className="dm-end-dest">
          {state.destination ? state.destination.name : "?"}{" "}
          {state.destination ? "(" + state.destination.country + ")" : ""}
        </p>
        <p className="dm-end-score">
          Score : <strong>{state.score}</strong> points ·{" "}
          {formatDuration(state.totalDurationMin)} de trajet au total
        </p>
        <p className="dm-squares" aria-label="Historique des essais">
          {squares}
        </p>

        <section className="dm-end-summary" aria-label="Récapitulatif des réponses">
          <h3>Récapitulatif des réponses</h3>
          {state.guesses.length === 0 ? (
            <p className="dm-hint-body">Aucune proposition.</p>
          ) : (
            <ol>
              {state.guesses.map((g) => (
                <li key={g.attemptNumber} className={g.correct ? "dm-guess-won" : ""}>
                  {g.city.name} ({g.city.country}) —{" "}
                  {g.correct ? "trouvé 🎉" : g.distanceKm + " km du but"}
                </li>
              ))}
            </ol>
          )}
        </section>

        {state.journey ? (
          <table className="dm-seg-table">
            <tbody>
              {state.journey.segments.map((s) => (
                <tr className="dm-seg-row" key={s.index}>
                  <td className="dm-seg-emoji">{KIND_EMOJI[s.kind] ?? "•"}</td>
                  <td>
                    {s.from} → {s.to}
                  </td>
                  <td className="dm-seg-kind">
                    {s.modeDetail}
                    {s.lineOrCarrier ? " · " + s.lineOrCarrier : ""}
                  </td>
                  <td className="dm-seg-kind">{formatDuration(s.durationMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <p className="dm-seg-note">
          {followsTracks
            ? "Sur la carte : le train suit les voies ferrées réelles (données OpenStreetMap) ; l'arc aérien est illustratif."
            : "Tracé indicatif : infrastructure ferroviaire indisponible, lignes droites."}
        </p>

        <button className="dm-btn dm-share" type="button" onClick={copyShare}>
          {copied ? "Copié ✔" : "Copier mon résultat"}
        </button>
        {process.env.NODE_ENV === "development" ? (
          <button className="dm-btn" type="button" onClick={onReplay}>
            Rejouer (développement)
          </button>
        ) : null}
        {onReroll ? (
          <button className="dm-btn" type="button" onClick={onReroll}>
            🎲 Nouvel itinéraire (développement)
          </button>
        ) : null}
      </div>
    </div>
  );
}
